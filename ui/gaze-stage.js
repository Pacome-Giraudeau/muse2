/* Scène du test du regard, PLEIN ÉCRAN (globale `GazeStage`) : un point suit le protocole de lib/gaze-model.js pendant
 * qu'un graphique en bas d'écran compare en direct l'ATTENDU (théorie, calibration) au RÉEL (AF7 − AF8). Aucun calcul
 * métier ici : les images mesurées (GazeMeter.frames) et le modèle sont fournis par l'appelant.
 *
 *   const stage = new GazeStage({ onCancel });          // bouton « Annuler » et touche Échap
 *   stage.run({ duration, target, frames, view, onTick, onEnd })
 *       duration  secondes du test ; target(t) -> position -1..+1 (+1 = bord gauche) ; frames() -> [{ t, d }]
 *       view      { gain, lagS, theoryGain, sign } : courbes attendues (gain = null : pas de calibration)
 *       onTick(t) à chaque image (ex. le simulateur suit le point) ; onEnd() à la fin normale
 *   stage.stop();  stage.destroy();
 *   GazeStage.draw(canvas, { frames, view, target, t0, t1, baseline, dark, detrend })   // le même graphique, hors scène (résultats)
 * Courbes (µV, niveau du centre soustrait) : point demandé (gris, ±1 = moitié de la hauteur), théorie (orange), calibration (bleu), réel (vert). */
class GazeStage {
  static COLORS = { target: '#9aa0a6', theory: '#e8a33d', calib: '#4a90e2', real: '#2ca36b' };

  constructor({ onCancel } = {}) {
    this.onCancel = onCancel;
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(12,14,20,.96);display:none;color:#e8eaed;font:14px system-ui,sans-serif';
    this.el.innerHTML = `
      <div data-dot style="position:absolute;top:34%;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:#ff5a5f;box-shadow:0 0 0 6px rgba(255,90,95,.25)"></div>
      <div data-cap style="position:absolute;top:12px;left:0;right:0;text-align:center"></div>
      <button data-cancel class="btn ghost" style="position:absolute;top:10px;right:14px">Annuler (Échap)</button>
      <canvas data-chart style="position:absolute;left:5%;width:90%;bottom:16px;height:36%"></canvas>`;
    document.body.appendChild(this.el);
    this.dot = this.el.querySelector('[data-dot]');
    this.cap = this.el.querySelector('[data-cap]');
    this.canvas = this.el.querySelector('[data-chart]');
    this.el.querySelector('[data-cancel]').onclick = () => this._cancel();
    this._key = (e) => { if (e.key === 'Escape') this._cancel(); };
    this._raf = 0;
  }

  _cancel() { this.stop(); if (this.onCancel) this.onCancel(); }

