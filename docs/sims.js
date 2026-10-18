/* Simulations interactives de la page « Comprendre la science » (docs/science.html).
 * Chaque <div class="sim" data-sim="nom"> est rempli par SIMS[nom](div).
 * Elles réutilisent le vrai code de l'application (lib/signal.js, lib/filters.js, lib/muse.js) : ce qu'on manipule
 * ici est exactement ce que fait l'appli. Les simulations animées ne tournent que lorsqu'elles sont visibles.
 *
 * Liste (identifiant de la section de science.html) : sampling (numerisation), filter (filtres), spectrum (spectre),
 * eye (yeux), muscle (muscles), threshold (calibration), ppg (ppg), bluetooth (bluetooth), mental (etat).
 */

/* ---------------- Outils communs ---------------- */
const Sim = {
  css: (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim(),
  gauss: (s = 1) => s * Math.sqrt(-2 * Math.log(Math.random() + 1e-12)) * Math.cos(2 * Math.PI * Math.random()),

  // Générateur pseudo-aléatoire reproductible (pour les distributions qui ne doivent pas « bouger »)
  seeded(seed) {
    let x = seed >>> 0;
    const rnd = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    return { rnd, gauss: (s = 1) => s * Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd()) };
  },

  canvas(parent, height) {
    const c = document.createElement('canvas');
    c.className = 'sim-canvas';
    c.style.height = height + 'px';
    parent.appendChild(c);
    return c;
  },

  // Prépare le canvas à la bonne résolution ; renvoie { g, w, h, d } (d = densité de pixels)
  ctx(c) {
    const d = window.devicePixelRatio || 1, w = Math.round(c.clientWidth * d), h = Math.round(c.clientHeight * d);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext('2d');
    g.clearRect(0, 0, w, h);
    g.font = `${11 * d}px system-ui, sans-serif`;
    g.lineJoin = 'round';
    return { g, w, h, d };
  },

  controls(parent) { const div = document.createElement('div'); div.className = 'sim-controls'; parent.appendChild(div); return div; },
  readout(parent) { const p = document.createElement('p'); p.className = 'sim-readout'; parent.appendChild(p); return p; },

  slider(parent, { label, min, max, step = 1, value, unit = '', fmt = (v) => v }, onInput) {
    const l = document.createElement('label');
    l.innerHTML = `${label} <input type="range" min="${min}" max="${max}" step="${step}" value="${value}"> <b></b> ${unit}`;
    const input = l.querySelector('input'), b = l.querySelector('b');
    const update = () => { b.textContent = fmt(+input.value); onInput && onInput(); };
    input.oninput = update;
    b.textContent = fmt(value);
    parent.appendChild(l);
    return () => +input.value;
  },

  check(parent, label, value, onChange) {
    const l = document.createElement('label');
    l.innerHTML = `<input type="checkbox" ${value ? 'checked' : ''}> ${label}`;
    const input = l.querySelector('input');
    input.onchange = () => onChange && onChange();
    parent.appendChild(l);
    return () => input.checked;
  },

  select(parent, label, options, value, onChange) {
    const l = document.createElement('label');
    l.innerHTML = `${label} <select>${options.map((o) => `<option value="${o.value}" ${o.value === value ? 'selected' : ''}>${o.label}</option>`).join('')}</select>`;
    const s = l.querySelector('select');
    s.onchange = () => onChange && onChange();
    parent.appendChild(l);
    return () => s.value;
  },

  button(parent, label, onClick) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = label;
    b.onclick = onClick;
    parent.appendChild(b);
    return b;
  },

  // Repère : cadre, grille, graduations. box = zone de tracé en pixels. Renvoie { X, Y } (valeur -> pixel).
  frame(g, d, box, { x0, x1, y0, y1, xTicks = [], yTicks = [], xFmt = (v) => v, yFmt = (v) => v, logX = false }) {
    const lx = (v) => (logX ? Math.log10(v) : v);
    const X = (v) => box.l + ((lx(v) - lx(x0)) / (lx(x1) - lx(x0))) * box.w;
    const Y = (v) => box.t + (1 - (v - y0) / (y1 - y0)) * box.h;
    g.strokeStyle = Sim.css('--line'); g.fillStyle = Sim.css('--muted'); g.lineWidth = d;
    xTicks.forEach((v) => { g.beginPath(); g.moveTo(X(v), box.t); g.lineTo(X(v), box.t + box.h); g.stroke(); g.fillText(xFmt(v), X(v) - 8 * d, box.t + box.h + 13 * d); });
    yTicks.forEach((v) => { g.beginPath(); g.moveTo(box.l, Y(v)); g.lineTo(box.l + box.w, Y(v)); g.stroke(); g.fillText(yFmt(v), 2 * d, Y(v) + 4 * d); });
    return { X, Y };
  },

  line(g, d, map, xs, ys, color, width = 1.5, dash = null) {
    g.save();
    g.strokeStyle = color; g.lineWidth = width * d;
    if (dash) g.setLineDash(dash.map((v) => v * d));
    g.beginPath();
    let pen = false;
    for (let i = 0; i < xs.length; i++) {
      if (ys[i] == null || !isFinite(ys[i])) { pen = false; continue; }
      const x = map.X(xs[i]), y = map.Y(ys[i]);
      pen ? g.lineTo(x, y) : g.moveTo(x, y);
      pen = true;
    }
    g.stroke();
    g.restore();
  },

  box(w, h, d, { l = 40, r = 8, t = 8, b = 20 } = {}) { return { l: l * d, t: t * d, w: w - (l + r) * d, h: h - (t + b) * d }; },

  // Lance fn(dt en s) à chaque image tant que l'élément est visible à l'écran
  loop(el, fn) {
    let visible = false, last = 0, frame = null;
    const tick = (now) => {
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      fn(dt);
      frame = visible ? requestAnimationFrame(tick) : null;
    };
    new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !frame) { last = 0; frame = requestAnimationFrame(tick); }
    }).observe(el);
    fn(0); // premier dessin, même hors écran
  },

  // Tampon glissant de taille fixe
  ring(n) { const a = new Array(n).fill(null); return { a, push(v) { a.push(v); a.shift(); } }; },
};

