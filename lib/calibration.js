/* Calibration guidée des seuils d'artefacts (globale `Calibrator`). Sans interface : voir ui/calibration-panel.js.
 *
 * Principe : l'utilisateur répète chaque geste pendant quelques secondes. Pour chaque signal, on compare le
 * niveau de repos à celui des gestes et on place le seuil entre les deux (40 % du chemin). Les seuils obtenus
 * sont appliqués au détecteur et mémorisés dans le PROFIL actif (lib/profiles.js, clé « calibration »).
 *
 * Usage :
 *   const calibrator = new Calibrator(detector);   // recharge et applique la calibration mémorisée
 *   calibrator.onProgress = (etat) => {};          // { phase, stepIndex, step, remainingS, statuses }
 *   calibrator.onDone = (cal, statuses) => {};
 *   calibrator.start();                            // tout refaire ; false si le détecteur n'est pas prêt
 *   calibrator.start(['frown', 'jaw']);            // ne refaire que ces étapes (les autres seuils sont conservés)
 *   calibrator.startFailed();                      // ne refaire que les étapes échouées (calibrator.failedIds)
 *   calibrator.cancel();
 *   calibrator.reset();                            // oublier la calibration (mémoire du navigateur comprise)
 *   calibrator.runOffline(enregistrements, only);  // tests : { idEtape: [trames] } -> { cal, statuses }
 *
 * phase : 'idle' | 'prepare' (compte à rebours) | 'record' (geste à faire) | 'done'
 * statuses : [{ id, label, status: 'pending' | 'active' | 'ok' | 'failed', message }]
 * cal : { version, date, floors, thresholds: { blink, frown, jaw, gaze, gazeLeft?, gazeRight?, ppg? }, gazeSign, yawnMinMs, jawDurMs, failed: [ids] }
 *   `failed` est mémorisé : les étapes à refaire survivent à un rechargement de la page.
 * Inscrite au registre des calibrations (lib/calibrations.js, id « artefacts ») ; étapes : emoji et `meter` (jauge).
 * Pouls : si ctx.feedPpg est alimenté, l'étape Sourcils teste aussi le capteur de pouls du front (thresholds.ppg, voir
 * ArtifactDetector.feedPpg) ; il n'est gardé que s'il réagit nettement aux froncements de cette personne.
 * Regard : étape « Regards secs » (32 s) — le point (step.target(t) -> -1, 0 ou +1, Calibrator.gazeTarget) SAUTE d'un bord
 * de l'écran à l'autre (Calibrator.GAZE_CUES : 10 consignes, 5 de chaque côté, 3 s d'intervalle, 1,2 s sur le côté). Mesuré
 * (docs/resultats.html, thème Regard) : l'écart AF7 − AF8 ne suit pas l'angle, seules les saccades larges laissent une trace,
 * en impulsion brève suivie d'une impulsion de retour de signe opposé. On mesure donc, pour chaque consigne, la PREMIÈRE
 * impulsion (son signe = sens, gazeSign ; son amplitude = seuil par direction thresholds.gazeLeft / gazeRight).
 * Sans repos mémorisé, l'étape Repos est ajoutée d'office.
 * Étapes à la carte : start(['blink', 'gaze']) ; les frames de calibration portent `t` (s depuis le début de l'étape).
 */
class Calibrator {
  static PREPARE_S = 3;

