/* Scène du jeu de course (globale `RunnerStage`) : dessine en perspective les 3 couloirs, les obstacles et le joueur d'un
 * RunnerGame (lib/runner-game.js) sur un canvas. Couleurs via les variables CSS de l'application.
 *
 *   const stage = new RunnerStage(conteneur, game);
 *   stage.render(flash?)   // à appeler à chaque image ; flash = 'hit' | 'dodge' | null (liseré coloré bref)
 *   stage.message(texte)   // bandeau au centre (null pour l'effacer)
 *   stage.destroy()
 */
class RunnerStage {
  constructor(container, game) {
    this.game = game;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'runner-canvas';
    this.canvas.width = 640; this.canvas.height = 360;
    container.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d');
    this._msg = null;
    this._shake = 0;
  }

  message(text) { this._msg = text; }

  _css(name) { return getComputedStyle(this.canvas).getPropertyValue(name).trim() || '#888'; }

  // Position d'un point (couloir fractionnaire, profondeur 0 = horizon .. 1 = joueur) à l'écran.
  _project(lane, depth) {
    const W = this.canvas.width, H = this.canvas.height, top = H * 0.18;
    const y = top + (H - top) * depth * depth * 0.2 + (H - top) * depth * 0.8;
    const half = (W * 0.08) + (W * 0.42) * depth, laneW = (half * 2) / 3;
    return { x: W / 2 - half + laneW * (lane + 0.5), y, laneW, scale: 0.2 + 0.8 * depth };
  }

  render(flash = null) {
    const { g, canvas: c, game } = this, W = c.width, H = c.height, s = game.state;
    const text = this._css('--text'), muted = this._css('--muted'), line = this._css('--line'), accent = this._css('--accent');
    const bad = this._css('--bad'), good = this._css('--good'), panel = this._css('--panel'), amber = this._css('--amber');
    g.clearRect(0, 0, W, H);
    g.fillStyle = panel; g.fillRect(0, 0, W, H);

    // couloirs
    const L = (lane, d) => this._project(lane - 0.5, d);
    g.strokeStyle = line; g.lineWidth = 2;
    for (let k = 0; k <= 3; k++) { g.beginPath(); const a = L(k, 0), b = L(k, 1); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
    const dist = s.distance * 0.35;
    for (let k = 0; k < 8; k++) { // traits qui défilent
      const d = ((k + (dist % 1)) / 8) ** 1.6, a = L(0, d), b = L(3, d);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }

    // obstacles (le plus loin d'abord)
    const approach = game.cfg.approachMs;
    [...s.obstacles].reverse().forEach((o) => {
      const depth = Math.max(0, Math.min(1, 1 - o.etaMs / approach));
      if (o.kind === 'bar') {
        const a = L(0, depth), b = L(3, depth), h = 26 * a.scale;
        g.fillStyle = amber; g.fillRect(a.x, a.y - h, b.x - a.x, h);
        g.fillStyle = text; g.font = `${Math.round(18 * a.scale + 6)}px sans-serif`; g.textAlign = 'center';
        g.fillText('⬆ saute !', (a.x + b.x) / 2, a.y - h * 0.25);
      } else {
        o.lanes.forEach((lane) => {
          const a = L(lane, depth), b = L(lane + 1, depth), h = 44 * a.scale;
          g.fillStyle = bad; g.fillRect(a.x + 3, a.y - h, b.x - a.x - 6, h);
        });
      }
    });

    // joueur
    const p = this._project(s.lane, 0.93), jump = s.jumping ? 46 : 0;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '44px sans-serif';
    g.fillStyle = text; g.fillText(s.jumping ? '🦘' : '🏃', p.x, p.y - 26 - jump);
    g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.ellipse(p.x, p.y - 4, 22, 6, 0, 0, Math.PI * 2); g.fill();

    // geste attendu
    const need = game.needed();
    if (need) {
      const icon = { left: '👈', right: '👉', jump: '😉' }[need.action];
      g.font = '40px sans-serif'; g.globalAlpha = 0.9;
      g.fillText(icon, need.action === 'right' ? W - 50 : need.action === 'left' ? 50 : W / 2, 50);
      g.globalAlpha = 1;
    }
    if (flash) { g.strokeStyle = flash === 'hit' ? bad : good; g.lineWidth = 8; g.strokeRect(4, 4, W - 8, H - 8); }
    if (this._msg) {
      g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, H / 2 - 40, W, 80);
      g.fillStyle = '#fff'; g.font = '24px sans-serif'; g.fillText(this._msg, W / 2, H / 2);
    }
    g.textBaseline = 'alphabetic';
  }

  destroy() { this.canvas.remove(); }
}
