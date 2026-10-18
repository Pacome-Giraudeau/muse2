/* Projet « Étude d'échantillon » : visualiser un échantillon enregistré, repérer automatiquement les artefacts et les
 * états mentaux, sélectionner un sous-échantillon et l'analyser (spectre, spectrogramme, bandes, statistiques), l'exporter
 * ou l'enregistrer comme nouvel échantillon.
 * Sources : échantillons du navigateur (#/p/etude/<n>), du dossier muse2/echantillons, fichier .muse2.json ou .edf,
 * ou un échantillon de démonstration. Briques : ui/signal-viewer.js, lib/recording.js, lib/artifacts.js,
 * lib/mental-state.js, lib/filters.js, lib/signal.js, lib/sample-folder.js. */
Projets.register({
  id: 'etude',

  template: `
    <header class="proj-head">
      <a class="back" href="#/">← Accueil</a>
      <h1>Étude d'échantillon</h1>
    </header>

    <div class="toolbar">
      <label>Échantillon <select id="pick"></select></label>
      <button class="btn ghost" id="from-folder">📂 Depuis le dossier</button>
      <label class="btn ghost file-btn">📄 Ouvrir un fichier<input type="file" id="from-file" accept=".json,.edf" hidden></label>
      <span class="hint" id="load-msg"></span>
    </div>
    <p class="hint" id="info"></p>

    <div class="panel">
      <div class="toolbar">
        <span class="seg" role="radiogroup" aria-label="Affichage">
          <label><input type="radio" name="mode" value="raw"> Brut</label>
          <label><input type="radio" name="mode" value="filtered"> Filtré</label>
          <label><input type="radio" name="mode" value="both" checked> Les deux</label>
        </span>
        <label><input type="checkbox" id="show-ppg" checked> Pouls</label>
        <label><input type="checkbox" id="show-motion" checked> Mouvement</label>
        <span class="seg">
          <button type="button" id="zoom-in" title="Zoom avant">＋</button><button type="button" id="zoom-out" title="Zoom arrière">－</button><button type="button" id="zoom-all">Tout</button><button type="button" id="zoom-sel">Sélection</button>
        </span>
        <span class="hint">Glisse sur le signal pour sélectionner · Ctrl + molette : zoom · double-clic : tout</span>
      </div>
      <div id="viewer"></div>
      <div class="legend-row" id="legend"></div>
      <div class="selbar">
        <b>Sélection</b>
        <label>de <input type="number" id="sel-a" step="0.1" min="0"> s</label>
        <label>à <input type="number" id="sel-b" step="0.1" min="0"> s</label>
        <span id="sel-len" class="hint"></span>
        <button class="btn ghost" id="sel-clear">Effacer</button>
        <button class="btn" id="sel-save">Enregistrer comme nouvel échantillon</button>
        <span class="hint" id="sel-msg"></span>
      </div>
    </div>

    <div class="panel">
      <div class="tabs" role="tablist" id="tabs">
        <button data-tab="artefacts" class="active">Artefacts</button>
        <button data-tab="etats">États mentaux</button>
        <button data-tab="spectre">Spectre</button>
        <button data-tab="spectro">Spectrogramme</button>
        <button data-tab="stats">Bandes et statistiques</button>
        <button data-tab="filtres">Filtres</button>
        <button data-tab="export">Exporter</button>
      </div>
      <p class="hint" id="scope"></p>
      <div class="tab" data-pane="artefacts">
        <div class="toolbar">
          <span class="seg"><label><input type="radio" name="evsrc" value="detected" checked> Re-détectés (réglages actuels)</label><label><input type="radio" name="evsrc" value="stored"> Enregistrés dans l'échantillon</label></span>
        </div>
        <div id="ev-summary" class="chips"></div>
        <table class="kv events-table" id="ev-table"></table>
      </div>
      <div class="tab" data-pane="etats" hidden>
        <div class="toolbar">
          <label>Référence <select id="ref">
            <option value="auto">Médiane de l'échantillon (états relatifs à l'échantillon)</option>
            <option value="saved">Ma référence mesurée (projet État mental)</option>
            <option value="selection">Une portion choisie (la sélection)</option>
          </select></label>
          <button class="btn ghost" id="ref-use-sel">Prendre la sélection actuelle comme référence</button>
        </div>
        <p class="hint" id="ref-info"></p>
        <div id="state-summary"></div>
      </div>
      <div class="tab" data-pane="spectre" hidden><canvas class="study-canvas" id="spec"></canvas><div class="legend-row" id="spec-legend"></div></div>
      <div class="tab" data-pane="spectro" hidden>
        <div class="toolbar"><label>Électrode <select id="sg-ch"></select></label><span class="hint">Temps en abscisse, fréquence (0–45 Hz) en ordonnée, puissance en couleur.</span></div>
        <canvas class="study-canvas" id="sg"></canvas>
      </div>
      <div class="tab" data-pane="stats" hidden><table class="kv stats-table" id="stats"></table></div>
      <div class="tab" data-pane="filtres" hidden>
        <p class="hint">Ces filtres servent à l'affichage « filtré », au spectre, aux bandes et aux états mentaux de cette page. Ils ne modifient pas l'échantillon.</p>
        <div id="stages"></div>
        <button class="btn ghost" id="save-filters">Utiliser ces réglages partout (par défaut)</button>
      </div>
      <div class="tab" data-pane="export" hidden>
        <p class="hint">Exporte la sélection (ou tout l'échantillon s'il n'y a pas de sélection), données telles qu'enregistrées.</p>
        <div class="buttons">
          <button class="btn ghost" data-x="edf">EDF+</button><button class="btn ghost" data-x="bids">Dossier BIDS (.zip)</button>
          <button class="btn ghost" data-x="csv">EEG (CSV)</button><button class="btn ghost" data-x="json">Tout (JSON)</button>
        </div>
      </div>
    </div>`,

  mount(root, { recorder, params }) {
    const $ = (id) => root.querySelector('#' + id);
    const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    const R = 256;
    const EV_COLORS = { blink: '#5b6cff', frown: '#f5b84a', jaw: '#ef6f6c', yawn: '#c06cff', 'gaze-left': '#2fc7b8', 'gaze-right': '#2fc7b8', gap: '#8f98ab' };
    const EV_LABEL = { blink: 'clignement', frown: 'sourcils', jaw: 'mâchoire', yawn: 'bâillement', 'gaze-left': 'regard ←', 'gaze-right': 'regard →', gap: 'interruption' };
    const ST_COLORS = { neutral: '#8f98ab', relaxed: '#7ddc6b', focused: '#f5b84a', drowsy: '#6c8cff', unknown: '#3a4152' };
    const typeOf = (trial) => Object.keys(Recording.EVENT_TYPES).find((k) => Recording.EVENT_TYPES[k] === trial) || trial;

    const pipeline = SignalPipeline.loadSaved(R);
    const viewer = new SignalViewer($('viewer'), { onSelect: () => { syncSelection(); refreshTools(); }, onView: () => {} });
    let rec = null, t = null, raw = null, filtered = null, detected = [], stored = [], timeline = null, refRange = null;
    // États mentaux : calculés sur une copie des filtres SANS la piste « clignements » (MentalState.statePipeline)
    let stateFiltered = null, stateRemoved = [];
    const filterAll = () => {
      filtered = pipeline.processOffline(raw).map((v) => Float32Array.from(v));
      const sp = MentalState.statePipeline(pipeline);
      stateRemoved = sp.removed;
      stateFiltered = sp.removed.length ? sp.pipeline.processOffline(raw).map((v) => Float32Array.from(v)) : filtered;
    };
    const hidden = new Set(); // types d'artefacts masqués (clic sur la légende)
    let current = null;       // source affichée : numéro d'échantillon, 'demo' ou 'fichier'

    /* ---------- Chargement ---------- */

    async function fillPicker(selectN) {
      const list = await recorder.listSamples();
      $('pick').innerHTML = list.map((e) => `<option value="${e.n}">${e.name} (${e.seconds.toFixed(0)} s)</option>`).join('')
        + '<option value="demo">Démonstration (signal fabriqué)</option>';
      if (selectN != null) $('pick').value = String(selectN);
      if ($('pick').selectedIndex < 0) $('pick').value = 'demo';
      return list;
    }

    function demoRecording() {
      const sim = new SignalSimulator({ theta: 6, beta: 4, blinkEveryS: 5, spikePerS: 0.05 }, R, 404), parts = [];
      [[1, 1, 1], [1, 2, 0.8], [0.9, 0.7, 2.6]].forEach(([th, al, be]) => { Object.assign(sim.cfg.gain, { theta: th, alpha: al, beta: be }); parts.push(sim.generate(10 * R)); });
      const eeg = [0, 1, 2, 3].map((c) => [].concat(...parts.map((p) => p[c]))), t0 = Date.now() - 30000;
      const ts = (n, rate) => Float64Array.from({ length: n }, (_, i) => t0 + (i * 1000) / rate);
      const arrays = {
        eeg: eeg.map((v) => ({ t: ts(v.length, R), v: Float32Array.from(v) })),
        ppg: [0, 1, 2].map(() => ({ t: ts(30 * 64, 64), v: Float32Array.from({ length: 30 * 64 }, (_, i) => 100000 + 600 * Math.exp(-((((i / 64) % 0.85 - 0.1) / 0.06) ** 2))) })),
        accel: [{ t: ts(30 * 52, 52), v: Float32Array.from({ length: 30 * 52 * 3 }, (_, i) => (i % 3 === 2 ? 1 : 0.01 * Math.sin(i / 50))) }],
        gyro: [{ t: ts(30 * 52, 52), v: new Float32Array(30 * 52 * 3) }],
      };
      return Recording.fromArrays(arrays, { n: 0, name: 'démonstration', task: 'démonstration : neutre, détendu, concentré (10 s chacun)' });
    }

    async function load(source) {
      $('load-msg').textContent = 'Chargement…';
      try {
        rec = source === 'demo' ? demoRecording() : typeof source === 'object' ? source : await recorder.getSample(+source);
        current = typeof source === 'object' ? 'fichier' : String(source);
        if (!rec) throw new Error('échantillon introuvable');
        analyse();
        $('load-msg').textContent = '';
      } catch (e) {
        console.error(e);
        $('load-msg').textContent = 'Impossible d’ouvrir : ' + e.message;
      }
    }

    // Tous les calculs dépendant de l'échantillon et des réglages
    function analyse() {
      const eeg = rec.streams.eeg, t0 = eeg.t[0];
      t = Float64Array.from(eeg.t, (v) => (v - t0) / 1000);
      raw = eeg.data;
      filterAll();
      detected = ArtifactDetector.detectOffline(raw, eeg.t, { calibration: Calibrator.load(), mainsHz: ArtifactDetector.profileMainsHz() })
        .map((e) => ({ type: e.type, start: (e.start - t0) / 1000, end: (e.start + e.duration - t0) / 1000 }));
      stored = rec.events.map((e) => ({ type: typeOf(e.trial_type), start: e.onset, end: e.onset + e.duration }));
      const d = eeg.t.length / R;
      $('info').textContent = `${rec.name} — ${d.toFixed(1).replace('.', ',')} s, tâche « ${rec.task} », données ${rec.processing.stored}, début ${new Date(rec.startTime).toLocaleString()}`
        + (rec.source ? ` — extrait de ${rec.source.name}` : '') + (rec.notes ? ` — ${rec.notes}` : '');
      computeStates();
      render(true);
    }

    function computeStates() {
      const choice = $('ref').value, saved = Profiles.get('mentalBaseline', null);
      const events = detected.map((e) => ({ type: e.type, onset: e.start, duration: e.end - e.start }));
      const opts = { rate: R, events, raw }; // brut : témoin musculaire (30–45 Hz)
      if (choice === 'saved' && saved) opts.baseline = saved;
      if (choice === 'selection' && refRange) opts.baselineRange = refRange;
      timeline = MentalState.timeline(stateFiltered, opts);
      const thr = timeline.threshold, pc = (s) => '+' + ((Math.exp(s) - 1) * 100).toFixed(0) + ' %';
      const notes = ' Seuils : détente ' + pc(thr.relax) + ', concentration ' + pc(thr.focus) + ', somnolence ' + pc(thr.drowsy)
        + (thr.fromSpread ? ' (2 × la fluctuation de la référence).' : ' (par défaut).')
        + (timeline.muscleGuard ? '' : ' Pas de témoin musculaire avec cette référence : une crispation peut passer pour de la concentration.')
        + (stateRemoved.includes('eog') ? ' Piste « Réduction des clignements » non appliquée aux états (elle efface une partie du theta frontal).' : '');
      $('ref-info').textContent = (choice === 'saved' && !saved ? 'Aucune référence mesurée dans le projet État mental : médiane de l’échantillon utilisée.'
        : choice === 'selection' && !refRange ? 'Sélectionne une portion calme puis clique « Prendre la sélection… ». En attendant : médiane de l’échantillon.'
        : choice === 'selection' ? `Référence : ${refRange[0].toFixed(1)} → ${refRange[1].toFixed(1)} s.`
        : choice === 'saved' ? `Référence mesurée le ${new Date(saved.date).toLocaleString()} (attention : elle dépend de la pose du casque ce jour-là).`
        : 'Référence : médiane de tout l’échantillon. Les états indiquent donc les moments plus détendus / concentrés / somnolents QUE LE RESTE de l’échantillon.') + notes;
    }

    /* ---------- Affichage ---------- */

    const events = () => (root.querySelector('input[name=evsrc]:checked').value === 'stored' ? stored : detected).filter((e) => !hidden.has(e.type === 'gaze-right' ? 'gaze-left' : e.type));

    function render(resetView = false) {
      const mode = root.querySelector('input[name=mode]:checked').value, t0 = rec.streams.eeg.t[0];
      const lanes = Muse.EEG_NAMES.map((name, i) => ({
        name, unit: 'µV', t,
        values: mode === 'filtered' ? filtered[i] : raw[i],
        overlay: mode === 'both' ? filtered[i] : undefined,
      }));
      const ppg = rec.streams.ppg, mot = rec.streams.accel;
      if ($('show-ppg').checked && ppg) lanes.push({ name: 'Pouls (IR)', unit: '', t: Float64Array.from(ppg.t, (v) => (v - t0) / 1000), values: ppg.data[1] });
      if ($('show-motion').checked && mot) lanes.push({ name: 'Mouvement', unit: 'g', t: Float64Array.from(mot.t, (v) => (v - t0) / 1000), values: Float32Array.from(mot.data[0], (x, i) => Math.hypot(x, mot.data[1][i], mot.data[2][i])) });
      const keepView = !resetView && viewer.data ? viewer.view : null, keepSel = resetView ? null : viewer.selection;
      viewer.setData({
        duration: t.length / R, lanes,
        events: events().map((e) => ({ start: e.start, end: Math.max(e.end, e.start + 0.05), label: EV_LABEL[e.type] || e.type, color: EV_COLORS[e.type] || css('--accent') })),
        states: timeline.segments, stateColors: ST_COLORS,
      });
      if (keepView) viewer.setView(...keepView);
      viewer.selection = keepSel;
      viewer.redraw();
      $('legend').innerHTML = Object.entries(EV_LABEL).filter(([k]) => k !== 'gaze-right').map(([k, l]) => `<button type="button" class="legend-toggle ${hidden.has(k) ? 'off' : ''}" data-type="${k}" title="Afficher / masquer"><i style="background:${EV_COLORS[k]}"></i>${k === 'gaze-left' ? 'regard' : l}</button>`).join('')
        + ' · ' + ['relaxed', 'focused', 'drowsy', 'neutral'].map((s) => `<span><i style="background:${ST_COLORS[s]}"></i>${MentalState.STATES[s].label}</span>`).join('');
      syncSelection();
      refreshTools();
    }

    /* ---------- Sélection ---------- */

    const scope = () => viewer.selection || [0, t.length / R];
    const idxRange = ([a, b]) => [Math.max(0, Math.floor(a * R)), Math.min(t.length, Math.ceil(b * R))];

    function syncSelection() {
      const s = viewer.selection;
      $('sel-a').value = s ? s[0].toFixed(2) : '';
      $('sel-b').value = s ? s[1].toFixed(2) : '';
      $('sel-len').textContent = s ? `(${(s[1] - s[0]).toFixed(2).replace('.', ',')} s)` : 'aucune : les outils portent sur tout l’échantillon';
      const [a, b] = scope();
      $('scope').textContent = `Analyse portant sur ${s ? 'la sélection' : 'tout l’échantillon'} : ${a.toFixed(2).replace('.', ',')} → ${b.toFixed(2).replace('.', ',')} s.`;
    }

    ['sel-a', 'sel-b'].forEach((id) => ($(id).onchange = () => {
      const a = +$('sel-a').value, b = +$('sel-b').value;
      if (b - a > 0.1) viewer.setSelection(a, b);
    }));
    $('sel-clear').onclick = () => viewer.setSelection(null);
    $('zoom-in').onclick = () => { const [a, b] = viewer.view, m = (a + b) / 2, w = (b - a) / 2.5; viewer.setView(m - w, m + w); };
    $('zoom-out').onclick = () => { const [a, b] = viewer.view, m = (a + b) / 2, w = b - a; viewer.setView(m - w, m + w); };
    $('zoom-all').onclick = () => viewer.setView(0, t.length / R);
    $('zoom-sel').onclick = () => { if (viewer.selection) { const [a, b] = viewer.selection, m = (b - a) * 0.1; viewer.setView(a - m, b + m); } };

    $('sel-save').onclick = async () => {
      const [a, b] = scope();
      if (b - a < 1) { $('sel-msg').textContent = 'Sélection trop courte (au moins 1 s).'; return; }
      let folder = null;
      try { folder = await SampleFolder.obtain(); } catch (e) { folder = null; } // demandé pendant le clic
      const n = await recorder.nextSampleNumber();
      const sub = Recording.slice(rec, a, b, { n, name: SignalRecorder.sampleName(n) });
      await recorder.saveRecording(sub);
      let where = 'dans le navigateur';
      if (folder) { try { await SampleFolder.write(sub, folder); where += ` et dans « ${folder.name} »`; } catch (e) { where += ` (dossier : ${e.message})`; } }
      await fillPicker(current === 'fichier' ? null : current);
      $('load-msg').textContent = '';
      $('sel-msg').innerHTML = `Enregistré ${where} : <a href="#/p/etude/${n}">${sub.name}</a>`;
    };

    /* ---------- Outils ---------- */

    root.querySelector('#tabs').onclick = (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      root.querySelectorAll('#tabs [data-tab]').forEach((x) => x.classList.toggle('active', x === b));
      root.querySelectorAll('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.tab));
      refreshTools();
    };
    const activeTab = () => root.querySelector('#tabs .active').dataset.tab;
    const analysed = () => (root.querySelector('input[name=mode]:checked').value === 'raw' ? raw : filtered);

    function refreshTools() {
      if (!rec) return;
      const tab = activeTab(), [a, b] = scope(), [i0, i1] = idxRange([a, b]);
      if (tab === 'artefacts') toolArtefacts(a, b);
      if (tab === 'etats') toolStates(a, b);
      if (tab === 'spectre') toolSpectrum(i0, i1);
      if (tab === 'spectro') toolSpectrogram(i0, i1, a);
      if (tab === 'stats') toolStats(i0, i1);
    }

    function toolArtefacts(a, b) {
      const list = events().filter((e) => e.end > a && e.start < b);
      const counts = {};
      list.forEach((e) => (counts[e.type] = (counts[e.type] || 0) + 1));
      $('ev-summary').innerHTML = Object.keys(counts).length
        ? Object.entries(counts).map(([k, n]) => `<span class="chip" style="border-color:${EV_COLORS[k]}">${EV_LABEL[k] || k} : <b>${n}</b></span>`).join('')
        : '<span class="hint">Aucun artefact dans cette portion.</span>';
      $('ev-table').innerHTML = list.length ? '<tr><th>Type</th><th>Début</th><th>Durée</th><th></th></tr>' + list.map((e, i) =>
        `<tr><td><i class="dot-ev" style="background:${EV_COLORS[e.type]}"></i>${EV_LABEL[e.type] || e.type}</td><td>${e.start.toFixed(2).replace('.', ',')} s</td><td>${((e.end - e.start) * 1000).toFixed(0)} ms</td><td><button class="link" data-ev="${i}">voir</button></td></tr>`).join('') : '';
      $('ev-table').onclick = (ev) => {
        const btn = ev.target.closest('[data-ev]');
        if (!btn) return;
        const e = list[+btn.dataset.ev];
        viewer.setView(e.start - 2, e.end + 2);
        viewer.setSelection(Math.max(0, e.start - 0.25), e.end + 0.25);
      };
    }

    function toolStates(a, b) {
      const segs = timeline.segments.filter((s) => s.end > a && s.start < b), total = segs.length || 1;
      const count = {};
      segs.forEach((s) => { const k = s.paused ? 'paused' : s.state; count[k] = (count[k] || 0) + 1; });
      const order = ['relaxed', 'focused', 'drowsy', 'neutral', 'unknown', 'paused'];
      $('state-summary').innerHTML = `<div class="state-bar">${order.filter((k) => count[k]).map((k) => `<span style="flex:${count[k]};background:${k === 'paused' ? 'rgba(143,152,171,0.25)' : ST_COLORS[k]}" title="${k}"></span>`).join('')}</div>`
        + '<table class="kv">' + order.filter((k) => count[k]).map((k) => `<tr><td>${k === 'paused' ? '⏸ Suspendu (artefact)' : MentalState.STATES[k].emoji + ' ' + MentalState.STATES[k].label}</td><td>${count[k]} s · ${((100 * count[k]) / total).toFixed(0)} %</td></tr>`).join('') + '</table>'
        + '<p class="hint">États calculés seconde par seconde sur des fenêtres de 4 s du signal filtré (sans la piste « clignements ») ; dans chaque fenêtre, les segments de 1 s touchés par un clignement, un regard ou un froncement sont retirés pour les électrodes du front, ceux touchés par la mâchoire pour les tempes. Bande « États » sous le signal.</p>';
    }

    function toolSpectrum(i0, i1) {
      const c = $('spec'), d = window.devicePixelRatio || 1;
      c.style.height = '240px';
      const w = (c.width = Math.round(c.clientWidth * d)), h = (c.height = Math.round(240 * d)), g = c.getContext('2d');
      g.font = `${11 * d}px system-ui`;
      const data = analysed(), colors = ['#5b6cff', '#2fc7b8', '#f5b84a', '#ef6f6c'];
      if (i1 - i0 < R) { g.fillStyle = css('--muted'); g.fillText('Sélection trop courte pour un spectre (au moins 1 s).', 10 * d, 20 * d); return; }
      const specs = data.map((v) => Signal.welch(v.subarray(i0, i1), R));
      const db = (p) => 10 * Math.log10(p + 1e-6), fMax = 60;
      const all = specs.flatMap((s) => s.psd.filter((_, k) => s.freqs[k] > 0.5 && s.freqs[k] <= fMax).map(db));
      const top = Math.ceil(Math.max(...all) / 10) * 10, bottom = top - 60, L = 40 * d, B = 18 * d;
      const X = (f) => L + (f / fMax) * (w - L - 6 * d), Y = (v) => (1 - (Math.max(bottom, v) - bottom) / (top - bottom)) * (h - B - 4 * d) + 4 * d;
      Signal.BANDS.forEach((bd) => { g.fillStyle = bd.color + '18'; g.fillRect(X(bd.range[0]), 0, X(bd.range[1]) - X(bd.range[0]), h - B); });
      g.strokeStyle = css('--line'); g.fillStyle = css('--muted'); g.lineWidth = d;
      for (let f = 0; f <= fMax; f += 10) { g.beginPath(); g.moveTo(X(f), 0); g.lineTo(X(f), h - B); g.stroke(); g.fillText(f + ' Hz', X(f) - 10 * d, h - 4 * d); }
      for (let v = bottom; v <= top; v += 20) { g.fillText(v + ' dB', 2 * d, Y(v) + 4 * d); }
      specs.forEach((s, ci) => {
        g.strokeStyle = colors[ci]; g.lineWidth = 1.6 * d; g.beginPath();
        s.freqs.forEach((f, k) => { if (f < 0.5 || f > fMax) return; const x = X(f), y = Y(db(s.psd[k])); k === 1 ? g.moveTo(x, y) : g.lineTo(x, y); });
        g.stroke();
      });
      $('spec-legend').innerHTML = Muse.EEG_NAMES.map((n, i) => `<span><i style="background:${colors[i]}"></i>${n}</span>`).join('') + ` · signal ${root.querySelector('input[name=mode]:checked').value === 'raw' ? 'brut' : 'filtré'} (méthode de Welch)`;
    }

    function toolSpectrogram(i0, i1, a) {
      const c = $('sg'), d = window.devicePixelRatio || 1;
      c.style.height = '240px';
      const w = (c.width = Math.round(c.clientWidth * d)), h = (c.height = Math.round(240 * d)), g = c.getContext('2d');
      g.font = `${11 * d}px system-ui`;
      const ch = +$('sg-ch').value, v = analysed()[ch].subarray(i0, i1);
      if (v.length < R) { g.fillStyle = css('--muted'); g.fillText('Sélection trop courte (au moins 1 s).', 10 * d, 20 * d); return; }
      const sg = Signal.spectrogram(v, R, { win: 256, step: Math.max(8, Math.floor(v.length / 300)), fMax: 45 });
      const all = sg.db.flat().sort((x, y) => x - y), lo = all[Math.floor(all.length * 0.05)], hi = all[Math.floor(all.length * 0.995)];
      const L = 40 * d, B = 18 * d, cw = (w - L) / sg.times.length, chh = (h - B) / sg.freqs.length;
      const color = (x) => { // bleu nuit -> violet -> orange -> jaune
        const s = Math.max(0, Math.min(1, (x - lo) / (hi - lo || 1)));
        const stops = [[13, 8, 135], [126, 3, 168], [204, 71, 120], [248, 149, 64], [240, 249, 33]], p = s * 4, i = Math.min(3, Math.floor(p)), f = p - i;
        return `rgb(${stops[i].map((c0, j) => Math.round(c0 + (stops[i + 1][j] - c0) * f)).join(',')})`;
      };
      sg.db.forEach((row, ti) => row.forEach((val, fi) => { g.fillStyle = color(val); g.fillRect(L + ti * cw, h - B - (fi + 1) * chh, cw + 1, chh + 1); }));
      g.fillStyle = css('--muted');
      [0, 10, 20, 30, 40].forEach((f) => g.fillText(f + ' Hz', 2 * d, h - B - (f / sg.freqs[sg.freqs.length - 1]) * (h - B) + 4 * d));
      const span = v.length / R;
      for (let k = 0; k <= 4; k++) g.fillText((a + (k * span) / 4).toFixed(1).replace('.', ',') + ' s', L + (k / 4) * (w - L) - 12 * d, h - 3 * d);
    }

    function toolStats(i0, i1) {
      const data = analysed(), rows = Muse.EEG_NAMES.map((n, i) => {
        const v = data[i].subarray(i0, i1), st = Signal.stats(v);
        const rel = v.length >= R ? Signal.bandPowersFromPsd(Signal.welch(v, R)) : Signal.BANDS.map(() => NaN);
        return { n, st, rel };
      });
      const f = (x, k = 1) => (isFinite(x) ? x.toFixed(k).replace('.', ',') : '–');
      $('stats').innerHTML = `<tr><th>Électrode</th><th title="Écart-type autour de la moyenne (le décalage continu est exclu)">écart-type (µV)</th><th>crête à crête</th><th>min</th><th>max</th>${Signal.BANDS.map((b) => `<th style="color:${b.color}">${b.name}</th>`).join('')}</tr>`
        + rows.map((r) => `<tr><td>${r.n}</td><td>${f(r.st.std)}</td><td>${f(r.st.ptp)}</td><td>${f(r.st.min)}</td><td>${f(r.st.max)}</td>${r.rel.map((p) => `<td>${f(100 * p, 0)} %</td>`).join('')}</tr>`).join('')
        + `<tr><td colspan="9" class="hint">Signal ${root.querySelector('input[name=mode]:checked').value === 'raw' ? 'brut' : 'filtré'} ; parts des bandes sur 1–45 Hz (Welch).</td></tr>`;
    }

    /* ---------- Réglages ---------- */

    $('sg-ch').innerHTML = Muse.EEG_NAMES.map((n, i) => `<option value="${i}" ${i === 1 ? 'selected' : ''}>${n}</option>`).join('');
    $('sg-ch').onchange = refreshTools;
    root.querySelectorAll('input[name=mode], #show-ppg, #show-motion').forEach((x) => (x.onchange = () => render()));
    root.querySelectorAll('input[name=evsrc]').forEach((x) => (x.onchange = () => render()));
    $('legend').onclick = (e) => {
      const b = e.target.closest('[data-type]');
      if (!b) return;
      hidden.has(b.dataset.type) ? hidden.delete(b.dataset.type) : hidden.add(b.dataset.type);
      render();
    };
    $('ref').onchange = () => { computeStates(); render(); };
    $('ref-use-sel').onclick = () => {
      if (!viewer.selection || viewer.selection[1] - viewer.selection[0] < 5) { $('ref-info').textContent = 'Sélectionne d’abord au moins 5 s calmes sur le signal.'; return; }
      refRange = [...viewer.selection];
      $('ref').value = 'selection';
      computeStates(); render();
    };
    new PipelinePanel($('stages'), pipeline, () => { if (!rec) return; filterAll(); computeStates(); render(); });
    $('save-filters').onclick = () => { pipeline.save(); $('save-filters').textContent = 'Réglages enregistrés ✓'; };

    root.querySelectorAll('[data-x]').forEach((b) => (b.onclick = () => {
      const [a, c] = scope(), part = viewer.selection ? Recording.slice(rec, a, c, { name: rec.name + `-${a.toFixed(1)}-${c.toFixed(1)}s` }) : rec;
      const save = (data, name, type) => { const l = document.createElement('a'); l.href = URL.createObjectURL(new Blob([data], { type })); l.download = name; l.click(); setTimeout(() => URL.revokeObjectURL(l.href), 1000); };
      const k = b.dataset.x;
      if (k === 'edf') save(EdfWriter.write(part), part.name + '.edf', 'application/octet-stream');
      if (k === 'bids') save(Bids.zip(part), part.name + '-bids.zip', 'application/zip');
      if (k === 'csv') save(Recording.toCSV(part, 'eeg'), part.name + '-eeg.csv', 'text/csv');
      if (k === 'json') save(Recording.toJSON(part), part.name + '.muse2.json', 'application/json');
    }));

    /* ---------- Sources ---------- */

    $('pick').onchange = () => load($('pick').value === 'demo' ? 'demo' : $('pick').value);
    $('from-folder').onclick = async () => {
      if (!SampleFolder.supported()) { $('load-msg').textContent = 'Ce navigateur ne permet pas d’ouvrir un dossier.'; return; }
      let folder = null;
      try { folder = await SampleFolder.obtain(); } catch (e) { $('load-msg').textContent = e.message; return; }
      if (!folder) { $('load-msg').textContent = 'Dossier non choisi ou accès refusé.'; return; }
      const files = await SampleFolder.list(folder);
      if (!files.length) { $('load-msg').textContent = `Aucun échantillon dans « ${folder.name} »/sourcedata.`; return; }
      $('load-msg').innerHTML = `Dans « ${folder.name} » : <select id="folder-pick">${files.map((f) => `<option>${f.file}</option>`).join('')}</select> <button class="btn ghost" id="folder-open">Ouvrir</button>`;
      $('folder-open').onclick = async () => load(await SampleFolder.read($('folder-pick').value, folder));
    };
    $('from-file').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        load(f.name.toLowerCase().endsWith('.edf') ? Recording.fromEdf(new Uint8Array(await f.arrayBuffer()), { n: 0, name: f.name.replace(/\.edf$/i, '') }) : Recording.fromJSON(await f.text()));
      } catch (err) { $('load-msg').textContent = 'Fichier illisible : ' + err.message; }
    };

    (async () => {
      const wanted = params && params[0];
      const list = await fillPicker(wanted);
      if (wanted) load(wanted);
      else if (list.length) { $('pick').value = String(list[0].n); load(list[0].n); }
      else { $('pick').value = 'demo'; load('demo'); $('load-msg').textContent = 'Aucun échantillon enregistré : démonstration affichée. Crée un échantillon depuis le menu ⏺ en haut.'; }
    })();

    return () => viewer.destroy();
  },
});