  static STEPS = [
    { id: 'rest', label: 'Repos', seconds: 8, emoji: '😶',
      instruction: 'Restez immobile, détendu, le regard fixe devant vous. Clignez normalement.' },
    { id: 'blink', label: 'Clignements', seconds: 10, emoji: '😉', meter: 'blink',
      instruction: 'Clignez franchement des yeux 5 fois, avec une seconde de pause entre chaque.' },
    { id: 'frown', label: 'Sourcils', seconds: 10, emoji: '😠', meter: 'frown',
      instruction: 'Froncez fort les sourcils 1 seconde, relâchez, puis recommencez (4 fois).' },
    { id: 'jaw', label: 'Mâchoire', seconds: 10, emoji: '😬', meter: 'jaw',
      instruction: 'Serrez fort la mâchoire 1 seconde, relâchez, puis recommencez (4 fois).' },
    { id: 'yawn', label: 'Bâillement', seconds: 12, emoji: '🥱', meter: 'jaw',
      instruction: 'Bâillez franchement (ou imitez : bouche grande ouverte 2 à 3 secondes), 2 fois.' },
    { id: 'gaze', label: 'Regards secs (gauche / droite)', seconds: 32, emoji: '👀', meter: 'gaze',
      target: (t) => Calibrator.gazeTarget(t),
      hint: 'Sans bouger la tête : quand le point saute sur un côté, jetez-y les yeux d’un coup, gardez-les là 1 s, puis revenez au centre.',
      instruction: 'Sans bouger la tête, quand le point SAUTE sur un côté, jetez-y les yeux d’un coup, franchement, gardez-les là environ 1 seconde, puis revenez au centre. 10 sauts, 5 de chaque côté.' },
  ];

  // Consignes de l'étape « Regards secs » : le point saute sur le côté `side` (+1 = gauche, -1 = droite : signe de
  // detector.features.gaze quand gazeSign = 1) à l'instant t (s), y reste GAZE_HOLD_S, puis revient au centre.
  // Côtés mêlés mais équilibrés (jamais plus de 2 fois de suite le même) ; 3 s entre deux consignes.
  static GAZE_HOLD_S = 1.2;
  static GAZE_CUES = [1, -1, -1, 1, 1, -1, -1, 1, 1, -1].map((side, k) => ({ t: 2 + 3 * k, side }));
  // Position du point à l'instant t de l'étape : +1 / -1 pendant une consigne, 0 sinon, null hors de 0..32 s.
  static gazeTarget(t) {
    if (t < 0 || t > 32) return null;
    const cue = Calibrator.GAZE_CUES.find((c) => t >= c.t && t < c.t + Calibrator.GAZE_HOLD_S);
    return cue ? cue.side : 0;
  }

  static load() {
    return Profiles.get('calibration', null);
  }
  static save(cal) {
    Profiles.set('calibration', cal);
  }
  static clearSaved() {
    Profiles.unset('calibration');
  }

  constructor(detector) {
    this.detector = detector;
    this.onProgress = null;
    this.onDone = null;
    this.running = false;
    this.cal = Calibrator.load();
    if (this.cal) detector.applyCalibration(this.cal);
    this._phase = 'idle';
    this._index = -1;
    this._queue = [];
    this._pos = -1;
    this._statuses = this._initialStatuses();
  }

  // États des étapes au chargement : tirés de la calibration mémorisée (cal.failed = étapes à refaire).
  _initialStatuses() {
    // anciennes calibrations : les étapes « left » / « right » (remplacées par « gaze ») comptent comme un regard à refaire
    const failed = ((this.cal && this.cal.failed) || []).map((id) => (id === 'left' || id === 'right' ? 'gaze' : id));
    return Calibrator.STEPS.map((s) => {
      if (!this.cal) return { id: s.id, label: s.label, status: 'pending', message: '' };
      if (failed.includes(s.id)) return { id: s.id, label: s.label, status: 'failed', message: 'à refaire' };
      return { id: s.id, label: s.label, status: 'ok', message: 'calibré' };
    });
  }

  get statuses() { return this._statuses; }

  get failedIds() {
    return this._statuses.filter((s) => s.status === 'failed').map((s) => s.id);
  }

  // Oublie la calibration (mémoire du navigateur comprise) : retour aux seuils automatiques.
  reset() {
    Calibrator.clearSaved();
    this.cal = null;
    this.detector.clearCalibration();
    this._statuses = this._initialStatuses();
  }

