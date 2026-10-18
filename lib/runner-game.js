/* Moteur du jeu de course aux artefacts (globale `RunnerGame`), façon Temple Run / Subway Surfers. Sans interface :
 * voir projets/07-jeu-artefacts. Le temps est fourni par l'appelant (advance), donc testable sans horloge.
 *
 * Principe : 3 couloirs ; des obstacles arrivent vers le joueur.
 *   - mur (wall)    : bloque 1 ou 2 couloirs -> regarder à gauche / à droite pour changer de couloir ;
 *   - barrière (bar): bloque les 3 couloirs  -> cligner des yeux pour sauter (à l'approche : le saut dure JUMP_MS).
 *
 *   const game = new RunnerGame({ level: 'moyen', seed, infinite });   // infinite : sans vies, jamais perdu (calibration) ; niveau : 'facile' | 'moyen' | 'difficile'
 *   game.onEvent = (e) => {};   // { type: 'lane'|'jump'|'dodge'|'hit'|'over', ... }
 *   game.start();  game.advance(ms);  game.input('left' | 'right' | 'jump');  // 'left'/'right' = changement de couloir
 *   game.needed()               // { action: 'left'|'right'|'jump', etaMs, id } si le joueur doit agir maintenant,
 *                               //   sinon null (aussi quelques instants après une action : le geste n'est plus « attendu »)
 *   game.state                  // { running, over, lane, jumping, lives, score, distance, obstacles: [{ id, kind, lanes, etaMs }],
 *                               //   passed, hits }
 *   RunnerGame.LEVELS           // réglages par niveau (visibilité, espacement, vies, mix d'obstacles)
 *
 * Résolution : à l'arrivée (etaMs <= 0), un mur touche si le couloir du joueur est bloqué, une barrière touche si le
 * joueur ne saute pas. Il y a toujours au moins un couloir libre. */
class RunnerGame {
  static LEVELS = {
    facile:    { label: 'Facile',    approachMs: 3600, gapMs: [2800, 3800], lives: 5, barP: 0.35, twoLanesP: 0,    windowMs: 2400 },
    moyen:     { label: 'Moyen',     approachMs: 2800, gapMs: [2000, 2800], lives: 3, barP: 0.4,  twoLanesP: 0.3,  windowMs: 1800 },
    difficile: { label: 'Difficile', approachMs: 2200, gapMs: [1400, 2000], lives: 3, barP: 0.45, twoLanesP: 0.55, windowMs: 1400 },
  };
  static JUMP_MS = 1200;       // durée en l'air
  static BAR_WINDOW_MS = 1000; // un saut n'est « attendu » qu'à l'approche d'une barrière (sinon il retomberait avant)
  static COOLDOWN_MS = 700;   // après une action, plus rien n'est « attendu » (laisse le geste retomber)
  static LANES = 3;

  constructor({ level = 'moyen', seed = Date.now() >>> 0, infinite = false } = {}) {
    this.infinite = infinite;
    this.cfg = RunnerGame.LEVELS[level] || RunnerGame.LEVELS.moyen;
    this.level = RunnerGame.LEVELS[level] ? level : 'moyen';
    this._seed = seed || 1;
    this.onEvent = null;
    this.reset();
  }

  reset() {
    this.state = { running: false, over: false, lane: 1, jumping: false, lives: this.infinite ? Infinity : this.cfg.lives, score: 0, distance: 0, obstacles: [], passed: 0, hits: 0 };
    this._jumpLeft = 0; this._cool = 0; this._nextIn = 1500; this._id = 0;
  }

  start() { this.reset(); this.state.running = true; }
  stop() { this.state.running = false; }

  _rnd() { this._seed = (this._seed * 1664525 + 1013904223) >>> 0; return this._seed / 2 ** 32; }
  _emit(e) { if (this.onEvent) this.onEvent(e); }

  _spawn() {
    const c = this.cfg;
    if (this._rnd() < c.barP) {
      this.state.obstacles.push({ id: ++this._id, kind: 'bar', lanes: [0, 1, 2], etaMs: c.approachMs });
    } else {
      const two = this._rnd() < c.twoLanesP, free = Math.floor(this._rnd() * RunnerGame.LANES);
      // 2 couloirs bloqués (tous sauf le libre) ou 1 seul (l'un des deux autres)
      const others = [0, 1, 2].filter((l) => l !== free);
      const blocked = two ? others : [others[Math.floor(this._rnd() * 2)]];
      this.state.obstacles.push({ id: ++this._id, kind: 'wall', lanes: blocked, etaMs: c.approachMs });
    }
    const [lo, hi] = c.gapMs;
    this._nextIn = lo + this._rnd() * (hi - lo);
  }

  input(action) {
    const s = this.state;
    if (!s.running || s.over) return false;
    this._cool = RunnerGame.COOLDOWN_MS;
    if (action === 'jump') {
      if (s.jumping) return false;
      s.jumping = true; this._jumpLeft = RunnerGame.JUMP_MS;
      this._emit({ type: 'jump' });
      return true;
    }
    const to = s.lane + (action === 'left' ? -1 : 1);
    if (to < 0 || to >= RunnerGame.LANES) return false;
    s.lane = to;
    this._emit({ type: 'lane', lane: to });
    return true;
  }

  advance(ms) {
    const s = this.state;
    if (!s.running || s.over) return;
    this._cool = Math.max(0, this._cool - ms);
    if (s.jumping) { this._jumpLeft -= ms; if (this._jumpLeft <= 0) s.jumping = false; }
    s.distance += ms / 100;
    s.score += ms / 100;
    this._nextIn -= ms;
    if (this._nextIn <= 0) this._spawn();
    for (const o of s.obstacles) o.etaMs -= ms;
    for (const o of s.obstacles.filter((x) => x.etaMs <= 0)) {
      const hit = o.kind === 'bar' ? !s.jumping : o.lanes.includes(s.lane);
      if (hit) {
        s.hits++; s.lives--;
        this._emit({ type: 'hit', kind: o.kind, lives: s.lives });
      } else {
        s.passed++; s.score += 50;
        this._emit({ type: 'dodge', kind: o.kind });
      }
    }
    s.obstacles = s.obstacles.filter((o) => o.etaMs > 0);
    if (s.lives <= 0) { s.over = true; s.running = false; this._emit({ type: 'over', score: Math.round(s.score) }); }
  }

  // Geste attendu pour le prochain obstacle, s'il est assez proche (fenêtre du niveau) et que le joueur doit agir.
  needed() {
    const s = this.state;
    if (!s.running || this._cool > 0) return null;
    const o = s.obstacles[0];
    if (!o || o.etaMs > this.cfg.windowMs) return null;
    if (o.kind === 'bar') return s.jumping || o.etaMs > RunnerGame.BAR_WINDOW_MS ? null : { action: 'jump', etaMs: o.etaMs, id: o.id };
    if (!o.lanes.includes(s.lane)) return null;
    // couloir libre le plus proche (à gauche en cas d'égalité)
    const free = [0, 1, 2].filter((l) => !o.lanes.includes(l)).sort((a, b) => Math.abs(a - s.lane) - Math.abs(b - s.lane) || a - b)[0];
    return { action: free < s.lane ? 'left' : 'right', etaMs: o.etaMs, id: o.id };
  }
}