  run({ duration, target, frames, view, onTick, onEnd }) {
    this.stop();
    this.el.style.display = 'block';
    window.addEventListener('keydown', this._key);
    if (this.el.requestFullscreen) this.el.requestFullscreen().catch(() => {});
    const t0 = performance.now();
    const loop = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= duration) { this.stop(); if (onEnd) onEnd(); return; }
      const pos = target(t);
      this.dot.style.left = (50 - (pos || 0) * 100 * GazeModel.EDGE / 2) + '%';
      this.cap.textContent = `Suis le point des yeux, sans bouger la tête — ${Math.ceil(duration - t)} s`;
      if (onTick) onTick(t);
      GazeStage.draw(this.canvas, { frames: frames(), view, target, t0: Math.max(0, t - 14), t1: Math.max(14, t), baseline: null, dark: true });
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this._raf);
    this.el.style.display = 'none';
    window.removeEventListener('keydown', this._key);
    if (document.fullscreenElement === this.el) document.exitFullscreen().catch(() => {});
  }

  destroy() { this.stop(); this.el.remove(); }

  // Graphique attendu / réel. detrend(t) : dérive à retirer (GazeModel.analyse().drift) ; baseline : niveau du « centre » (µV) ; null = moyenne des images de t = 0,5 à 2 s.
  static draw(canvas, { frames, view, target, t0, t1, baseline, dark = false, detrend = null }) {
    const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    const g = canvas.getContext('2d'), C = GazeStage.COLORS;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const fg = dark ? '#e8eaed' : getComputedStyle(canvas).color;
    let base = baseline;
    if (detrend) { frames = frames.map((f) => ({ t: f.t, d: f.d - detrend(f.t) })); base = 0; }
    if (base === null || base === undefined) {
      const c = frames.filter((f) => f.t >= 0.5 && f.t < GazeModel.LEAD_S).map((f) => f.d);
      base = c.length ? c.reduce((s, x) => s + x, 0) / c.length : (frames.length ? frames[0].d : 0);
    }
    const sign = view.sign || 1, lag = view.lagS || 0;
    const series = [
      ['target', (t) => { const p = target(t); return p === null ? null : p; }, 'point demandé (échelle ±1)', true],
      view.theoryGain ? ['theory', (t) => { const p = target(t - lag); return p === null ? null : sign * view.theoryGain * p; }, 'théorie', false] : null,
      view.gain ? ['calib', (t) => { const p = target(t - lag); return p === null ? null : view.gain * p; }, 'calibration', false] : null,
    ].filter(Boolean);
    const vis = frames.filter((f) => f.t >= t0 && f.t <= t1);
    let amp = 1;
    for (const f of vis) amp = Math.max(amp, Math.abs(f.d - base));
    if (view.theoryGain) amp = Math.max(amp, view.theoryGain);
    if (view.gain) amp = Math.max(amp, Math.abs(view.gain));
    amp *= 1.15;
    const L = 46, T = 18, B = 8, pw = W - L - 8, ph = H - T - B;
    const X = (t) => L + ((t - t0) / (t1 - t0)) * pw, Y = (v) => T + ph / 2 - (v / amp) * (ph / 2);
    g.strokeStyle = 'rgba(128,128,128,.35)'; g.lineWidth = 1; g.font = '11px system-ui'; g.fillStyle = fg;
    g.beginPath(); g.moveTo(L, Y(0)); g.lineTo(W - 8, Y(0)); g.stroke();
    g.textAlign = 'right';
    g.fillText('+' + amp.toFixed(0) + ' µV', L - 4, T + 8); g.fillText('0', L - 4, Y(0) + 4); g.fillText('−' + amp.toFixed(0), L - 4, T + ph);
    const line = (color, fn, dash) => {
      g.strokeStyle = color; g.lineWidth = 2; g.setLineDash(dash ? [6, 4] : []); g.beginPath();
      let pen = false;
      for (let i = 0; i <= 300; i++) {
        const t = t0 + ((t1 - t0) * i) / 300, v = fn(t);
        if (v === null) { pen = false; continue; }
        if (pen) g.lineTo(X(t), Y(v)); else { g.moveTo(X(t), Y(v)); pen = true; }
      }
      g.stroke(); g.setLineDash([]);
    };
    series.forEach(([k, fn, , unit]) => line(C[k], unit ? (t) => { const v = fn(t); return v === null ? null : v * amp * 0.5; } : fn, k === 'theory'));
    g.strokeStyle = C.real; g.lineWidth = 2; g.beginPath();
    vis.forEach((f, i) => { const x = X(f.t), y = Y(f.d - base); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
    g.textAlign = 'left';
    let x = L;
    [...series.map((s) => [C[s[0]], s[2]]), [C.real, detrend ? 'réel (dérive retirée)' : 'réel (AF7 − AF8)']].forEach(([c, label]) => {
      g.fillStyle = c; g.fillRect(x, 4, 12, 4); g.fillStyle = fg; g.fillText(label, x + 16, 10); x += 22 + g.measureText(label).width + 10;
    });
  }
}
