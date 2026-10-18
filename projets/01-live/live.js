/* Projet « Capteurs en direct » : branche le casque (lib/muse.js, partagé) sur l'interface.
 * Chargé à la demande par app/shell.js ; se nettoie entièrement au démontage. */
Projets.register({
  id: 'live',

  template: `
    <header class="proj-head">
      <a class="back" href="#/">← Accueil</a>
      <h1>Capteurs en direct</h1>
    </header>
    <div class="grid">
      <div class="stack">
        <div class="panel">
          <h2>EEG (µV) <span class="flag" id="enhanced-flag" hidden>amélioré</span></h2>
          <div class="controls" style="margin-bottom:8px; flex-wrap:wrap">
            Échelle ±
            <select id="scale">
              <option>50</option><option>100</option><option selected>200</option><option>500</option><option>1000</option>
            </select> µV
            <label class="switch"><input type="checkbox" id="enhance"><span></span> Amélioration numérique</label>
            <span class="hint" id="enhance-summary"></span>
          </div>
          <div id="eeg"></div>
        </div>
        <div class="panel">
          <h2>Pouls (PPG infrarouge)</h2>
          <canvas class="wide" id="ppg"></canvas>
          <ul class="hint">
            <li>EEG : 4 canaux (TP9, AF7, AF8, TP10), 256 Hz.</li>
            <li>PPG : pouls (rythme cardiaque).</li>
            <li>Accéléromètre et gyroscope.</li>
            <li>Télémétrie : batterie, etc.</li>
          </ul>
        </div>
        <div class="panel">
          <h2>Mouvement</h2>
          <table class="kv">
            <tr><td>Accéléro X (g)</td><td id="ax">–</td></tr>
            <tr><td>Accéléro Y (g)</td><td id="ay">–</td></tr>
            <tr><td>Accéléro Z (g)</td><td id="az">–</td></tr>
            <tr><td>Gyro X (°/s)</td><td id="gx">–</td></tr>
            <tr><td>Gyro Y (°/s)</td><td id="gy">–</td></tr>
            <tr><td>Gyro Z (°/s)</td><td id="gz">–</td></tr>
          </table>
        </div>
        <div class="panel">
          <h2>Position de la tête (3D) <button class="btn ghost" id="recenter" style="float:right">Recentrer</button></h2>
          <div id="head3d"></div>
          <p class="hint">Déduite de l'accéléromètre et du gyroscope. Le sens des axes n'est pas encore vérifié sur le casque réel ; le pivotement (gauche / droite) dérive lentement : « Recentrer » le remet à zéro.</p>
        </div>
      </div>
      <div class="stack">
        <div class="panel"><h2>Capteurs et contact</h2><div id="headmap"></div></div>
        <div class="panel">
          <h2>Bandes de fréquences <span class="flag" id="polluted" hidden>pollué par un artefact</span></h2>
          <div class="toolbar"><span class="seg" id="bands-mode">
            <button type="button" data-v="relative">Relatif (%)</button>
            <button type="button" data-v="absolute">Absolu (µV²)</button>
          </span></div>
          <div id="bands"></div>
          <p class="hint" id="bands-hint"></p>
        </div>
        <div class="panel"><h2>Artefacts</h2><div id="artifacts"></div></div>
        <div class="panel"><h2>Calibration</h2><div id="calibration"></div></div>
        <div class="panel">
          <h2>Qualité de la liaison</h2>
          <table class="kv">
            <tr><td>Connecté depuis</td><td id="st-uptime">–</td></tr>
            <tr><td>Débit EEG (attendu ~85)</td><td id="st-rate">–</td></tr>
            <tr><td>Coupures</td><td id="st-disconnects">0</td></tr>
            <tr><td>Reconnexions réussies</td><td id="st-reconnects">0</td></tr>
            <tr><td>Dernière coupure</td><td id="st-last">–</td></tr>
          </table>
        </div>
      </div>
    </div>`,

  mount(root, { muse }) {
    const $ = (id) => root.querySelector('#' + id);
    const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    const EEG_WINDOW = 1024; // ~4 s d'EEG affichées

    const detector = new ArtifactDetector();
    const contact = new ContactQuality();
    const calibrator = new Calibrator(detector);
    const eegBuf = Muse.EEG_NAMES.map(() => []);
    // Amélioration numérique : mêmes réglages que le projet « Amélioration numérique du signal » (mémorisés).
    // Elle ne s'applique qu'à l'affichage (tracés et bandes) ; contact et artefacts restent calculés sur le brut,
    // car leurs seuils (et la calibration) sont définis sur le signal brut.
    const pipeline = SignalPipeline.loadSaved(Muse.EEG_RATE);
    const cleanBuf = Muse.EEG_NAMES.map(() => []);
    let enhance = false;
    enhance = !!Profiles.get('liveEnhance', false); // mémorisé dans le profil actif
    const shown = () => (enhance ? cleanBuf : eegBuf);
    const ppgBuf = [];

    /* ---------- Construction de l'interface ---------- */

    $('eeg').innerHTML = Muse.EEG_NAMES.map((n, i) => `
      <div class="channel">
        <div class="label"><span>${n}</span><span id="rms${i}">–</span></div>
        <canvas id="eeg${i}"></canvas>
      </div>`).join('');

    // Bandes : part de chaque bande (relatif, somme = 100 %) ou puissance absolue (µV², échelle log), avec les 60 dernières
    // secondes en dessous. L'absolu montre si c'est la bande qui bouge ou le total : en relatif, un delta gonflé par un
    // clignement fait « baisser » l'alpha sans que l'alpha ait changé.
    const BAND_HISTORY = 240;                 // 240 mises à jour × 250 ms = 60 s
    const bandHist = { relative: Signal.BANDS.map(() => []), absolute: Signal.BANDS.map(() => []) };
    let bandsMode = Profiles.get('liveBands', 'relative') === 'absolute' ? 'absolute' : 'relative';
    const absPos = (p) => Math.max(0, Math.min(1, (Math.log10(Math.max(p, 1e-9)) + 1) / 5)); // 0,1 µV² → 0 ; 10 000 µV² → 1
    const fmtAbs = (p) => (p < 10 ? p.toFixed(2) : p < 1000 ? p.toFixed(0) : p.toExponential(1)) + ' µV²';
    $('bands').innerHTML = Signal.BANDS.map((b, i) => `
      <div class="bar"><span>${b.name}</span>
      <div class="track"><div class="fill" id="band${i}" style="background:${b.color}"></div></div>
      <span class="val" id="bandv${i}">–</span></div>
      <canvas class="spark" id="spark${i}"></canvas>`).join('');
    const showBandsMode = () => {
      root.querySelectorAll('#bands-mode button').forEach((b) => b.classList.toggle('on', b.dataset.v === bandsMode));
      $('bands-hint').textContent = bandsMode === 'relative'
        ? 'Part de chaque bande dans le total (1–45 Hz), moyenne des électrodes affichées.'
        : 'Puissance de chaque bande, moyenne des électrodes affichées ; barre en échelle logarithmique (0,1 à 10 000 µV²).';
    };
    root.querySelectorAll('#bands-mode button').forEach((b) => (b.onclick = () => {
      bandsMode = b.dataset.v;
      Profiles.set('liveBands', bandsMode);
      showBandsMode();
      drawBands();
    }));
    showBandsMode();

    const artifactPanel = new ArtifactPanel($('artifacts'), detector);
    const calibrationPanel = new CalibrationPanel($('calibration'), calibrator);
    const headMap = new HeadMap($('headmap'));
    const head3d = new Head3D($('head3d'));
    const pose = new HeadPose();
    $('recenter').onclick = () => pose.recenter();

    /* ---------- Dessin ---------- */

    function fit(canvas) {
      const r = devicePixelRatio || 1;
      const w = Math.round(canvas.clientWidth * r), h = Math.round(canvas.clientHeight * r);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      return canvas.getContext('2d');
    }

    function trace(canvas, data, amp) {
      const ctx = fit(canvas), w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = css('--line');
      ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
      if (data.length < 2) return;
      ctx.strokeStyle = css('--trace');
      ctx.lineWidth = 1.5 * (devicePixelRatio || 1);
      ctx.beginPath();
      data.forEach((v, i) => {
        const x = (i / (EEG_WINDOW - 1)) * w;
        const y = h / 2 - Math.max(-1, Math.min(1, v / amp)) * (h / 2);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
    }

    let frame = requestAnimationFrame(function draw() {
      const amp = +$('scale').value;
      shown().forEach((buf, i) => {
        const c = Signal.centered(buf);
        trace($('eeg' + i), c, amp);
        if (c.length) $('rms' + i).textContent = Math.sqrt(c.reduce((a, v) => a + v * v, 0) / c.length).toFixed(1) + ' µV rms';
      });
      const ppg = Signal.centered(ppgBuf);
      trace($('ppg'), ppg, Math.max(50, ...ppg.map(Math.abs)));
      head3d.update(pose.angles);
      frame = requestAnimationFrame(draw);
    });

    function updateBands() {
      const ready = shown().filter((b) => b.length >= 256);
      if (!ready.length) return;
      const rel = Signal.BANDS.map(() => 0), abs = Signal.BANDS.map(() => 0);
      // DSP de Welch sur les 2 dernières secondes (3 segments de 256 points ; 1 seul tant que < 384 points)
      ready.forEach((b) => {
        const spec = Signal.welch(b.slice(-512));
        Signal.bandPowersFromPsd(spec).forEach((p, i) => (rel[i] += p / ready.length));
        Signal.BANDS.forEach((band, i) => (abs[i] += Signal.powerBetween(spec, band.range[0], band.range[1]) / ready.length));
      });
      Signal.BANDS.forEach((_, i) => {
        for (const [k, v] of [['relative', rel], ['absolute', abs]]) {
          bandHist[k][i].push(v[i]);
          if (bandHist[k][i].length > BAND_HISTORY) bandHist[k][i].shift();
        }
      });
      drawBands();
    }

    function drawBands() {
      const hist = bandHist[bandsMode];
      Signal.BANDS.forEach((band, i) => {
        const h = hist[i];
        if (!h.length) return;
        const now = h[h.length - 1];
        $('band' + i).style.width = ((bandsMode === 'relative' ? now : absPos(now)) * 100).toFixed(0) + '%';
        $('bandv' + i).textContent = bandsMode === 'relative' ? (now * 100).toFixed(0) + '%' : fmtAbs(now);
        // historique : relatif 0 → plus grande part de la période ; absolu en échelle log, la même que la barre
        const ctx = fit($('spark' + i)), w = ctx.canvas.width, ht = ctx.canvas.height;
        const top = bandsMode === 'relative' ? Math.max(0.05, ...h) : 1, y = (v) => ht - 2 - (ht - 4) * ((bandsMode === 'relative' ? v : absPos(v)) / top);
        ctx.clearRect(0, 0, w, ht);
        ctx.strokeStyle = band.color;
        ctx.lineWidth = Math.max(1, devicePixelRatio || 1);
        ctx.beginPath();
        h.forEach((v, k) => (k ? ctx.lineTo((k / (BAND_HISTORY - 1)) * w, y(v)) : ctx.moveTo(0, y(v))));
        ctx.stroke();
      });
    }

    const fmtDuration = (ms) => {
      const s = Math.floor(ms / 1000);
      return s >= 60 ? Math.floor(s / 60) + ' min ' + (s % 60) + ' s' : s + ' s';
    };

    function updateStats() {
      const s = muse.stats;
      $('st-uptime').textContent = s.connectedSince ? fmtDuration(Date.now() - s.connectedSince) : '–';
      $('st-rate').textContent = muse.connected ? s.rate + ' /s' : '–';
      $('st-disconnects').textContent = s.disconnects;
      $('st-reconnects').textContent = s.reconnects;
      $('st-last').textContent = s.lastDisconnect ? new Date(s.lastDisconnect).toLocaleTimeString() : '–';
    }

    /* ---------- Abonnements au casque ---------- */

    /* ---------- Interrupteur « Amélioration numérique » ---------- */

    const push = (buf, vals, max) => { buf.push(...vals); if (buf.length > max) buf.splice(0, buf.length - max); };

    pipeline.onSamples = (raw, clean) => clean.forEach((v, c) => push(cleanBuf[c], v, EEG_WINDOW));
    $('enhance').checked = enhance;
    $('enhance-summary').innerHTML = `Réglages : ${pipeline.summary()} — <a href="#/p/filtres">modifier</a>`;
    const showEnhance = () => { $('enhanced-flag').hidden = !enhance; };
    showEnhance();
    $('enhance').onchange = (e) => {
      enhance = e.target.checked;
      Profiles.set('liveEnhance', enhance);
      showEnhance();
    };

    const unsubscribe = [
      muse.on('eeg', (c, s) => { push(eegBuf[c], s, EEG_WINDOW); pipeline.feed(c, s); detector.feed(c, s); contact.feed(c, s); }),
      muse.on('ppg', (c, s) => { if (c === 1) push(ppgBuf, s, 256); detector.feedPpg(c, s); }),
      muse.on('accel', (a) => { pose.accel(a); ['x', 'y', 'z'].forEach((k) => ($('a' + k).textContent = a[k].toFixed(2))); }),
      muse.on('gyro', (g) => { pose.gyro(g); ['x', 'y', 'z'].forEach((k) => ($('g' + k).textContent = g[k].toFixed(1))); }),
      muse.on('resync', () => { pipeline.reset(); detector.resync(); }), // trou de paquets non comblé : canaux réalignés
      muse.on('state', (state) => { if (state === 'connected') { detector.reset(); contact.reset(); pipeline.reset(); pose.reset(); } }),
    ];

    const timers = [
      setInterval(updateBands, 250),
      setInterval(updateStats, 1000),
      setInterval(() => {
        headMap.update(contact.levels);
        $('polluted').hidden = !detector.isContaminated(1000);
      }, 500),
    ];

    /* ---------- Nettoyage ---------- */

    return () => {
      cancelAnimationFrame(frame);
      timers.forEach(clearInterval);
      unsubscribe.forEach((off) => off());
      calibrator.cancel();
      calibrationPanel.destroy();
      artifactPanel.destroy();
      head3d.destroy();
    };
  },
});
