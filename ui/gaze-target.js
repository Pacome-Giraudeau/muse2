/* Point à suivre du regard, PLEIN ÉCRAN (globale `GazeTarget`) : pour les étapes de calibration qui ont un `target(t)`
 * (lib/calibration.js, étape « Regards secs » : le point SAUTE d'un bord à l'autre). Le point va jusqu'au bord de l'écran :
 * seules les saccades larges laissent une trace dans l'écart AF7 − AF8 (docs/resultats.html). `step.hint` = légende du pied. Un voile couvre la fenêtre (position: fixed) ; on tente aussi le vrai
 * plein écran du navigateur (accepté seulement peu après un clic : sans effet sinon, le voile suffit).
 *
 *   const gt = new GazeTarget({ onCancel });          // onCancel : bouton « Annuler » et touche Échap
 *   gt.update(step, elapsedS, légende?)               // affiche le point à la position step.target(elapsedS) ;
 *                                                     //   masque le voile si l'étape n'a pas de cible
 *   gt.hide();  gt.destroy();
 * Position : +1 = bord gauche de l'écran, -1 = bord droit. Le point est animé à chaque image (requestAnimationFrame)
 * entre deux appels de update(), à partir de l'horloge recalée par update(). */
class GazeTarget {
  constructor({ onCancel = null } = {}) {
    this.onCancel = onCancel;
    this.el = document.createElement('div');
    this.el.className = 'gaze-full';
    this.el.hidden = true;
    this.el.innerHTML = `<div class="gaze-caption"></div><div class="gaze-track"><i class="gaze-dot"></i></div>
      <div class="gaze-foot"><span data-hint>Sans bouger la tête, suis le point des yeux.</span><button class="btn ghost" type="button">Annuler (Échap)</button></div>`;
    document.body.appendChild(this.el);
    this.dot = this.el.querySelector('.gaze-dot');
    this.cap = this.el.querySelector('.gaze-caption');
    this.el.querySelector('button').onclick = () => this._cancel();
    this._key = (e) => { if (e.key === 'Escape' && !this.el.hidden) this._cancel(); };
    document.addEventListener('keydown', this._key);
  }

  _cancel() { this.hide(); if (this.onCancel) this.onCancel(); }

  update(step, elapsedS, caption = '') {
    const has = !!(step && step.target && step.target(elapsedS) != null);
    this._step = has ? step : null;
    this._t0 = performance.now() - elapsedS * 1000;
    if (!has) return this.hide();
    this.cap.textContent = caption;
    this.el.querySelector('[data-hint]').textContent = step.hint || 'Sans bouger la tête, suis le point des yeux.';
    if (this.el.hidden) {
      this.el.hidden = false;
      try { if (!document.fullscreenElement && this.el.requestFullscreen) this.el.requestFullscreen().then(() => { this._fs = true; }, () => {}); } catch (e) { /* refusé */ }
    }
    if (!this._raf) this._loop();
  }

  _loop() {
    const p = this._step && this._step.target((performance.now() - this._t0) / 1000);
    if (p == null) { this._stopLoop(); return; }
    this.dot.style.left = (50 - 47 * p).toFixed(1) + '%';
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._loop(); });
  }

  _stopLoop() { cancelAnimationFrame(this._raf); this._raf = 0; }

  hide() {
    this._step = null; this._stopLoop();
    if (this.el.hidden) return;
    this.el.hidden = true;
    try { if (this._fs && document.fullscreenElement === this.el) document.exitFullscreen(); } catch (e) { /* déjà sorti */ }
    this._fs = false;
  }

  destroy() {
    this.hide();
    document.removeEventListener('keydown', this._key);
    this.el.remove();
  }
}
