/* Outils de traitement du signal (globale `Signal`). Aucune dépendance, indépendant du Bluetooth.
 *
 *   Signal.fft(re, im)            FFT radix-2 en place (longueur = puissance de 2)
 *   Signal.BANDS                  bandes EEG : { name, range: [Hz min, Hz max], color }
 *   Signal.centered(samples)      échantillons moins leur moyenne (retire le décalage continu)
 *   Signal.welch(samples, rate=256, nfft=256, keep=null)   DSP de Welch { freqs, psd, segments } (il faut >= nfft
 *                                               échantillons) ; keep = indices des segments à moyenner (défaut : tous)
 *   Signal.periodograms(samples, rate=256, nfft=256)   { freqs, list: [{ start, psd }] } : un périodogramme par
 *                                               segment de Welch (Hann, recouvrement 50 %)
 *   Signal.powerBetween(spec, f1, f2)           puissance (µV²) entre f1 et f2 Hz
 *   Signal.bandPowersFromPsd(spec)              puissance relative par bande (somme = 1) ; usage :
 *                                               Signal.bandPowersFromPsd(Signal.welch(échantillons))
 *   Signal.stats(samples)         { n, mean, std (écart-type), rms (valeur efficace √moyenne(x²)), min, max, ptp }
 *   Signal.spectrogram(samples, rate, { win, step, fMax })   { times, freqs, db }
 *   Signal.onePoleCoef(fc, rate)  coefficient a d'un filtre d'ordre 1 y += a·(x − y), coupure fc Hz : 1 − e^(−2π·fc/rate)
 *   Signal.smoothCoef(tauS, rate) coefficient a d'un lissage exponentiel de constante de temps tauS s : 1 − e^(−1/(tauS·rate))
 */
