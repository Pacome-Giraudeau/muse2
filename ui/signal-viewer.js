/* Visionneuse de signal multi-voies (globale `SignalViewer`) : vue d'ensemble + vue détaillée zoomable, bandes
 * d'événements (artefacts), bande d'états, sélection à la souris, lecture des valeurs au survol.
 *
 *   const v = new SignalViewer(conteneur, { onSelect: (sel) => {}, onView: (vue) => {} });
 *   v.setData({ duration, lanes, events, states, stateColors });
 *     lanes  : [{ name, unit, t: Float64Array (s), values: Float32Array, overlay?: Float32Array (tracé en couleur vive) }]
 *     events : [{ start, end, label, color }]          states : [{ start, end, state, paused }]
 *   v.setView(début, fin)   v.setSelection(début, fin) | v.setSelection(null)   v.selection   v.view
 *
 * Souris (vue détaillée) : glisser = sélectionner ; clic = effacer la sélection ; double-clic = tout afficher ;
 * Ctrl + molette = zoom autour du pointeur ; Maj + molette = déplacement.
 * Vue d'ensemble : cliquer / glisser déplace la fenêtre affichée.
 */
class SignalViewer {
  static LANE_H = 64;
  static STATE_H = 16;
  static LEFT = 74;

  constructor(container, { onSelect = () => {}, onView = () => {} } = {}) {
    container.innerHTML = `
      <canvas class="sv-overview"></canvas>
      <canvas class="sv-detail"></canvas>
      <div class="sv-readout hint">Survole le signal pour lire les valeurs.</div>`;
    this.el = container;
    this.ov = container.querySelector('.sv-overview');
    this.dt = container.querySelector('.sv-detail');
    this.readout = container.querySelector('.sv-readout');
    this.onSelect = onSelect;
    this.onView = onView;
    this.data = null;
    this.view = [0, 1];
    this.selection = null;
    this._hover = null;
    this._bind();
    this._onResize = () => this.redraw();
    window.addEventListener('resize', this._onResize);
  }

  destroy() { window.removeEventListener('resize', this._onResize); }

  setData(data) {
    this.data = data;
    this.view = [0, data.duration];
    this.redraw();
  }

  setView(a, b) {
    if (!this.data) return;
    const D = this.data.duration, w = Math.max(0.25, Math.min(D, b - a));
    a = Math.max(0, Math.min(D - w, a));
    this.view = [a, a + w];
    this.redraw();
    this.onView(this.view);
  }

  setSelection(a, b) {
    this.selection = a == null ? null : [Math.max(0, Math.min(a, b)), Math.min(this.data.duration, Math.max(a, b))];
    this.redraw();
    this.onSelect(this.selection);
  }

  /* ---------- Interaction ---------- */

  _toS(canvas, ev, range) {
    const r = canvas.getBoundingClientRect(), L = canvas === this.dt ? SignalViewer.LEFT : 0;
    const x = Math.max(L, Math.min(r.width, ev.clientX - r.left));
    return range[0] + ((x - L) / (r.width - L)) * (range[1] - range[0]);
  }

  _bind() {
    let from = null, moved = false;
    this.dt.onpointerdown = (ev) => { if (!this.data) return; from = this._toS(this.dt, ev, this.view); moved = false; this.dt.setPointerCapture(ev.pointerId); };
    this.dt.onpointermove = (ev) => {
      if (!this.data) return;
      const s = this._toS(this.dt, ev, this.view);
      this._hover = s;
      this._showReadout(s);
      if (from != null && Math.abs(s - from) > (this.view[1] - this.view[0]) / 300) { moved = true; this.selection = [Math.min(from, s), Math.max(from, s)]; }
      this.redraw();
    };
    this.dt.onpointerup = () => {
      if (from == null) return;
      if (moved) this.onSelect(this.selection); else this.setSelection(null);
      from = null;
    };
    this.dt.onpointerleave = () => { this._hover = null; this.redraw(); };
    this.dt.ondblclick = () => this.setView(0, this.data.duration);
    this.dt.addEventListener('wheel', (ev) => {
      if (!this.data || (!ev.ctrlKey && !ev.shiftKey)) return;
      ev.preventDefault();
      const [a, b] = this.view, w = b - a;
      if (ev.ctrlKey) {
        const s = this._toS(this.dt, ev, this.view), k = ev.deltaY > 0 ? 1.25 : 0.8, nw = w * k;
        this.setView(s - ((s - a) / w) * nw, s - ((s - a) / w) * nw + nw);
      } else {
        const d = (ev.deltaY > 0 ? 0.15 : -0.15) * w;
        this.setView(a + d, b + d);
      }
    }, { passive: false });

    let dragOv = false;
    const moveTo = (ev) => { const s = this._toS(this.ov, ev, [0, this.data.duration]), w = this.view[1] - this.view[0]; this.setView(s - w / 2, s + w / 2); };
    this.ov.onpointerdown = (ev) => { if (!this.data) return; dragOv = true; this.ov.setPointerCapture(ev.pointerId); moveTo(ev); };
    this.ov.onpointermove = (ev) => { if (dragOv) moveTo(ev); };
    this.ov.onpointerup = () => { dragOv = false; };
  }

