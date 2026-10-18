/* Modèle du regard (globale `GazeModel`) et mesure AF7 − AF8 (globale `GazeMeter`) : de quoi comparer ce que la THÉORIE
 * attend (l'œil est un dipôle, l'écart AF7 − AF8 est proportionnel à l'angle du regard) à ce que le casque mesure.
 * Sans interface. Convention (celle de ArtifactDetector et du simulateur) : position du regard +1 = bord GAUCHE de
 * l'écran, −1 = bord DROIT ; un regard à gauche donne un écart AF7 − AF8 positif quand le montage est « normal ».
 *
 * Protocole de test (le même pour la calibration et l'étude en direct), durée GazeModel.DURATION (38 s) :
 *   2 s au centre · 8 fixations de 3 s (0,5 · 1 · 0,5 · 0 · −0,5 · −1 · −0,5 · 0) · un balayage lent de 12 s (sinus)
 *   GazeModel.target(t) -> position -1..+1 (null hors du protocole) ; GazeModel.holds() -> [{ from, to, pos }]
 *
 * Théorie : GazeModel.THEORY_UV_PER_DEG (2,5 µV/° : valeur d'illustration de la page Science, PAS une mesure du Muse).
 *   GazeModel.halfAngle(largeurCm, distanceCm)    demi-angle de l'écran (°) quand le point est au bord (94 % de la largeur)
 *   GazeModel.theoryGain(halfAngleDeg)            µV d'écart attendus pour une position de ±1
 *   GazeModel.expected(pos, { gain, offset })     écart attendu (µV) pour une position
 *
 * Mesure :
 *   const meter = new GazeMeter(rate = 256);      meter.feed(canal, échantillons) (AF7 = 1, AF8 = 2, autres ignorés)
 *   meter.frames   [{ t (s), d (µV, AF7 − AF8 passe-bas 6 Hz) }] à 64 Hz ; meter.onFrame = (frame) => {} ; meter.reset()
 *
 * Analyse d'un essai (frames de l'essai, t = 0 au début du protocole) :
 *   GazeModel.analyse(frames, { halfAngleDeg }) -> {
 *     n (images retenues), rejected (part rejetée : clignements, pics), r (± √R² partiel : corrélation avec la position une fois la
 *     dérive lente retirée), lagS (0..0,6 s : réaction + retard du filtrage),
 *     gain (µV par unité de position), offset (niveau du centre en fin de test, µV), drift(t) (niveau du centre à l'instant t :
 *     polynôme de degré 3), driftPtp (amplitude de la dérive, µV), rmse (µV, écart du modèle linéaire), noise (µV, écart-type au centre),
 *     gainLeft / gainRight (pente côté +/− séparément), asymmetry (|gainLeft − gainRight| / moyenne),
 *     droop (rapport fin / début des fixations excentrées ; 1 = pas d'affaissement, 0 = le signal est retombé),
 *     theoryGain, ratio (|gain| / théorie) } | null s'il y a trop peu de données
 *   GazeModel.verdict(analyse) -> { level: 'bon' | 'moyen' | 'faible', text } (les seuils sont des choix de l'application)
 * Enregistrement d'une expérience (le signal étudié) :
 *   GazeModel.experimentFiles({ name, notes, source, rate, af7, af8, analysis, calibration, setup, context }) -> [{ name, data }]
 *     signal.csv (t_s, af7_uv, af8_uv, diff_uv, position_demandee : brut 256 Hz) + meta.json (modalités, mesures, contexte) ;
 *     à écrire avec SampleFolder.writeExperiment (dossier echantillons/experience/<nom>/).
 * Les résultats sont à interpréter avec les limites de la page Science : rien n'est validé sur casque réel. */
class GazeMeter {
  constructor(rate = 256) {
    this.rate = rate;
    this.step = 4;                       // 256 / 4 = 64 images par seconde
    this.a = Signal.onePoleCoef(GazeMeter.CUTOFF_HZ, rate);
    this.onFrame = null;
    this.reset();
  }

