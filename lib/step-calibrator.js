/* Base des calibrations « par étapes » (globale `StepCalibrator`) : compte à rebours, enregistrement, état des
 * étapes, progression. Sans interface. Les sous-classes (lib/alpha-calibration.js, lib/mental-baseline.js…) ne
 * décrivent que la mesure. Même contrat que Calibrator (voir lib/calibrations.js, « Runner »).
 *
 *   class MaCalibration extends StepCalibrator {
 *     constructor(ctx) { super(ctx, MaCalibration.STEPS); }
 *     _sample(step, t)    // appelée chaque seconde d'enregistrement (t = secondes écoulées)
 *     _stepDone(step, t)  // facultatif : fin de l'étape (défaut : t >= step.seconds)
 *     _progress(step, t)  // facultatif : avancement 0..1 (défaut : t / step.seconds)
 *     _analyse(step)      // -> { ok, message } à la fin de l'étape
 *     _finish()           // -> résultat (le mémoriser) ; appelée quand toutes les étapes sont faites
 *     _forget()           // oublier le résultat mémorisé (reset)
 *   }
 *   runner.advance(ms)    // horloge manuelle (tests) : new X(ctx, { clock: false }) puis advance()
 *
 * step.prepareS (facultatif) remplace le compte à rebours par défaut (PREPARE_S), ex. pour fermer les yeux.
 */
class StepCalibrator {
  static PREPARE_S = 3;

  constructor(ctx, steps, { clock = true } = {}) {
    this.ctx = ctx;
    this.steps = steps;
    this.onProgress = null;
    this.onDone = null;
    this.running = false;
    this.result = null;
    this._clock = clock;
    this._statuses = this._initialStatuses();
  }

  // À surcharger si le résultat mémorisé connaît les étapes échouées
  _initialStatuses() {
    return this.steps.map((s) => ({ id: s.id, label: s.label, status: 'pending', message: '' }));
  }

  get statuses() { return this._statuses; }
  get failedIds() { return this._statuses.filter((s) => s.status === 'failed').map((s) => s.id); }

  _canStart() { return this.ctx.ready; }

  start(only = null) {
    if (this.running || !this._canStart()) return false;
    this._queue = this.steps.map((s, i) => (!only || only.includes(s.id) ? i : -1)).filter((i) => i >= 0);
    this._queue.forEach((i) => Object.assign(this._statuses[i], { status: 'pending', message: '' }));
    this._pos = -1;
    this._now = 0;
    this.running = true;
    if (this._clock) {
      let last = Date.now();
      this._timer = setInterval(() => { const t = Date.now(); this.advance(t - last); last = t; }, 100);
    }
    this._next();
    return true;
  }

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

  reset() {
    if (this.running) this._stop();
    this._forget();
    this.result = null;
    this._statuses = this.steps.map((s) => ({ id: s.id, label: s.label, status: 'pending', message: '' }));
  }

  _forget() {}

  _stop() {
    clearInterval(this._timer);
    this.running = false;
  }

  get _step() { return this.steps[this._index]; }

  _next() {
    this._pos++;
    if (this._pos >= this._queue.length) return this._end();
    this._index = this._queue[this._pos];
    this._statuses[this._index].status = 'active';
    this._phase = 'prepare';
    this._until = this._now + 1000 * (this._step.prepareS || StepCalibrator.PREPARE_S);
    this._emit();
  }

  // Avance l'horloge de `ms` millisecondes (appelée par le minuteur, ou à la main dans les tests)
  advance(ms) {
    if (!this.running) return;
    const end = this._now + ms;
    while (this.running && this._now < end) {
      const stepMs = Math.min(100, end - this._now);
      this._now += stepMs;
      this._tick();
    }
    if (this.running) this._emit();
  }

  _tick() {
    const step = this._step;
    if (this._phase === 'prepare') {
      if (this._now < this._until) return;
      this._phase = 'record';
      this._recStart = this._now;
      this._lastSample = 0;
      this._beginStep(step);
      return;
    }
    const t = (this._now - this._recStart) / 1000;
    if (Math.floor(t) > this._lastSample) { this._lastSample = Math.floor(t); this._sample(step, this._lastSample); }
    if (!this._stepDone(step, t)) return;
    const r = this._analyse(step);
    Object.assign(this._statuses[this._index], { status: r.ok ? 'ok' : 'failed', message: r.message });
    this._next();
  }

  _beginStep() {}
  _sample() {}
  _stepDone(step, t) { return t >= step.seconds; }
  _progress(step, t) { return Math.min(1, t / step.seconds); }

  _end() {
    this._stop();
    this.result = this._finish();
    this._phase = 'done';
    this._emit();
    if (this.onDone) this.onDone(this.result, this._statuses);
  }

  _emit() {
    if (!this.onProgress) return;
    const step = this._step || null, rec = this._phase === 'record';
    const t = rec ? (this._now - this._recStart) / 1000 : 0;
    const remainingS = this._phase === 'prepare' ? (this._until - this._now) / 1000 : rec ? Math.max(0, step.seconds - t) : 0;
    this.onProgress({
      phase: this._phase, step, stepIndex: this._index, position: this._pos + 1, total: (this._queue || []).length,
      remainingS, prepareS: step ? step.prepareS || StepCalibrator.PREPARE_S : StepCalibrator.PREPARE_S,
      progress: rec ? this._progress(step, t) : 0, statuses: this._statuses,
    });
  }
}
