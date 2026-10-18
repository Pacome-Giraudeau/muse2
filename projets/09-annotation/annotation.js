/* Projet « Annotation » : construire un jeu de test annoté (signal + étiquettes de gestes ou d'états mentaux).
 *  - Annotation forcée : l'application demande un geste (consigne, durée, pause) ; la fenêtre de la consigne est la vérité.
 *  - Annotation spontanée : la personne marque en direct (touches 1…n maintenues, ou boutons) ; temps de réaction corrigé.
 * Puis revue (corriger, exclure, décaler), comparaison avec le détecteur d'artefacts et enregistrement : échantillon
 * de l'application + dossier BIDS (colonnes d'événements supplémentaires). Logique : lib/annotation.js, capture longue :
 * lib/annotation-capture.js, scène : ui/annotation-stage.js. Démonstration : le simulateur joue (ou « annote ») à ta place.
 * Chargé à la demande par app/shell.js ; se nettoie entièrement au démontage. */
Projets.register({
  id: 'annotation',

  template: `
    <header class="proj-head">
      <a class="back" href="#/">← Accueil</a>
      <h1>Annotation</h1>
    </header>
    <p class="intro">Fabrique un <strong>jeu de test annoté</strong> : un enregistrement de plusieurs minutes dont chaque geste est étiqueté,
    pour mesurer le détecteur d’artefacts sur des données dont on connaît la vérité, ou un enregistrement dont chaque période est étiquetée par
    <strong>état mental</strong> (détendu, concentré, somnolent, neutre). Deux méthodes : <strong>forcée</strong> (l’application
    demande le geste) ou <strong>spontanée</strong> (tu marques toi-même ce que tu fais).</p>

    <div class="panel" id="setup">
      <div class="toolbar">
        <span class="seg" role="radiogroup" aria-label="Source du signal">
          <label><input type="radio" name="src" value="muse" checked> Casque</label>
          <label><input type="radio" name="src" value="demo"> Démonstration</label>
        </span>
        <span class="seg" role="radiogroup" aria-label="Ce qu'on annote">
          <label><input type="radio" name="kind" value="gesture" checked> 😉 Gestes</label>
          <label><input type="radio" name="kind" value="mental"> 🧘 État mental</label>
        </span>
        <span class="seg" role="radiogroup" aria-label="Méthode">
          <label><input type="radio" name="mode" value="forced" checked> 📣 Forcée</label>
          <label><input type="radio" name="mode" value="spontaneous"> ✋ Spontanée</label>
        </span>
        <span class="hint" id="src-msg"></span>
      </div>
      <p class="hint" id="mode-hint"></p>
      <div class="ann-labels" id="labels"></div>
      <div class="toolbar">
        <label id="reps-box">Répétitions par geste <select id="reps"><option>1</option><option>2</option><option selected>3</option><option>5</option></select></label>
        <label id="delay-box" hidden>Temps de réaction à retrancher <input id="delay" type="number" min="0" max="1500" step="50" value="350" style="width:70px"> ms</label>
        <button class="btn" id="go">Démarrer la séance</button>
      </div>
    </div>

    <div class="panel" id="run" hidden>
      <div id="stage"></div>
      <div class="runner-hud">
        <span>⏱ <strong id="elapsed">0:00</strong></span>
        <span>🏷️ <strong id="count">0</strong> annotation(s)</span>
        <span class="hint" id="cap-info"></span>
      </div>
      <div class="buttons" style="justify-content:center">
        <button class="btn ghost" id="miss" title="Touche X">Raté / pas fait (X)</button>
        <button class="btn" id="stop">Terminer la séance</button>
      </div>
    </div>

    <div id="review" hidden>
      <div class="panel">
        <h2>Revue</h2>
        <p class="hint">Fenêtres d’annotation et détections 🤖 sur le signal frontal (AF7, AF8). La détection n’est PAS la vérité : elle sert à comparer.
        Glisse pour sélectionner, Ctrl + molette pour zoomer.</p>
        <div id="viewer"></div>
        <div class="toolbar">
          <label>Décalage de toutes les annotations <input id="shift" type="number" step="50" value="0" style="width:80px"> ms</label>
          <button class="btn ghost" id="shift-go">Appliquer</button>
        </div>
        <div style="overflow-x:auto"><table class="table"><thead><tr><th>Étiquette</th><th>Début (s)</th><th>Fin (s)</th><th>Source</th><th>Douteux</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>
      </div>
      <div class="panel"><h2>Comparaison avec le détecteur</h2><div id="compare"></div></div>
      <div class="panel">
        <h2>Enregistrer le jeu annoté</h2>
        <div class="toolbar"><label>Nom <input id="name" type="text" style="width:260px"></label></div>
        <div class="toolbar"><label>Notes <input id="notes" type="text" style="width:420px" placeholder="conditions : lumière, posture, lunettes…"></label></div>
        <div class="buttons"><button class="btn" id="save">Enregistrer</button><button class="btn ghost" id="again">Nouvelle séance</button></div>
        <p class="hint" id="save-msg"></p>
      </div>
    </div>
  `,

  mount(root, { muse, recorder }) {
    const $ = (id) => root.querySelector('#' + id);
    const val = (name) => (root.querySelector(`input[name=${name}]:checked`) || {}).value;
    const sim = new SignalSimulator({ theta: 6, beta: 4, drift: 15, spikePerS: 0.02, blinkEveryS: 60 });
    const ACT = { rest: null, blink: 'blink', frown: 'frown', jaw: 'jaw', yawn: 'yawn', 'gaze-left': 'left', 'gaze-right': 'right', closed: 'closed' };
    const COLOR = { rest: '#8a93a6', blink: '#e0a030', frown: '#d64545', jaw: '#a05ac8', yawn: '#2a9db0', 'gaze-left': '#3a8ee6', 'gaze-right': '#2f6fc0', closed: '#4a9a6a', 'mental-relax': '#4a9a6a', 'mental-focus': '#e0a030', 'mental-drowsy': '#7a6ac8', 'mental-neutral': '#8a93a6' };
    const HINT = {
      forced: 'Forcée : une consigne apparaît (geste, durée, pause aléatoire), blocs équilibrés. La vérité est la fenêtre de la consigne (précision : quelques secondes, le geste est dedans). Touche X ou « Raté » si tu n’as pas pu le faire : la fenêtre sera exclue de la comparaison.',
      spontaneous: 'Spontanée : fais ce que tu veux, et MAINTIENS la touche (1…n) ou le bouton pendant le geste ; un clignement = un appui. Ton temps de réaction est retranché. Moins précis qu’une consigne, mais couvre des gestes naturels ; à corriger ensuite dans la revue.',
    };
    const SCENARIO = { 'mental-relax': { theta: 1, alpha: 2, beta: 0.8 }, 'mental-focus': { theta: 0.9, alpha: 0.7, beta: 2.6 }, 'mental-drowsy': { theta: 2.4, alpha: 0.6, beta: 0.8 }, 'mental-neutral': { theta: 1, alpha: 1, beta: 1 } };
    const MENTAL_HINT = {
      forced: 'Forcée : une consigne d’état apparaît (45 s chacune, blocs équilibrés). Un état ne s’obtient pas sur commande : la fenêtre dit ce que tu as TENTÉ, pas ce que le cerveau a fait. Touche X si tu n’y arrives pas.',
      spontaneous: 'Spontanée : MAINTIENS la touche (1…n) ou le bouton de l’état que tu ressens, tant qu’il dure. Subjectif et retardé (ton ressenti suit l’état avec un décalage) ; à corriger ensuite dans la revue.',
    };
    let bus = null, cap = null, detector = null, detections = [], session = null, runner = null, stage = null;
    let timer = 0, offs = [], frozen = null, viewer = null, running = false, source = 'muse', demoNext = 0, demoCur = null, lastPhase = '';

    function fillLabels() {
      const mental = val('kind') === 'mental';
      $('labels').innerHTML = `<strong>${mental ? 'États' : 'Gestes'} :</strong> ` + Annotation.LABELS.filter((l) => Annotation.isMental(l.id) === mental).map((l) =>
        `<label><input type="checkbox" value="${l.id}" ${l.id === 'yawn' || l.id === 'closed' ? '' : 'checked'}> ${l.emoji} ${l.name}</label>`).join('');
    }
    fillLabels();
    const chosen = () => [...root.querySelectorAll('#labels input:checked')].map((i) => i.value);
    const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

    function syncSetup() {
      const m = val('mode');
      $('mode-hint').textContent = (val('kind') === 'mental' ? MENTAL_HINT : HINT)[m];
      $('reps-box').hidden = m !== 'forced';
      $('delay-box').hidden = m !== 'spontaneous';
      $('src-msg').textContent = val('src') === 'demo' ? 'Démonstration : le simulateur joue à ta place. Rien n’est écrit sur le disque.' : '';
    }
    root.querySelectorAll('input[name=src], input[name=mode]').forEach((r) => (r.onchange = syncSetup));
    root.querySelectorAll('input[name=kind]').forEach((r) => (r.onchange = () => { fillLabels(); syncSetup(); }));
    syncSetup();

    /* ---------- Séance ---------- */
    function start() {
      const labels = chosen();
      if (!labels.length) { $('src-msg').textContent = 'Choisis au moins un geste.'; return; }
      source = val('src');
      if (source === 'muse' && !muse.connected) { $('src-msg').textContent = 'Connecte le casque (bouton en haut), ou choisis la démonstration.'; return; }
      const mode = val('mode');
      bus = source === 'demo' ? sim : muse;
      cap = new AnnotationCapture(bus);
      detector = ArtifactDetector.forProfile();
      detections = [];
      detector.onEvent = (e) => { const d = Annotation.detectionFrom(e); if (d) detections.push(d); };
      offs = [bus.on('eeg', (c, s) => detector.feed(c, s)), bus.on('ppg', (c, s) => detector.feedPpg(c, s))];
      session = new Annotation.Session({ delayMs: Number($('delay').value) || 0 });
      $('setup').hidden = true; $('review').hidden = true; $('run').hidden = false;
      $('miss').hidden = mode !== 'forced';
      stage = new AnnotationStage($('stage'), {
        onPress: (id) => { session.press(id, Date.now()); stage.setActive(Object.keys(session.pending)); refresh(); },
        onRelease: (id) => { session.release(id, Date.now()); stage.setActive(Object.keys(session.pending)); refresh(); },
      });
      if (source === 'demo') sim.start();
      cap.start();
      running = true;
      const now = Date.now();
      if (mode === 'forced') {
        runner = new Annotation.Runner(Annotation.plan({ labels, reps: Number($('reps').value), seed: now % 100000 }), session);
        runner.start(now);
      } else {
        runner = null;
        stage.message('Annote en direct : maintiens la touche (ou le bouton) du geste que tu fais.');
        stage.pad(labels.map(Annotation.label));
        demoNext = now + 3000; demoCur = null;
      }
      lastPhase = '';
      timer = setInterval(tick, 100);
      tick();
    }

    function demoAct(id) { // geste joué, ou état mental simulé par les gains theta / alpha / bêta
      if (id && SCENARIO[id]) { Object.assign(sim.cfg.gain, SCENARIO[id]); sim.act(null); } else sim.act(id ? ACT[id] : null);
    }
    function demoCue(label) { demoAct(label); }

    function tick() {
      if (!running) return;
      const now = Date.now();
      if (runner) {
        const st = runner.tick(now);
        stage.cue(st);
        const key = st.phase + (st.trial ? st.trial.label + st.index : '');
        if (source === 'demo' && key !== lastPhase) demoCue(st.phase === 'cue' ? st.trial.label : null);
        lastPhase = key;
        if (st.phase === 'done') return stop();
      } else if (source === 'demo') demoSpontaneous(now);
      $('elapsed').textContent = fmtT((now - cap.startedAt) / 1000);
      refresh();
    }

    function refresh() {
      $('count').textContent = session.list.length;
      $('cap-info').textContent = detector.ready ? `${cap.seconds.toFixed(0)} s de signal gardées` : 'le détecteur apprend le bruit de fond…';
    }

    // Démonstration spontanée : un « utilisateur » simulé enchaîne des gestes et les marque lui-même
    function demoSpontaneous(now) {
      const labels = Annotation.LABELS.filter((l) => chosen().includes(l.id));
      if (demoCur && now >= demoCur.until) {
        stage.onRelease(demoCur.id); demoCur = null; demoAct(null); demoNext = now + 1500 + Math.random() * 2500;
      } else if (!demoCur && now >= demoNext) {
        const l = labels[Math.floor(Math.random() * labels.length)];
        demoAct(l.id);
        stage.onPress(l.id);
        demoCur = { id: l.id, until: now + (l.kind === 'instant' ? 600 : l.windowS * 700) };
      }
    }

    function miss() {
      if (!runner) return;
      const now = Date.now(), cur = session.sorted().filter((a) => a.source === 'forced' && a.start <= now).pop();
      if (cur) { session.flag(cur.id, 'doubtful'); $('cap-info').textContent = 'Fenêtre exclue de la comparaison.'; }
    }

    function stop() {
      if (!running) return;
      running = false;
      clearInterval(timer);
      const now = Date.now();
      session.finish(now);
      cap.stop();
      offs.forEach((off) => off()); offs = [];
      sim.stop(); sim.act(null); Object.assign(sim.cfg.gain, { theta: 1, alpha: 1, beta: 1 });
      detector.onEvent = null;
      frozen = cap.freeze();
      stage.destroy(); stage = null;
      $('run').hidden = true;
      openReview();
    }

    /* ---------- Revue ---------- */
    const t0 = () => frozen.eeg[0].t[0];
    const rel = (ms) => (ms - t0()) / 1000;

    function openReview() {
      $('review').hidden = false;
      $('name').value = (source === 'demo' ? 'annotation-demo-' : 'annotation-') + new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
      $('save-msg').textContent = '';
      if (viewer) viewer.destroy && viewer.destroy();
      $('viewer').innerHTML = '';
      viewer = new SignalViewer($('viewer'), {});
      renderReview(true);
    }

    function renderReview(reset = false) {
      const e = frozen.eeg, base = t0(), n = Math.min(...e.map((c) => c.t.length));
      const t = Float64Array.from({ length: n }, (_, i) => (e[0].t[i] - base) / 1000);
      const lanes = [1, 2].map((i) => ({ name: Muse.EEG_NAMES[i], unit: 'µV', t, values: e[i].v.subarray(0, n) }));
      const events = [
        ...session.list.map((a) => ({ start: rel(a.start), end: rel(a.end), label: Annotation.label(a.label).emoji + (a.quality === 'doubtful' ? ' ?' : ''), color: COLOR[a.label] })),
        ...detections.map((d) => ({ start: rel(d.start), end: Math.max(rel(d.end), rel(d.start) + 0.05), label: '🤖 ' + d.type, color: css('--muted') || '#888' })),
      ];
      const keep = !reset && viewer.data ? viewer.view : null;
      viewer.setData({ duration: n / 256, lanes, events, states: [], stateColors: {} });
      if (keep) viewer.setView(...keep);
      viewer.redraw();

      const opt = (sel) => Annotation.LABELS.map((l) => `<option value="${l.id}" ${l.id === sel ? 'selected' : ''}>${l.emoji} ${l.name}</option>`).join('');
      $('rows').innerHTML = session.sorted().map((a) => `
        <tr class="ann-row ${a.quality === 'doubtful' ? 'ann-row-bad' : ''}" data-id="${a.id}">
          <td><select data-f="label">${opt(a.label)}</select></td>
          <td><input data-f="start" type="number" step="0.1" value="${rel(a.start).toFixed(2)}"></td>
          <td><input data-f="end" type="number" step="0.1" value="${rel(a.end).toFixed(2)}"></td>
          <td>${a.source === 'forced' ? 'forcée' : 'spontanée'}</td>
          <td><input data-f="quality" type="checkbox" ${a.quality === 'doubtful' ? 'checked' : ''}></td>
          <td><button class="btn ghost" data-del>✕</button></td></tr>`).join('') || '<tr><td colspan="6" class="hint">Aucune annotation.</td></tr>';
      renderCompare();
    }

    function renderCompare() {
      const r = Annotation.compare(session.list, detections), L = Annotation.label;
      const pct = (x) => (x == null ? '—' : Math.round(x * 100) + ' %');
      const rows = Object.entries(r.perLabel).filter(([, v]) => v.n).map(([id, v]) =>
        `<tr><td>${L(id).emoji} ${L(id).name}</td><td>${v.n}</td><td>${v.hits}</td><td>${pct(v.recall)}</td><td>${v.latencyMs == null ? '—' : Math.round(v.latencyMs) + ' ms'}</td></tr>`).join('');
      const conf = r.confusions.map((c) => `${L(c.label).emoji} → détecté « ${c.got} » ×${c.n}`).join(' · ') || 'aucune';
      const rest = Object.entries(r.restFalseAlarms).map(([k, n]) => `${k} ×${n}`).join(' · ') || 'aucune';
      const prec = Object.entries(r.precision).map(([k, v]) => `${k} ${v.good}/${v.total}`).join(' · ') || '—';
      $('compare').innerHTML = (rows ? `<table class="table"><thead><tr><th>Geste</th><th>Annotations</th><th>Détectées</th><th>Rappel</th><th>Délai médian*</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="hint">Rien à comparer (pas d’annotation exploitable).</p>')
        + `<p>Confusions : ${conf}<br>Fausses alarmes pendant le repos : ${rest}<br>Détections tombées dans une fenêtre de leur geste (bonnes / total) : ${prec}<br>Détections hors de toute fenêtre (non comptées) : ${r.unlabelled}</p>`
        + '<p class="hint">* depuis le début de la fenêtre (en forcé : inclut ton temps de réaction). Tolérance ±1 s. Les clignements naturels ne sont pas comptés comme erreurs. Une seule séance, une seule personne : un ordre de grandeur, pas une validation.</p>';
    }

    $('rows').onchange = (ev) => {
      const tr = ev.target.closest('tr[data-id]');
      if (!tr) return;
      const f = ev.target.dataset.f, id = Number(tr.dataset.id);
      if (f === 'label') session.edit(id, { label: ev.target.value });
      else if (f === 'quality') session.flag(id, ev.target.checked ? 'doubtful' : 'ok');
      else if (f === 'start' || f === 'end') session.edit(id, { [f]: t0() + Number(ev.target.value) * 1000, precision: 'marked' });
      renderReview();
    };
    $('rows').onclick = (ev) => {
      const b = ev.target.closest('[data-del]');
      if (b) { session.remove(Number(b.closest('tr').dataset.id)); renderReview(); }
    };
    $('shift-go').onclick = () => { session.shift(Number($('shift').value) || 0); $('shift').value = 0; renderReview(); };

    /* ---------- Enregistrement ---------- */
    $('save').onclick = async () => {
      let folder = null;
      if (source !== 'demo') { try { folder = await SampleFolder.obtain(); } catch (e) { folder = null; } } // d'abord : exige le clic
      const msg = $('save-msg');
      try {
        const n = await recorder.nextSampleNumber(), createdAt = new Date();
        const rec = Recording.fromArrays(frozen, {
          n, name: $('name').value.trim() || 'annotation-' + n, task: 'annotation', notes: $('notes').value.trim() + (source === 'demo' ? ' (démonstration, signal simulé)' : ''),
          powerLine: ArtifactDetector.profileMainsHz(), include: { ppg: true, motion: false }, createdAt,
        });
        Annotation.applyTo(rec, session.sorted(), { delayMs: val('mode') === 'spontaneous' ? session.delayMs : null, detections, mode: val('mode') });
        await recorder.saveRecording(rec);
        let where = 'dans le navigateur (menu ⏺ du bandeau)';
        if (folder) {
          try { await SampleFolder.write(rec, folder); where += ' et dans le dossier des échantillons (BIDS)'; } catch (e) { where += ` ; dossier non écrit : ${e.message}`; }
        } else if (source !== 'demo') where += ' ; dossier des échantillons non disponible (lance « python serveur.py »)';
        msg.textContent = `Enregistré « ${rec.name} » (${rec.events.length} événements) ${where}.`;
      } catch (e) { msg.textContent = 'Échec : ' + e.message; }
    };

    function reset() {
      $('review').hidden = true; $('setup').hidden = false; frozen = null; syncSetup();
    }
    $('again').onclick = reset;
    $('go').onclick = start;
    $('stop').onclick = stop;
    $('miss').onclick = miss;
    const onKey = (e) => { if (running && runner && e.key.toLowerCase() === 'x' && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) miss(); };
    window.addEventListener('keydown', onKey);

    return () => {
      running = false;
      clearInterval(timer);
      offs.forEach((off) => off());
      if (cap) cap.stop();
      if (detector) detector.onEvent = null;
      sim.stop();
      if (stage) stage.destroy();
      if (viewer) viewer.destroy();
      window.removeEventListener('keydown', onKey);
    };
  },
});
