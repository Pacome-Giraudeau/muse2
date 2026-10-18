/* Calibration du regard (globale `GazeCalibrator`) : relie la POSITION du regard (point à suivre plein écran) à l'écart
 * AF7 − AF8 mesuré, pour pouvoir comparer ensuite l'attendu au réel (projet « Regard »). Sans interface.
 * Différente de l'étape « Regard guidé » de la calibration des artefacts (qui règle un SEUIL de détection) : celle-ci
 * mesure le GAIN (µV par position), le décalage de réaction, l'affaissement et l'asymétrie. Modèle : lib/gaze-model.js.
 *
 *   GazeCalibrator.load()  .save(cal)  .clear()           // résultat du profil actif (clé « gazeMap »)
 *   GazeCalibrator.setup() -> { widthCm, distanceCm }     // taille de l'écran et distance des yeux (clé « gazeSetup »)
 *   GazeCalibrator.saveSetup({ widthCm, distanceCm })  GazeCalibrator.halfAngle()   // demi-angle de l'écran (°)
 *   const runner = new GazeCalibrator(ctx);               // ctx : CalibrationContext ; contrat : lib/step-calibrator.js
 *
 * Une étape de GazeModel.DURATION secondes avec un point à suivre (step.target(t), GazeModel.target). Chaque seconde,
 * la dernière seconde de BRUT (ctx.rawWindow) alimente un GazeMeter ; à la fin, GazeModel.analyse.
 * Réussite : |corrélation| >= GazeModel.MIN_R (sinon le résultat précédent est conservé).
 * Résultat : { version, date, gain, offset, r, lagS, noise, asymmetry, droop, ratio, halfAngleDeg, theoryGain }
 *   (gain en µV pour une position de ±1 ; gain > 0 : un regard à gauche donne AF7 − AF8 > 0). */
class GazeCalibrator extends StepCalibrator {
  static STEPS = [{
    id: 'map', label: 'Regard étalonné', seconds: Math.round(GazeModel.DURATION), emoji: '🎯',
    instruction: 'Suis le point des yeux, sans bouger la tête : il reste immobile quelques secondes à chaque position, puis balaie l’écran.',
    target: (t) => GazeModel.target(t),
  }];

  constructor(ctx, opts) {
    super(ctx, GazeCalibrator.STEPS, opts);
    this._meter = null; this._last = null;
  }

  static load() { return Profiles.get('gazeMap', null); }
  static save(cal) { Profiles.set('gazeMap', cal); }
  static clear() { Profiles.unset('gazeMap'); }
  static setup() {
    return { widthCm: GazeModel.DEFAULT_WIDTH_CM, distanceCm: GazeModel.DEFAULT_DISTANCE_CM, ...(Profiles.get('gazeSetup', null) || {}) };
  }
  static saveSetup(s) { Profiles.set('gazeSetup', { widthCm: s.widthCm, distanceCm: s.distanceCm }); }
  static halfAngle() { const s = GazeCalibrator.setup(); return GazeModel.halfAngle(s.widthCm, s.distanceCm); }

  _beginStep() { this._meter = new GazeMeter(this.ctx.rate); this._last = null; }

  _sample() {
    const w = this.ctx.rawWindow(1);
    if (!w) return;
    this._meter.feed(1, w[1]);
    this._meter.feed(2, w[2]);
  }

  _analyse() {
    const a = GazeModel.analyse(this._meter.frames, { halfAngleDeg: GazeCalibrator.halfAngle() });
    this._last = a;
    if (!a) return { ok: false, message: 'Pas assez de signal.' };
    const ok = Math.abs(a.r) >= GazeModel.MIN_R;
    return { ok, message: ok ? `corrélation ${a.r.toFixed(2)}, gain ${a.gain.toFixed(0)} µV` : `le signal ne suit pas le point (corrélation ${a.r.toFixed(2)})` };
  }

  _finish() {
    const a = this._last;
    if (!a || Math.abs(a.r) < GazeModel.MIN_R) return GazeCalibrator.load();
    const cal = {
      version: 1, date: new Date().toISOString(), gain: a.gain, offset: a.offset, r: a.r, lagS: a.lagS, noise: a.noise,
      asymmetry: a.asymmetry, droop: a.droop, ratio: a.ratio, halfAngleDeg: a.halfAngleDeg, theoryGain: a.theoryGain,
    };
    GazeCalibrator.save(cal);
    return cal;
  }

  _forget() { GazeCalibrator.clear(); }
}

Calibrations.register({
  id: 'regard', order: 15, label: 'Regard étalonné (attendu / réel)', emoji: '👀', project: 'regard', profileKey: 'gazeMap',
  description: 'Un point à suivre des yeux : mesure combien de µV correspondent à une position du regard, avec quel retard et quel affaissement.',
  steps: GazeCalibrator.STEPS,
  status() {
    const c = GazeCalibrator.load();
    return c ? { done: true, date: c.date, summary: `${Math.abs(c.gain).toFixed(0)} µV pour ±1 (r = ${c.r.toFixed(2)}), ×${c.ratio.toFixed(1)} la théorie`, failed: 0 }
      : { done: false, summary: 'non mesuré', failed: 0 };
  },
  create: (ctx) => new GazeCalibrator(ctx),
});