  // Étapes à exécuter pour `only` (liste d'ids, ou null = toutes), dans l'ordre. Règles de dépendance :
  // sans repos mémorisé, on refait le repos.
  _plan(only) {
    if (!only) return Calibrator.STEPS.map((s) => s.id);
    const ids = new Set(only);
    const floors = this.cal && this.cal.floors;
    if (!(floors && floors.blink != null)) ids.add('rest');
    return Calibrator.STEPS.map((s) => s.id).filter((id) => ids.has(id));
  }

  /* ---------- Déroulement ---------- */

  // only : ids des étapes à (re)faire ; omis = tout. Voir aussi startFailed().
  start(only = null) {
    if (this.running || !this.detector.ready) return false;
    const ids = this._plan(only);
    this._queue = ids.map((id) => Calibrator.STEPS.findIndex((s) => s.id === id));
    this._pos = -1;
    this._index = -1;
    this.running = true;
    this._draft = this._newDraft();
    if (!only) this._statuses = Calibrator.STEPS.map((s) => ({ id: s.id, label: s.label, status: 'pending', message: '' }));
    else this._queue.forEach((i) => Object.assign(this._statuses[i], { status: 'pending', message: '' }));
    this.detector.onFrame = (f) => this._onFrame(f);
    this._timer = setInterval(() => this._tick(), 100);
    this._nextStep();
    return true;
  }

  // Ne refait que les étapes qui ont échoué à la dernière calibration.
  startFailed() {
    const failed = this.failedIds;
    return failed.length ? this.start(failed) : false;
  }

  cancel() {
    if (!this.running) return;
    this._stop();
    this._phase = 'idle';
    this._emit();
  }

  _stop() {
    clearInterval(this._timer);
    this.detector.onFrame = null;
    this.running = false;
  }

  _nextStep() {
    this._pos++;
    if (this._pos >= this._queue.length) return this._finish();
    this._index = this._queue[this._pos];
    this._statuses[this._index].status = 'active';
    this._enter('prepare', Calibrator.PREPARE_S);
  }

  _enter(phase, seconds) {
    this._phase = phase;
    this._until = Date.now() + seconds * 1000;
    this._frames = [];
    this._t0 = Date.now();
    this._emit(seconds);
  }

  _tick() {
    const left = this._until - Date.now();
    if (left > 0) return this._emit(left / 1000);
    if (this._phase === 'prepare') return this._enter('record', Calibrator.STEPS[this._index].seconds);
    const step = Calibrator.STEPS[this._index];
    const r = this.analyseStep(step.id, this._frames, this._draft);
    Object.assign(this._statuses[this._index], { status: r.ok ? 'ok' : 'failed', message: r.message });
    this._nextStep();
  }

  _onFrame(f) {
    if (this._phase === 'record') {
      this._frames.push({ blink: f.blink, frown: f.frontalHF, jaw: f.temporalHF, gaze: f.gaze, ppg: f.ppg, t: (Date.now() - this._t0) / 1000 });
    }
  }

  _finish() {
    const cal = this._build(this._draft, this.failedIds);
    this._apply(cal);
    this._stop();
    this._phase = 'done';
    this._emit();
    if (this.onDone) this.onDone(cal, this._statuses);
  }

  _apply(cal) {
    this.cal = cal;
    this.detector.applyCalibration(cal);
    Calibrator.save(cal);
  }

  _emit(remainingS = 0) {
    if (!this.onProgress) return;
    this.onProgress({
      phase: this._phase, stepIndex: this._index, step: Calibrator.STEPS[this._index] || null,
      position: this._pos + 1, total: this._queue.length, // « étape position / total » de cette session
      remainingS, prepareS: Calibrator.PREPARE_S, statuses: this._statuses,
    });
  }

  /* ---------- Analyse (sans temps réel, testable) ---------- */