const Signal = {
  fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = i + k + len / 2;
          const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  },

  BANDS: [
    { name: 'Delta', range: [1, 4], color: '#6c8cff' },
    { name: 'Theta', range: [4, 8], color: '#2fc7b8' },
    { name: 'Alpha', range: [8, 13], color: '#7ddc6b' },
    { name: 'Bêta', range: [13, 30], color: '#f5b84a' },
    { name: 'Gamma', range: [30, 45], color: '#ef6f6c' },
  ],

  centered(samples) {
    const mean = samples.reduce((a, b) => a + b, 0) / (samples.length || 1);
    return samples.map((v) => v - mean);
  },

  // Périodogrammes des segments de Welch : segments de nfft points (fenêtre de Hann), recouvrement 50 %, décalage
  // continu de chaque segment retiré. Retourne { freqs, list: [{ start (1er échantillon du segment), psd (µV²/Hz) }] }.
  // Sert à ne moyenner que certains segments (ceux qu'aucun artefact ne touche : MentalState.measure).
  periodograms(samples, rate = 256, nfft = 256) {
    const step = nfft / 2, win = new Float64Array(nfft);
    let wPow = 0;
    for (let i = 0; i < nfft; i++) { win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (nfft - 1)); wPow += win[i] * win[i]; }
    const list = [];
    for (let start = 0; start + nfft <= samples.length; start += step) {
      let mean = 0;
      for (let i = 0; i < nfft; i++) mean += samples[start + i];
      mean /= nfft;
      const re = new Float64Array(nfft), im = new Float64Array(nfft), psd = new Float64Array(nfft / 2 + 1);
      for (let i = 0; i < nfft; i++) re[i] = (samples[start + i] - mean) * win[i];
      Signal.fft(re, im);
      for (let k = 0; k <= nfft / 2; k++) psd[k] = ((k === 0 || k === nfft / 2 ? 1 : 2) * (re[k] * re[k] + im[k] * im[k])) / (rate * wPow);
      list.push({ start, psd });
    }
    return { freqs: Array.from({ length: nfft / 2 + 1 }, (_, k) => (k * rate) / nfft), list };
  },

  // Densité spectrale de puissance par la méthode de Welch : moyenne des périodogrammes des segments (periodograms),
  // ou seulement des segments d'indices `keep`. Retourne { freqs, psd } (µV²/Hz) de 0 à rate/2, et `segments` =
  // nombre de segments moyennés. Moins bruité qu'une seule FFT.
  welch(samples, rate = 256, nfft = 256, keep = null) {
    const { freqs, list } = Signal.periodograms(samples, rate, nfft);
    const used = keep ? keep.map((k) => list[k]).filter(Boolean) : list, psd = new Array(nfft / 2 + 1).fill(0);
    for (const seg of used) for (let k = 0; k < psd.length; k++) psd[k] += seg.psd[k];
    if (used.length) for (let k = 0; k < psd.length; k++) psd[k] /= used.length;
    return { freqs, psd, segments: used.length };
  },

  // Puissance (µV²) entre f1 et f2 Hz à partir d'une DSP { freqs, psd }.
  powerBetween({ freqs, psd }, f1, f2) {
    const df = freqs[1] - freqs[0];
    let p = 0;
    for (let k = 0; k < psd.length; k++) if (freqs[k] >= f1 && freqs[k] < f2) p += psd[k] * df;
    return p;
  },

  // Puissance relative par bande (somme = 1) à partir d'une DSP (ex. issue de welch).
  bandPowersFromPsd(spec) {
    const res = Signal.BANDS.map((b) => Signal.powerBetween(spec, b.range[0], b.range[1]));
    const total = res.reduce((a, b) => a + b, 0) || 1;
    return res.map((v) => v / total);
  },

  // Statistiques simples d'un tableau : moyenne, écart-type (std, autour de la moyenne), valeur efficace
  // (rms = √moyenne(x²), décalage continu compris), min, max, crête à crête
  stats(samples) {
    const n = samples.length;
    if (!n) return { n: 0, mean: 0, std: 0, rms: 0, min: 0, max: 0, ptp: 0 };
    let sum = 0, sum2 = 0, min = Infinity, max = -Infinity;
    for (const v of samples) { sum += v; sum2 += v * v; if (v < min) min = v; if (v > max) max = v; }
    const mean = sum / n;
    let sq = 0;
    for (const v of samples) sq += (v - mean) * (v - mean);
    const std = Math.sqrt(sq / n);
    return { n, mean, std, rms: Math.sqrt(sum2 / n), min, max, ptp: max - min };
  },

  // Spectrogramme (temps-fréquence) : FFT de fenêtres de `win` points (Hann) tous les `step` points.
  // Retourne { times (s, centre des fenêtres), freqs (Hz), db: [temps][fréquence] } jusqu'à fMax.
  spectrogram(samples, rate = 256, { win = 256, step = 32, fMax = 45 } = {}) {
    const times = [], db = [], kMax = Math.min(win / 2, Math.floor((fMax * win) / rate));
    const freqs = Array.from({ length: kMax + 1 }, (_, k) => (k * rate) / win);
    const w = Array.from({ length: win }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (win - 1)));
    for (let s = 0; s + win <= samples.length; s += step) {
      let mean = 0;
      for (let i = 0; i < win; i++) mean += samples[s + i];
      mean /= win;
      const re = new Float64Array(win), im = new Float64Array(win);
      for (let i = 0; i < win; i++) re[i] = (samples[s + i] - mean) * w[i];
      Signal.fft(re, im);
      const row = [];
      for (let k = 0; k <= kMax; k++) row.push(10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-9));
      db.push(row);
      times.push((s + win / 2) / rate);
    }
    return { times, freqs, db };
  },

  // Coefficient d'un filtre d'ordre 1 (y += a·(x − y)) de fréquence de coupure fc Hz.
  onePoleCoef(fc, rate) {
    return 1 - Math.exp((-2 * Math.PI * fc) / rate);
  },

  // Coefficient d'un lissage exponentiel de constante de temps tauS secondes.
  smoothCoef(tauS, rate) {
    return 1 - Math.exp(-1 / (tauS * rate));
  },
};
