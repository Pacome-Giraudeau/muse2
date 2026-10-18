/* Calibration dynamique des artefacts en jeu (globale `DynamicCalibration`). Sans interface.
 * Affine les seuils « clignement » et « regard » de la calibration des artefacts (lib/calibration.js, id « artefacts »,
 * clé de profil « calibration ») PENDANT une partie, en supposant que le joueur fait le bon geste au bon moment.
 * Elle ne crée donc pas une calibration de plus au registre (lib/calibrations.js) : elle améliore celle qui y est.
 *
 *   const dyn = new DynamicCalibration(detector);
 *   detector.onFrame = (f) => dyn.observe(f, game.needed() && game.needed().action, nowMs);  // ~32 fois/s
 *   dyn.guard(nowMs);          // à appeler à chaque événement du détecteur / action du joueur (le geste « retombe »)
 *   dyn.apply();               // recalcule les seuils et les applique au détecteur ; -> true si un seuil a changé
 *   dyn.stats()                // { jump|gaze: { trials, used, median }, rest: { blink, gaze }, updates, thresholds }
 *   dyn.save()                 // mémorise dans le profil actif (Profiles 'calibration') ; -> true si quelque chose a changé
 *
 * Mesures : 'jump' = amplitude de clignement (features.blink) ; 'left' / 'right' = écart de regard orienté vers le côté
 * demandé (features.gaze × gazeSign, inversé pour la droite). Un essai = tous les instants où le même geste est attendu
 * d'affilée (+ 0,4 s de suivi : la détection tombe avant le pic du geste) ; on en garde le PIC. Le repos = pics par tranche de 2 s hors d'un essai et hors garde (1,5 s après un geste).
 * Règle (comme la calibration guidée, 40 % du chemin) : seuil visé = R + 0,4 × (G − R), avec G = médiane des essais
 * retenus (pic ≥ 1,2 × R : sinon le joueur n'a sans doute pas fait le geste, l'essai est écarté) et R = 60ᵉ centile du
 * repos (médiane haute : les coups d'œil sur l'écran pendant la partie ne doivent pas le gonfler). Il faut ≥ 3 essais retenus et G ≥ 1,5 × R. Le seuil bouge de 50 % de l'écart à chaque mise à jour, et jamais
 * de plus de ×0,6 / ×1,6 d'un coup.
 * Sens du regard : si ≥ 70 % des essais de regard (≥ 3, nettement au-dessus du repos) se lisent du côté OPPOSÉ à celui
 * demandé, `gazeSign` de la calibration est inversé et le regard repart de zéro (stats().flips compte les inversions). Seuils sourcils / mâchoire inchangés (le jeu ne les utilise pas). */
class DynamicCalibration {
  static REST_CHUNK_MS = 2000;
  static GUARD_MS = 1500;
  static TAIL_MS = 400;        // suivi après la fin de l'attente : la détection tombe avant le pic du geste
  static MIN_TRIALS = 3;
  static REST_Q = 0.6;         // centile du repos : les coups d'œil sur l'écran pendant la partie ne doivent pas gonfler le repos
  static KEEP = 12;            // essais / tranches de repos conservés par mesure
  static MIX = 0.4;            // position du seuil entre repos et geste
  static STEP = 0.5;           // fraction de l'écart parcourue à chaque mise à jour
  static LIMITS = [0.6, 1.6];  // facteurs min / max d'un coup
  static MIN_RATIO = 1.4;      // G doit dépasser R de ce facteur
  static VALID_RATIO = 1.2;    // un essai ne compte que s'il dépasse R de ce facteur

  constructor(detector) {
    this.detector = detector;
    this.trials = { blink: [], gaze: [] };   // pics des essais, par mesure
    this.rest = { blink: [], gaze: [] };     // pics des tranches de repos
    this.votes = [];                         // essais de regard : pic du bon côté / du côté opposé
    this.flips = 0;                          // nombre d'inversions du sens du regard décidées
    this.updates = 0;
    this._cur = null;                         // essai en cours { action, peak }
    this._chunk = null;                       // tranche de repos en cours { t0, blink, gaze }
    this._guardUntil = 0;
    this._dirty = false;
    this._before = null;
  }

  static _measure(action) { return action === 'jump' ? 'blink' : 'gaze'; }

  _value(action, f) {
    if (action === 'jump') return f.blink;
    const sign = (this.detector.cal && this.detector.cal.gazeSign) || 1;
    return (action === 'left' ? 1 : -1) * f.gaze * sign;
  }

  guard(nowMs) {
    this._guardUntil = nowMs + DynamicCalibration.GUARD_MS;
    this._chunk = null;
  }

  _push(list, v) { list.push(v); if (list.length > DynamicCalibration.KEEP) list.shift(); }

  _track(t, f) {
    const v = this._value(t.action, f);
    t.peak = Math.max(t.peak, v);
    t.low = Math.min(t.low, v);
    // Première impulsion franche (≥ seuil de regard) : son signe est le sens du regard. L'impulsion de retour au centre,
    // de signe opposé et souvent plus grande (mesuré : 24 essais sur 24), ne doit pas décider du sens.
    if (t.first == null && Math.abs(v) >= this.detector.thresholds.gaze && t.action !== 'jump') t.first = v;
  }

  _closeTrial() {
    const t = this._cur;
    this._cur = null;
    if (!t) return;
    const m = DynamicCalibration._measure(t.action);
    // regard : le pic du mauvais côté (t.low < 0) sert à détecter un sens gauche / droite inversé (_checkSign)
    if (m === 'gaze') this._push(this.votes, t.first != null ? { ok: Math.max(t.first, 0), opp: Math.max(-t.first, 0) } : { ok: t.peak, opp: -t.low });
    if (t.peak > 0) { this._push(this.trials[m], t.peak); this._dirty = true; }
  }