  // enregistrements : { rest: [trames], blink: [...], ... }, trame = { blink, frown, jaw, gaze }
  // only : ids des étapes à analyser (les autres gardent leur état et leurs seuils précédents) ; omis = toutes.
  runOffline(recordings, only = null) {
    const ids = this._plan(only);
    const draft = this._newDraft();
    if (!only) this._statuses = Calibrator.STEPS.map((s) => ({ id: s.id, label: s.label, status: 'pending', message: '' }));
    Calibrator.STEPS.forEach((s, i) => {
      if (!ids.includes(s.id)) return;
      const r = this.analyseStep(s.id, recordings[s.id] || [], draft);
      Object.assign(this._statuses[i], { status: r.ok ? 'ok' : 'failed', message: r.message });
    });
    const cal = this._build(draft, this.failedIds);
    this._apply(cal);
    return { cal, statuses: this._statuses };
  }

  _newDraft() {
    const prev = this.cal || {};
    return {
      floors: { ...(prev.floors || {}) }, thresholds: { ...(prev.thresholds || {}) },
      gazeSign: prev.gazeSign, yawnMinMs: prev.yawnMinMs, jawDurMs: prev.jawDurMs || 0,
    };
  }

  _build(d, failed = []) {
    const cal = { version: 1, date: new Date().toISOString(), floors: d.floors, thresholds: d.thresholds, failed };
    if (d.gazeSign) cal.gazeSign = d.gazeSign;
    if (d.yawnMinMs) cal.yawnMinMs = d.yawnMinMs;
    if (d.jawDurMs) cal.jawDurMs = d.jawDurMs;
    return cal;
  }

  analyseStep(id, frames, d) {
    const fail = (message) => ({ ok: false, message });
    if (frames.length < 20) return fail('pas assez de données reçues');
    const col = (k) => frames.map((f) => f[k]);

    if (id === 'rest') {
      d.floors = {
        blink: Calibrator._pct(col('blink'), 90), frown: Calibrator._pct(col('frown'), 90),
        jaw: Calibrator._pct(col('jaw'), 90), gaze: Calibrator._pct(col('gaze').map(Math.abs), 90),
      };
      const ppg = col('ppg').filter((v) => v > 0);
      if (ppg.length > 20) d.floors.ppg = Calibrator._pct(ppg, 90); else delete d.floors.ppg;
      return { ok: true, message: 'bruit de fond mesuré' + (d.floors.ppg ? '' : ' (pas de signal de pouls)') };
    }
    if (!d.floors || d.floors.blink == null) return fail('faites d\'abord l\'étape « Repos »');

    if (id === 'blink') return this._gesture(d, 'blink', col('blink'), 'µV');
    if (id === 'frown') {
      const r = this._gesture(d, 'frown', col('frown'), 'µV');
      if (r.ok) r.message += this._ppgFrown(d, col('ppg'));
      return r;
    }
    if (id === 'jaw') {
      const r = this._gesture(d, 'jaw', col('jaw'), 'µV');
      if (r.ok) d.jawDurMs = Calibrator._longest(col('jaw'), d.thresholds.jaw * 0.6);
      return r;
    }
    if (id === 'yawn') return this._yawn(d, col('jaw'));
    if (id === 'gaze') return this._gazeStep(d, frames);
    return fail('étape inconnue');
  }

  // Geste « positif » : seuil placé à 40 % entre le repos et le pic typique du geste.
  // `frac` : place du seuil entre le repos et le pic (0,4 par défaut ; le pouls, indice très sélectif, en prend 0,15).
  _gesture(d, name, values, unit, frac = 0.4) {
    const floor = Math.max(d.floors[name], 0.5);
    const p98 = Calibrator._pct(values, 98);
    if (!(p98 > 1.6 * floor)) return { ok: false, message: `signal trop faible (${p98.toFixed(0)} ${unit} pour un repos à ${floor.toFixed(0)}) — réessayez plus fort` };
    const eps = Calibrator._episodes(values, floor + 0.3 * (p98 - floor), 3, 3);
    if (eps.length < 2) return { ok: false, message: 'moins de 2 gestes distincts repérés — réessayez' };
    const peak = Calibrator._median(eps.map((e) => e.peak));
    if (peak < 1.5 * floor) return { ok: false, message: 'gestes indiscernables du repos — réessayez plus fort' };
    const thr = floor + frac * (peak - floor);
    d.thresholds[name] = thr;
    return { ok: true, message: `seuil ${thr.toFixed(0)} ${unit} (repos ${floor.toFixed(0)}, geste ${peak.toFixed(0)}, ${eps.length} gestes)` };
  }

