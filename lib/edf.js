/* Écriture d'un fichier EDF+ continu (« EDF+C ») à partir d'un enregistrement (globale `EdfWriter`).
 * EDF+ est le format d'échange de référence pour l'EEG ; lisible par EDFbrowser, MNE-Python, EEGLAB, FieldTrip…
 * Spécification : edfplus.info (docs/sources.html, réf. 38).
 *
 *   const bytes = EdfWriter.write(rec);          // Uint8Array, rec = lib/recording.js
 *   const parsed = EdfWriter.read(bytes);        // relecture minimale (tests) : en-têtes, signaux, annotations
 *
 * Choix :
 *   - enregistrements de données de 1 s ; nombre d'enregistrements = durée EEG arrondie à la seconde inférieure ;
 *   - chaque signal garde sa fréquence (EEG 256, PPG 64, mouvement 52 échantillons par enregistrement) ;
 *   - les flux sont alignés sur l'heure du 1er échantillon EEG ; chaque instant prend l'échantillon le plus proche
 *     dans le temps (un trou dans le flux devient un palier, et il est signalé par un événement « interruption_flux ») ;
 *   - échantillons sur 16 bits : EEG ±1000 µV (étendue du Muse 2), mouvement selon la fiche technique (±2 g, ±250 °/s),
 *     PPG selon ses valeurs min/max ;
 *   - un signal « EDF Annotations » porte l'horodatage de chaque enregistrement et les événements.
 */