  // f : features du détecteur ; action : geste attendu à cet instant ('jump' | 'left' | 'right') ou null ; nowMs : horloge.
  observe(f, action, nowMs) {
    if (action) {
      this._chunk = null;
      if (this._cur && (this._cur.action !== action || this._cur.endAt != null)) this._closeTrial();
      if (!this._cur) this._cur = { action, peak: 0, low: 0 };
      this._track(this._cur, f);
      return;
    }
    if (this._cur) {   // geste plus attendu (réussi ou raté) : on suit encore TAIL_MS pour voir le vrai pic, puis on clôt l'essai
      const t = this._cur;
      if (t.endAt == null) t.endAt = nowMs + DynamicCalibration.TAIL_MS;
      this._track(t, f);
      if (nowMs >= t.endAt) { this._closeTrial(); this.guard(nowMs); }
      return;
    }
    if (nowMs < this._guardUntil) { this._chunk = null; return; }
    const c = this._chunk || (this._chunk = { t0: nowMs, blink: 0, gaze: 0 });
    c.blink = Math.max(c.blink, f.blink);
    c.gaze = Math.max(c.gaze, Math.abs(f.gaze));
    if (nowMs - c.t0 >= DynamicCalibration.REST_CHUNK_MS) {
      this._push(this.rest.blink, c.blink); this._push(this.rest.gaze, c.gaze);
      this._chunk = null;
    }
  }

  static _quantile(list, q) {
    const s = [...list].sort((a, b) => a - b);
    return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null;
  }

  // Seuil visé pour une mesure, ou null si les données ne permettent pas de conclure.
  _target(measure) {
    const K = DynamicCalibration, R = K._quantile(this.rest[measure], K.REST_Q);
    if (R == null) return null;
    const used = this.trials[measure].filter((p) => p >= K.VALID_RATIO * R);
    if (used.length < K.MIN_TRIALS) return null;
    const G = K._quantile(used, 0.5);
    if (G < K.MIN_RATIO * R) return null;
    return R + K.MIX * (G - R);
  }

  // Sens du regard : si les regards « demandés à gauche » se lisent presque toujours du côté opposé, le sens mémorisé
  // (gazeSign) est inversé : on le retourne et on repart de zéro sur le regard.
  _checkSign() {
    const K = DynamicCalibration, R = K._quantile(this.rest.gaze, K.REST_Q);
    if (R == null) return false;
    const valid = this.votes.filter((v) => Math.max(v.ok, v.opp) >= K.VALID_RATIO * R);
    if (valid.length < K.MIN_TRIALS || valid.filter((v) => v.opp > v.ok).length < 0.7 * valid.length) return false;
    const det = this.detector, base = det.cal || this._baseCal();
    det.applyCalibration({ ...base, gazeSign: -((base.gazeSign) || 1) });
    this.trials.gaze = []; this.votes = []; this.flips++;
    return true;
  }

  _baseCal() {
    // Sans calibration préalable : seuils clignement / regard seulement, le reste reste « à refaire »
    const todo = Calibrator.STEPS.map((s) => s.id).filter((id) => !['blink', 'left', 'right'].includes(id));
    return { version: 1, date: new Date().toISOString(), floors: {}, thresholds: {}, failed: todo };
  }

  apply() {
    const K = DynamicCalibration, det = this.detector;
    if (this._cur) this._closeTrial();
    const flipped = this._checkSign();
    const cur = det.thresholds, next = {};
    if (!this._before) this._before = { blink: cur.blink, gaze: cur.gaze };
    for (const [measure, name] of [['blink', 'blink'], ['gaze', 'gaze']]) {
      const target = this._target(measure);
      if (target == null) continue;
      const old = cur[name] / det.sensitivity;   // les seuils mémorisés sont avant sensibilité
      const moved = old + K.STEP * (target - old);
      next[name] = Math.min(old * K.LIMITS[1], Math.max(old * K.LIMITS[0], moved));
    }
    // seuils par direction (calibration « Regards secs ») : ils suivent le même facteur que le seuil commun
    const baseTh = (det.cal && det.cal.thresholds) || {};
    if (next.gaze != null) {
      const k = next.gaze / (cur.gaze / det.sensitivity);
      for (const key of ['gazeLeft', 'gazeRight']) if (baseTh[key] != null) next[key] = baseTh[key] * k;
    }
    if (!Object.keys(next).length) { if (flipped) this.updates++; return flipped; }
    const base = det.cal || this._baseCal();
    det.applyCalibration({ ...base, thresholds: { ...base.thresholds, ...next }, dynamicDate: new Date().toISOString() });
    this.updates++;
    return true;
  }

  stats() {
    const K = DynamicCalibration, one = (m) => {
      const R = K._quantile(this.rest[m], K.REST_Q), used = R == null ? [] : this.trials[m].filter((p) => p >= K.VALID_RATIO * R);
      return { trials: this.trials[m].length, used: used.length, median: used.length ? K._quantile(used, 0.5) : null };
    };
    return { jump: one('blink'), gaze: one('gaze'),
      rest: { blink: K._quantile(this.rest.blink, K.REST_Q), gaze: K._quantile(this.rest.gaze, K.REST_Q) },
      updates: this.updates, flips: this.flips, before: this._before, thresholds: this.detector.thresholds };
  }

  // Mémorise la calibration affinée dans le profil actif (rien si aucun seuil n'a bougé).
  save() {
    const cal = this.detector.cal;
    if (!this.updates || !cal) return false;
    Calibrator.save(cal);
    return true;
  }
}
