/* Projet « État mental » : un indicateur simple (détendu, concentré, somnolent, neutre) calculé à partir des bandes
 * theta, alpha et bêta, toujours COMPARÉES À UNE RÉFÉRENCE PERSONNELLE (lib/mental-state.js).
 * Chaîne : casque (ou démonstration) -> filtres mémorisés SANS la piste « clignements » (MentalState.statePipeline,
 * signalé à l'écran) -> MentalState.measure sur 4 s (+ 4 s de brut pour le témoin musculaire) -> MentalState, 1 fois/s.
 * Détecteur d'artefacts du profil (ArtifactDetector.forProfile : calibration, sensibilité, secteur). Artefacts : même
 * règle qu'hors ligne — rejet par segment de 1 s (MentalState.EventLog.recent -> measure) : clignement, sourcils et
 * regard -> front ; mâchoire -> tempes ; bâillement -> toutes ; une électrode n'est écartée que s'il lui reste moins de
 * MIN_SEGMENTS segments propres. Chaque électrode est comparée à sa propre référence. Affiche aussi les écarts bruts
 * θ/α/β, le seuil réel (tiré de la référence) et les électrodes « tendues » (témoin musculaire).
 * Mesure suspendue si aucune électrode utilisable ne reste, ou si moins de 2 électrodes ont un contact correct
 * (lib/contact.js). Chargé à la demande par app/shell.js ; se nettoie entièrement au démontage. */
