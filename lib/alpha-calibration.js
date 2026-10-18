/* Profil alpha personnel : réactivité yeux fermés / ouverts et fréquence alpha individuelle (globale `AlphaCalibrator`).
 * Sans interface. Effet de Berger : fermer les yeux renforce nettement le rythme alpha (8–13 Hz), surtout à
 * l'arrière de la tête (TP9 / TP10 sur le Muse). La fréquence du pic alpha (IAF) varie d'une personne à l'autre
 * (≈ 8 à 12 Hz) : c'est un repère personnel pour placer les bandes. Explications : docs/science.html (« alpha »).
 *
 *   AlphaCalibrator.load()  .save(p)  .clear()          // profil du profil actif (clé « alphaProfile »)
 *   const runner = new AlphaCalibrator(ctx);             // ctx : CalibrationContext ; contrat : lib/step-calibrator.js
 *   AlphaCalibrator.analyse(spectres)                    // { open: [psd moyenne | null par canal], closed: [...] } -> profil
 *
 * Mesure : de la 4e à la dernière seconde de chaque étape (on laisse l'alpha s'installer), chaque seconde, spectre
 * de Welch (fenêtre de 4 s, résolution 0,5 Hz) des électrodes utilisables ; moyenne par électrode.
 * Profil : { version, date, iaf (Hz), reactivity (médiane des rapports alpha fermés / ouverts), perChannel: [rapport | null] }
 * Réussite : réactivité >= MIN_REACTIVITY (sinon le profil précédent est conservé). Les deux étapes vont ensemble.
 */
class AlphaCalibrator extends StepCalibrator {
  static MIN_REACTIVITY = 1.2;
  static NFFT = 512;
  static STEPS = [
    { id: 'open', label: 'Yeux ouverts', seconds: 20, emoji: '👀',
      instruction: 'Yeux ouverts, regard posé sur un point, détendu. Cligne normalement.' },
    { id: 'closed', label: 'Yeux fermés', seconds: 20, emoji: '😌', prepareS: 5, eyesClosed: true,
      instruction: 'Ferme les yeux et détends-toi, sans dormir. Un double bip te dira de les rouvrir.' },
  ];

  static load() { return Profiles.get('alphaProfile', null); }
  static save(p) { Profiles.set('alphaProfile', p); }
  static clear() { Profiles.unset('alphaProfile'); }

  constructor(ctx, options) {
    super(ctx, AlphaCalibrator.STEPS, options);
    this.result = AlphaCalibrator.load();
    if (this.result) this._statuses.forEach((s) => Object.assign(s, { status: 'ok', message: 'mesuré' }));
    this._spectra = {};
  }

  start() { return super.start(null); } // ouverts et fermés se comparent : toujours les deux

  _beginStep(step) { this._acc = this._spectra[step.id] = { sum: [null, null, null, null], n: [0, 0, 0, 0], freqs: null }; }

  _sample(step, t) {
    if (t < 4) return;
    const win = this.ctx.window(4);
    if (!win) return;
    for (const c of this.ctx.usableChannels()) {
      const spec = Signal.welch(win[c], this.ctx.rate, AlphaCalibrator.NFFT), a = this._acc;
      a.freqs = spec.freqs;
      a.sum[c] = a.sum[c] ? a.sum[c].map((v, k) => v + spec.psd[k]) : Array.from(spec.psd);
      a.n[c]++;
    }
  }

  _mean(id) {
    const a = this._spectra[id];
    return a ? { freqs: a.freqs, psd: a.sum.map((s, c) => (s && a.n[c] >= 5 ? s.map((v) => v / a.n[c]) : null)) } : null;
  }

  _analyse(step) {
    const m = this._mean(step.id);
    if (!m || m.psd.every((p) => !p)) return { ok: false, message: 'pas assez de signal propre — vérifie le contact et reste immobile' };
    if (step.id === 'open') return { ok: true, message: 'spectre de référence mesuré' };
    const open = this._mean('open');
    if (!open) return { ok: false, message: 'fais d’abord l’étape « Yeux ouverts »' };
    this._profile = AlphaCalibrator.analyse({ freqs: m.freqs, open: open.psd, closed: m.psd });
    const p = this._profile;
    if (!p) return { ok: false, message: 'aucune électrode mesurée dans les deux étapes' };
    const txt = `alpha ×${p.reactivity.toFixed(1)} yeux fermés, pic à ${p.iaf.toFixed(1)} Hz`;
    if (p.reactivity < AlphaCalibrator.MIN_REACTIVITY) {
      this._profile = null;
      return { ok: false, message: `pas de hausse nette de l’alpha (${txt}) — ferme bien les yeux et relâche-toi` };
    }
    return { ok: true, message: txt };
  }

  // { freqs, open: [psd | null], closed: [psd | null] } -> profil (ou null si aucune électrode commune)
  static analyse({ freqs, open, closed }) {
    const alpha = (psd) => Signal.powerBetween({ freqs, psd }, 8, 13);
    const perChannel = open.map((o, c) => (o && closed[c] ? alpha(closed[c]) / (alpha(o) + 1e-12) : null));
    const ratios = perChannel.filter((r) => r != null).sort((a, b) => a - b);
    if (!ratios.length) return null;
    const closedList = closed.filter(Boolean);
    const avg = freqs.map((f, k) => closedList.reduce((s, p) => s + p[k], 0) / closedList.length);
    return { version: 1, date: new Date().toISOString(), iaf: AlphaCalibrator.peak(freqs, avg, 7, 13),
      reactivity: ratios[Math.floor((ratios.length - 1) / 2)], perChannel };
  }

  // Fréquence du maximum entre f1 et f2, affinée par interpolation parabolique sur les 3 points autour du pic.
  static peak(freqs, psd, f1, f2) {
    let best = -1;
    freqs.forEach((f, k) => { if (f >= f1 && f <= f2 && (best < 0 || psd[k] > psd[best])) best = k; });
    if (best <= 0 || best >= psd.length - 1) return freqs[best];
    const [a, b, c] = [psd[best - 1], psd[best], psd[best + 1]], den = a - 2 * b + c;
    const shift = den ? (0.5 * (a - c)) / den : 0;
    return freqs[best] + shift * (freqs[1] - freqs[0]);
  }

  _finish() {
    if (!this._profile) return AlphaCalibrator.load();
    AlphaCalibrator.save(this._profile);
    return this._profile;
  }

  _forget() { AlphaCalibrator.clear(); this._spectra = {}; }
}

Calibrations.register({
  id: 'alpha', order: 20, label: 'Profil alpha (yeux fermés)', emoji: '🌙', project: 'calibration', profileKey: 'alphaProfile',
  description: 'Yeux ouverts puis fermés : réactivité de ton rythme alpha et fréquence de ton pic alpha personnel.',
  steps: AlphaCalibrator.STEPS,
  status() {
    const p = AlphaCalibrator.load();
    return p ? { done: true, date: p.date, summary: `pic alpha ${p.iaf.toFixed(1)} Hz, ×${p.reactivity.toFixed(1)} yeux fermés`, failed: 0 }
      : { done: false, summary: 'non mesuré', failed: 0 };
  },
  create: (ctx) => new AlphaCalibrator(ctx),
});
