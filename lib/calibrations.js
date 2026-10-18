/* Registre de TOUTES les calibrations de l'application (globale `Calibrations`). Sans interface.
 * Le projet « Calibration » (projets/06-calibration) lit ce registre : une calibration enregistrée ici apparaît
 * automatiquement dans la liste des calibrations séparées ET dans la calibration générale.
 * RÈGLE : toute nouvelle calibration (nouveau projet…) s'enregistre ici, à la fin de son fichier lib/.
 *
 *   Calibrations.register(définition)   // voir le contrat ci-dessous
 *   Calibrations.list()                 // définitions triées par `order` (ordre de la calibration générale)
 *   Calibrations.get(id)
 *   Calibrations.seconds(ids)           // durée estimée (préparations comprises) d'une sélection
 *
 * Définition :
 *   { id, order, label, emoji, description,
 *     project,                          // id de la page qui utilise le résultat (lien « utilisé par »)
 *     profileKey,                       // clé de Profiles où le résultat est mémorisé (lib/profiles.js)
 *     steps: [{ id, label, seconds, instruction, emoji, meter?, eyesClosed? }],
 *     status() -> { done, date, summary, failed }   // état mémorisé dans le profil actif (failed = nb d'étapes à refaire)
 *     create(ctx) -> runner }           // ctx : CalibrationContext (lib/calibration-context.js)
 *   meter : clé de ctx.detector.levels à afficher pendant l'étape (jauge « force du geste »), facultatif.
 *   eyesClosed : l'étape se fait les yeux fermés (consignes sonores indispensables).
 *
 * Runner (même contrat que Calibrator, lib/calibration.js, et StepCalibrator, lib/step-calibrator.js) :
 *   runner.start(only?) -> bool         // only = ids d'étapes ; false si le signal n'est pas prêt
 *   runner.startFailed()  runner.cancel()  runner.reset()  runner.running  runner.statuses  runner.failedIds
 *   runner.onProgress = (état) => {}    // { phase: 'idle'|'prepare'|'record'|'done', step, position, total,
 *                                       //   remainingS, prepareS, progress (0..1, facultatif), statuses }
 *   runner.onDone = (résultat, statuses) => {}
 */
const Calibrations = {
  _defs: [],

  register(def) {
    this._defs = this._defs.filter((d) => d.id !== def.id).concat(def);
    this._defs.sort((a, b) => (a.order || 0) - (b.order || 0));
  },
  list() { return [...this._defs]; },
  get(id) { return this._defs.find((d) => d.id === id) || null; },

  // Durée estimée : enregistrement + compte à rebours de préparation de chaque étape.
  seconds(ids = null, prepareS = 3) {
    return this._defs.filter((d) => !ids || ids.includes(d.id))
      .reduce((s, d) => s + d.steps.reduce((t, st) => t + st.seconds + prepareS, 0), 0);
  },
};
