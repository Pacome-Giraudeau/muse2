/* Projet « Regard » : la théorie de l'œil-dipôle s'approche-t-elle de la réalité ?
 *  1. Comprendre : modèle (écart AF7 − AF8 proportionnel à l'angle du regard) + mini-simulation.
 *  2. Calibration « Regard étalonné » (lib/gaze-calibration.js, inscrite au registre) : un point à suivre plein écran.
 *  3. Étude en direct : le même protocole, avec en bas d'écran l'ATTENDU (théorie, calibration) contre le RÉEL, puis
 *     les mesures (corrélation, gain, retard, affaissement, asymétrie) et un verdict. Suivi libre du regard.
 *  4. Autres éléments : contact, tête, clignements, bruit… mesurés pendant le test quand c'est possible.
 * Logique : lib/gaze-model.js (modèle, analyse) ; affichage de la scène : ui/gaze-stage.js. Démonstration : le simulateur suit
 * le point (son gain est un réglage du simulateur, pas une mesure : il sert à tester la chaîne) ; réglages en bac à sable.
 * Chargé à la demande par app/shell.js ; se nettoie entièrement au démontage. */
Projets.register({
  id: 'regard',

  template: `
    <header class="proj-head">
      <a class="back" href="#/">← Accueil</a>
      <h1>Regard : théorie et réalité</h1>
    </header>
    <p class="intro">Quand les yeux tournent, les deux électrodes du front (AF7 et AF8) bougent en sens opposés. La théorie dit que leur
    <strong>différence</strong> est proportionnelle à l'angle du regard. Ici on <strong>le vérifie</strong> : calibration, puis test où l'on compare
    ce que la théorie attend à ce que le casque mesure. <a href="#/d/science">Les explications complètes</a>.</p>

    <div class="toolbar">
      <span class="seg" role="radiogroup" aria-label="Source du signal">
        <label><input type="radio" name="src" value="muse"> Casque</label>
        <label><input type="radio" name="src" value="demo"> Démonstration</label>
      </span>
      <span class="hint" id="src-msg"></span>
    </div>

    <div class="panel">
      <h2>1 · Comprendre</h2>
      <p>Chaque œil est un petit dipôle : l'avant (cornée) est positif par rapport à l'arrière (rétine). Regarder à gauche rapproche le « + » de AF7 et
      l'éloigne de AF8. Un clignement, lui, fait monter les deux ensemble : il s'efface dans la différence. Attendu : <b>AF7 − AF8 = gain × angle</b>.</p>
      <div class="gauge"><span>Angle du regard</span><input type="range" id="sim-angle" min="-30" max="30" value="0"><b id="sim-angle-v">0°</b></div>
      <div class="gauge"><span>AF7 (gauche)</span><div class="gauge-track"><div class="gauge-fill" id="sim-af7"></div></div><b id="sim-af7-v"></b></div>
      <div class="gauge"><span>AF8 (droite)</span><div class="gauge-track"><div class="gauge-fill" id="sim-af8"></div></div><b id="sim-af8-v"></b></div>
      <div class="gauge"><span>AF7 − AF8</span><div class="gauge-track"><div class="gauge-fill" id="sim-diff"></div></div><b id="sim-diff-v"></b></div>
      <p class="hint">Gain d'illustration : <span id="theory-uv"></span> µV par degré (valeur de la page Science, <b>pas une mesure du Muse</b> : c'est précisément ce qu'on teste).</p>
      <div class="toolbar">
        <label>Largeur de l'écran <input type="number" id="w-cm" min="10" max="200" step="1" style="width:64px"> cm</label>
        <label>Distance des yeux <input type="number" id="d-cm" min="20" max="200" step="5" style="width:64px"> cm</label>
        <span class="hint" id="angle-info"></span>
      </div>
    </div>

    <div class="panel">
      <h2>2 · Calibration</h2>
      <p class="hint">Un point parcourt l'écran en entier : fixations de 3 s à plusieurs positions, puis balayage lent. On mesure le gain réel (µV pour ±1),
      le retard de réaction, l'affaissement et l'asymétrie. Cette calibration rejoint aussi la calibration générale.</p>
      <p id="calib-summary"></p>
      <div id="calib"></div>
    </div>

    <div class="panel">
      <h2>3 · Étude en direct : attendu contre réel</h2>
      <div class="toolbar">
        <label>Nom de l'expérience <input type="text" id="exp-name" placeholder="auto : regard-date-heure" style="width:210px"></label>
        <label>Modalités <input type="text" id="exp-notes" placeholder="distance, éclairage, posture, consigne…" style="width:300px"></label>
      </div>
      <p class="hint">Avec le casque, le signal brut (AF7, AF8) et les mesures sont enregistrés dans <code>echantillons/experience/&lt;nom&gt;/</code> (signal.csv + meta.json) ; la page « Résultats : théorie vs réalité » les répertorie.</p>
      <div class="buttons"><button class="btn" id="test">Lancer le test (38 s)</button><span class="hint" id="test-msg"></span></div>
      <canvas id="result-chart" style="width:100%;height:260px;display:none;margin-top:10px"></canvas>
      <div id="result"></div>
      <h3>Suivi libre</h3>
      <div class="gauge"><span>Regard estimé</span><div class="gauge-track"><div class="gauge-fill" id="free-fill"></div></div><b id="free-v">—</b></div>
      <p class="hint" id="free-info"></p>
    </div>

    <div class="panel">
      <h2>4 · Autres éléments à prendre en compte</h2>
      <p class="hint">Valeurs <b>en direct</b> (contact, tête, clignements) puis, dans le tableau, ce qui a été mesuré pendant le dernier test.</p>
      <div class="chips" id="live-chips"></div>
      <div id="factors"></div>
    </div>`,

  mount(root, { muse }) {
    const $ = (id) => root.querySelector('#' + id);
    const sim = new SignalSimulator({ drift: 5, spikePerS: 0 });   // démonstration : sans dérive ni pics (ce sont ceux du vrai casque qu'on veut voir)
    const stage = new GazeStage({ onCancel: () => { $('test-msg').textContent = 'Test annulé.'; sim.look(null); rawBuf = null; } });
    let rawBuf = null, source = null, ctx = null, meter = null, runner = null, panel = null, unsubscribe = null, free = null, last = null;
    const gyro = { n: 0, sum: 0, recent: 0 };
    const fmt = (x, n = 0) => (x === null || x === undefined || Number.isNaN(x) ? '—' : x.toFixed(n).replace('.', ','));

    /* ---------- 1 · Mini-simulation et réglage de l'écran ---------- */

    const fillGauge = (id, v, max) => {
      const el = $(id), w = Math.min(50, (Math.abs(v) / max) * 50);
      el.style.left = (v >= 0 ? 50 : 50 - w) + '%'; el.style.width = w + '%'; el.style.background = v >= 0 ? 'var(--accent, #4a90e2)' : '#e8a33d';
    };
    function simAngle() {
      const a = +$('sim-angle').value, g = GazeModel.THEORY_UV_PER_DEG, af7 = 0.5 * g * a, af8 = -0.5 * g * a, max = 0.5 * g * 30 * 2;
      $('sim-angle-v').textContent = (a > 0 ? '← ' : a < 0 ? '→ ' : '') + Math.abs(a) + '°';
      [['sim-af7', af7], ['sim-af8', af8], ['sim-diff', af7 - af8]].forEach(([id, v]) => { fillGauge(id, v, max); $(id + '-v').textContent = fmt(v, 1) + ' µV'; });
    }
    $('theory-uv').textContent = fmt(GazeModel.THEORY_UV_PER_DEG, 1);
    $('sim-angle').oninput = simAngle;
    simAngle();

    const setup = GazeCalibrator.setup();
    $('w-cm').value = setup.widthCm; $('d-cm').value = setup.distanceCm;
    function angleInfo() {
      const half = GazeCalibrator.halfAngle();
      $('angle-info').textContent = `Le point atteint ±${fmt(half, 1)}° : la théorie attend ≈ ${fmt(GazeModel.theoryGain(half), 0)} µV d'écart pour ±1.`;
    }
    const onSetup = () => {
      const w = +$('w-cm').value, d = +$('d-cm').value;
      if (w >= 10 && d >= 20) { GazeCalibrator.saveSetup({ widthCm: w, distanceCm: d }); angleInfo(); }
    };
    $('w-cm').onchange = onSetup; $('d-cm').onchange = onSetup;
    angleInfo();

    /* ---------- Source et chaîne de mesure ---------- */

    const offGyro = muse.on('gyro', (s) => {
      const m = Math.hypot(s.x, s.y, s.z);
      gyro.recent += 0.05 * (m - gyro.recent);
      gyro.n++; gyro.sum += m * m;
    });

    function setSource(src) {
      if (unsubscribe) unsubscribe();
      stage.stop(); sim.stop(); sim.look(null);
      if (panel) panel.destroy();
      if (runner) runner.cancel();
      source = src;
      Profiles.sandbox(src === 'demo');
      ctx = new CalibrationContext();
      meter = new GazeMeter();
      runner = Calibrations.get('regard').create(ctx);
      root.querySelectorAll('input[name=src]').forEach((r) => (r.checked = r.value === src));
      $('src-msg').textContent = src === 'demo' ? 'Démonstration : le simulateur suit le point (son gain est un réglage, pas une mesure). Rien n’est mémorisé.' : '';
      const bus = src === 'demo' ? sim : muse;
      const offs = [bus.on('eeg', (c, s) => { ctx.feed(c, s); meter.feed(c, s); if (rawBuf && (c === 1 || c === 2)) rawBuf[c === 1 ? 'af7' : 'af8'].push(...s); })];
      unsubscribe = () => offs.forEach((off) => off());
      if (src === 'demo') sim.start();
      panel = new CalibrationPanel($('calib'), runner, {
        def: Calibrations.get('regard'),
        onState: (s) => {
          sim.look(src === 'demo' && s.phase === 'record' && s.step && s.step.target ? s.step.target(s.step.seconds - s.remainingS) : null);
          if (s.phase === 'done' || s.phase === 'idle') summary();
        },
      });
      last = null; $('result').innerHTML = ''; $('result-chart').style.display = 'none';
      summary();
    }
    root.querySelectorAll('input[name=src]').forEach((r) => (r.onchange = () => setSource(r.value)));
    const offState = muse.on('state', (st) => { if (st === 'connected' && source === 'muse') setSource('muse'); });

    function summary() {
      const c = GazeCalibrator.load(), st = Calibrations.get('regard').status();
      $('calib-summary').innerHTML = c
        ? `<span class="tag ok">faite</span> ${st.summary}. Retard ${fmt(c.lagS * 1000)} ms, affaissement ${c.droop === null ? '—' : fmt(c.droop * 100) + ' %'} restant.`
        : '<span class="tag">à faire</span> Sans calibration, le test compare seulement la théorie au réel.';
    }

    /* ---------- 3 · Test attendu / réel ---------- */

    const viewOf = () => {
      const c = GazeCalibrator.load(), half = GazeCalibrator.halfAngle();
      return { theoryGain: GazeModel.theoryGain(half), sign: c && c.gain < 0 ? -1 : 1, gain: c ? c.gain : null, lagS: c ? c.lagS : 0.15 };
    };

    const pad = (n) => String(n).padStart(2, '0');
    async function saveExperiment(raw) {   // casque seulement : la démonstration n'est pas une expérience
      const d = new Date(), name = $('exp-name').value.trim() || `regard-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}h${pad(d.getMinutes())}`;
      try {
        const folder = raw.folder || (await SampleFolder.ensure(false));
        if (!folder) throw new Error('dossier des échantillons non disponible (lance « python serveur.py » ou choisis un dossier dans « Étude d’échantillon »)');
        const files = GazeModel.experimentFiles({
          name, notes: $('exp-notes').value.trim(), source: 'casque', af7: raw.af7, af8: raw.af8, analysis: last.analysis,
          calibration: GazeCalibrator.load(), setup: GazeCalibrator.setup(),
          context: { clignements: last.blinks, teteRmsDegS: last.gyroRms, contact: last.contact, profil: Profiles.active ? Profiles.active().name : undefined },
        });
        const w = await SampleFolder.writeExperiment(name, files, folder);
        $('test-msg').textContent = `Expérience enregistrée : echantillons/experience/${w.name}/`;
      } catch (e) { $('test-msg').textContent = 'Expérience non enregistrée : ' + e.message; }
    }

    $('test').onclick = async () => {   // le plein écran exige un clic : démarrer d'emblée
      if (runner.running) { $('test-msg').textContent = 'Une calibration est en cours.'; return; }
      if (source === 'muse' && !muse.connected) { $('test-msg').textContent = 'Connecte le casque (en haut à droite) ou choisis « Démonstration ».'; return; }
      if (!ctx.ready) { $('test-msg').textContent = 'Signal pas encore prêt : patiente quelques secondes.'; return; }
      $('test-msg').textContent = '';
      let folder = null;
      if (source === 'muse') { try { folder = await SampleFolder.obtain(); } catch (e) { folder = null; } }   // l'autorisation se demande pendant le clic
      meter.reset(); gyro.n = 0; gyro.sum = 0;
      rawBuf = { af7: [], af8: [], folder };
      const blinks0 = ctx.detector.counts.blink, view = viewOf();
      stage.run({
        duration: GazeModel.DURATION, target: GazeModel.target, frames: () => meter.frames, view,
        onTick: (t) => { if (source === 'demo') sim.look(GazeModel.target(t)); },
        onEnd: () => {
          sim.look(null);
          last = {
            frames: meter.frames.slice(), view, blinks: ctx.detector.counts.blink - blinks0,
            gyroRms: source === 'muse' && gyro.n ? Math.sqrt(gyro.sum / gyro.n) : null,
            contact: ctx.contact.levels.map((l) => l.label),
          };
          last.analysis = GazeModel.analyse(last.frames, { halfAngleDeg: GazeCalibrator.halfAngle() });
          const raw = rawBuf; rawBuf = null;
          showResult();
          if (source === 'muse') saveExperiment(raw); else $('test-msg').textContent = 'Démonstration : rien n’est enregistré.';
        },
      });
    };

    function showResult() {
      const a = last.analysis, v = GazeModel.verdict(a), cv = $('result-chart');
      cv.style.display = 'block';
      GazeStage.draw(cv, { frames: last.frames, view: last.view, target: GazeModel.target, t0: 0, t1: GazeModel.DURATION, baseline: a ? a.offset : null, detrend: a ? a.drift : null });
      if (!a) { $('result').innerHTML = `<p class="notice">${v.text}</p>`; return; }
      const tag = { bon: 'ok', moyen: 'wip', faible: '' }[v.level];
      const row = (nom, valeur, aide) => `<tr><td>${nom}</td><td><b>${valeur}</b></td><td class="hint">${aide}</td></tr>`;
      $('result').innerHTML = `
        <p><span class="tag ${tag}">${v.level}</span> ${v.text}</p>
        <table class="table"><tr><th>Mesure</th><th>Valeur</th><th>Lecture</th></tr>
          ${row('Corrélation avec le point', fmt(a.r, 2), 'proche de ±1 : le signal suit la position ; le signe dit le sens du montage')}
          ${row('Gain réel', fmt(Math.abs(a.gain)) + ' µV pour ±1', `${fmt(Math.abs(a.gain) / a.halfAngleDeg, 1)} µV/° contre ${fmt(GazeModel.THEORY_UV_PER_DEG, 1)} dans la théorie (×${fmt(a.ratio, 2)})`)}
          ${row('Écart du modèle linéaire', fmt(a.rmse, 1) + ' µV', 'ce que la droite « gain × position » n’explique pas')}
          ${row('Dérive pendant le test', fmt(a.driftPtp) + ' µV', 'variation lente du niveau de AF7 − AF8 (retirée du calcul et du graphique) ; ' + fmt(a.rejected * 100) + ' % d’images écartées (clignements, pics)')}
          ${row('Retard', fmt(a.lagS * 1000) + ' ms', 'réaction de l’œil + retard du filtrage')}
        </table>`;
      factors();
    }

    /* ---------- Suivi libre : position estimée par le modèle calibré ---------- */

    free = setInterval(() => {
      const c = GazeCalibrator.load(), fr = meter && meter.frames;
      if (!c || !fr || fr.length < 8 || stage.el.style.display === 'block') { $('free-v').textContent = '—'; $('free-info').textContent = c ? 'En attente de signal.' : 'Fais d’abord la calibration (2).'; fillGauge('free-fill', 0, 1); return; }
      const d = fr.slice(-8).reduce((s, f) => s + f.d, 0) / 8, pos = Math.max(-1.2, Math.min(1.2, (d - c.offset) / c.gain));
      fillGauge('free-fill', pos, 1.2);
      $('free-v').textContent = (pos > 0.1 ? '← ' : pos < -0.1 ? '→ ' : '') + fmt(Math.abs(pos), 2);
      $('free-info').textContent = `Estimé depuis AF7 − AF8 = ${fmt(d - c.offset, 1)} µV au-dessus du centre calibré (modèle linéaire calibré).`;
    }, 150);

    /* ---------- 4 · Autres éléments ---------- */

    function liveChips() {
      const names = Muse.EEG_NAMES, lv = ctx ? ctx.contact.levels : [];
      const col = { bon: '#2ca36b', moyen: '#e8a33d' };
      $('live-chips').innerHTML = names.map((n, i) => `<span class="chip" style="border-color:${col[lv[i] && lv[i].label] || '#d9534f'}">${n} ${lv[i] ? lv[i].label : '—'}</span>`).join('')
        + `<span class="chip">tête ${source === 'muse' ? fmt(gyro.recent, 1) + ' °/s' : 'n/a (démo)'}</span>`
        + `<span class="chip">clignements ${ctx ? ctx.detector.counts.blink : 0}</span>`;
    }
    const live = setInterval(liveChips, 500);

    function factors() {
      const a = last && last.analysis;
      const rows = [
        ['Contact AF7 / AF8', last ? last.contact.slice(1, 3).join(' / ') : '—', 'Un contact inégal fausse la comparaison gauche / droite : refaire le test si l’un des deux n’est pas « bon ».'],
        ['Mouvement de la tête', last && last.gyroRms !== null ? fmt(last.gyroRms, 1) + ' °/s (rms)' : (last ? 'n/a (démo)' : '—'), 'La tête qui tourne déplace aussi les électrodes et ajoute du mouvement : le test demande de ne bouger que les yeux.'],
        ['Clignements pendant le test', last ? String(last.blinks) : '—', 'Théoriquement symétriques (annulés dans AF7 − AF8) ; en pratique ils laissent des restes.'],
        ['Affaissement des fixations', a && a.droop !== null ? fmt(a.droop * 100) + ' % restant en fin de fixation' : '—', 'Si le signal retombe pendant que le regard reste en place, le montage est « passe-haut » : seuls les changements de regard sont fiables.'],
        ['Asymétrie gauche / droite', a ? `gauche ${fmt(Math.abs(a.gainLeft))} · droite ${fmt(Math.abs(a.gainRight))} µV (écart ${fmt(a.asymmetry * 100)} %)` : '—', 'La théorie prévoit les deux côtés égaux ; un écart traduit un contact ou une anatomie différente de chaque côté.'],
        ['Bruit au centre', a ? fmt(a.noise, 1) + ' µV' : '—', 'Plus il est grand, plus les petits angles sont noyés.'],
        ['Regard vertical', 'non mesuré ici', 'Haut / bas déplace AF7 et AF8 dans le même sens : invisible dans la différence, il ressemble à un clignement.'],
        ['Distance, éclairage, fatigue', 'non mesuré ici', 'L’angle dépend de la distance à l’écran ; le potentiel de l’œil dépend aussi de l’état de l’œil. À vérifier sur casque réel.'],
      ];
      $('factors').innerHTML = `<table class="table"><tr><th>Élément</th><th>Mesuré</th><th>Pourquoi c’est important</th></tr>${rows.map((r) => `<tr><td>${r[0]}</td><td><b>${r[1]}</b></td><td class="hint">${r[2]}</td></tr>`).join('')}</table>`;
    }
    factors();

    setSource(muse.connected ? 'muse' : 'demo');

    return () => {
      clearInterval(free); clearInterval(live);
      offGyro(); offState();
      if (unsubscribe) unsubscribe();
      stage.destroy(); sim.stop(); sim.look(null);
      if (panel) panel.destroy();
      if (runner) runner.cancel();
      Profiles.sandbox(false);
    };
  },
});