  // Pouls et sourcils : le capteur de pouls est sur le front. Si, pendant les froncements, son rapport (features.ppg)
  // dépasse nettement celui du repos (même règle que les autres gestes), on mémorise un seuil `thresholds.ppg` : le
  // détecteur l'utilise alors pour confirmer les sourcils. Sinon on n'en mémorise pas (et on supprime l'ancien).
  _ppgFrown(d, values) {
    delete d.thresholds.ppg;
    if (!d.floors.ppg || values.filter((v) => v > 0).length < 20) return ' — pouls : pas de signal, sourcils par EEG seul';
    const r = this._gesture(d, 'ppg', values, '×', 0.15); // mesuré : froncements 5 à 12 ×, tout le reste < 4 ×
    if (!r.ok) { delete d.thresholds.ppg; return ' — pouls : ne réagit pas assez aux sourcils, EEG seul'; }
    return ` — pouls utilisable (seuil ${d.thresholds.ppg.toFixed(1)}×)`;
  }

  _yawn(d, values) {
    const thr = d.thresholds.jaw || this.detector.thresholds.jaw;
    const longest = Calibrator._longest(values, thr * 0.6);
    if (!longest) return { ok: false, message: 'aucun épisode musculaire long repéré — réessayez' };
    let min = Math.min(4000, Math.max(1200, 0.7 * longest));
    if (d.jawDurMs) min = Math.min(4000, Math.max(min, 1.3 * d.jawDurMs));
    d.yawnMinMs = min;
    return { ok: true, message: `bâillement le plus long ${(longest / 1000).toFixed(1)} s, durée minimale ${(min / 1000).toFixed(1)} s` };
  }

  // Regards secs : pour chaque consigne de Calibrator.GAZE_CUES, on cherche dans la seconde qui suit le premier pic de
  // l'écart AF7 − AF8 (le premier instant où |écart| atteint 60 % du maximum de la fenêtre, puis le sommet dans les 0,25 s
  // suivantes). Le retour au centre (impulsion de signe opposé, aussi grande) arrive plus tard : il est hors fenêtre.
  // Il faut au moins 3 impulsions nettes (> 1,6 x le bruit de repos) de chaque côté. Le SENS est celui de la majorité (80 %
  // au moins doivent concorder, sinon l'étape échoue) : gazeSign = +1 si l'impulsion d'une consigne « gauche » est positive.
  // Seuil de chaque direction = 40 % entre le repos et l'amplitude médiane de ce côté ; `thresholds.gaze` (commun, jeu des
  // artefacts) prend le plus bas des deux.
  _gazeStep(d, frames) {
    const fail = (message) => ({ ok: false, message });
    const frameS = ArtifactDetector.FRAME_DECIMATION / 256, floor = Math.max(d.floors.gaze, 0.5);
    if (frames.length < 100) return fail('pas assez de données reçues');
    const time = (f, i) => (f.t != null ? f.t : i * frameS);
    const pulses = [];
    for (const cue of Calibrator.GAZE_CUES) {
      const win = frames.map((f, i) => ({ t: time(f, i), g: f.gaze })).filter((x) => x.t >= cue.t && x.t < cue.t + 1);
      if (win.length < 5) continue;
      const max = Math.max(...win.map((x) => Math.abs(x.g)));
      if (!(max > 1.6 * floor)) continue;
      const first = win.findIndex((x) => Math.abs(x.g) >= 0.6 * max);
      const near = win.filter((x, i) => i >= first && x.t <= win[first].t + 0.25);
      const top = near.reduce((a, x) => (Math.abs(x.g) > Math.abs(a.g) ? x : a));
      pulses.push({ side: cue.side, amp: Math.abs(top.g), dir: Math.sign(top.g) * cue.side });
    }
    const per = (side) => pulses.filter((p) => p.side === side);
    const nL = per(1).length, nR = per(-1).length, n = Calibrator.GAZE_CUES.length / 2;
    if (nL < 3 || nR < 3) {
      return fail(`regards trop faibles ou absents (${nL} sur ${n} à gauche, ${nR} sur ${n} à droite, repos ${floor.toFixed(0)} µV) — jetez les yeux franchement et d'un coup sur le côté`);
    }
    const plus = pulses.filter((p) => p.dir > 0).length, agree = Math.max(plus, pulses.length - plus) / pulses.length;
    if (agree < 0.8) return fail(`sens du regard incohérent (${plus} impulsions dans un sens, ${pulses.length - plus} dans l'autre) — regardez d'un coup, sans bouger la tête`);
    const sign = plus >= pulses.length - plus ? 1 : -1;
    const amp = (side) => Calibrator._median(per(side).filter((p) => p.dir === sign).map((p) => p.amp));
    const ampL = amp(1), ampR = amp(-1);
    if (!(ampL > 0 && ampR > 0)) return fail('sens du regard incohérent d’un côté — regardez d’un coup, sans bouger la tête');
    d.gazeSign = sign;
    d.thresholds.gazeLeft = floor + 0.4 * (ampL - floor);
    d.thresholds.gazeRight = floor + 0.4 * (ampR - floor);
    d.thresholds.gaze = Math.min(d.thresholds.gazeLeft, d.thresholds.gazeRight);
    return { ok: true, message: `gauche ${ampL.toFixed(0)} µV, droite ${ampR.toFixed(0)} µV (repos ${floor.toFixed(0)} µV), sens ${sign > 0 ? 'normal' : 'inversé'}, ${pulses.length} regards sur ${2 * n}` };
  }