  _valueAt(lane, s, arr) {
    const t = lane.t;
    let lo = 0, hi = t.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < s) lo = m + 1; else hi = m; }
    return arr[lo];
  }

  _showReadout(s) {
    const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toFixed(3)).replace('.', ',');
    const parts = this.data.lanes.map((l) => `${l.name} ${fmt(this._valueAt(l, s, l.overlay || l.values))} ${l.unit}`);
    const ev = (this.data.events || []).filter((e) => s >= e.start && s <= e.end).map((e) => e.label);
    const st = (this.data.states || []).find((x) => s >= x.start && s < x.end);
    this.readout.textContent = `t = ${s.toFixed(2).replace('.', ',')} s · ${parts.join(' · ')}`
      + (ev.length ? ` · artefact : ${ev.join(', ')}` : '') + (st ? ` · état : ${st.paused ? 'suspendu' : (MentalState.STATES[st.state] || {}).label}` : '');
  }

  /* ---------- Dessin ---------- */

  _fit(c, cssH) {
    const d = window.devicePixelRatio || 1;
    c.style.height = cssH + 'px';
    const w = Math.round(c.clientWidth * d), h = Math.round(cssH * d);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext('2d');
    g.clearRect(0, 0, w, h);
    g.font = `${11 * d}px system-ui, sans-serif`;
    return { g, w, h, d };
  }

  // Tracé en enveloppe min/max par colonne de pixels (rapide et fidèle aux pics)
  _trace(g, lane, arr, X, mid, half, amp, color, d, range) {
    const t = lane.t;
    let i0 = 0;
    while (i0 < t.length && t[i0] < range[0]) i0++;
    let mean = 0, cnt = 0;
    for (let i = i0; i < t.length && t[i] <= range[1]; i++) { mean += arr[i]; cnt++; }
    mean = cnt ? mean / cnt : 0;
    g.strokeStyle = color; g.lineWidth = 1.1 * d; g.beginPath();
    let col = null, lo = 0, hi = 0;
    const flush = () => { if (col == null) return; g.moveTo(col, mid - (hi / amp) * half); g.lineTo(col, mid - (lo / amp) * half + 0.5); };
    for (let i = Math.max(0, i0 - 1); i < t.length && t[i] <= range[1] + 1e-9; i++) {
      const x = Math.round(X(t[i])), v = Math.max(-amp, Math.min(amp, arr[i] - mean));
      if (x !== col) { flush(); col = x; lo = hi = v; } else { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
    flush();
    g.stroke();
    return mean;
  }

  _amp(lane, arr, range) {
    const t = lane.t, vals = [];
    for (let i = 0; i < t.length; i++) if (t[i] >= range[0] && t[i] <= range[1]) vals.push(arr[i]);
    if (!vals.length) return 1;
    const s = [...vals].sort((a, b) => a - b), med = s[s.length >> 1];
    const dev = vals.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
    return dev[Math.floor(dev.length * 0.99)] * 1.15 || 1;
  }

  redraw() {
    if (!this.data) return;
    const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    const { lanes, events = [], states = [], stateColors = {}, duration } = this.data;

    /* Vue d'ensemble : première voie EEG en miniature + événements + fenêtre affichée + sélection */
    let { g, w, h, d } = this._fit(this.ov, 44);
    const Xo = (s) => (s / duration) * w, lane0 = lanes[1] || lanes[0];
    events.forEach((e) => { g.fillStyle = e.color; g.globalAlpha = 0.35; g.fillRect(Xo(e.start), 0, Math.max(d, Xo(e.end) - Xo(e.start)), h); g.globalAlpha = 1; });
    this._trace(g, lane0, lane0.overlay || lane0.values, Xo, h / 2, h / 2 - 3 * d, this._amp(lane0, lane0.overlay || lane0.values, [0, duration]), css('--trace'), d, [0, duration]);
    if (this.selection) { g.fillStyle = 'rgba(91,108,255,0.25)'; g.fillRect(Xo(this.selection[0]), 0, Xo(this.selection[1]) - Xo(this.selection[0]), h); }
    g.strokeStyle = css('--text'); g.lineWidth = 1.5 * d;
    g.strokeRect(Xo(this.view[0]) + d, d, Xo(this.view[1]) - Xo(this.view[0]) - 2 * d, h - 2 * d);

    /* Vue détaillée */
    const L = SignalViewer.LEFT, LH = SignalViewer.LANE_H, SH = states.length ? SignalViewer.STATE_H + 6 : 0;
    ({ g, w, h, d } = this._fit(this.dt, lanes.length * LH + SH + 22));
    const [a, b] = this.view, X = (s) => L * d + ((s - a) / (b - a)) * (w - L * d);
    const top = 4 * d, laneH = LH * d, bottom = top + lanes.length * laneH;

    events.forEach((e) => {
      if (e.end < a || e.start > b) return;
      const x0 = X(Math.max(a, e.start)), x1 = X(Math.min(b, e.end));
      g.fillStyle = e.color; g.globalAlpha = 0.16; g.fillRect(x0, top, Math.max(2 * d, x1 - x0), bottom - top); g.globalAlpha = 1;
      g.fillRect(x0, 0, Math.max(2 * d, x1 - x0), 3 * d);
      if (x1 - x0 > 30 * d) { g.fillStyle = e.color; g.fillText(e.label, x0 + 3 * d, top + 11 * d); }
    });

    lanes.forEach((lane, i) => {
      const y0 = top + i * laneH, mid = y0 + laneH / 2;
      g.strokeStyle = css('--line'); g.lineWidth = d;
      g.beginPath(); g.moveTo(L * d, mid); g.lineTo(w, mid); g.stroke();
      const main = lane.overlay || lane.values, amp = this._amp(lane, main, this.view);
      if (lane.overlay) this._trace(g, lane, lane.values, X, mid, laneH / 2 - 4 * d, amp, css('--muted'), d, this.view);
      this._trace(g, lane, main, X, mid, laneH / 2 - 4 * d, amp, lane.overlay ? css('--accent') : css('--trace'), d, this.view);
      g.fillStyle = css('--text'); g.fillText(lane.name, 4 * d, mid);
      g.fillStyle = css('--muted'); g.fillText(`±${amp >= 10 ? amp.toFixed(0) : amp.toFixed(2)} ${lane.unit}`, 4 * d, mid + 13 * d);
    });

    if (states.length) {
      const y = bottom + 4 * d, hh = SignalViewer.STATE_H * d;
      states.forEach((s) => {
        if (s.end < a || s.start > b) return;
        g.fillStyle = s.paused ? 'rgba(143,152,171,0.25)' : stateColors[s.state] || css('--muted');
        g.fillRect(X(Math.max(a, s.start)), y, X(Math.min(b, s.end)) - X(Math.max(a, s.start)) + 0.5, hh);
      });
      g.fillStyle = css('--text'); g.fillText('États', 4 * d, y + 12 * d);
    }

    if (this.selection) {
      const x0 = X(Math.max(a, this.selection[0])), x1 = X(Math.min(b, this.selection[1]));
      if (x1 > x0) {
        g.fillStyle = 'rgba(91,108,255,0.18)'; g.fillRect(x0, 0, x1 - x0, h - 18 * d);
        g.strokeStyle = css('--accent'); g.lineWidth = 1.5 * d;
        g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0, h - 18 * d); g.moveTo(x1, 0); g.lineTo(x1, h - 18 * d); g.stroke();
      }
    }
    if (this._hover != null && this._hover >= a && this._hover <= b) {
      g.strokeStyle = css('--text'); g.globalAlpha = 0.5; g.lineWidth = d;
      g.beginPath(); g.moveTo(X(this._hover), 0); g.lineTo(X(this._hover), h - 18 * d); g.stroke(); g.globalAlpha = 1;
    }
    // Graduations de temps
    const span = b - a, step = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30].find((s) => span / s <= 10) || 60;
    g.fillStyle = css('--muted');
    for (let s = Math.ceil(a / step) * step; s <= b + 1e-9; s += step) {
      const x = X(s);
      g.fillRect(x, h - 18 * d, d, 4 * d);
      g.fillText((+s.toFixed(2)).toString().replace('.', ',') + ' s', x - 8 * d, h - 3 * d);
    }
  }
}
