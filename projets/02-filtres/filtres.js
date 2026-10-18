/* Projet « Amélioration numérique du signal » : compare le signal brut et le signal filtré par les pistes
 * activées (lib/filters.js), en temps réel, sur le casque ou sur un signal de démonstration (lib/simulator.js).
 * Chargé à la demande par app/shell.js ; se nettoie entièrement au démontage. */
Projets.register({
  id: 'filtres',

  template: `
    <header class="proj-head">
      <a class="back" href="#/">← Accueil</a>
      <h1>Amélioration numérique du signal</h1>
    </header>
    <p class="intro">Active ou désactive chaque piste d'amélioration et regarde l'effet immédiat sur le tracé, le spectre et les mesures.
    Sans casque, le mode « Démonstration » fabrique un signal avec les défauts typiques (dérive, secteur 50 Hz, clignements, pics).
    Les réglages sont mémorisés et repris par l'interrupteur « Amélioration numérique » de Capteurs en direct et par l'aperçu des échantillons.</p>

    <div class="toolbar">
      <span class="seg" role="radiogroup" aria-label="Source du signal">
        <label><input type="radio" name="src" value="muse"> Casque</label>
        <label><input type="radio" name="src" value="demo"> Démonstration</label>
      </span>
      <label>Canal <select id="channel"></select></label>
      <span class="hint" id="src-msg"></span>
    </div>

    <div class="grid">
      <div class="stack">
        <div class="panel">
          <h2>Signal brut <span class="scale" id="scale-raw"></span></h2>
          <canvas class="trace" id="raw"></canvas>
          <h2 style="margin-top:12px">Signal amélioré <span class="scale" id="scale-clean"></span></h2>
          <canvas class="trace" id="clean"></canvas>
        </div>
        <div class="panel">
          <h2>Spectres (dB, même échelle pour les quatre)</h2>
          <div class="spec-grid">
            <span></span><b>Instantané (1 s)</b><b>Stabilisé (Welch, 4 s)</b>
            <b class="spec-row">Brut</b><canvas class="spectrum" id="sp-raw-fft"></canvas><canvas class="spectrum" id="sp-raw-welch"></canvas>
            <b class="spec-row">Amélioré</b><canvas class="spectrum" id="sp-clean-fft"></canvas><canvas class="spectrum" id="sp-clean-welch"></canvas>
          </div>
          <p class="hint">Colonnes : une seule FFT sur la dernière seconde (réactive mais très bruitée) contre la moyenne de Welch sur 4 s (stable). Lignes : avant et après les pistes activées. Bande rosée : fréquence du secteur.</p>
        </div>
        <div class="panel">
          <h2>Bandes de fréquences (part de chaque bande, 1–45 Hz)</h2>
          <div class="spec-grid band-grid">
            <span></span><b>Instantané (1 s)</b><b>Stabilisé (Welch, 4 s)</b>
            <b class="spec-row">Brut</b><div id="bd-raw-fft"></div><div id="bd-raw-welch"></div>
            <b class="spec-row">Amélioré</b><div id="bd-clean-fft"></div><div id="bd-clean-welch"></div>
          </div>
          <p class="hint">Mêmes quatre combinaisons que les spectres. À comparer : de haut en bas, l'effet des filtres sur chaque bande (le passe-bas réduit le gamma ; un clignement dans la fenêtre gonfle le delta) ; de gauche à droite, des parts qui sautent d'une seconde à l'autre contre des parts stables. La dérive (&lt; 1 Hz) est hors des bandes.</p>
        </div>
        <div class="panel">
          <h2>Effet mesuré (4 dernières secondes)</h2>
          <table class="kv metrics">
            <tr><th></th><th>brut</th><th>amélioré</th><th>effet</th></tr>
            <tr><td>Amplitude (rms)</td><td id="m-rms-r">–</td><td id="m-rms-c">–</td><td id="m-rms-e">–</td></tr>
            <tr><td>Parasite secteur</td><td id="m-mains-r">–</td><td id="m-mains-c">–</td><td id="m-mains-e">–</td></tr>
            <tr><td>Dérive (&lt; 1 Hz)</td><td id="m-drift-r">–</td><td id="m-drift-c">–</td><td id="m-drift-e">–</td></tr>
            <tr><td>Rythmes alpha + bêta (8–30 Hz)</td><td id="m-eeg-r">–</td><td id="m-eeg-c">–</td><td id="m-eeg-e">–</td></tr>
          </table>
          <p class="hint">Puissances en µV² (méthode de Welch). L'idéal : secteur et dérive fortement réduits, rythmes 8–30 Hz conservés (proche de 100 %).</p>
        </div>
      </div>
      <div class="stack">
        <div class="panel"><h2>Pistes d'amélioration</h2><div id="stages"></div></div>
      </div>
    </div>`,

  mount(root, { muse }) {
    const $ = (id) => root.querySelector('#' + id);
    const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    const R = Muse.EEG_RATE, WINDOW = 4 * R;

    const pipeline = SignalPipeline.loadSaved(R); // derniers réglages choisis (partagés avec les autres projets)
    const simulator = new SignalSimulator();
    const raw = [0, 1, 2, 3].map(() => []), clean = [0, 1, 2, 3].map(() => []);
    let source = null, unsubscribeSource = null;

    $('channel').innerHTML = Muse.EEG_NAMES.map((n, i) => `<option value="${i}" ${i === 1 ? 'selected' : ''}>${n}</option>`).join('');
    const BAND_CELLS = ['bd-raw-fft', 'bd-raw-welch', 'bd-clean-fft', 'bd-clean-welch'];
    BAND_CELLS.forEach((cell) => {
      $(cell).innerHTML = Signal.BANDS.map((b, i) => `
        <div class="bar"><span>${b.name}</span>
        <div class="track"><div class="fill" id="${cell}-${i}" style="background:${b.color}"></div></div>
        <span class="val" id="${cell}-v${i}">–</span></div>`).join('');
    });

    const clearBuffers = () => { raw.forEach((b) => (b.length = 0)); clean.forEach((b) => (b.length = 0)); };
    new PipelinePanel($('stages'), pipeline, () => { pipeline.save(); pipeline.reset(); clearBuffers(); });

    const push = (buf, vals) => { buf.push(...vals); if (buf.length > WINDOW) buf.splice(0, buf.length - WINDOW); };
    pipeline.onSamples = (r, c) => { for (let ch = 0; ch < 4; ch++) { push(raw[ch], r[ch]); push(clean[ch], c[ch]); } };

    /* ---------- Source : casque ou démonstration ---------- */

    function setSource(src) {
      if (unsubscribeSource) unsubscribeSource();
      simulator.stop();
      source = src;
      pipeline.reset();
      clearBuffers();
      root.querySelectorAll('input[name=src]').forEach((r) => (r.checked = r.value === src));
      const feed = (ch, s) => pipeline.feed(ch, s);
      if (src === 'demo') { unsubscribeSource = simulator.on('eeg', feed); simulator.start(); }
      else unsubscribeSource = muse.on('eeg', feed);
      updateSourceMsg();
    }

    function updateSourceMsg() {
      $('src-msg').textContent = source === 'demo'
        ? 'Signal fabriqué : les amplitudes sont des ordres de grandeur, pas une vraie mesure.'
        : muse.connected ? '' : 'Casque non connecté : connecte-le en haut à droite, ou passe en démonstration.';
    }

    root.querySelectorAll('input[name=src]').forEach((r) => (r.onchange = () => setSource(r.value)));
    const offState = muse.on('state', (state) => { if (state === 'connected' && source === 'muse') { pipeline.reset(); clearBuffers(); } updateSourceMsg(); });
    setSource(muse.connected ? 'muse' : 'demo');

    /* ---------- Dessin ---------- */

    function fit(canvas) {
      const r = devicePixelRatio || 1;
      const w = Math.round(canvas.clientWidth * r), h = Math.round(canvas.clientHeight * r);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      return canvas.getContext('2d');
    }

    // Tracé centré, échelle automatique arrondie (affichée à côté du titre)
    function trace(canvas, data, color, scaleEl) {
      const ctx = fit(canvas), w = canvas.width, h = canvas.height, dpr = devicePixelRatio || 1;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = css('--line'); ctx.lineWidth = dpr;
      ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
      if (data.length < 2) { scaleEl.textContent = ''; return; }
      const d = Signal.centered(data);
      const peak = Math.max(...d.map(Math.abs)) || 1;
      const amp = [10, 20, 50, 100, 200, 500, 1000, 2000].find((v) => v >= peak) || peak;
      scaleEl.textContent = `±${amp} µV`;
      ctx.strokeStyle = color; ctx.lineWidth = 1.3 * dpr;
      ctx.beginPath();
      d.forEach((v, i) => {
        const x = (i / (WINDOW - 1)) * w, y = h / 2 - (v / amp) * (h / 2 - 2);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
    }

    const db = (p) => 10 * Math.log10(p + 1e-6);

    // Un spectre dans son canvas ; `top` (dB) est commun aux quatre graphiques pour qu'ils soient comparables.
    function spectrum(canvas, spec, color, top) {
      const ctx = fit(canvas), w = canvas.width, h = canvas.height, dpr = devicePixelRatio || 1;
      const padL = 30 * dpr, padB = 16 * dpr, fMax = R / 2;
      ctx.clearRect(0, 0, w, h);
      if (!spec) return;
      const bottom = top - 70;
      const X = (f) => padL + (f / fMax) * (w - padL), Y = (v) => (1 - (Math.max(v, bottom) - bottom) / (top - bottom)) * (h - padB);
      ctx.font = `${10 * dpr}px system-ui`; ctx.fillStyle = css('--muted'); ctx.strokeStyle = css('--line'); ctx.lineWidth = dpr;
      for (let f = 0; f <= fMax; f += 40) { ctx.beginPath(); ctx.moveTo(X(f), 0); ctx.lineTo(X(f), h - padB); ctx.stroke(); ctx.fillText(f + ' Hz', X(f) - (f ? 14 : 0) * dpr, h - 4 * dpr); }
      for (let v = bottom; v <= top; v += 20) { ctx.beginPath(); ctx.moveTo(padL, Y(v)); ctx.lineTo(w, Y(v)); ctx.stroke(); ctx.fillText(v, 2 * dpr, Y(v) + 4 * dpr); }
      const mains = pipeline.getParam('notch');
      ctx.fillStyle = 'rgba(214,69,69,0.12)'; ctx.fillRect(X(mains - 1), 0, X(mains + 1) - X(mains - 1), h - padB);
      const line = (spec, color) => {
        ctx.strokeStyle = color; ctx.lineWidth = 1.5 * dpr; ctx.beginPath();
        spec.psd.forEach((p, k) => { if (!k) return; const x = X(spec.freqs[k]), y = Y(db(p)); k === 1 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
        ctx.stroke();
      };
      line(spec, color);
    }

    let frame = requestAnimationFrame(function draw() {
      const ch = +$('channel').value;
      trace($('raw'), raw[ch], css('--muted'), $('scale-raw'));
      trace($('clean'), clean[ch], css('--accent'), $('scale-clean'));
      frame = requestAnimationFrame(draw);
    });

    /* ---------- Mesures et bandes (2 fois par seconde) ---------- */

    const fmt = (v) => (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2));
    const dbChange = (a, b) => { const d = 10 * Math.log10((b + 1e-9) / (a + 1e-9)); return (d > 0 ? '+' : '') + d.toFixed(0) + ' dB'; };

    function analyse() {
      const ch = +$('channel').value;
      const ids = ['sp-raw-fft', 'sp-raw-welch', 'sp-clean-fft', 'sp-clean-welch'];
      if (raw[ch].length < 2 * R || clean[ch].length < 2 * R) { ids.forEach((id) => spectrum($(id))); return; }
      const sr = Signal.welch(raw[ch], R), sc = Signal.welch(clean[ch], R);           // stabilisés (Welch, 4 s)
      const fr = Signal.welch(raw[ch].slice(-R), R), fc = Signal.welch(clean[ch].slice(-R), R); // 1 seule FFT (1 s, Hann)
      const top = Math.ceil(Math.max(...[sr, sc, fr, fc].flatMap((s) => s.psd.slice(1).map(db))) / 10) * 10;
      spectrum($('sp-raw-fft'), fr, css('--muted'), top);
      spectrum($('sp-raw-welch'), sr, css('--muted'), top);
      spectrum($('sp-clean-fft'), fc, css('--accent'), top);
      spectrum($('sp-clean-welch'), sc, css('--accent'), top);
      const mains = pipeline.getParam('notch');
      const rms = (a) => { const d = Signal.centered(a); return Math.sqrt(d.reduce((s, v) => s + v * v, 0) / d.length); };
      const rows = {
        rms: [rms(raw[ch]), rms(clean[ch]), ' µV'],
        mains: [Signal.powerBetween(sr, mains - 1, mains + 2), Signal.powerBetween(sc, mains - 1, mains + 2), ''],
        drift: [Signal.powerBetween(Signal.welch(raw[ch], R, WINDOW), 0.2, 1), Signal.powerBetween(Signal.welch(clean[ch], R, WINDOW), 0.2, 1), ''], // 1 seul segment de 4 s : résolution 0,25 Hz
        eeg: [Signal.powerBetween(sr, 8, 30), Signal.powerBetween(sc, 8, 30), ''],
      };
      for (const [k, [a, b, unit]] of Object.entries(rows)) {
        $(`m-${k}-r`).textContent = fmt(a) + unit;
        $(`m-${k}-c`).textContent = fmt(b) + unit;
        $(`m-${k}-e`).textContent = k === 'eeg' ? `${((100 * b) / (a || 1)).toFixed(0)} % conservé` : k === 'rms' ? `×${(b / (a || 1)).toFixed(2)}` : dbChange(a, b);
      }
      [fr, sr, fc, sc].forEach((spec, k) => {
        Signal.bandPowersFromPsd(spec).forEach((p, i) => {
          $(`${BAND_CELLS[k]}-${i}`).style.width = (p * 100).toFixed(0) + '%';
          $(`${BAND_CELLS[k]}-v${i}`).textContent = (p * 100).toFixed(0) + ' %';
        });
      });
    }
    const timer = setInterval(analyse, 500);

    /* ---------- Nettoyage ---------- */

    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
      simulator.stop();
      if (unsubscribeSource) unsubscribeSource();
      offState();
    };
  },
});
