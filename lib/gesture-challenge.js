/* Défi des gestes (globale `GestureChallenge`) : vérifie la calibration des artefacts en jeu. Sans interface.
 * L'application demande des gestes au hasard ; un geste est réussi si le détecteur (seuils calibrés) reconnaît le BON
 * geste avant la fin du temps imparti. Points : 100 par geste réussi + bonus de rapidité (jusqu'à 50).
 *
 *   const game = new GestureChallenge(ctx, { rounds: 8, seed });   // ctx : CalibrationContext
 *   game.onProgress = (état) => {};   // { phase: 'ready'|'go'|'hit'|'miss'|'done', round, total, gesture, remainingS,
 *                                     //   score, last: { ok, reactionMs, got }, results }
 *   game.onDone = (bilan) => {};      // { score, hits, total, perGesture: { id: { hits, tries } }, toRedo: [ids d'étapes] }
 *   game.start() -> bool ; game.cancel() ; game.advance(ms) (tests, avec { clock: false })
 *
 * `got` = geste reconnu à la place (confusion) ; `toRedo` = étapes de lib/calibration.js à refaire (moins d'un geste
 * sur deux reconnu pour ce geste).
 */
class GestureChallenge {
  static READY_S = 2;
  static TIMEOUT_S = 5;
  static GESTURES = [
    { id: 'blink', label: 'Cligne des yeux !', emoji: '😉', events: ['blink'], step: 'blink' },
    { id: 'frown', label: 'Fronce les sourcils !', emoji: '😠', events: ['frown'], step: 'frown' },
    { id: 'jaw', label: 'Serre la mâchoire !', emoji: '😬', events: ['jaw'], step: 'jaw' },
    { id: 'left', label: 'Regarde à gauche !', emoji: '👈', events: ['gaze-left'], step: 'gaze' },
    { id: 'right', label: 'Regarde à droite !', emoji: '👉', events: ['gaze-right'], step: 'gaze' },
  ];

  constructor(ctx, { rounds = 8, seed = Date.now() >>> 0, clock = true } = {}) {
    this.ctx = ctx;
    this.rounds = rounds;
    this._seed = seed || 1;
    this._clock = clock;
    this.onProgress = null;
    this.onDone = null;
    this.running = false;
  }

  _rnd() { this._seed = (this._seed * 1664525 + 1013904223) >>> 0; return this._seed / 2 ** 32; }

  // Ordre : chaque geste au moins une fois, puis au hasard ; jamais deux fois de suite le même.
  _plan() {
    const G = GestureChallenge.GESTURES, list = [];
    const pool = () => G.map((g) => g).sort(() => this._rnd() - 0.5);
    while (list.length < this.rounds) for (const g of pool()) if (list.length < this.rounds && list[list.length - 1] !== g) list.push(g);
    return list;
  }

  start() {
    if (this.running || !this.ctx.detector.ready) return false;
    this._list = this._plan();
    this._round = -1;
    this._now = 0;
    this.score = 0;
    this.results = [];
    this.running = true;
    this._off = this.ctx.onEvent((e) => this._onEvent(e));
    if (this._clock) {
      let last = Date.now();
      this._timer = setInterval(() => { const t = Date.now(); this.advance(t - last); last = t; }, 100);
    }
    this._nextRound();
    return true;
  }

  cancel() {
    if (!this.running) return;
    this._stop();
    this._phase = 'idle';
    this._emit();
  }

  _stop() {
    clearInterval(this._timer);
    if (this._off) this._off();
    this.running = false;
  }

  _nextRound() {
    this._round++;
    if (this._round >= this._list.length) return this._end();
    this._phase = 'ready';
    this._until = this._now + 1000 * GestureChallenge.READY_S;
    this._last = null;
    this._emit();
  }

  advance(ms) {
    if (!this.running) return;
    const end = this._now + ms;
    while (this.running && this._now < end) {
      this._now += Math.min(100, end - this._now);
      if (this._now < this._until) continue;
      if (this._phase === 'ready') { this._phase = 'go'; this._goAt = this._now; this._until = this._now + 1000 * GestureChallenge.TIMEOUT_S; this._got = null; }
      else if (this._phase === 'go') this._result(false);
      else this._nextRound(); // après 'hit' / 'miss'
    }
    if (this.running) this._emit();
  }

  _onEvent(e) {
    if (this._phase !== 'go' || e.phase === 'end') return; // les gestes longs comptent dès leur début
    const g = this._list[this._round];
    if (g.events.includes(e.type)) this._result(true);
    else this._got = this._got || e.type;
  }

  _result(ok) {
    const g = this._list[this._round], reactionMs = this._now - this._goAt;
    if (ok) this.score += 100 + Math.round(50 * Math.max(0, 1 - reactionMs / (1000 * GestureChallenge.TIMEOUT_S)));
    this._last = { ok, reactionMs: ok ? reactionMs : null, got: ok ? null : this._got };
    this.results.push({ gesture: g.id, ...this._last });
    this._phase = ok ? 'hit' : 'miss';
    this._until = this._now + 1200;
    this._emit();
  }

  summary() {
    const per = {};
    for (const r of this.results) { const p = (per[r.gesture] = per[r.gesture] || { hits: 0, tries: 0 }); p.tries++; if (r.ok) p.hits++; }
    const toRedo = GestureChallenge.GESTURES.filter((g) => per[g.id] && per[g.id].hits / per[g.id].tries < 0.5).map((g) => g.step);
    return { score: this.score, hits: this.results.filter((r) => r.ok).length, total: this.results.length, perGesture: per, toRedo };
  }

  _end() {
    this._stop();
    this._phase = 'done';
    this._emit();
    if (this.onDone) this.onDone(this.summary());
  }

  _emit() {
    if (!this.onProgress) return;
    const g = this._list ? this._list[this._round] || null : null;
    this.onProgress({ phase: this._phase, round: this._round + 1, total: this.rounds, gesture: g,
      remainingS: Math.max(0, (this._until - this._now) / 1000), score: this.score, last: this._last, results: this.results });
  }
}