  /* ---------- Statistiques ---------- */

  static _pct(arr, p) {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor((p / 100) * (s.length - 1)))];
  }
  static _median(arr) { return Calibrator._pct(arr, 50); }

  // Séquences de trames au-dessus de `level` ; les trous de <= gap trames sont comblés.
  static _episodes(values, level, minFrames, gap) {
    const eps = [];
    let cur = null;
    values.forEach((v, i) => {
      if (v > level) {
        if (cur && i - cur.end <= gap + 1) { cur.end = i; cur.peak = Math.max(cur.peak, v); }
        else { if (cur) eps.push(cur); cur = { start: i, end: i, peak: v }; }
      }
    });
    if (cur) eps.push(cur);
    return eps.filter((e) => e.end - e.start + 1 >= minFrames);
  }

  // Durée (ms) du plus long épisode au-dessus de `level`.
  static _longest(values, level) {
    const frameMs = 1000 / (256 / ArtifactDetector.FRAME_DECIMATION);
    const eps = Calibrator._episodes(values, level, 3, 10);
    return eps.reduce((m, e) => Math.max(m, (e.end - e.start + 1) * frameMs), 0);
  }
}

Calibrations.register({
  id: 'artefacts', order: 10, label: 'Gestes et artefacts', emoji: '😉', project: 'live', profileKey: 'calibration',
  description: 'Repos, clignements, sourcils, mâchoire, bâillement, regards : tes seuils personnels de détection des artefacts.',
  steps: Calibrator.STEPS,
  status() {
    const cal = Calibrator.load(), failed = (cal && cal.failed && cal.failed.length) || 0;
    if (!cal) return { done: false, summary: 'non faite (seuils automatiques)', failed: 0 };
    const f = (v) => (v != null ? v.toFixed(0) + ' µV' : 'auto'), t = cal.thresholds;
    return { done: true, date: cal.date, failed,
      summary: `clignement ${f(t.blink)}, sourcils ${f(t.frown)}, mâchoire ${f(t.jaw)}, regard ${f(t.gaze)}` + (failed ? ` — ${failed} étape(s) à refaire` : '') };
  },
  create: (ctx) => new Calibrator(ctx.detector),
});
