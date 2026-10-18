/* Petite tête en 3D (fil de fer sur canvas 2D, sans bibliothèque) qui suit l'orientation du casque (globale `Head3D`).
 *
 *   const head = new Head3D(document.getElementById('head3d'));
 *   head.update({ pitch, roll, yaw });   // degrés, voir lib/head-pose.js (`pose.angles`)
 *   head.destroy();
 *
 * Repère : x vers le nez, y vers l'oreille gauche, z vers le haut. Vue de face en miroir, légèrement du dessus.
 * Le nez, les oreilles et les 4 capteurs (TP9, AF7, AF8, TP10) sont dessinés pour s'orienter. Redessine seulement quand les angles changent.
 */
class Head3D {
  // Capteurs sur un ellipsoïde de demi-axes (1, 0.85, 1.05) : [x, y, z] (nez = +x).
  static SENSORS = [
    { name: 'TP9', p: [-0.2, 0.84, -0.12] },
    { name: 'AF7', p: [0.82, 0.38, 0.5] },
    { name: 'AF8', p: [0.82, -0.38, 0.5] },
    { name: 'TP10', p: [-0.2, -0.84, -0.12] },
  ];
  static AXES = [1, 0.85, 1.05];

  constructor(container) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'head3d';
    container.appendChild(this.canvas);
    this._angles = { pitch: 0, roll: 0, yaw: 0 };
    this._draw();
  }

  update(angles) {
    const a = this._angles;
    if (a.pitch === angles.pitch && a.roll === angles.roll && a.yaw === angles.yaw) return;
    this._angles = { pitch: angles.pitch, roll: angles.roll, yaw: angles.yaw };
    this._draw();
  }

  destroy() { this.canvas.remove(); }

  // Matrice de rotation de la tête (Rz·Ry·Rx) puis de la vue (tête vue de face, un peu du dessus).
  _matrix() {
    const r = Math.PI / 180, { pitch, roll, yaw } = this._angles;
    const mul = (A, B) => A.map((row, i) => B[0].map((_, j) => row.reduce((s, _v, k) => s + A[i][k] * B[k][j], 0)));
    const rx = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
    const ry = (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
    const rz = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
    const head = mul(rz(yaw * r), mul(ry(pitch * r), rx(roll * r)));
    const view = mul(ry(-0.35), rz(180 * r));
    return mul(view, head);
  }

  _draw() {
    const cv = this.canvas, dpr = devicePixelRatio || 1;
    const w = Math.round((cv.clientWidth || 240) * dpr), h = Math.round((cv.clientHeight || 200) * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const ctx = cv.getContext('2d');
    const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    const muted = css('--muted') || '#666', accent = css('--accent') || '#36c';
    const M = this._matrix(), S = Math.min(w, h) * 0.4, cx = w / 2, cy = h / 2;
    // Caméra face à la tête, en MIROIR (tourner à gauche = la figure tourne vers la gauche de l'écran) : z vers le haut ; x = profondeur.
    const proj = (p) => {
      const x = M[0][0] * p[0] + M[0][1] * p[1] + M[0][2] * p[2];
      const y = M[1][0] * p[0] + M[1][1] * p[1] + M[1][2] * p[2];
      const z = M[2][0] * p[0] + M[2][1] * p[1] + M[2][2] * p[2];
      return { sx: cx + y * S, sy: cy - z * S, depth: x };
    };
    const [ax, ay, az] = Head3D.AXES;
    const onHead = (u, v, s = 1) => [ax * Math.cos(v) * Math.cos(u) * s, ay * Math.cos(v) * Math.sin(u) * s, az * Math.sin(v) * s];
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = dpr;
    const poly = (pts, color, closed) => {
      for (let i = 0; i < pts.length - 1 + (closed ? 1 : 0); i++) {
        const a = proj(pts[i]), b = proj(pts[(i + 1) % pts.length]);
        const front = (a.depth + b.depth) / 2 < 0; // côté caméra (x négatif) : trait plein, l'autre côté : estompé
        ctx.globalAlpha = front ? 0.8 : 0.22;
        ctx.strokeStyle = color;
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };
    const N = 36;
    // Méridiens et parallèles du crâne
    for (let k = 0; k < 6; k++) poly(Array.from({ length: N }, (_, i) => onHead((i / N) * 2 * Math.PI, ((k - 2.5) / 6) * Math.PI * 0.95)), muted, true);
    for (let k = 0; k < 6; k++) {
      const u = (k / 6) * Math.PI;
      poly(Array.from({ length: N }, (_, i) => { const v = (i / N) * 2 * Math.PI; return [ax * Math.cos(v) * Math.cos(u), ay * Math.cos(v) * Math.sin(u), az * Math.sin(v)]; }), muted, true);
    }
    // Bandeau du casque (anneau front → oreilles → nuque)
    poly(Array.from({ length: N }, (_, i) => onHead((i / N) * 2 * Math.PI, 0.32, 1.04)), accent, true);
    // Nez
    const nose = [onHead(0.18, 0.02, 1), [ax * 1.38, 0, 0.0], onHead(-0.18, 0.02, 1)];
    poly(nose, muted, false);
    // Oreilles
    for (const side of [1, -1]) poly(Array.from({ length: 12 }, (_, i) => { const t = (i / 12) * 2 * Math.PI; return [-0.05 + 0.1 * Math.cos(t), side * ay * 1.0, -0.05 + 0.18 * Math.sin(t)]; }), muted, true);
    // Capteurs
    ctx.font = `${Math.round(10 * dpr)}px sans-serif`;
    ctx.textAlign = 'center';
    for (const s of Head3D.SENSORS) {
      const p = proj(s.p.map((v, i) => v * Head3D.AXES[i] * 1.04));
      ctx.globalAlpha = p.depth < 0 ? 1 : 0.35;
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.arc(p.sx, p.sy, 4 * dpr, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = muted;
      ctx.fillText(s.name, p.sx, p.sy - 7 * dpr);
    }
    ctx.globalAlpha = 1;
  }
}