  static CUTOFF_HZ = 6;
  static MAX_S = 120;

  reset() {
    this.frames = [];
    this._q = { 1: [], 2: [] };
    this._lp = null;
    this._n = 0;
  }

  feed(channel, samples) {
    const q = this._q[channel];
    if (!q) return;
    q.push(...samples);
    const n = Math.min(this._q[1].length, this._q[2].length);
    for (let i = 0; i < n; i++) {
      const d = this._q[1][i] - this._q[2][i];
      this._lp = this._lp === null ? d : this._lp + this.a * (d - this._lp);
      if (this._n++ % this.step === 0) {
        const f = { t: (this._n - 1) / this.rate, d: this._lp };
        this.frames.push(f);
        if (this.onFrame) this.onFrame(f);
      }
    }
    this._q[1].splice(0, n); this._q[2].splice(0, n);
    for (const k of [1, 2]) if (this._q[k].length > 512) this._q[k].splice(0, this._q[k].length - 512); // canal muet
    const max = GazeMeter.MAX_S * this.rate / this.step;
    if (this.frames.length > max) this.frames.splice(0, this.frames.length - max);
  }
}

const GazeModel = {
  LEAD_S: 2, HOLD_S: 3, HOLDS: [0.5, 1, 0.5, 0, -0.5, -1, -0.5, 0], SWEEP_S: 12,
  THEORY_UV_PER_DEG: 2.5, DEFAULT_WIDTH_CM: 34, DEFAULT_DISTANCE_CM: 60, EDGE: 0.94,
  MAX_LAG_S: 0.6, MIN_R: 0.5,

  get DURATION() { return GazeModel.LEAD_S + GazeModel.HOLDS.length * GazeModel.HOLD_S + GazeModel.SWEEP_S; },

  target(t) {
    const M = GazeModel, holdEnd = M.LEAD_S + M.HOLDS.length * M.HOLD_S;
    if (t < 0 || t > M.DURATION) return null;
    if (t < M.LEAD_S) return 0;
    if (t < holdEnd) return M.HOLDS[Math.floor((t - M.LEAD_S) / M.HOLD_S)];
    return Math.sin((2 * Math.PI * (t - holdEnd)) / M.SWEEP_S);
  },

  holds() {
    const M = GazeModel;
    return M.HOLDS.map((pos, i) => ({ from: M.LEAD_S + i * M.HOLD_S, to: M.LEAD_S + (i + 1) * M.HOLD_S, pos }));
  },

  halfAngle(widthCm, distanceCm) {
    return (Math.atan((GazeModel.EDGE * widthCm) / 2 / distanceCm) * 180) / Math.PI;
  },
  theoryGain(halfAngleDeg) { return GazeModel.THEORY_UV_PER_DEG * halfAngleDeg; },
  expected(pos, model) { return (model.offset || 0) + model.gain * pos; },

  // Moindres carrés : colonnes = fonctions de base (position, 1, dérive t, t², t³), lignes = images. Résout (AᵀA)x = Aᵀy.
  _lsq(rows, ys) {
    const k = rows[0].length, A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
    rows.forEach((r, i) => { for (let a = 0; a < k; a++) { for (let b = 0; b < k; b++) A[a][b] += r[a] * r[b]; A[a][k] += r[a] * ys[i]; } });
    for (let c = 0; c < k; c++) {   // élimination de Gauss avec pivot
      let p = c;
      for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]];
      if (Math.abs(A[c][c]) < 1e-12) return null;
      for (let r = 0; r < k; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j]; }
    }
    return A.map((row, i) => row[k] / row[i]);
  },

  // Ajuste d ≈ gain·position(t − décalage) + dérive lente (polynôme de degré 3 sur le test : AF7 − AF8 dérive de
  // plusieurs dizaines de µV) ; deux passes, la 2e sans les images à plus de 3 écarts absolus médians (clignements, pics).
  // R² partiel = part de la variance, une fois la dérive retirée, que la position explique ; r = ± √R².
  _fit(frames, lag) {
    const M = GazeModel, T = M.DURATION, feats = (p, t) => { const u = t / T - 0.5; return [Math.max(p, 0), Math.min(p, 0), 1, u, u * u, u * u * u]; };   // pente côté gauche, côté droit, dérive
    let pts = frames.map((f) => ({ t: f.t, d: f.d, p: M.target(f.t - lag) })).filter((x) => x.p !== null);
    if (pts.length < 64 * 10) return null;
    let c = M._lsq(pts.map((x) => feats(x.p, x.t)), pts.map((x) => x.d));
    if (!c) return null;
    const res = (x, cc) => x.d - feats(x.p, x.t).reduce((s, v, i) => s + v * cc[i], 0);
    const abs = pts.map((x) => Math.abs(res(x, c))).sort((a, b) => a - b);
    const lim = Math.max(1, 3 * 1.4826 * abs[Math.floor(abs.length / 2)]);
    const kept = pts.filter((x) => Math.abs(res(x, c)) <= lim);
    if (kept.length >= 64 * 10) { const c2 = M._lsq(kept.map((x) => feats(x.p, x.t)), kept.map((x) => x.d)); if (c2) { c = c2; pts = kept; } }
    const sse = pts.reduce((s, x) => s + res(x, c) ** 2, 0);
    const c0 = M._lsq(pts.map((x) => feats(x.p, x.t).slice(2)), pts.map((x) => x.d));
    const sse0 = c0 ? pts.reduce((s, x) => s + (x.d - feats(x.p, x.t).slice(2).reduce((q, v, i) => q + v * c0[i], 0)) ** 2, 0) : 0;
    const r2 = sse0 > 0 ? Math.max(0, 1 - sse / sse0) : 0;
    return { c, pts, sse, r: Math.sign(c[0] + c[1]) * Math.sqrt(r2), kept: pts.length };
  },

  analyse(frames, { halfAngleDeg = GazeModel.halfAngle(GazeModel.DEFAULT_WIDTH_CM, GazeModel.DEFAULT_DISTANCE_CM) } = {}) {
    const M = GazeModel, T = M.DURATION, inRange = frames.filter((f) => f.t >= 0 && f.t <= T);
    if (inRange.length < 64 * 10) return null;
    let best = null;
    for (let lag = 0; lag <= M.MAX_LAG_S + 1e-9; lag += 0.05) {
      const fit = M._fit(inRange, lag);
      if (fit && (!best || Math.abs(fit.r) > Math.abs(best.fit.r))) best = { lag, fit };
    }
    if (!best) return null;
    const lag = best.lag, fit = best.fit, c = fit.c;
    const drift = (t) => { const u = t / T - 0.5; return c[2] + c[3] * u + c[4] * u * u + c[5] * u * u * u; };   // niveau du « centre » à l'instant t
    const dd = (f) => f.d - drift(f.t);                                                                        // signal sans la dérive
    const rmse = Math.sqrt(fit.sse / fit.pts.length);
    const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    const gainLeft = c[0], gainRight = c[1], gain = (c[0] + c[1]) / 2;   // µV par unité de position, côté gauche / côté droit
    const during = (a, b, pos) => inRange.filter((f) => f.t >= a + lag && f.t < b + lag).map((f) => dd(f) * Math.sign(pos));
    const ratios = M.holds().filter((h) => Math.abs(h.pos) >= 0.9).map((h) => {
      const early = mean(during(h.from + 0.3, h.from + 1.0, h.pos)), late = mean(during(h.to - 1.0, h.to - 0.1, h.pos));
      return early > 0 ? late / early : null;
    }).filter((x) => x !== null);
    const resid = fit.pts.filter((x) => Math.abs(x.p) < 0.05).map((x) => x.d - drift(x.t) - 0);
    const noise = resid.length ? Math.sqrt(mean(resid.map((x) => (x - mean(resid)) ** 2))) : 0;
    let lo = Infinity, hi = -Infinity;
    for (let t = 0; t <= T; t += 0.5) { const v = drift(t); lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const theoryGain = M.theoryGain(halfAngleDeg), gl = Math.abs(gainLeft), gr = Math.abs(gainRight);
    return {
      n: fit.kept, rejected: 1 - fit.kept / inRange.filter((f) => M.target(f.t - lag) !== null).length,
      r: fit.r, lagS: lag, gain, offset: drift(T), drift, driftPtp: hi - lo, rmse, noise,
      gainLeft, gainRight, asymmetry: gl + gr ? Math.abs(gl - gr) / ((gl + gr) / 2) : 0,
      droop: ratios.length ? ratios.sort((a, b) => a - b)[Math.floor(ratios.length / 2)] : null,
      halfAngleDeg, theoryGain, ratio: Math.abs(gain) / theoryGain,
    };
  },

  experimentFiles({ name, notes = '', source, rate = 256, af7, af8, analysis, calibration, setup, context = {} }) {
    const n = Math.min(af7.length, af8.length), M = GazeModel, rows = ['t_s,af7_uv,af8_uv,diff_uv,position_demandee'];
    for (let i = 0; i < n; i++) {
      const t = i / rate, p = M.target(t);
      rows.push([t.toFixed(4), af7[i].toFixed(2), af8[i].toFixed(2), (af7[i] - af8[i]).toFixed(2), p === null ? '' : p.toFixed(4)].join(','));
    }
    const { drift, ...metrics } = analysis || {};
    const meta = {
      experience: name, type: 'regard-theorie-vs-realite', date: new Date().toISOString(), source, notes,
      protocole: { dureeS: M.DURATION, centreS: M.LEAD_S, fixationS: M.HOLD_S, fixations: M.HOLDS, balayageS: M.SWEEP_S, convention: 'position +1 = bord gauche de l’écran' },
      theorie: { uvParDegre: M.THEORY_UV_PER_DEG, nature: 'valeur d’illustration, pas une mesure du Muse' },
      ecran: setup, tauxHz: rate, echantillons: n, mesures: metrics, calibration: calibration || null, contexte: context,
      fichiers: { 'signal.csv': 'brut AF7 et AF8 (µV), écart, position demandée au même instant (vide hors protocole)' },
    };
    return [{ name: 'signal.csv', data: rows.join('\n') + '\n' }, { name: 'meta.json', data: JSON.stringify(meta, null, 2) }];
  },

  verdict(a) {
    if (!a) return { level: 'faible', text: 'Pas assez de données.' };
    const R = Math.abs(a.r);
    if (R < GazeModel.MIN_R) return { level: 'faible', text: 'Le signal ne suit pas le point (corrélation trop basse) : la théorie ne se vérifie pas ici, ou le test est à refaire (contact, clignements, yeux qui ne suivent pas).' };
    const near = a.ratio >= 0.5 && a.ratio <= 2;
    if (R >= 0.8 && near) return { level: 'bon', text: 'Le signal suit bien la forme attendue (proportionnel à la position) et son ordre de grandeur est proche de la théorie.' };
    if (R >= 0.8) return { level: 'moyen', text: 'La forme est bien celle de la théorie (proportionnelle à la position), mais le gain mesuré est ' + (a.ratio > 2 ? 'bien plus grand' : 'bien plus petit') + ' que celui d’illustration : il dépend de la personne, du contact et de la distance, d’où la calibration.' };
    return { level: 'moyen', text: 'Le signal suit en partie le point : la théorie est une approximation grossière ici (voir affaissement, asymétrie, décalage).' };
  },
};