Projets.register({
  id: 'etat',

  template: `
    <header class="proj-head">
      <a class="back" href="#/">← Accueil</a>
      <h1>État mental</h1>
    </header>
    <p class="intro">Une estimation simple de ton état à partir des rythmes cérébraux, <strong>comparés à ta propre référence</strong>.
    C'est un indicateur approximatif, pas une mesure médicale : <a href="#/d/science">voir les explications et les limites</a>.</p>

    <div class="toolbar">
      <span class="seg" role="radiogroup" aria-label="Source du signal">
        <label><input type="radio" name="src" value="muse"> Casque</label>
        <label><input type="radio" name="src" value="demo"> Démonstration</label>
      </span>
      <span class="seg" id="demo-ctl" hidden aria-label="Scénario de démonstration">
        <label><input type="radio" name="scn" value="neutral" checked> 😐 Neutre</label>
        <label><input type="radio" name="scn" value="relaxed"> 😌 Détendu</label>
        <label><input type="radio" name="scn" value="focused"> 🎯 Concentré</label>
        <label><input type="radio" name="scn" value="drowsy"> 😴 Somnolent</label>
      </span>
      <span class="hint" id="src-msg"></span>
    </div>

    <div class="grid">
      <div class="stack">
        <div class="panel state-card" id="card">
          <div class="state-emoji" id="emoji">⏳</div>
          <div>
            <div class="state-label" id="label">En attente</div>
            <div class="state-desc" id="desc"></div>
            <div class="hint" id="since"></div>
          </div>
        </div>
        <div class="panel">
          <h2>Indicateurs (écart à ta référence)</h2>
          <div id="gauges"></div>
          <p class="hint" id="gauge-hint"></p>
        </div>
        <div class="panel">
          <h2>Bandes (écart à ta référence)</h2>
          <div id="devs"></div>
          <p class="hint" id="dev-hint">Puissance de chaque bande comparée à celle de ta référence, électrode par électrode, lissée comme les indicateurs. Les trois indicateurs ci-dessus combinent ces trois bandes : une baisse d'alpha seule fait monter à la fois « concentration » et « somnolence ».</p>
        </div>
        <div class="panel">
          <h2>Historique (3 dernières minutes)</h2>
          <canvas class="timeline" id="timeline"></canvas>
          <div class="legend-row" id="legend"></div>
        </div>
      </div>
      <div class="stack">
        <div class="panel">
          <h2>Ta référence</h2>
          <p class="hint" id="base-info"></p>
          <div class="progress" id="base-progress-wrap" hidden><div id="base-progress"></div></div>
          <div class="buttons" style="margin-top:8px">
            <button class="btn" id="base-measure">Mesurer ma référence (30 s)</button>
            <button class="btn ghost" id="base-reset">Réinitialiser</button>
          </div>
          <p class="hint">Pendant la mesure : assis, détendu mais éveillé, yeux ouverts, sans bouger ni parler. Refaire la référence à chaque nouvelle pose du casque donne de meilleurs résultats. Elle fait aussi partie de la <a href="#/p/calibration">calibration générale</a>.</p>
        </div>
        <div class="panel">
          <h2>Mesure en cours</h2>
          <div id="bands"></div>
          <table class="kv">
            <tr><td>Électrodes utilisées</td><td id="used">–</td></tr>
            <tr><td>Mesure</td><td id="status">–</td></tr>
            <tr><td>Filtres</td><td id="filters">–</td></tr>
          </table>
        </div>
      </div>
    </div>`,

  mount(root, { muse }) {
    const $ = (id) => root.querySelector('#' + id);
    const R = Muse.EEG_RATE, WINDOW = 4 * R;
    const COLORS = { neutral: '#8f98ab', relaxed: '#7ddc6b', focused: '#f5b84a', drowsy: '#6c8cff', unknown: '#3a4152' };
    const GAUGES = [['relax', 'Détente', 'relaxed'], ['focus', 'Concentration', 'focused'], ['drowsy', 'Somnolence', 'drowsy']];
    const BANDS = [['theta', 'Theta (4–8 Hz)', '#2fc7b8'], ['alpha', 'Alpha (8–13 Hz)', '#7ddc6b'], ['beta', 'Bêta (13–20 Hz)', '#f5b84a']];
    const pct = (s) => `${s >= 0 ? '+' : ''}${((Math.exp(s) - 1) * 100).toFixed(0)} %`; // score ln -> écart en %
    const names = (list) => list.map((i) => Muse.EEG_NAMES[i]).join(', ');

    const loadBase = () => BaselineCalibrator.load(); // référence du profil actif (lib/mental-baseline.js)
    const saveBase = (b) => (b ? BaselineCalibrator.save(b) : BaselineCalibrator.clear());

    // Démonstration : signal simulé dont on règle les gains theta / alpha / bêta selon le scénario choisi
    const SCENARIOS = { neutral: { theta: 1, alpha: 1, beta: 1 }, relaxed: { theta: 1, alpha: 2, beta: 0.8 }, focused: { theta: 0.9, alpha: 0.7, beta: 2.6 }, drowsy: { theta: 2.4, alpha: 0.6, beta: 0.8 } };
    // Pics isolés rares et dérive modérée : chaque pic (400 µV) et chaque dérive AF7/AF8 prise pour un regard écarte
    // des électrodes pendant toute la fenêtre de 4 s ; trop fréquents, ils suspendraient la démonstration en permanence.
    const simulator = new SignalSimulator({ theta: 6, beta: 4, blinkEveryS: 7, spikePerS: 0.02, drift: 20 });

    let source = null, unsubscribe = null, state, pipeline, removed = [], detector, contact, buf, rawBuf, measuring = null, events, received = 0;
    // Mesure de la fenêtre : rejet des artefacts PAR SEGMENT de 1 s (LA règle de lib/mental-state.js, mêmes zones et
    // marges qu'hors ligne) + témoin musculaire sur le brut. Horloge = échantillons reçus, comme les événements.
    const measureNow = (good) => {
      const now = (received * 1000) / R;
      return MentalState.measure(buf.map((b, i) => (good.includes(i) ? b : null)),
        { rate: R, raw: rawBuf, events: events.recent(detector.active, WINDOW / R, now), t0: now / 1000 - WINDOW / R });
    };

    $('gauges').innerHTML = GAUGES.map(([k, name, st]) => `
      <div class="gauge"><span>${name}</span>
        <div class="gauge-track"><i class="gauge-mark l" id="gl-${k}"></i><i class="gauge-mark r" id="gr-${k}"></i><div class="gauge-fill" id="g-${k}" style="background:${COLORS[st]}"></div></div>
        <b id="gv-${k}">–</b></div>`).join('');
    $('devs').innerHTML = BANDS.map(([k, name, color]) => `
      <div class="gauge"><span>${name.split(' ')[0]}</span>
        <div class="gauge-track"><div class="gauge-fill" id="d-${k}" style="background:${color}"></div></div>
        <b id="dv-${k}">–</b></div>`).join('');
    $('bands').innerHTML = BANDS.map(([k, name, color]) => `
      <div class="bar"><span>${name.split(' ')[0]}</span><div class="track"><div class="fill" id="b-${k}" style="background:${color}"></div></div><span class="val" id="bv-${k}">–</span></div>`).join('');
    $('legend').innerHTML = ['relaxed', 'focused', 'drowsy', 'neutral'].map((s) => `<span><i style="background:${COLORS[s]}"></i>${MentalState.STATES[s].label}</span>`).join('') + `<span><i style="background:${COLORS.unknown}"></i>En attente</span><span><i class="paused"></i>Suspendu</span>`;

    /* ---------- Source ---------- */

    function setSource(src) {
      if (unsubscribe) unsubscribe();
      simulator.stop();
      source = src;
      measuring = null;
      ({ pipeline, removed } = MentalState.statePipeline(SignalPipeline.loadSaved(R))); // sans la piste « clignements »
      // casque : calibration, sensibilité et secteur du profil actif ; démonstration : signal fabriqué, réglages par défaut
      detector = src === 'muse' ? ArtifactDetector.forProfile(R) : new ArtifactDetector({}, R);
      events = new MentalState.EventLog();
      received = 0;
      detector.onEvent = (e) => events.add({ ...e, time: (e.sample * 1000) / R });
      contact = new ContactQuality();
      buf = [[], [], [], []];
      rawBuf = [[], [], [], []];
      state = new MentalState({ baseline: src === 'muse' ? loadBase() : null }); // la démo a sa propre référence
      root.querySelectorAll('input[name=src]').forEach((r) => (r.checked = r.value === src));
      $('demo-ctl').hidden = src !== 'demo';
      const keep = (b, v) => { b.push(...v); if (b.length > WINDOW) b.splice(0, b.length - WINDOW); };
      pipeline.onSamples = (raw, clean) => clean.forEach((v, c) => { keep(buf[c], v); keep(rawBuf[c], raw[c]); });
      const feed = (c, s) => { if (c === 0) received += s.length; pipeline.feed(c, s); detector.feed(c, s); contact.feed(c, s); };
      const feedPpg = (c, s) => detector.feedPpg(c, s);
      const bus = src === 'demo' ? simulator : muse, offs = [bus.on('eeg', feed), bus.on('ppg', feedPpg), muse.on('resync', () => { pipeline.reset(); detector.resync(); })];
      unsubscribe = () => offs.forEach((off) => off());
      if (src === 'demo') { applyScenario(); simulator.start(); }
      render({ paused: true, reason: 'démarrage…' });
    }

    function applyScenario() {
      const scn = root.querySelector('input[name=scn]:checked').value;
      Object.assign(simulator.cfg.gain, SCENARIOS[scn]);
    }

    root.querySelectorAll('input[name=src]').forEach((r) => (r.onchange = () => setSource(r.value)));
    root.querySelectorAll('input[name=scn]').forEach((r) => (r.onchange = applyScenario));
    const offState = muse.on('state', (st) => { if (st === 'connected' && source === 'muse') setSource('muse'); else render(lastResult); });

    /* ---------- Référence ---------- */

    $('base-measure').onclick = () => {
      measuring = { list: [] };
      $('base-progress-wrap').hidden = false;
    };
    $('base-reset').onclick = () => {
      if (source === 'muse') saveBase(null);
      state.resetBaseline();
      measuring = null;
      $('base-progress-wrap').hidden = true;
    };

    /* ---------- Mesure, une fois par seconde ---------- */

    let lastResult = { paused: true };
    function tick() {
      let perChannel = null, bands = null, reason = '', notes = [], usable = [];
      const good = contact.levels.map((l, i) => (l.label === 'bon' || l.label === 'moyen' ? i : -1)).filter((i) => i >= 0);
      if (source === 'muse' && !muse.connected) reason = 'casque non connecté';
      else if (buf[0].length < WINDOW) reason = 'remplissage (4 s de signal)';
      else if (good.length < 2) reason = `contact insuffisant (${good.length}/4 électrodes)`;
      else {
        const m = measureNow(good);
        usable = good.filter((i) => m[i]);
        if (!usable.length) reason = 'artefact sur toutes les électrodes utilisables';
        else {
          perChannel = m;
          bands = MentalState.meanBands(m); // pour l'affichage des parts θ/α/β
          if (usable.length < good.length) notes.push('écartées pour artefact : ' + names(good.filter((i) => !m[i])));
          const partial = usable.filter((i) => m[i].segments < m[i].of);
          if (partial.length) notes.push('segments propres : ' + partial.map((i) => `${Muse.EEG_NAMES[i]} ${m[i].segments}/${m[i].of}`).join(', '));
        }
      }

      if (measuring && perChannel) {
        measuring.list.push(perChannel);
        if (measuring.list.length >= 30) {
          const b = MentalState.baselineFrom(measuring.list);
          state.setBaseline(b);
          if (source === 'muse') saveBase(b);
          measuring = null;
          $('base-progress-wrap').hidden = true;
        }
      }
      const r = state.update(measuring ? null : perChannel, 1); // pas d'état affiché pendant la mesure de référence
      if (r.muscle && r.muscle.length) notes.push('tension musculaire (30–45 Hz) : ' + names(r.muscle) + (r.focusSuspended ? ' — concentration suspendue' : ', exclues de la concentration'));
      lastResult = { ...r, reason: measuring ? 'mesure de la référence…' : reason, note: notes.join(' ; '), bands, used: usable };
      render(lastResult);
    }

    /* ---------- Affichage ---------- */

    function render(r) {
      const st = MentalState.STATES[state.state];
      $('emoji').textContent = st.emoji;
      $('label').textContent = st.label;
      $('desc').textContent = st.description;
      $('card').style.borderColor = COLORS[state.state];
      $('card').classList.toggle('paused', !!r.paused);
      const secs = Math.round((Date.now() - state.since) / 1000);
      $('since').textContent = r.paused && r.reason ? 'Mesure suspendue : ' + r.reason
        : state.state === 'unknown' ? `Référence automatique : ${Math.round((r.baselineProgress || 0) * 30)} / 30 s de signal propre` : `depuis ${secs} s`;
      $('src-msg').textContent = source === 'demo' ? 'Signal fabriqué : choisis un scénario pour voir l’indicateur réagir (≈ 5 à 10 s).' : '';

      // Jauges : score ln de -1 à +1 sur toute la largeur ; traits = seuil RÉEL de chaque indicateur (state.threshold)
      const bar = (el, s) => { const w = Math.min(50, Math.abs(s) * 50); el.style.width = w + '%'; el.style.left = s >= 0 ? '50%' : 50 - w + '%'; };
      const thr = state.threshold;
      GAUGES.forEach(([k]) => {
        const s = state.scores[k];
        bar($('g-' + k), s);
        $('gl-' + k).style.left = 50 - Math.min(50, thr[k] * 50) + '%';
        $('gr-' + k).style.left = 50 + Math.min(50, thr[k] * 50) + '%';
        $('gv-' + k).textContent = state.baseline ? pct(s) + (k === 'focus' && r.focusSuspended ? ' ⏸' : '') : '–';
      });
      $('gauge-hint').textContent = `Le trait de chaque côté marque le seuil de changement d'état : détente ${pct(thr.relax)}, concentration ${pct(thr.focus)}, somnolence ${pct(thr.drowsy)}`
        + (thr.fromSpread ? ' (2 × la fluctuation naturelle de ta référence au repos).' : ' (seuil par défaut : référence sans mesure de fluctuation).')
        + ' Un état doit durer 3 s pour s’afficher.' + (r.muscleGuard ? '' : state.baseline ? ' Pas de témoin musculaire avec cette référence : une crispation peut passer pour de la concentration.' : '');
      const dv = state.deviations;
      BANDS.forEach(([k]) => {
        bar($('d-' + k), dv ? dv[k] : 0);
        $('dv-' + k).textContent = dv && state.baseline ? pct(dv[k]) : '–';
      });
      if (state.baseline && !dv) $('dev-hint').textContent = 'Ta référence a été mesurée avant l’ajout de ces écarts : refais-la pour les voir.';
      if (r.bands) {
        const tot = r.bands.theta + r.bands.alpha + r.bands.beta;
        BANDS.forEach(([k]) => { const p = (100 * r.bands[k]) / tot; $('b-' + k).style.width = p.toFixed(0) + '%'; $('bv-' + k).textContent = p.toFixed(0) + ' %'; });
      }
      $('used').textContent = r.used && r.used.length ? r.used.map((i) => Muse.EEG_NAMES[i]).join(', ') : '–';
      $('status').textContent = r.paused ? 'suspendue' : r.note ? 'en cours (' + r.note + ')' : 'en cours';
      $('filters').textContent = pipeline.summary() + (removed.includes('eog')
        ? ' — piste « Réduction des clignements » active ailleurs mais NON appliquée ici : elle efface une partie du theta frontal.' : '');

      const b = state.baseline;
      $('base-info').textContent = measuring ? `Mesure en cours : ${measuring.list.length} / 30 s de signal propre. Reste calme, yeux ouverts.`
        : !b ? 'Pas encore de référence : les 30 premières secondes de signal propre serviront de référence automatique.'
        : state.auto ? `Référence automatique (30 premières secondes de signal propre). Pour plus de fiabilité, mesure-la au calme.`
        : `Référence mesurée le ${new Date(b.date).toLocaleString()} (${b.seconds} s).` + (source === 'demo' ? ' (démonstration, non mémorisée)' : '')
          + (b.legacy ? ' Ancienne référence (bêta 13–30 Hz, sans témoin musculaire ni mesure de fluctuation) : refais-la pour en profiter.' : '');
      if (measuring) $('base-progress').style.width = (100 * measuring.list.length / 30).toFixed(0) + '%';
      drawTimeline();
    }

    function drawTimeline() {
      const c = $('timeline'), d = window.devicePixelRatio || 1;
      const w = Math.round(c.clientWidth * d), h = Math.round(c.clientHeight * d);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      const g = c.getContext('2d'), N = 180, hist = state.history.slice(-N), x0 = w - (hist.length / N) * w;
      g.clearRect(0, 0, w, h);
      hist.forEach((e, i) => {
        g.fillStyle = e.paused ? 'rgba(143,152,171,0.25)' : COLORS[e.state];
        g.fillRect(x0 + (i / N) * w, 0, w / N + 0.5, h - 14 * d);
      });
      g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted');
      g.font = `${10 * d}px system-ui`;
      g.fillText('−3 min', 0, h - 2 * d);
      g.fillText('maintenant', w - 56 * d, h - 2 * d);
    }

    setSource(muse.connected ? 'muse' : 'demo');
    const timer = setInterval(tick, 1000);

    return () => {
      clearInterval(timer);
      simulator.stop();
      if (unsubscribe) unsubscribe();
      offState();
    };
  },
});
