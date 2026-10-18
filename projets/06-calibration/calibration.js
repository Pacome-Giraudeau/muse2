/* Projet « Calibration » : toutes les calibrations de l'application au même endroit (registre lib/calibrations.js).
 *  - Calibrations séparées : un CalibrationPanel par calibration enregistrée.
 *  - Calibration générale : liste à cocher (une calibration nouvellement enregistrée est cochée d'office), vérification
 *    du contact, puis enchaînement ludique (ui/calibration-stage.js) et défi des gestes en bonus (lib/gesture-challenge.js),
 *    bilan « carte d'identité » et reprise des seules étapes ratées.
 * Une seule chaîne de mesure (CalibrationContext) partagée par toutes les calibrations ; une seule calibration à la fois.
 * Démonstration : le simulateur joue les gestes demandés ; les réglages sont dans un bac à sable (Profiles.sandbox),
 * donc rien n'est mémorisé. Choix mémorisés dans le profil : clé « calibrationChoice » = { off: [ids], challenge, voice }.
 * Chargé à la demande par app/shell.js ; se nettoie entièrement au démontage. */
Projets.register({
  id: 'calibration',

  template: `
    <header class="proj-head">
      <a class="back" href="#/">← Accueil</a>
      <h1>Calibration</h1>
    </header>
    <p class="intro">Toutes les calibrations de l'application au même endroit : fais-les <strong>une par une</strong>, ou enchaîne-les
    dans une <strong>calibration générale</strong> guidée, avec un défi final pour vérifier que tes gestes sont bien reconnus.
    Les résultats sont mémorisés dans ton profil et utilisés par les autres projets. <a href="#/d/science">Pourquoi calibrer ?</a></p>

    <div class="toolbar">
      <span class="seg" role="radiogroup" aria-label="Source du signal">
        <label><input type="radio" name="src" value="muse"> Casque</label>
        <label><input type="radio" name="src" value="demo"> Démonstration</label>
      </span>
      <label class="switch"><input type="checkbox" id="voice"><span></span> Consignes parlées</label>
      <span class="hint" id="src-msg"></span>
    </div>

    <section id="setup">
      <div class="panel calib-general">
        <h2>🚀 Calibration générale</h2>
        <p class="hint">Coche ce que tu veux enchaîner. Toute calibration ajoutée à l'application apparaît ici, cochée d'office.</p>
        <ul class="calib-list" id="choice"></ul>
        <div class="buttons calib-go">
          <button class="btn" id="go">Lancer la calibration générale</button>
          <span class="hint" id="go-info"></span>
        </div>
        <p class="hint" id="go-msg"></p>
      </div>
      <h2 class="section">Calibrations séparées</h2>
      <div class="calib-cards" id="separate"></div>
    </section>

    <section id="run" hidden>
      <div class="panel preflight" id="preflight" hidden>
        <h2>Avant de commencer : la pose du casque</h2>
        <div class="preflight-body">
          <div id="pf-map"></div>
          <div>
            <p id="pf-text"></p>
            <ul class="hint">
              <li>Assieds-toi confortablement, dos droit, les pieds au sol, au calme.</li>
              <li>Les capteurs du front touchent la peau ; ceux derrière les oreilles aussi (cheveux dégagés).</li>
              <li>Coupe les notifications : la séance dure quelques minutes.</li>
            </ul>
            <div class="buttons">
              <button class="btn" id="pf-go">C'est parti !</button>
              <button class="btn ghost" id="pf-anyway">Continuer quand même</button>
              <button class="btn ghost" id="pf-cancel">Annuler</button>
            </div>
          </div>
        </div>
      </div>
      <div id="stage"></div>
      <div class="buttons run-buttons" id="run-buttons">
        <button class="btn ghost" id="skip">Passer cette calibration</button>
        <button class="btn ghost" id="stop">Arrêter</button>
      </div>
    </section>

    <section id="end" hidden>
      <div class="panel end-card">
        <div class="confetti" id="confetti" aria-hidden="true"></div>
        <div class="end-head"><div class="end-emoji" id="end-emoji">🏆</div>
          <div><div class="state-label" id="end-title"></div><div class="hint" id="end-sub"></div></div></div>
        <h2>Ta carte d'identité cérébrale</h2>
        <div class="cal-badges" id="badges"></div>
        <div class="buttons">
          <button class="btn" id="redo" hidden>Refaire les étapes ratées</button>
          <button class="btn ghost" id="back">Retour aux calibrations</button>
        </div>
      </div>
    </section>`,

  mount(root, { muse }) {
    const $ = (id) => root.querySelector('#' + id);
    const show = (id) => ['setup', 'run', 'end'].forEach((s) => ($(s).hidden = s !== id));
    const ACTS = ['blink', 'frown', 'jaw', 'yawn'];
    const actFor = (step) => (step.eyesClosed ? 'closed' : ACTS.includes(step.id) ? step.id : null);
    const choice = () => ({ off: [], challenge: true, voice: false, ...Profiles.get('calibrationChoice', {}) });
    const saveChoice = (patch) => Profiles.set('calibrationChoice', { ...choice(), ...patch });

    const stage = new CalibrationStage($('stage'), { voice: () => $('voice').checked,
      onCancel: () => { stopProgram(); renderChoice(); show('setup'); } }); // Échap / « Annuler » du point à suivre plein écran
    const headMap = new HeadMap($('pf-map'));
    const sim = new SignalSimulator({ theta: 6, beta: 4, drift: 15, spikePerS: 0.05, blinkEveryS: 6 });
    let source = null, ctx = null, unsubscribe = null, runners = {}, panels = [], program = null, timers = [];

    /* ---------- Source et chaîne de mesure ---------- */

    function setSource(src) {
      stopProgram();
      if (unsubscribe) unsubscribe();
      sim.stop();
      sim.act(null); sim.look(null);
      panels.forEach((p) => p.destroy());
      Object.values(runners).forEach((r) => r.cancel());
      source = src;
      Profiles.sandbox(src === 'demo'); // la démonstration ne touche pas aux vrais réglages
      ctx = new CalibrationContext();
      runners = Object.fromEntries(Calibrations.list().map((d) => [d.id, d.create(ctx)]));
      root.querySelectorAll('input[name=src]').forEach((r) => (r.checked = r.value === src));
      $('voice').checked = choice().voice;
      $('src-msg').textContent = src === 'demo'
        ? 'Démonstration : le simulateur fait les gestes à ta place. Rien n’est mémorisé dans ton profil.' : '';
      const feed = (c, s) => ctx.feed(c, s);
      const bus = src === 'demo' ? sim : muse, offs = [bus.on('eeg', feed), bus.on('ppg', (c, s) => ctx.feedPpg(c, s)), muse.on('resync', () => ctx.resync())];
      unsubscribe = () => offs.forEach((off) => off());
      if (src === 'demo') sim.start();
      renderChoice();
      renderSeparate();
      show('setup');
    }

    root.querySelectorAll('input[name=src]').forEach((r) => (r.onchange = () => setSource(r.value)));
    $('voice').onchange = () => saveChoice({ voice: $('voice').checked });
    const offState = muse.on('state', (st) => { if (st === 'connected' && source === 'muse' && !program) setSource('muse'); });

    const busy = () => (program || Object.values(runners).some((r) => r.running) ? 'Une autre calibration est en cours.' : true);
    const actDemo = (state) => {
      if (source !== 'demo') return;
      const rec = state.phase === 'record' && state.step;
      sim.act(rec ? actFor(state.step) : null);
      sim.look(rec && state.step.target ? state.step.target(state.step.seconds - state.remainingS) : null); // le simulateur suit le point
    };

    /* ---------- Calibrations séparées ---------- */

    function renderSeparate() {
      const defs = Calibrations.list();
      $('separate').innerHTML = defs.map((d) => {
        const p = CATALOGUE.projets.find((x) => x.id === d.project);
        const used = p && p.id !== 'calibration' ? ` Utilisée par <a href="#/p/${p.id}">${p.titre}</a>.` : '';
        return `<div class="panel"><h2>${d.emoji} ${d.label}</h2><p class="hint">${d.description}${used}</p><div id="sep-${d.id}"></div></div>`;
      }).join('');
      panels = defs.map((d) => new CalibrationPanel($('sep-' + d.id), runners[d.id], {
        def: d, canStart: busy,
        onState: (s) => { actDemo(s); if (s.phase === 'done' || s.phase === 'idle') renderChoice(); },
      }));
    }

    /* ---------- Liste à cocher de la calibration générale ---------- */

    function renderChoice() {
      const c = choice(), fmt = (s) => (s >= 60 ? `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')}` : `${s} s`);
      const rows = Calibrations.list().map((d) => {
        const st = d.status(), on = !c.off.includes(d.id);
        const badge = st.done ? (st.failed ? `<span class="tag wip">${st.failed} à refaire</span>` : '<span class="tag ok">faite</span>') : '<span class="tag">à faire</span>';
        return `<li><label class="switch"><input type="checkbox" data-id="${d.id}" ${on ? 'checked' : ''}><span></span></label>
          <div><b>${d.emoji} ${d.label}</b> ${badge} <small class="hint">≈ ${fmt(Calibrations.seconds([d.id]))}</small>
          <div class="hint">${d.description}</div><div class="hint"><i>${st.summary}</i></div></div></li>`;
      });
      rows.push(`<li class="bonus"><label class="switch"><input type="checkbox" data-id="challenge" ${c.challenge ? 'checked' : ''}><span></span></label>
        <div><b>🎯 Défi des gestes</b> <span class="tag">bonus</span> <small class="hint">≈ ${fmt(10 * 4)}</small>
        <div class="hint">10 gestes demandés au hasard : vérifie que la calibration les reconnaît, et marque des points.</div></div></li>`);
      $('choice').innerHTML = rows.join('');
      $('choice').querySelectorAll('input[data-id]').forEach((box) => (box.onchange = () => {
        const id = box.dataset.id;
        if (id === 'challenge') saveChoice({ challenge: box.checked });
        else saveChoice({ off: box.checked ? choice().off.filter((x) => x !== id) : [...choice().off, id] });
        renderChoice();
      }));
      const sel = selection();
      const total = Calibrations.seconds(sel.ids) + (sel.challenge ? 40 : 0);
      $('go').disabled = !sel.ids.length && !sel.challenge;
      $('go-info').textContent = `${sel.ids.length} calibration(s)${sel.challenge ? ' + défi' : ''} · ≈ ${fmt(total)}`;
    }

    function selection() {
      const c = choice();
      return { ids: Calibrations.list().map((d) => d.id).filter((id) => !c.off.includes(id)), challenge: !!c.challenge };
    }

    /* ---------- Programme de la calibration générale ---------- */

    $('go').onclick = () => {
      const sel = selection(), items = sel.ids.map((id) => ({ kind: 'calib', id, only: null }));
      if (sel.challenge) items.push({ kind: 'challenge' });
      startProgram(items);
    };

    function startProgram(items) {
      if (busy() !== true) { $('go-msg').textContent = busy(); return; }
      if (source === 'muse' && !muse.connected) { $('go-msg').textContent = 'Connecte le casque (en haut à droite) ou choisis « Démonstration ».'; return; }
      $('go-msg').textContent = '';
      const steps = (it) => (it.kind === 'challenge' ? 10 : it.only ? it.only.length : Calibrations.get(it.id).steps.length);
      program = { items, i: -1, done: 0, total: items.reduce((n, it) => n + steps(it), 0), game: null, summary: null };
      show('run');
      $('stage').hidden = source === 'muse';
      $('run-buttons').hidden = source === 'muse';
      $('preflight').hidden = source !== 'muse';
      if (source === 'muse') preflight(); else nextItem();
    }

    function preflight() {
      const t = setInterval(() => {
        const levels = ctx.contact.levels, ok = levels.filter((l) => l.label === 'bon' || l.label === 'moyen').length;
        headMap.update(levels);
        $('pf-text').textContent = ok === 4 ? '✅ Les quatre capteurs sont bons : tu peux lancer la séance.'
          : `${ok}/4 capteurs au contact correct. Ajuste le casque jusqu'à voir les quatre en vert (ou continue quand même).`;
        $('pf-go').disabled = ok < 3;
      }, 500);
      timers.push(t);
      const go = () => { clearInterval(t); $('preflight').hidden = true; $('stage').hidden = false; $('run-buttons').hidden = false; nextItem(); };
      $('pf-go').onclick = go;
      $('pf-anyway').onclick = go;
      $('pf-cancel').onclick = () => { clearInterval(t); stopProgram(); show('setup'); };
    }

    const current = () => program && program.items[program.i];
    const trail = () => program.items.filter((it) => it.kind === 'calib').map((it) => {
      const def = Calibrations.get(it.id), st = runners[it.id].statuses;
      return { emoji: def.emoji, statuses: it.only ? st.filter((s) => it.only.includes(s.id)) : st };
    });

    function nextItem() {
      const it = current();
      if (it) program.done += it.kind === 'challenge' ? 10 : it.only ? it.only.length : Calibrations.get(it.id).steps.length;
      program.i++;
      const next = current();
      if (!next) return finish();
      if (next.kind === 'challenge') return runChallenge();
      const def = Calibrations.get(next.id), runner = runners[next.id];
      runner.onProgress = (s) => {
        actDemo(s);
        const pos = s.phase === 'done' ? s.total : Math.max(0, s.position - 1);
        stage.mission({ def, state: s, overall: { done: program.done + pos, total: program.total }, trail: trail(),
          meter: s.step && s.step.meter ? ctx.detector.levels[s.step.meter] : null });
      };
      runner.onDone = () => timers.push(setTimeout(() => program && nextItem(), 1500));
      const tryStart = () => {
        if (!program || current() !== next) return;
        if (runner.start(next.only)) return;
        stage.mission({ def, state: {}, overall: { done: program.done, total: program.total }, trail: trail(),
          wait: 'Le signal se stabilise (apprentissage du bruit de fond, quelques secondes)…' });
        timers.push(setTimeout(tryStart, 500));
      };
      tryStart();
    }

    function runChallenge() {
      const game = program.game = new GestureChallenge(ctx, { rounds: 10 });
      let goAt = 0;
      game.onProgress = (p) => {
        if (source === 'demo') { // le simulateur réagit ~0,8 s après « Maintenant ! »
          if (p.phase === 'go' && !goAt) goAt = Date.now();
          if (p.phase !== 'go') goAt = 0;
          sim.act(goAt && Date.now() - goAt > 800 ? p.gesture.id : null);
        }
        stage.challenge(p, { done: program.done + p.results.length, total: program.total });
      };
      game.onDone = (summary) => { program.summary = summary; timers.push(setTimeout(() => program && nextItem(), 1500)); };
      const tryStart = () => { if (program && program.game === game && !game.start()) timers.push(setTimeout(tryStart, 500)); };
      tryStart();
    }

    function stopProgram() {
      timers.forEach((t) => { clearInterval(t); clearTimeout(t); });
      timers = [];
      if (program) {
        Object.values(runners).forEach((r) => r.cancel());
        if (program.game) program.game.cancel();
      }
      program = null;
      sim.act(null);
      stage.destroy();
      if (ctx) renderSeparate(); // les panneaux reprennent la main sur les runners
    }

    $('skip').onclick = () => {
      const it = current();
      if (!it) return;
      if (it.kind === 'challenge') program.game.cancel(); else runners[it.id].cancel();
      timers.forEach((t) => clearTimeout(t));
      nextItem();
    };
    $('stop').onclick = () => { stopProgram(); renderChoice(); show('setup'); };
    $('back').onclick = () => { renderChoice(); show('setup'); };

    /* ---------- Bilan ---------- */

    function finish() {
      const items = program.items, summary = program.summary;
      stopProgram();
      let ok = 0, all = 0;
      const redo = [];
      const badges = items.filter((it) => it.kind === 'calib').map((it) => {
        const def = Calibrations.get(it.id), st = runners[it.id].statuses.filter((s) => !it.only || it.only.includes(s.id));
        const good = st.filter((s) => s.status === 'ok').length, failed = st.filter((s) => s.status === 'failed');
        ok += good; all += st.length;
        if (failed.length) redo.push({ kind: 'calib', id: it.id, only: failed.map((s) => s.id) });
        return `<div class="cal-badge ${failed.length ? 'partial' : 'full'}"><div class="cal-badge-emoji">${def.emoji}</div>
          <div><b>${def.label}</b> ${'⭐'.repeat(good)}${'💥'.repeat(failed.length)}
          <div class="hint">${def.status().summary}</div>
          ${failed.length ? `<div class="hint">À refaire : ${failed.map((s) => `${s.label} (${s.message})`).join(' ; ')}</div>` : ''}</div></div>`;
      });
      if (summary) {
        const gestures = GestureChallenge.GESTURES.map((g) => { const r = summary.perGesture[g.id]; return r ? `${g.emoji} ${r.hits}/${r.tries}` : ''; }).filter(Boolean).join(' · ');
        badges.push(`<div class="cal-badge ${summary.toRedo.length ? 'partial' : 'full'}"><div class="cal-badge-emoji">🎯</div>
          <div><b>Défi des gestes : ${summary.score} points</b> (${summary.hits}/${summary.total} reconnus)
          <div class="hint">${gestures}</div>
          ${summary.toRedo.length ? '<div class="hint">Gestes mal reconnus : leur calibration sera refaite avec « Refaire les étapes ratées ».</div>' : ''}</div></div>`);
        if (summary.toRedo.length && Calibrations.get('artefacts')) {
          const r = redo.find((x) => x.id === 'artefacts');
          if (r) r.only = [...new Set([...r.only, ...summary.toRedo])];
          else redo.push({ kind: 'calib', id: 'artefacts', only: summary.toRedo });
        }
      }
      const perfect = !redo.length && all > 0;
      $('end-emoji').textContent = perfect ? '🏆' : ok >= all / 2 ? '🥈' : '🌱';
      $('end-title').textContent = perfect ? 'Calibration parfaite !' : `${ok} étape(s) réussie(s) sur ${all}`;
      $('end-sub').textContent = source === 'demo' ? 'Démonstration : rien n’a été mémorisé dans ton profil.'
        : perfect ? 'Tout est enregistré dans ton profil : les autres projets utilisent maintenant tes réglages.'
        : 'Les réussites sont enregistrées ; refais seulement ce qui a raté.';
      $('badges').innerHTML = badges.join('');
      $('redo').hidden = !redo.length;
      $('redo').onclick = () => startProgram(redo);
      $('confetti').innerHTML = perfect ? Array.from({ length: 40 }, (_, i) =>
        `<i style="left:${(i * 37) % 100}%;animation-delay:${((i * 13) % 20) / 10}s;background:hsl(${(i * 47) % 360} 80% 60%)"></i>`).join('') : '';
      if (perfect) stage.say('Bravo ! Calibration parfaite.');
      renderChoice();
      show('end');
    }

    setSource(muse.connected ? 'muse' : 'demo');

    return () => {
      stopProgram();
      stage.dispose();
      panels.forEach((p) => p.destroy());
      Object.values(runners).forEach((r) => r.cancel());
      if (unsubscribe) unsubscribe();
      sim.stop();
      offState();
      Profiles.sandbox(false);
    };
  },
});