/* ---------------- Les simulations ---------------- */
const SIMS = {

  /* Échantillonnage, repliement et quantification */
  sampling(el) {
    const c = Sim.canvas(el, 220), ctl = Sim.controls(el), out = Sim.readout(el);
    const f = Sim.slider(ctl, { label: 'Fréquence du signal', min: 1, max: 400, value: 10, unit: 'Hz' }, draw);
    const fs = Sim.slider(ctl, { label: 'Échantillonnage', min: 20, max: 512, value: 256, unit: 'Hz' }, draw);
    const bits = Sim.slider(ctl, { label: 'Résolution', min: 2, max: 12, value: 12, unit: 'bits' }, draw);
    window.addEventListener('resize', draw);

    function draw() {
      const { g, w, h, d } = Sim.ctx(c), T = 100; // fenêtre de 100 ms
      const m = Sim.frame(g, d, Sim.box(w, h, d, { l: 26 }), { x0: 0, x1: T, y0: -1.25, y1: 1.25, xTicks: [0, 25, 50, 75, 100], yTicks: [-1, 0, 1], xFmt: (v) => v + ' ms' });
      const F = f(), FS = fs(), levels = 2 ** bits();
      const q = (v) => (Math.round(((v + 1) / 2) * (levels - 1)) / (levels - 1)) * 2 - 1;
      const xs = [], ys = [];
      for (let i = 0; i <= 3000; i++) { const t = (i / 3000) * T; xs.push(t); ys.push(Math.sin((2 * Math.PI * F * t) / 1000)); }
      Sim.line(g, d, m, xs, ys, Sim.css('--muted'), 1);
      const signed = F - FS * Math.round(F / FS), alias = Math.abs(signed); // fréquence perçue (repliée)
      const rx = [], ry = [];
      for (let i = 0; i <= 1000; i++) { const t = (i / 1000) * T; rx.push(t); ry.push(Math.sin((2 * Math.PI * signed * t) / 1000)); }
      Sim.line(g, d, m, rx, ry, Sim.css('--accent'), 1.5, [5, 4]);
      g.fillStyle = Sim.css('--accent');
      for (let k = 0; k <= (T / 1000) * FS; k++) {
        const t = (k / FS) * 1000;
        g.beginPath(); g.arc(m.X(t), m.Y(q(Math.sin(2 * Math.PI * F * k / FS))), 3 * d, 0, 2 * Math.PI); g.fill();
      }
      const step = 2000 / (levels - 1);
      out.innerHTML = `Gris : le vrai signal. Points : les mesures. Pointillés : ce que les mesures laissent croire (<b>${alias.toFixed(0)} Hz</b>).` +
        (F > FS / 2 ? ` <span class="warn">⚠ ${F} Hz dépasse la moitié de l'échantillonnage (${(FS / 2).toFixed(0)} Hz) : le signal est <b>replié</b> et se fait passer pour ${alias.toFixed(0)} Hz.</span>` : '') +
        ` Avec ${bits()} bits sur ±1000 µV, un pas vaut ${step.toLocaleString('fr-FR', { maximumFractionDigits: step < 10 ? 2 : 0 })} µV (Muse 2 : 12 bits = 0,49 µV).`;
    }
    draw();
  },

  /* Filtres : effet dans le temps et réponse en fréquence (vrais biquads de lib/filters.js) */
  filter(el) {
    const c1 = Sim.canvas(el, 180), c2 = Sim.canvas(el, 150), ctl = Sim.controls(el), out = Sim.readout(el);
    const R = 256, N = 4 * R, rng = Sim.seeded(7);
    const parts = {
      drift: Array.from({ length: N }, (_, i) => 40 * Math.sin(2 * Math.PI * 0.2 * i / R)),
      alpha: Array.from({ length: N }, (_, i) => 10 * Math.sin(2 * Math.PI * 10 * i / R)),
      mains: Array.from({ length: N }, (_, i) => 8 * Math.sin(2 * Math.PI * 50 * i / R)),
    };
    const input = parts.drift.map((v, i) => v + parts.alpha[i] + parts.mains[i] + rng.gauss(1.5));
    const type = Sim.select(ctl, 'Filtre', [
      { value: 'lowpass', label: 'passe-bas' }, { value: 'highpass', label: 'passe-haut' }, { value: 'notch', label: 'coupe-bande' }], 'highpass', draw);
    const pos = Sim.slider(ctl, { label: 'Fréquence', min: 0, max: 100, value: 33, fmt: (v) => fc(v).toFixed(fc(v) < 1 ? 2 : fc(v) < 10 ? 1 : 0) }, draw);
    ctl.lastChild.insertAdjacentText('beforeend', 'Hz');
    function fc(v) { return 0.1 * 10 ** ((v / 100) * 3.08); } // 0,1 à 120 Hz, échelle logarithmique
    window.addEventListener('resize', draw);

    function gainAt(co, f) {
      const w = (2 * Math.PI * f) / R, c1_ = Math.cos(w), s1 = Math.sin(w), c2_ = Math.cos(2 * w), s2 = Math.sin(2 * w);
      const nr = co.b0 + co.b1 * c1_ + co.b2 * c2_, ni = -(co.b1 * s1 + co.b2 * s2);
      const dr = 1 + co.a1 * c1_ + co.a2 * c2_, di = -(co.a1 * s1 + co.a2 * s2);
      return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
    }

    function draw() {
      const t = type(), f0 = fc(pos()), co = Biquad.design(t, f0, R, t === 'notch' ? 25 : Math.SQRT1_2);
      const bq = new Biquad(co), output = input.map((v) => bq.step(v));
      let { g, w, h, d } = Sim.ctx(c1);
      const xs = input.map((_, i) => i / R);
      let m = Sim.frame(g, d, Sim.box(w, h, d, { l: 34 }), { x0: 0, x1: 4, y0: -70, y1: 70, xTicks: [0, 1, 2, 3, 4], yTicks: [-50, 0, 50], xFmt: (v) => v + ' s' });
      Sim.line(g, d, m, xs, input, Sim.css('--muted'), 1);
      Sim.line(g, d, m, xs, output, Sim.css('--accent'), 1.5);
      ({ g, w, h, d } = Sim.ctx(c2));
      m = Sim.frame(g, d, Sim.box(w, h, d, { l: 34 }), { x0: 0.1, x1: 128, y0: -40, y1: 5, logX: true, xTicks: [0.1, 1, 10, 50, 128], yTicks: [-40, -20, 0], xFmt: (v) => v + ' Hz', yFmt: (v) => v + ' dB' });
      const fx = [], fy = [];
      for (let i = 0; i <= 400; i++) { const f = 0.1 * 1280 ** (i / 400); fx.push(f); fy.push(20 * Math.log10(gainAt(co, f) + 1e-6)); }
      Sim.line(g, d, m, fx, fy, Sim.css('--accent'), 2);
      const comps = [['dérive', 0.2], ['alpha', 10], ['secteur', 50]];
      g.fillStyle = Sim.css('--text');
      comps.forEach(([name, f]) => {
        const y = 20 * Math.log10(gainAt(co, f) + 1e-6);
        g.beginPath(); g.arc(m.X(f), m.Y(Math.max(-40, y)), 4 * d, 0, 2 * Math.PI); g.fill();
        g.fillText(name, m.X(f) + 6 * d, m.Y(Math.max(-40, y)) - 6 * d);
      });
      const pct = (f) => (100 * gainAt(co, f)).toFixed(0) + ' %';
      out.innerHTML = `En haut : signal d'entrée (gris : dérive 0,2 Hz + alpha 10 Hz + secteur 50 Hz) et sortie du filtre (couleur). En bas : ce que le filtre laisse passer à chaque fréquence.
        Il garde <b>${pct(0.2)}</b> de la dérive, <b>${pct(10)}</b> de l'alpha, <b>${pct(50)}</b> du secteur.
        <br>À essayer : passe-haut à 1 Hz (la dérive disparaît) ; coupe-bande à 50 Hz (le secteur disparaît, l'alpha reste) ; passe-bas à 5 Hz (l'alpha disparaît aussi : trop fort !).`;
    }
    draw();
  },

  /* Spectre : composer un signal, voir sa FFT, l'effet de la fenêtre et de la moyenne de Welch */
  spectrum(el) {
    const c1 = Sim.canvas(el, 130), c2 = Sim.canvas(el, 190), ctl = Sim.controls(el), out = Sim.readout(el);
    const R = 256;
    const comps = [['Delta', 2, 5], ['Theta', 6, 3], ['Alpha', 10, 10], ['Bêta', 20, 3], ['Gamma', 40, 1]]
      .map(([name, f, v]) => ({ name, f, amp: Sim.slider(ctl, { label: `${name} (${f} Hz)`, min: 0, max: 20, value: v, unit: 'µV' }) }));
    const noise = Sim.slider(ctl, { label: 'Bruit', min: 0, max: 10, step: 0.5, value: 2, unit: 'µV' });
    const hann = Sim.check(ctl, 'Fenêtre de Hann', true);
    const between = Sim.check(ctl, 'Alpha entre deux cases (10,5 Hz)', false);
    const welch = Sim.check(ctl, 'Moyenne de Welch (4 s)', false);
    let acc = 0;

    function signal(n) {
      return Array.from({ length: n }, (_, i) => comps.reduce((s, c) => {
        const f = c.name === 'Alpha' && between() ? 10.5 : c.f;
        return s + c.amp() * Math.sin(2 * Math.PI * f * i / R + c.f);
      }, 0) + Sim.gauss(noise()));
    }

    function periodogram(x, useHann) {
      const n = x.length, re = new Float64Array(n), im = new Float64Array(n);
      let wp = 0, mean = x.reduce((a, b) => a + b, 0) / n;
      for (let i = 0; i < n; i++) { const wv = useHann ? 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)) : 1; re[i] = (x[i] - mean) * wv; wp += wv * wv; }
      Signal.fft(re, im);
      const psd = [], freqs = [];
      for (let k = 0; k <= n / 2; k++) { psd.push(((k && k < n / 2 ? 2 : 1) * (re[k] ** 2 + im[k] ** 2)) / (R * wp)); freqs.push((k * R) / n); }
      return { freqs, psd };
    }

    Sim.loop(el, (dt) => {
      acc += dt;
      if (dt && acc < 0.25) return; // 4 images/s : assez pour voir le spectre « danser »
      acc = 0;
      const useWelch = welch(), x = signal(useWelch ? 4 * R : R);
      const spec = useWelch ? Signal.welch(x, R, 256) : periodogram(x, hann());
      let { g, w, h, d } = Sim.ctx(c1);
      const show = x.slice(0, R);
      let m = Sim.frame(g, d, Sim.box(w, h, d, { l: 34 }), { x0: 0, x1: 1, y0: -45, y1: 45, xTicks: [0, 0.25, 0.5, 0.75, 1], yTicks: [-30, 0, 30], xFmt: (v) => v + ' s' });
      Sim.line(g, d, m, show.map((_, i) => i / R), show, Sim.css('--trace'), 1.2);
      ({ g, w, h, d } = Sim.ctx(c2));
      m = Sim.frame(g, d, Sim.box(w, h, d, { l: 34 }), { x0: 0, x1: 50, y0: -30, y1: 25, xTicks: [0, 4, 8, 13, 30, 45], yTicks: [-20, 0, 20], xFmt: (v) => v + ' Hz', yFmt: (v) => v + ' dB' });
      Signal.BANDS.forEach((b) => { g.fillStyle = b.color + '22'; g.fillRect(m.X(b.range[0]), m.Y(25), m.X(b.range[1]) - m.X(b.range[0]), m.Y(-30) - m.Y(25)); });
      const ks = spec.freqs.map((f, k) => k).filter((k) => spec.freqs[k] <= 50);
      Sim.line(g, d, m, ks.map((k) => spec.freqs[k]), ks.map((k) => 10 * Math.log10(spec.psd[k] + 1e-4)), Sim.css('--accent'), 1.8);
      const rel = Signal.bandPowersFromPsd(spec);
      out.innerHTML = 'Part de chaque bande : ' + Signal.BANDS.map((b, i) => `<span style="color:${b.color}">■</span> ${b.name} ${(rel[i] * 100).toFixed(0)} %`).join(' · ') +
        `<br>À essayer : décoche la fenêtre de Hann avec l'alpha « entre deux cases » (l'énergie fuit partout) ; monte le bruit puis active Welch (le spectre se calme).`;
    });
  },

  /* L'œil, un dipôle électrique : regard et clignement vus par AF7 et AF8 */
  eye(el) {
    const row = document.createElement('div'); row.className = 'sim-row'; el.appendChild(row);
    const cHead = Sim.canvas(row, 240), cTr = Sim.canvas(row, 240);
    const ctl = Sim.controls(el), out = Sim.readout(el);
    const target = Sim.slider(ctl, { label: 'Regard (← gauche · droite →)', min: -30, max: 30, value: 0, unit: '°', fmt: (v) => (v > 0 ? '← ' + v : v < 0 ? -v + ' →' : '0') });
    // la case est inversée visuellement : valeur positive = gauche
    ctl.querySelector('input').style.direction = 'rtl';
    let blinkT = -1;
    Sim.button(ctl, 'Cligner', () => { blinkT = 0; });
    const brain = Sim.check(ctl, 'Activité cérébrale (alpha + bruit)', true);
    const R = 128, N = 5 * R, GAIN = 2.5; // µV par degré (ordre de grandeur pédagogique)
    const tr = { af7: Sim.ring(N), af8: Sim.ring(N), mean: Sim.ring(N), diff: Sim.ring(N) };
    let theta = 0, t = 0, carry = 0;
    out.innerHTML = 'La cornée (avant de l’œil) est positive par rapport à la rétine : chaque œil est un petit dipôle. Regarder à gauche rapproche le « + » de AF7 (gauche) et l’éloigne de AF8 : les deux électrodes bougent <b>en sens opposés</b>, la <b>différence</b> le révèle. Un clignement fait monter les deux <b>ensemble</b> : c’est la <b>moyenne</b> qui le révèle. C’est exactement ce qu’utilise le détecteur d’artefacts. (Gain de 2,5 µV/° choisi pour l’illustration.)';

    Sim.loop(el, (dt) => {
      carry += dt * R;
      for (; carry >= 1; carry--) {
        t += 1 / R;
        theta += (target() - theta) * 0.25; // saccade rapide
        if (blinkT >= 0) blinkT += 1 / R;
        const b = blinkT >= 0 && blinkT < 0.3 ? 150 * (0.5 - 0.5 * Math.cos(2 * Math.PI * blinkT / 0.3)) : 0;
        if (blinkT > 0.3) blinkT = -1;
        const bg = () => (brain() ? 8 * Math.sin(2 * Math.PI * 10 * t) + Sim.gauss(3) : 0);
        const a7 = GAIN * theta + b + bg(), a8 = -GAIN * theta + b + bg();
        tr.af7.push(a7); tr.af8.push(a8); tr.mean.push((a7 + a8) / 2); tr.diff.push(a7 - a8);
      }
      drawHead(); drawTraces();
    });

    // Vue de dessus, nez en haut : les yeux sont à l'avant, AF7/AF8 juste derrière sur le front, de chaque côté.
    function drawHead() {
      const { g, w, h, d } = Sim.ctx(cHead), r = Math.min(w * 0.42, h * 0.36), cx = w / 2, cy = h * 0.56;
      g.textAlign = 'center';
      g.strokeStyle = Sim.css('--line'); g.fillStyle = Sim.css('--bg'); g.lineWidth = 2 * d;
      g.beginPath(); g.arc(cx, cy, r, 0, 2 * Math.PI); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(cx - 9 * d, cy - r + 2 * d); g.lineTo(cx, cy - r - 14 * d); g.lineTo(cx + 9 * d, cy - r + 2 * d); g.stroke();
      const closed = blinkT >= 0;
      [-1, 1].forEach((side) => {
        const ex = cx + side * r * 0.3, ey = cy - r * 0.78;
        g.fillStyle = closed ? Sim.css('--muted') : '#fff';
        g.beginPath(); g.ellipse(ex, ey, 12 * d, 7 * d, 0, 0, 2 * Math.PI); g.fill();
        if (!closed) {
          const ix = ex - (theta / 30) * 7 * d; // regard à gauche = vers la gauche de l'écran
          g.fillStyle = '#3a4a7a'; g.beginPath(); g.arc(ix, ey, 4 * d, 0, 2 * Math.PI); g.fill();
        }
      });
      g.fillStyle = Sim.css('--muted'); g.fillText(closed ? 'paupières fermées' : 'yeux', cx, cy - r * 0.78 + 20 * d);
      const val = { AF7: tr.af7.a[N - 1] || 0, AF8: tr.af8.a[N - 1] || 0 };
      [['AF7', -1], ['AF8', 1]].forEach(([name, side]) => {
        const v = val[name], x = cx + side * r * 0.62, y = cy - r * 0.32, k = Math.min(1, Math.abs(v) / 100);
        g.fillStyle = v >= 0 ? `rgba(214,69,69,${0.25 + 0.75 * k})` : `rgba(91,108,255,${0.25 + 0.75 * k})`;
        g.beginPath(); g.arc(x, y, 15 * d, 0, 2 * Math.PI); g.fill();
        g.fillStyle = '#fff'; g.font = `bold ${10 * d}px system-ui, sans-serif`; g.fillText(name, x, y + 4 * d);
        g.font = `${11 * d}px system-ui, sans-serif`; g.fillStyle = Sim.css('--text');
        g.fillText(`${v >= 0 ? '+' : ''}${v.toFixed(0)} µV`, x, y + 30 * d);
      });
      g.fillStyle = Sim.css('--muted'); g.fillText('rouge = +   bleu = −', cx, h - 6 * d);
      g.textAlign = 'start';
    }

    function drawTraces() {
      const { g, w, h, d } = Sim.ctx(cTr), lanes = [['AF7', tr.af7, '--trace'], ['AF8', tr.af8, '--trace'], ['moyenne', tr.mean, '--good'], ['différence', tr.diff, '--accent']];
      const lh = h / 4, xs = Array.from({ length: N }, (_, i) => i);
      lanes.forEach(([name, ring, color], i) => {
        const box = { l: 70 * d, t: i * lh + 4 * d, w: w - 74 * d, h: lh - 8 * d };
        const m = Sim.frame(g, d, box, { x0: 0, x1: N - 1, y0: -180, y1: 180, yTicks: [0] , yFmt: () => '' });
        g.fillStyle = Sim.css('--text'); g.fillText(name, 4 * d, box.t + box.h / 2 + 4 * d);
        Sim.line(g, d, m, xs, ring.a, Sim.css(color), 1.4);
      });
    }
  },

  /* Muscles : une contraction ajoute de l'énergie rapide (> 20 Hz) que l'appli détecte */
  muscle(el) {
    const c1 = Sim.canvas(el, 140), c2 = Sim.canvas(el, 170), ctl = Sim.controls(el), out = Sim.readout(el);
    const force = Sim.slider(ctl, { label: 'Contraction', min: 0, max: 100, value: 0, unit: '%' });
    const R = 256, N = 2 * R, buf = Sim.ring(N);
    const shape = new Biquad(Biquad.design('highpass', 20, R)), lp = new Biquad(Biquad.design('lowpass', 15, R));
    let env = 0, t = 0, carry = 0, acc = 0;
    const THR = 8;
    Sim.loop(el, (dt) => {
      carry += dt * R;
      for (; carry >= 1; carry--) {
        t += 1 / R;
        const emg = shape.step(Sim.gauss((force() / 100) * 60)); // bruit large bande, surtout au-dessus de 20 Hz
        const x = 10 * Math.sin(2 * Math.PI * 10 * t) + Sim.gauss(3) + emg;
        env += (1 - Math.exp(-1 / (0.06 * R))) * (Math.abs(x - lp.step(x)) - env); // enveloppe > 15 Hz, comme lib/artifacts.js
        buf.push(x);
      }
      acc += dt;
      let { g, w, h, d } = Sim.ctx(c1);
      let m = Sim.frame(g, d, Sim.box(w, h, d, { l: 34 }), { x0: 0, x1: 2, y0: -120, y1: 120, xTicks: [0, 1, 2], yTicks: [-100, 0, 100], xFmt: (v) => v + ' s' });
      Sim.line(g, d, m, buf.a.map((_, i) => i / R), buf.a, Sim.css('--trace'), 1);
      if (dt && acc < 0.25 && c2.dataset.done) return;
      acc = 0; c2.dataset.done = 1;
      const data = buf.a.map((v) => v || 0), spec = Signal.welch(data, R, 256);
      ({ g, w, h, d } = Sim.ctx(c2));
      m = Sim.frame(g, d, Sim.box(w, h, d, { l: 34 }), { x0: 0, x1: 128, y0: -20, y1: 25, xTicks: [0, 10, 20, 40, 80, 128], yTicks: [-10, 0, 10, 20], xFmt: (v) => v + ' Hz', yFmt: (v) => v + ' dB' });
      g.fillStyle = 'rgba(239,111,108,0.10)'; g.fillRect(m.X(20), m.Y(25), m.X(128) - m.X(20), m.Y(-20) - m.Y(25));
      Sim.line(g, d, m, spec.freqs, spec.psd.map((p) => 10 * Math.log10(p + 1e-4)), Sim.css('--accent'), 1.8);
      const detected = env > THR;
      out.innerHTML = `Énergie au-dessus de 15 Hz : <b>${env.toFixed(1).replace('.', ',')} µV</b> (seuil d'exemple ${THR} µV) → ${detected ? '<span class="warn"><b>activité musculaire détectée</b></span>' : 'pas de muscle détecté'}.
        Le pic de l'alpha (10 Hz) reste visible, mais une contraction remplit toute la zone rosée (&gt; 20 Hz) : c'est pour cela que bêta et gamma sont si sensibles aux muscles.`;
    });
  },

  /* Placer un seuil : détections réussies contre fausses alertes */
  threshold(el) {
    const c = Sim.canvas(el, 200), ctl = Sim.controls(el), out = Sim.readout(el);
    const sep = Sim.slider(ctl, { label: 'Écart geste / repos', min: 1.2, max: 8, step: 0.1, value: 4, unit: '×', fmt: (v) => String(v).replace('.', ',') }, draw);
    const spread = Sim.slider(ctl, { label: 'Variabilité', min: 0.15, max: 0.7, step: 0.05, value: 0.35, fmt: (v) => v.toFixed(2).replace('.', ',') }, draw);
    const pos = Sim.slider(ctl, { label: 'Position du seuil', min: 0, max: 100, value: 40, unit: '%' }, draw);
    window.addEventListener('resize', draw);
    const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((p / 100) * (s.length - 1))]; };

    function draw() {
      const rng = Sim.seeded(42);
      const rest = Array.from({ length: 3000 }, () => 5 * Math.exp(rng.gauss(spread())));
      const gest = Array.from({ length: 300 }, () => 5 * sep() * Math.exp(rng.gauss(spread())));
      const floor = pct(rest, 90), peak = pct(gest, 50), thr = floor + (pos() / 100) * (peak - floor);
      const { g, w, h, d } = Sim.ctx(c);
      const m = Sim.frame(g, d, Sim.box(w, h, d, { l: 34 }), { x0: 1, x1: 300, y0: 0, y1: 1, logX: true, xTicks: [1, 3, 10, 30, 100, 300], xFmt: (v) => v + ' µV' });
      const hist = (vals, color) => {
        const bins = 60, counts = new Array(bins).fill(0);
        vals.forEach((v) => { const k = Math.floor((Math.log10(v) / Math.log10(300)) * bins); if (k >= 0 && k < bins) counts[k]++; });
        const max = Math.max(...counts);
        g.fillStyle = color;
        counts.forEach((n, k) => {
          const x0 = 10 ** ((k / bins) * Math.log10(300)), x1 = 10 ** (((k + 1) / bins) * Math.log10(300));
          g.fillRect(m.X(x0), m.Y((n / max) * 0.95), m.X(x1) - m.X(x0) - d, m.Y(0) - m.Y((n / max) * 0.95));
        });
      };
      hist(rest, 'rgba(143,152,171,0.55)');
      hist(gest, 'rgba(91,108,255,0.55)');
      const vline = (x, color, label, dash) => {
        g.save(); g.strokeStyle = color; g.lineWidth = 2 * d; if (dash) g.setLineDash([4 * d, 3 * d]);
        g.beginPath(); g.moveTo(m.X(x), m.Y(1)); g.lineTo(m.X(x), m.Y(0)); g.stroke(); g.restore();
        g.fillStyle = color; g.fillText(label, m.X(x) + 4 * d, m.Y(0.97));
      };
      vline(floor, Sim.css('--muted'), 'repos', true);
      vline(peak, Sim.css('--accent'), 'geste', true);
      vline(thr, '#d64545', 'seuil', false);
      const hit = gest.filter((v) => v > thr).length / gest.length, fa = rest.filter((v) => v > thr).length / rest.length;
      out.innerHTML = `Gris : niveaux mesurés au repos. Bleu : pics des gestes. Le seuil est placé à ${pos()} % du chemin entre le repos (90<sup>e</sup> percentile) et le geste typique (médiane).
        → <b>${(hit * 100).toFixed(0)} %</b> des gestes détectés, <b>${(fa * 100).toFixed(1).replace('.', ',')} %</b> des instants de repos déclenchent une fausse alerte.
        <br>À essayer : réduis l'écart (geste peu marqué) ou augmente la variabilité : aucun seuil ne gagne sur les deux tableaux. C'est pour cela que la calibration mesure tes propres niveaux.`;
    }
    draw();
  },

  /* Le pouls (PPG) : une pulsation minuscule sur un grand niveau constant */
  ppg(el) {
    const c1 = Sim.canvas(el, 110), c2 = Sim.canvas(el, 130), ctl = Sim.controls(el), out = Sim.readout(el);
    const bpm = Sim.slider(ctl, { label: 'Rythme cardiaque', min: 40, max: 160, value: 70, unit: 'battements/min' });
    const ac = Sim.slider(ctl, { label: 'Pulsation', min: 0.2, max: 3, step: 0.1, value: 1, unit: '% du signal' });
    const motion = Sim.slider(ctl, { label: 'Mouvement', min: 0, max: 100, value: 0, unit: '%' });
    const R = 64, N = 6 * R, raw = Sim.ring(N), clean = Sim.ring(N), DC = 100000;
    const hp = new Biquad(Biquad.design('highpass', 0.5, R));
    let phase = 0, t = 0, carry = 0;
    const pulse = (p) => Math.exp(-(((p - 0.15) / 0.07) ** 2)) + 0.4 * Math.exp(-(((p - 0.45) / 0.1) ** 2)); // onde + incisure
    Sim.loop(el, (dt) => {
      carry += dt * R;
      for (; carry >= 1; carry--) {
        t += 1 / R;
        phase = (phase + bpm() / 60 / R) % 1;
        const moving = (motion() / 100) * DC * 0.02 * (Math.sin(2 * Math.PI * 0.7 * t) + 0.5 * Sim.gauss());
        const v = DC * (1 - (ac() / 100) * pulse(phase)) + moving + Sim.gauss(20); // plus de sang = moins de lumière reçue
        raw.push(v);
        clean.push(-hp.step(v)); // on retire le niveau constant et on inverse : un pic = un battement
      }
      const xs = raw.a.map((_, i) => i / R);
      let { g, w, h, d } = Sim.ctx(c1);
      let m = Sim.frame(g, d, Sim.box(w, h, d, { l: 52 }), { x0: 0, x1: 6, y0: 0, y1: 120000, yTicks: [0, 50000, 100000], xTicks: [0, 2, 4, 6], xFmt: (v) => v + ' s', yFmt: (v) => (v / 1000) + 'k' });
      Sim.line(g, d, m, xs, raw.a, Sim.css('--muted'), 1.5);
      ({ g, w, h, d } = Sim.ctx(c2));
      const amp = Math.max(200, ...clean.a.map((v) => Math.abs(v || 0))) * 1.1;
      m = Sim.frame(g, d, Sim.box(w, h, d, { l: 52 }), { x0: 0, x1: 6, y0: -amp, y1: amp, yTicks: [0], xTicks: [0, 2, 4, 6], xFmt: (v) => v + ' s' });
      Sim.line(g, d, m, xs, clean.a, Sim.css('--accent'), 1.6);
    });
    out.innerHTML = 'En haut : la lumière reçue, telle que mesurée. La pulsation (≈ 1 %) y est presque invisible. En bas : la même chose après retrait de la composante lente (passe-haut 0,5 Hz) et inversion : chaque pic est un battement, suivi de la petite « incisure » de fermeture des valves. À essayer : ajoute du mouvement, il écrase vite la pulsation.';
  },

  /* État mental : trois indices comparés à une référence (vrai code de lib/mental-state.js) */
  mental(el) {
    const ctl = Sim.controls(el), view = document.createElement('div');
    view.className = 'sim-mental';
    el.insertBefore(view, ctl);
    const out = Sim.readout(el);
    const base = { theta: 4, alpha: 10, beta: 3 }, ref = MentalState.indices(base);
    const g = {};
    [['theta', 'Theta (4–8 Hz)'], ['alpha', 'Alpha (8–13 Hz)'], ['beta', 'Bêta (13–20 Hz)']].forEach(([k, label]) => {
      g[k] = Sim.slider(ctl, { label, min: 0.25, max: 3, step: 0.05, value: 1, unit: '× la référence', fmt: (v) => v.toFixed(2).replace('.', ',') }, draw);
    });
    // Variabilité de la référence : écart-type des scores seconde par seconde (0 = inconnue -> seuil de repli)
    const sd = Sim.slider(ctl, { label: 'Variabilité de ta référence', min: 0, max: 0.6, step: 0.02, value: 0.16, unit: '(écart-type par seconde ; 0 = inconnue)', fmt: (v) => v.toFixed(2).replace('.', ',') }, draw);
    const COLORS = { relaxed: '#7ddc6b', focused: '#f5b84a', drowsy: '#6c8cff', neutral: '#8f98ab' };
    function draw() {
      const b = { theta: base.theta * g.theta(), alpha: base.alpha * g.alpha(), beta: base.beta * g.beta() };
      const idx = MentalState.indices(b), s = {};
      for (const k of ['relax', 'focus', 'drowsy']) s[k] = Math.log(idx[k] / ref[k]);
      // Seuil personnel : même calcul que lib/mental-state.js (écart-type × facteur de lissage, × k, borné)
      const sigma = sd() * MentalState.smoothingFactor();
      const thr = MentalState.thresholds(sd() > 0 ? { spread: { relax: sigma, focus: sigma, drowsy: sigma, n: 30 } } : null);
      // Décision : le score le plus fort rapporté à son seuil, s'il le dépasse
      const best = Object.entries(MentalState.KEYS).map(([st, k]) => [st, s[k] / thr[k]]).sort((x, y) => y[1] - x[1])[0];
      const state = best[1] > 1 ? best[0] : 'neutral', info = MentalState.STATES[state];
      const pct = (v) => `${v >= 0 ? '+' : ''}${((Math.exp(v) - 1) * 100).toFixed(0)} %`;
      const bar = (k, name, st) => {
        const w = Math.min(50, Math.abs(s[k]) * 50), m = Math.min(50, thr[k] * 50);
        return `<div class="gauge"><span>${name}</span><div class="gauge-track"><i class="gauge-mark" style="left:${50 - m}%"></i><i class="gauge-mark" style="left:${50 + m}%"></i>
          <div class="gauge-fill" style="background:${COLORS[st]};width:${w}%;left:${s[k] >= 0 ? 50 : 50 - w}%"></div></div><b>${pct(s[k])}</b></div>`;
      };
      view.innerHTML = `<div class="sim-state" style="border-color:${COLORS[state]}"><span>${info.emoji}</span><b>${info.label}</b></div>`
        + bar('relax', 'Détente α/(θ+α+β)', 'relaxed') + bar('focus', 'Engagement β/(α+θ)', 'focused') + bar('drowsy', 'Somnolence θ/(α+β)', 'drowsy');
      const seuil = thr.fromSpread
        ? `seuil personnel ${pct(thr.relax)} = 2 × ${sigma.toFixed(2).replace('.', ',')} (écart-type après lissage), borné entre +10 % et +65 %`
        : `seuil de repli ${pct(thr.relax)}, variabilité inconnue`;
      out.innerHTML = 'Les curseurs multiplient la puissance de chaque bande par rapport à la référence (1 = comme au repos). Chaque indicateur est le rapport de son indice à celui de la référence ; au-delà du seuil (traits ; ' + seuil + '), l\u2019état change. À essayer : monter seulement l\u2019alpha (détendu) ; monter seulement le bêta (concentré) ; monter le theta et baisser l\u2019alpha (somnolent) ; monter les trois ensemble : rien ne change, car seules les <b>proportions</b> comptent. Puis augmenter la variabilité : une référence agitée exige un écart plus grand avant qu’un état s’affiche.';
    }
    draw();
  },

  /* Liaison Bluetooth : paquets perdus, trous dans le signal et indice à 4 barres (vrai code de lib/muse.js) */
  bluetooth(el) {
    const c = Sim.canvas(el, 150), ctl = Sim.controls(el), out = Sim.readout(el);
    const loss = Sim.slider(ctl, { label: 'Paquets perdus', min: 0, max: 90, value: 0, unit: '%' });
    const burst = Sim.check(ctl, 'Pertes groupées (corps entre le casque et l’ordinateur)', false);
    const indicator = document.createElement('span');
    indicator.className = 'pill bt';
    indicator.innerHTML = '<span class="bars"><i></i><i></i><i></i><i></i></span> <span data-r></span>';
    ctl.appendChild(indicator);
    const R = 256, N = 4 * R, buf = Sim.ring(N), muse = new Muse();
    muse.state = 'connected';
    let t = 0, carry = 0, received = [], badRun = 0;
    Sim.loop(el, (dt) => {
      carry += dt * (R / 12); // paquets de 12 échantillons par canal
      for (; carry >= 1; carry--) {
        let lost = Math.random() < loss() / 100;
        if (burst()) { if (badRun > 0) { badRun--; lost = true; } else if (lost) badRun = 8; }
        for (let i = 0; i < 12; i++) { t += 1 / R; buf.push(lost ? null : 10 * Math.sin(2 * Math.PI * 10 * t) + Sim.gauss(4)); }
        if (!lost) received.push(performance.now());
      }
      const now = performance.now();
      received = received.filter((x) => now - x < 1000);
      muse.stats.rate = received.length * 4; // 4 canaux
      const { rate, ratio, bars } = muse.link;
      indicator.className = `pill bt bars-${bars} ${bars === 4 ? 'bt-good' : bars >= 2 ? 'bt-mid' : bars === 1 ? 'bt-bad' : 'bt-none'}`;
      indicator.querySelector('[data-r]').textContent = `${rate} paquets/s (${(ratio * 100).toFixed(0)} %)`;
      const { g, w, h, d } = Sim.ctx(c);
      const m = Sim.frame(g, d, Sim.box(w, h, d, { l: 34 }), { x0: 0, x1: 4, y0: -40, y1: 40, xTicks: [0, 1, 2, 3, 4], yTicks: [-20, 0, 20], xFmt: (v) => v + ' s' });
      Sim.line(g, d, m, buf.a.map((_, i) => i / R), buf.a, Sim.css('--trace'), 1.2);
    });
    out.innerHTML = 'Chaque paquet porte 12 échantillons (47 ms de signal) ; un paquet perdu laisse un trou. L’indice à 4 barres de l’en-tête est calculé exactement ainsi : paquets reçus par seconde rapportés aux ~85 attendus. Les pertes groupées (rafales) sont typiques d’un obstacle : elles font de longs trous et, au-delà de 4 s sans rien, déclenchent la reconnexion automatique.';
  },
};

document.querySelectorAll('[data-sim]').forEach((el) => {
  try { SIMS[el.dataset.sim](el); } catch (e) { el.insertAdjacentHTML('beforeend', `<p class="warn">Simulation indisponible : ${e.message}</p>`); console.error(e); }
});
