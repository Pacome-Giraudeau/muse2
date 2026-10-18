/* Référence personnelle de l'état mental (globale `BaselineCalibrator`). Sans interface.
 * Mesure 30 secondes de SIGNAL PROPRE au repos éveillé, yeux ouverts, exactement comme projets/03-etat
 * (ctx.measureState -> MentalState.measure : filtres sans la piste « clignements », rejet des artefacts par segment,
 * témoin musculaire sur le brut) ; référence = MentalState.baselineFrom (version 3) : médianes des indices
 * relax / focus / drowsy, des puissances θ / α / β et du témoin 30–45 Hz, électrode par électrode, et dispersion des
 * scores (seuil de décision personnel). Les secondes où une électrode est polluée (artefact, mauvais contact) ne
 * comptent pas pour elle ; l'étape dure donc de 30 s à 60 s au plus. Mémorisée dans le profil actif
 * (clé « mentalBaseline »), utilisée par projets/03-etat et projets/04-etude.
 *
 *   BaselineCalibrator.load()  .save(b)  .clear()     // référence du profil actif
 *   const runner = new BaselineCalibrator(ctx);        // ctx : CalibrationContext ; contrat : lib/step-calibrator.js
 * Réussite : au moins MIN_S secondes propres (sinon la référence précédente est conservée).
 */
class BaselineCalibrator extends StepCalibrator {
  static TARGET_S = 30;
  static MIN_S = 20;
  static MAX_S = 60;
  static STEPS = [
    { id: 'calm', label: 'Repos éveillé', seconds: 30, emoji: '🧘',
      instruction: 'Assis, détendu mais éveillé, yeux ouverts, regard posé sur un point. Ne bouge pas, ne parle pas.' },
  ];

  static load() { return Profiles.get('mentalBaseline', null); }
  static save(b) { Profiles.set('mentalBaseline', b); }
  static clear() { Profiles.unset('mentalBaseline'); }

  constructor(ctx, options) {
    super(ctx, BaselineCalibrator.STEPS, options);
    this.result = BaselineCalibrator.load();
    if (this.result) this._statuses[0] = { ...this._statuses[0], status: 'ok', message: 'référence mesurée' };
  }

  _beginStep() { this._list = []; }

  _sample() {
    const m = this.ctx.measureState();
    if (m && m.some(Boolean)) this._list.push(m);
  }

  _stepDone(step, t) { return this._list.length >= BaselineCalibrator.TARGET_S || t >= BaselineCalibrator.MAX_S; }
  _progress() { return Math.min(1, this._list.length / BaselineCalibrator.TARGET_S); }

  _analyse() {
    const n = this._list.length;
    if (n < BaselineCalibrator.MIN_S) return { ok: false, message: `seulement ${n} s de signal propre (il en faut ${BaselineCalibrator.MIN_S}) — vérifie le contact, reste immobile` };
    this._baseline = MentalState.baselineFrom(this._list);
    return { ok: true, message: `référence mesurée sur ${n} s de signal propre` };
  }

  _finish() {
    if (!this._baseline) return BaselineCalibrator.load();
    BaselineCalibrator.save(this._baseline);
    return this._baseline;
  }

  _forget() { BaselineCalibrator.clear(); }
}

Calibrations.register({
  id: 'etat', order: 30, label: 'Référence de l’état mental', emoji: '🧘', project: 'etat', profileKey: 'mentalBaseline',
  description: '30 s de calme les yeux ouverts : ton point de comparaison pour détente, concentration et somnolence.',
  steps: BaselineCalibrator.STEPS,
  status() {
    const b = BaselineCalibrator.load();
    return b ? { done: true, date: b.date, summary: `mesurée sur ${b.seconds} s`, failed: 0 } : { done: false, summary: 'non mesurée', failed: 0 };
  },
  create: (ctx) => new BaselineCalibrator(ctx),
});