class EdfWriter {
  static MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  // Texte ASCII imprimable (accents retirés, espaces remplacés par « _ » si demandé)
  static ascii(s, noSpaces = false) {
    let a = String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '');
    if (noSpaces) a = a.replace(/ /g, '_');
    return a;
  }

  static field(s, len) { return EdfWriter.ascii(s).slice(0, len).padEnd(len, ' '); }

  // Nombre écrit sur 8 caractères au plus (point décimal), en réduisant les décimales si besoin
  static num(x, len = 8) {
    for (let d = 6; d >= 0; d--) {
      const s = String(+x.toFixed(d));
      if (s.length <= len) return s;
    }
    throw new Error('Nombre trop long pour EDF : ' + x);
  }

  static write(rec) {
    const R = 1; // durée d'un enregistrement de données (s)
    const eeg = rec.streams.eeg, start = eeg.t[0];
    const records = Math.floor(eeg.t.length / eeg.rate);
    if (records < 1) throw new Error('Moins d’une seconde de signal : impossible d’écrire un fichier EDF.');

    const prefilter = rec.processing.stored === 'filtré' && rec.processing.stages ? Object.keys(rec.processing.stages).join('; ') : '';
    const signals = [];
    for (const ch of rec.channels) {
      const s = rec.streams[ch.stream], n = records * s.rate * R;
      const values = EdfWriter._resample(s.t, s.data[ch.index], start, s.rate, n);
      let pmin, pmax;
      if (ch.stream === 'eeg') { pmin = -1000; pmax = 1000; }
      else if (ch.stream === 'accel') { const m = Math.max(2, ...values.map(Math.abs)); pmin = -m; pmax = m; }
      else if (ch.stream === 'gyro') { const m = Math.max(250, ...values.map(Math.abs)); pmin = -m; pmax = m; }
      else { pmin = Math.floor(Math.min(...values)); pmax = Math.ceil(Math.max(...values)); if (pmax <= pmin) pmax = pmin + 1; }
      signals.push({
        label: ch.name, transducer: ch.stream === 'eeg' ? 'Electrode seche Muse 2' : ch.stream === 'ppg' ? 'Capteur optique PPG' : 'Capteur MEMS',
        dim: ch.units === 'n/a' ? '' : ch.units, pmin, pmax, dmin: -32768, dmax: 32767,
        prefilter: ch.stream === 'eeg' ? (rec.processing.stored === 'filtré' ? EdfWriter._prefilterFromChannel(ch) || prefilter : 'aucun (brut)') : '',
        perRecord: s.rate * R, values,
      });
    }

    // Annotations : horodatage de chaque enregistrement + événements qui commencent dans cet enregistrement
    const enc = new TextEncoder();
    const tals = [];
    for (let r = 0; r < records; r++) {
      let txt = `+${r}\x14\x14\x00`;
      for (const e of rec.events) {
        if (e.onset >= r && e.onset < r + 1 && e.onset < records) {
          txt += `+${EdfWriter.num(e.onset)}` + (e.duration > 0 ? `\x15${EdfWriter.num(e.duration)}` : '') + `\x14${EdfWriter.ascii(e.trial_type)}\x14\x00`;
        }
      }
      tals.push(enc.encode(txt));
    }
    const annSamples = Math.max(32, Math.ceil(Math.max(...tals.map((b) => b.length)) / 2));
    signals.push({ label: 'EDF Annotations', transducer: '', dim: '', pmin: -1, pmax: 1, dmin: -32768, dmax: 32767, prefilter: '', perRecord: annSamples, tals });

    // En-tête
    const ns = signals.length, d = new Date(start), p2 = (x) => String(x).padStart(2, '0');
    const startdate = `${p2(d.getDate())}-${EdfWriter.MONTHS[d.getMonth()]}-${d.getFullYear()}`;
    let h = '';
    h += EdfWriter.field('0', 8);
    h += EdfWriter.field(`${EdfWriter.ascii(rec.subject || 'X', true)} X X X`, 80); // patient : code = sujet BIDS (profil), sexe, naissance, nom inconnus
    h += EdfWriter.field(`Startdate ${startdate} ${EdfWriter.ascii(rec.name, true)} X Muse_2_InteraXon`, 80);
    h += EdfWriter.field(`${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${p2(d.getFullYear() % 100)}`, 8);
    h += EdfWriter.field(`${p2(d.getHours())}.${p2(d.getMinutes())}.${p2(d.getSeconds())}`, 8);
    h += EdfWriter.field(String(256 + ns * 256), 8);
    h += EdfWriter.field('EDF+C', 44);
    h += EdfWriter.field(String(records), 8);
    h += EdfWriter.field(String(R), 8);
    h += EdfWriter.field(String(ns), 4);
    const per = (key, len, fmt = (v) => v) => signals.map((s) => EdfWriter.field(fmt(s[key]), len)).join('');
    h += per('label', 16) + per('transducer', 80) + per('dim', 8) + per('pmin', 8, EdfWriter.num) + per('pmax', 8, EdfWriter.num)
      + per('dmin', 8, String) + per('dmax', 8, String) + per('prefilter', 80) + per('perRecord', 8, String) + signals.map(() => ' '.repeat(32)).join('');

    // Données : pour chaque enregistrement, chaque signal à la suite (entiers 16 bits petit-boutistes)
    const recordBytes = signals.reduce((a, s) => a + 2 * s.perRecord, 0);
    const out = new Uint8Array(h.length + records * recordBytes);
    for (let i = 0; i < h.length; i++) out[i] = h.charCodeAt(i);
    const view = new DataView(out.buffer);
    let o = h.length;
    for (let r = 0; r < records; r++) {
      for (const s of signals) {
        if (s.tals) { out.set(s.tals[r], o); o += 2 * s.perRecord; continue; } // reste à 0x00
        const scale = (s.dmax - s.dmin) / (s.pmax - s.pmin);
        for (let k = 0; k < s.perRecord; k++) {
          const v = s.values[r * s.perRecord + k];
          const dig = Math.max(s.dmin, Math.min(s.dmax, Math.round((v - s.pmin) * scale + s.dmin)));
          view.setInt16(o, dig, true);
          o += 2;
        }
      }
    }
    return out;
  }

  static _prefilterFromChannel(ch) {
    const parts = [];
    if (ch.low_cutoff !== 'n/a') parts.push(`HP:${ch.low_cutoff}Hz`);
    if (ch.high_cutoff !== 'n/a') parts.push(`LP:${ch.high_cutoff}Hz`);
    if (ch.notch !== 'n/a') parts.push(`N:${ch.notch}Hz`);
    return parts.join(' ');
  }

  // n valeurs aux instants start + k/rate : échantillon le plus proche dans le temps (pointeur croissant)
  static _resample(t, v, start, rate, n) {
    const out = new Array(n);
    let j = 0;
    for (let k = 0; k < n; k++) {
      const tau = start + (k * 1000) / rate;
      while (j < t.length - 1 && Math.abs(t[j + 1] - tau) <= Math.abs(t[j] - tau)) j++;
      out[k] = v.length ? v[j] : 0;
    }
    return out;
  }

  /* ---------- Relecture (tests et vérification) ---------- */

  static read(bytes) {
    const txt = (a, b) => String.fromCharCode(...bytes.subarray(a, b)).trim();
    const ns = +txt(252, 256), records = +txt(236, 244), headerBytes = +txt(184, 192);
    const col = (offset, len) => Array.from({ length: ns }, (_, i) => txt(256 + offset * ns + i * len, 256 + offset * ns + (i + 1) * len));
    let off = 0;
    const take = (len) => { const c = col(off, len); off += len; return c; };
    const labels = take(16), transducers = take(80), dims = take(8), pmin = take(8).map(Number), pmax = take(8).map(Number),
      dmin = take(8).map(Number), dmax = take(8).map(Number), prefilter = take(80), perRecord = take(8).map(Number);
    const header = { version: txt(0, 8), patient: txt(8, 88), recording: txt(88, 168), startdate: txt(168, 176), starttime: txt(176, 184),
      headerBytes, reserved: txt(192, 236), records, recordDuration: +txt(244, 252), ns };
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const signals = labels.map((label, i) => ({ label, transducer: transducers[i], dim: dims[i], pmin: pmin[i], pmax: pmax[i], dmin: dmin[i], dmax: dmax[i], prefilter: prefilter[i], perRecord: perRecord[i], values: [] }));
    const annotations = [];
    let o = headerBytes;
    for (let r = 0; r < records; r++) {
      for (const s of signals) {
        if (s.label === 'EDF Annotations') {
          const raw = new TextDecoder().decode(bytes.subarray(o, o + 2 * s.perRecord));
          raw.split('\x00').filter(Boolean).forEach((tal) => {
            const [time, ...texts] = tal.split('\x14');
            const [onset, duration] = time.split('\x15');
            texts.filter(Boolean).forEach((text) => annotations.push({ onset: +onset, duration: duration ? +duration : 0, text }));
            if (!texts.some(Boolean)) annotations.push({ onset: +onset, timekeeping: true });
          });
        } else {
          const scale = (s.pmax - s.pmin) / (s.dmax - s.dmin);
          for (let k = 0; k < s.perRecord; k++) s.values.push((view.getInt16(o + 2 * k, true) - s.dmin) * scale + s.pmin);
        }
        o += 2 * s.perRecord;
      }
    }
    return { header, signals, annotations };
  }
}
