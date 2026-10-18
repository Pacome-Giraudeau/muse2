/* Projet « Jeu des artefacts » : course façon Temple Run / Subway Surfers pilotée par les yeux.
 *  - regarder à gauche / à droite : changer de couloir (artefacts 'gaze-left' / 'gaze-right') ;
 *  - cligner des yeux : sauter par-dessus une barrière ('blink').
 * Deux modes : « Jeu simple » (seuils de la calibration du profil) et « Calibration dynamique » : pendant la partie,
 * lib/dynamic-calibration.js affine les seuils clignement / regard en supposant que le joueur fait le bon geste au bon
 * moment, et les mémorise dans le profil à la fin. Trois niveaux (lib/runner-game.js). Clavier de secours : ← → espace.
 * Démonstration : le simulateur joue les gestes demandés (réglages en bac à sable, rien n'est mémorisé).
 * Chargé à la demande par app/shell.js ; se nettoie entièrement au démontage. */
Projets.register({
  id: 'jeu-artefacts',

  template: `
    <header class="proj-head">
      <a class="back" href="#/">← Accueil</a>
      <h1>Jeu des artefacts</h1>
    </header>
    <p class="intro">Une course simple pilotée par tes yeux : <strong>regarde à gauche ou à droite</strong> pour changer de couloir,
    <strong>cligne des yeux</strong> pour sauter. Les gestes sont reconnus avec <a href="#/p/calibration">ta calibration des artefacts</a>.</p>

    <div class="toolbar">
      <span class="seg" role="radiogroup" aria-label="Source du signal">
        <label><input type="radio" name="src" value="muse"> Casque</label>
        <label><input type="radio" name="src" value="demo"> Démonstration</label>
      </span>
      <span class="seg" role="radiogroup" aria-label="Mode">
        <label><input type="radio" name="mode" value="simple" checked> 🎮 Jeu simple</label>
        <label><input type="radio" name="mode" value="dyn"> 🎯 Calibration dynamique</label>
      </span>
      <span class="seg" role="radiogroup" aria-label="Difficulté">
        <label><input type="radio" name="lvl" value="facile"> Facile</label>
        <label><input type="radio" name="lvl" value="moyen" checked> Moyen</label>
        <label><input type="radio" name="lvl" value="difficile"> Difficile</label>
      </span>
      <span class="hint" id="src-msg"></span>
    </div>
    <p class="hint" id="mode-hint"></p>

    <div class="panel">
      <div id="stage"></div>
      <div class="runner-hud">
        <span>Score <strong id="score">0</strong></span>
        <span id="lives"></span>
        <span class="hint" id="gauges"></span>
      </div>
      <div class="buttons" style="justify-content:center"><button class="btn" id="go">Jouer</button></div>
    </div>

    <div class="panel runner-end" id="end" hidden>
      <h2>Bilan de la partie</h2>
      <p id="end-text"></p>
      <div id="end-dyn"></div>
    </div>
  `,

  mount(root, { muse }) {
    const $ = (id) => root.querySelector('#' + id);
    const sim = new SignalSimulator({ theta: 6, beta: 4, drift: 15, spikePerS: 0.02, blinkEveryS: 60 });
    const MODE_HINT = {
      simple: 'Jeu simple : seuils de ta calibration (ou automatiques si tu n’en as pas).',
      dyn: 'Calibration dynamique (sans vies, partie infinie : arrête-toi quand tu veux) : fais exactement le geste demandé (👈 👉 😉) au bon moment. Les seuils clignement et regard s’affinent pendant la partie et sont mémorisés à la fin.',
    };
    let source = null, ctx = null, unsub = null, offEvent = null, game = null, stage = null, dyn = null;
    let raf = 0, last = 0, flash = null, flashUntil = 0, nextApply = 0;
    const val = (name) => (root.querySelector(`input[name=${name}]:checked`) || {}).value;
    const fmt = (v) => (v == null ? '—' : v.toFixed(0) + ' µV');
    const running = () => !!(game && game.state.running);

    /* ---------- Source ---------- */
    function setSource(src) {
      endGame(true);
      if (unsub) unsub();
      if (offEvent) offEvent();
      sim.stop(); sim.act(null);
      source = src;
      Profiles.sandbox(src === 'demo');
      ctx = new CalibrationContext();
      offEvent = ctx.onEvent(onDetect);
      root.querySelectorAll('input[name=src]').forEach((r) => (r.checked = r.value === src));
      $('src-msg').textContent = src === 'demo' ? 'Démonstration : le simulateur joue à ta place. Rien n’est mémorisé.' : '';
      const feed = (c, s) => ctx.feed(c, s);
      const bus = src === 'demo' ? sim : muse, offs = [bus.on('eeg', feed), bus.on('ppg', (c, s) => ctx.feedPpg(c, s)), muse.on('resync', () => ctx.resync())];
      unsub = () => offs.forEach((off) => off());
      if (src === 'demo') sim.start();
      newStage();
    }
    root.querySelectorAll('input[name=src]').forEach((r) => (r.onchange = () => setSource(r.value)));
    root.querySelectorAll('input[name=mode]').forEach((r) => (r.onchange = () => { $('mode-hint').textContent = MODE_HINT[val('mode')]; if (!running()) newStage(); }));
    root.querySelectorAll('input[name=lvl]').forEach((r) => (r.onchange = () => { if (!running()) newStage(); }));
    $('mode-hint').textContent = MODE_HINT.simple;
    const offState = muse.on('state', (st) => { if (st === 'connected' && source === 'muse' && !running()) setSource('muse'); });

    /* ---------- Partie ---------- */
    function newStage(message = 'Appuie sur « Jouer »') {
      if (stage) stage.destroy();
      game = new RunnerGame({ level: val('lvl'), infinite: val('mode') === 'dyn' });
      stage = new RunnerStage($('stage'), game);
      stage.message(message);
      stage.render();
      showHud();
    }

    function showHud() {
      const s = game.state, d = ctx.detector, l = d.levels, sg = ((d.cal && d.cal.gazeSign) || 1) * d.features.gaze / d.thresholds.gaze;
      $('score').textContent = Math.round(s.score);
      $('lives').textContent = game.infinite ? `Mode infini · ${s.hits} raté(s)` : '❤️'.repeat(Math.max(0, s.lives)) + '🖤'.repeat(Math.max(0, game.cfg.lives - s.lives));
      $('gauges').textContent = ctx.ready ? `clignement ${l.blink.toFixed(1)} · regard ◀ ${Math.max(0, sg).toFixed(1)} · ${Math.max(0, -sg).toFixed(1)} ▶ (1 = seuil)` : 'apprentissage du signal…';
    }

    function startGame() {
      if (!ctx.ready) { $('src-msg').textContent = 'Signal pas encore prêt (apprentissage du bruit de fond, quelques secondes).'; return; }
      newStage(null);
      game.onEvent = onGame;
      dyn = val('mode') === 'dyn' ? new DynamicCalibration(ctx.detector) : null;
      ctx.detector.onFrame = dyn ? (f) => { const n = game.needed(); dyn.observe(f, n && n.action, performance.now()); } : null;
      $('end').hidden = true; $('go').textContent = 'Arrêter'; $('src-msg').textContent = source === 'demo' ? 'Démonstration : le simulateur joue à ta place. Rien n’est mémorisé.' : '';
      game.start();
      last = performance.now(); nextApply = last + 5000;
      raf = requestAnimationFrame(loop);
    }

    function onGame(e) {
      if (e.type === 'hit' || e.type === 'dodge') { flash = e.type; flashUntil = performance.now() + 250; }
      if (e.type === 'over') endGame(false);
    }

    function onDetect(e) {
      if (!running()) return;
      const action = e.type === 'blink' ? 'jump' : e.phase === 'start' && e.type === 'gaze-left' ? 'left' : e.phase === 'start' && e.type === 'gaze-right' ? 'right' : null;
      if (!action) return;
      if (dyn) dyn.guard(performance.now());
      game.input(action);
    }

    function loop(now) {
      const dt = Math.min(60, now - last);
      last = now;
      if (!running()) return;
      if (source === 'demo') actDemo();
      game.advance(dt);
      if (dyn && now > nextApply) { dyn.apply(); nextApply = now + 5000; }
      stage.render(now < flashUntil ? flash : null);
      showHud();
      if (running()) raf = requestAnimationFrame(loop);
    }

    // Démonstration : le simulateur « fait » le geste attendu tant qu'il l'est (il réagit de lui-même ~0,5 s plus tard).
    function actDemo() {
      const n = game.needed();
      sim.act(n ? { left: 'left', right: 'right', jump: 'blink' }[n.action] : null);
    }

    function endGame(silent) {
      cancelAnimationFrame(raf);
      sim.act(null);
      if (ctx) ctx.detector.onFrame = null;
      const played = game && (game.state.running || game.state.over);
      if (game) game.stop();
      $('go').textContent = 'Jouer';
      if (silent || !played) return;
      stage.message(game.state.over ? 'Perdu !' : 'Partie arrêtée');
      stage.render();
      const s = game.state;
      $('end-text').textContent = `Score ${Math.round(s.score)} · ${s.passed} obstacle(s) évité(s), ${s.hits} touché(s) · niveau ${game.cfg.label}.`;
      $('end-dyn').innerHTML = dyn ? dynSummary() : '';
      $('end').hidden = false;
    }

    function dynSummary() {
      dyn.apply();
      const st = dyn.stats(), b = st.before || st.thresholds, t = st.thresholds, saved = dyn.save();
      const row = (nom, m, k) => `<tr><td>${nom}</td><td>${st[m].used}/${st[m].trials}</td><td>${fmt(b[k])}</td><td>${fmt(t[k])}</td></tr>`;
      const flip = st.flips ? 'Le sens gauche / droite du regard était inversé : il a été corrigé. ' : '';
      const note = flip + (!st.updates ? 'Pas assez d’essais exploitables pour changer les seuils (il faut au moins 3 essais par geste, nettement au-dessus du repos).'
        : saved ? (source === 'demo' ? 'Démonstration : seuils affinés mais non mémorisés.' : 'Seuils mémorisés dans ton profil actif (calibration des artefacts).') : '');
      return `<table class="runner-table"><tr><th>Seuil</th><th>Essais retenus</th><th>Avant</th><th>Après</th></tr>
        ${row('Clignement (saut)', 'jump', 'blink')}${row('Regard (gauche / droite)', 'gaze', 'gaze')}</table><p class="hint">${note}</p>`;
    }

    $('go').onclick = () => { if (running()) endGame(false); else startGame(); };
    const onKey = (e) => {
      const a = { ArrowLeft: 'left', ArrowRight: 'right', ' ': 'jump', ArrowUp: 'jump' }[e.key];
      if (a && running()) { e.preventDefault(); game.input(a); }
    };
    document.addEventListener('keydown', onKey);

    setSource(muse.connected ? 'muse' : 'demo');

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      if (unsub) unsub();
      if (offEvent) offEvent();
      offState();
      sim.stop();
      if (ctx) ctx.detector.onFrame = null;
      if (running() && dyn) { dyn.apply(); dyn.save(); } // quitter la page en pleine calibration : on garde ce qui a été appris
      if (stage) stage.destroy();
      Profiles.sandbox(false);
    };
  },
});
