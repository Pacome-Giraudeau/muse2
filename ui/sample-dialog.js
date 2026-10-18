/* Fenêtre « Nouvel échantillon » (globale `SampleDialog`) : aperçu de la mémoire figée AVANT enregistrement,
 * réglages (nom, tâche, notes, recadrage, contenu, filtres, événements) puis création de l'échantillon.
 *
 *   SampleDialog.open(recorder, { onSaved: (meta) => {} });
 *
 * La mémoire est copiée à l'ouverture (recorder.freeze()) : l'aperçu montre exactement ce qui sera enregistré, même
 * si le casque continue d'envoyer du signal. Le format enregistré est lib/recording.js (aligné sur BIDS).
 * Les filtres choisis servent à l'aperçu ; ils ne modifient les données enregistrées que si l'on choisit « filtrées ».
 * Durée gardée : champ « Durée » et boutons rapides (5, 10, 15, 20 s, tout), curseurs début / fin, ou glisser sur l'aperçu.
 * Enregistrement : dans le navigateur ET, si le dossier muse2/echantillons a été choisi, sur le disque (lib/sample-folder.js).
 */
class SampleDialog {
  static TASKS = ['repos yeux ouverts', 'repos yeux fermés', 'méditation', 'concentration', 'clignements', 'mâchoire', 'regards', 'libre'];
  static EVENT_COLORS = { blink: '#5b6cff', frown: '#f5b84a', jaw: '#ef6f6c', yawn: '#c06cff', 'gaze-left': '#2fc7b8', 'gaze-right': '#2fc7b8' };

  static async open(recorder, { onSaved = () => {} } = {}) {
    const dlg = new SampleDialog(recorder, onSaved);
    await dlg._init();
    return dlg;
  }

  constructor(recorder, onSaved) {
    this.recorder = recorder;
    this.onSaved = onSaved;
  }

  async _init() {
    this.arrays = this.recorder.freeze();
    const eeg = this.arrays.eeg, len = Math.min(...eeg.map((c) => c.t.length));
    if (len < 256) { alert('Moins d’une seconde de signal en mémoire : connecte le casque et patiente un peu.'); return; }
    this.len = len;
    this.t = eeg[0].t.subarray(0, len);
    this.raw = eeg.map((c) => c.v.subarray(0, len));
    this.total = len / 256;
    this.n = await this.recorder.nextSampleNumber();
    this.createdAt = new Date();
    this.pipeline = SignalPipeline.loadSaved(); // réglages du projet « Amélioration numérique »
    this.events = ArtifactDetector.detectOffline(this.raw, this.t, { calibration: Calibrator.load(), mainsHz: ArtifactDetector.profileMainsHz() });
    this._build();
    this._refilter();
  }

  /* ---------- Construction ---------- */

  _build() {
    const counts = {};
    this.events.forEach((e) => (counts[e.type] = (counts[e.type] || 0) + 1));
    const evSummary = Object.entries(counts).map(([k, v]) => `${v} ${Recording.EVENT_TYPES[k]}`).join(', ') || 'aucun';
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-label="Nouvel échantillon">
        <header class="modal-head">
          <h2>Nouvel échantillon</h2>
          <span class="hint">${this.total.toFixed(1).replace('.', ',')} s figées le ${this.createdAt.toLocaleTimeString()}</span>
          <button class="btn ghost" data-close aria-label="Fermer">✕</button>
        </header>
        <div class="modal-body">
          <section class="modal-main">
            <div class="toolbar">
              <span class="seg" role="radiogroup" aria-label="Affichage">
                <label><input type="radio" name="view" value="raw"> Brut</label>
                <label><input type="radio" name="view" value="filtered"> Filtré</label>
                <label><input type="radio" name="view" value="both" checked> Les deux</label>
              </span>
              <span class="hint">Lignes : 4 électrodes EEG, puis pouls et mouvement s'ils sont inclus. Repères en haut : événements détectés.</span>
            </div>
            <canvas class="sample-preview" data-preview></canvas>
            <div class="crop">
              <label>Durée gardée <input type="number" data-dur min="1" max="${this.total}" step="0.5" value="${this.total}"> s</label>
              <span class="seg" data-quick>${[5, 10, 15, 20].filter((s) => s < this.total).map((s) => `<button type="button" data-q="${s}">${s} s</button>`).join('')}<button type="button" data-q="all">tout</button></span>
              <span class="hint">ou glisse sur l'aperçu</span>
            </div>
            <div class="crop">
              <label>Début <input type="range" data-crop-start min="0" max="${this.total}" step="0.25" value="0"> <b data-start-val></b></label>
              <label>Fin <input type="range" data-crop-end min="0" max="${this.total}" step="0.25" value="${this.total}"> <b data-end-val></b></label>
              <span data-duration></span>
            </div>
            <h3 class="sub">Filtres (aperçu, et enregistrement si « filtrées »)</h3>
            <div data-stages></div>
          </section>
          <aside class="modal-side">
            <fieldset>
              <legend>Identification</legend>
              <label>Nom <input type="text" data-name value="${SignalRecorder.sampleName(this.n, this.createdAt)}"></label>
              <label>Tâche <input type="text" data-task list="sample-tasks" value="libre"></label>
              <datalist id="sample-tasks">${SampleDialog.TASKS.map((t) => `<option value="${t}">`).join('')}</datalist>
              <label>Notes <textarea data-notes rows="3" placeholder="Conditions, ressenti, consignes…"></textarea></label>
            </fieldset>
            <fieldset>
              <legend>Contenu</legend>
              <label><input type="checkbox" data-ppg checked> Pouls (PPG)</label>
              <label><input type="checkbox" data-motion checked> Mouvement (accéléromètre, gyroscope)</label>
              <label><input type="checkbox" data-events checked> Événements détectés : ${evSummary}</label>
              <label>Secteur électrique <select data-mains><option value="50" selected>50 Hz</option><option value="60">60 Hz</option></select></label>
            </fieldset>
            <fieldset>
              <legend>Données enregistrées</legend>
              <label><input type="radio" name="stored" value="raw" checked> Brutes (recommandé : tout reste possible ensuite)</label>
              <label><input type="radio" name="stored" value="filtered"> Filtrées avec les réglages ci-contre</label>
              <p class="hint">Dans les deux cas, le format est aligné sur la norme BIDS ; export possible en EDF+ et en dossier BIDS (.zip). Les filtres appliqués sont décrits dans l'échantillon.</p>
            </fieldset>
            <fieldset>
              <legend>Dossier du projet</legend>
              <p class="hint" data-folder-info>…</p>
              <button type="button" class="btn ghost" data-folder-choose>Choisir le dossier muse2/echantillons</button>
            </fieldset>
          </aside>
        </div>
        <footer class="modal-foot">
          <span class="hint" data-msg></span>
          <button class="btn ghost" data-cancel>Annuler</button>
          <button class="btn" data-save>Enregistrer l'échantillon</button>
        </footer>
      </div>`;
    document.body.appendChild(back);
    this.el = back;
    const q = (s) => back.querySelector(s);
    this.q = q;

    new PipelinePanel(q('[data-stages]'), this.pipeline, () => this._refilter());
    back.querySelectorAll('input[name=view]').forEach((r) => (r.onchange = () => this._draw()));
    ['[data-crop-start]', '[data-crop-end]'].forEach((s) => (q(s).oninput = () => this._crop()));
    ['[data-ppg]', '[data-motion]', '[data-events]'].forEach((s) => (q(s).onchange = () => this._draw()));
    q('[data-dur]').oninput = () => this._setDuration(+q('[data-dur]').value);
    q('[data-quick]').onclick = (e) => { const b = e.target.closest('[data-q]'); if (b) this._setDuration(b.dataset.q === 'all' ? this.total : +b.dataset.q); };
    this._dragSelect(q('[data-preview]'));
    q('[data-folder-choose]').onclick = async () => {
      try { await SampleFolder.choose(); } catch (e) { if (e.name !== 'AbortError') q('[data-msg]').textContent = e.message; }
      this._folderInfo();
    };
    this._folderInfo();
    q('[data-close]').onclick = q('[data-cancel]').onclick = () => this.close();
    q('[data-save]').onclick = () => this._save();
    this._onKey = (e) => { if (e.key === 'Escape') this.close(); };
    document.addEventListener('keydown', this._onKey);
    this._onResize = () => this._draw();
    window.addEventListener('resize', this._onResize);
    this._crop();
  }

  close() {
    document.removeEventListener('keydown', this._onKey);
    window.removeEventListener('resize', this._onResize);
    this.el.remove();
  }

  /* ---------- Réglages ---------- */

  _crop(fromDuration = false) {
    const q = this.q;
    let a = +q('[data-crop-start]').value, b = +q('[data-crop-end]').value;
    if (b - a < 1) { // au moins 1 s (un enregistrement EDF)
      if (document.activeElement === q('[data-crop-start]')) a = Math.max(0, b - 1); else b = Math.min(this.total, a + 1);
      q('[data-crop-start]').value = a; q('[data-crop-end]').value = b;
    }
    this.cropRange = { start: a, end: b };
    const f = (v) => v.toFixed(2).replace('.', ',') + ' s';
    q('[data-start-val]').textContent = f(a);
    q('[data-end-val]').textContent = f(b);
    q('[data-duration]').textContent = `→ ${f(b - a)} gardées`;
    if (fromDuration !== true || document.activeElement !== q('[data-dur]')) q('[data-dur]').value = +(b - a).toFixed(2);
    this._draw();
  }

  _refilter() {
    clearTimeout(this._filterTimer);
    this._filterTimer = setTimeout(() => {
      this.filtered = this.pipeline.processOffline(this.raw);
      this._draw();
    }, 60);
  }

  // Garde les `d` dernières secondes de la plage actuelle (ou de la fin si elle ne tient pas)
  _setDuration(d) {
    d = Math.max(1, Math.min(this.total, d || this.total));
    let { end } = this.cropRange;
    if (end - d < 0) end = d;
    this.q('[data-crop-start]').value = end - d;
    this.q('[data-crop-end]').value = end;
    this._crop(true);
  }

  // Glisser sur l'aperçu pour choisir la plage gardée
  _dragSelect(canvas) {
    const toS = (ev) => {
      const r = canvas.getBoundingClientRect(), L = 78, x = Math.max(L, Math.min(r.width - 4, ev.clientX - r.left));
      return ((x - L) / (r.width - 4 - L)) * this.total;
    };
    let from = null;
    canvas.onpointerdown = (ev) => { from = toS(ev); canvas.setPointerCapture(ev.pointerId); };
    canvas.onpointermove = (ev) => {
      if (from == null) return;
      const to = toS(ev);
      this.q('[data-crop-start]').value = Math.min(from, to);
      this.q('[data-crop-end]').value = Math.max(from, to);
      this._crop(true);
    };
    canvas.onpointerup = () => { from = null; };
  }

  async _folderInfo() {
    const q = this.q, st = await SampleFolder.status();
    if (st.server) {
      q('[data-folder-info]').textContent = 'Écrit automatiquement dans muse2/echantillons (jeu de données BIDS).';
      q('[data-folder-choose]').hidden = true;
    } else if (!SampleFolder.supported()) {
      q('[data-folder-info]').textContent = 'Ce navigateur ne permet pas d\u2019écrire dans un dossier : l\u2019échantillon restera dans le navigateur (exports possibles).';
      q('[data-folder-choose]').hidden = true;
    } else if (!st.chosen) {
      q('[data-folder-info]').textContent = 'Dossier pas encore choisi : à l\u2019enregistrement, choisis muse2/echantillons (une seule fois). Si tu annules, l\u2019échantillon restera seulement dans le navigateur. (Lancée par python serveur.py, l\u2019application écrit dans muse2/echantillons sans rien demander.)';
    } else {
      q('[data-folder-info]').textContent = `Écrit aussi dans « ${st.name} » (jeu de données BIDS)` + (st.permission === 'granted' ? '.' : ' — le navigateur te demandera d\u2019autoriser l\u2019accès.')
        + (st.name === 'echantillons' ? '' : ' ⚠ Ce n\u2019est pas le dossier muse2/echantillons : clique « Changer de dossier ».');
      q('[data-folder-choose]').textContent = 'Changer de dossier';
    }
  }

  /* ---------- Aperçu ---------- */

  _lanes() {
    const lanes = Muse.EEG_NAMES.map((name, i) => ({ name, raw: this.raw[i], filtered: this.filtered && this.filtered[i], t: this.t, unit: 'µV' }));
    if (this.q('[data-ppg]').checked && this.arrays.ppg[1].t.length) lanes.push({ name: 'Pouls (IR)', raw: this.arrays.ppg[1].v, t: this.arrays.ppg[1].t, unit: '' });
    const acc = this.arrays.accel[0];
    if (this.q('[data-motion]').checked && acc.t.length) {
      const mag = Float32Array.from({ length: acc.t.length }, (_, i) => Math.hypot(acc.v[i * 3], acc.v[i * 3 + 1], acc.v[i * 3 + 2]));
      lanes.push({ name: 'Mouvement', raw: mag, t: acc.t, unit: 'g' });
    }
    return lanes;
  }

  _draw() {
    const c = this.q('[data-preview]'), d = window.devicePixelRatio || 1;
    const lanes = this._lanes();
    c.style.height = (lanes.length * 62 + 26) + 'px';
    const w = Math.round(c.clientWidth * d), h = Math.round(c.clientHeight * d);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext('2d'), css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    g.clearRect(0, 0, w, h);
    g.font = `${11 * d}px system-ui, sans-serif`;
    const L = 78 * d, top = 14 * d, laneH = (h - top - 12 * d) / lanes.length, t0 = this.t[0];
    const X = (ms) => L + ((ms - t0) / 1000 / this.total) * (w - L - 4 * d);
    const mode = this.el.querySelector('input[name=view]:checked').value;

    lanes.forEach((lane, i) => {
      const y0 = top + i * laneH, mid = y0 + laneH / 2;
      g.fillStyle = css('--text'); g.fillText(lane.name, 4 * d, mid + 4 * d);
      g.strokeStyle = css('--line'); g.lineWidth = d; g.beginPath(); g.moveTo(L, mid); g.lineTo(w, mid); g.stroke();
      const series = [];
      if (mode !== 'filtered' || !lane.filtered) series.push([lane.raw, lane.filtered && mode === 'both' ? css('--muted') : css('--trace')]);
      if (mode !== 'raw' && lane.filtered) series.push([lane.filtered, css('--accent')]);
      // échelle commune aux séries de la ligne : 99e percentile des écarts à la médiane
      const ref = series[series.length - 1][0], sorted = Array.from(ref).sort((a, b) => a - b), med = sorted[sorted.length >> 1];
      const dev = Array.from(ref, (v) => Math.abs(v - med)).sort((a, b) => a - b), amp = dev[Math.floor(dev.length * 0.99)] * 1.15 || 1;
      series.forEach(([data, color]) => {
        const m = data.reduce((a, v) => a + v, 0) / data.length;
        g.strokeStyle = color; g.lineWidth = 1.1 * d; g.beginPath();
        // enveloppe min/max par colonne de pixels : rapide et fidèle aux pics
        let col = -1, lo = 0, hi = 0;
        const flush = () => { if (col < 0) return; g.moveTo(col, mid - (hi / amp) * (laneH / 2 - 3 * d)); g.lineTo(col, mid - (lo / amp) * (laneH / 2 - 3 * d) + 0.5); };
        for (let k = 0; k < data.length; k++) {
          const x = Math.round(X(lane.t[k])), v = Math.max(-amp, Math.min(amp, data[k] - m));
          if (x !== col) { flush(); col = x; lo = hi = v; } else { lo = Math.min(lo, v); hi = Math.max(hi, v); }
        }
        flush();
        g.stroke();
      });
      g.fillStyle = css('--muted'); g.fillText(`±${amp >= 10 ? amp.toFixed(0) : amp.toFixed(2)} ${lane.unit}`, 4 * d, mid + 17 * d);
    });

    if (this.q('[data-events]').checked) {
      this.events.forEach((e) => {
        g.fillStyle = SampleDialog.EVENT_COLORS[e.type] || css('--accent');
        const x0 = X(e.start), x1 = Math.max(x0 + 2 * d, X(e.start + e.duration));
        g.globalAlpha = 0.18; g.fillRect(x0, top, x1 - x0, h - top - 12 * d); g.globalAlpha = 1;
        g.fillRect(x0, 0, x1 - x0, 8 * d);
      });
    }
    // zones exclues par le recadrage
    g.fillStyle = 'rgba(0,0,0,0.45)';
    const a = X(t0 + this.cropRange.start * 1000), b = X(t0 + this.cropRange.end * 1000);
    g.fillRect(L, 0, a - L, h); g.fillRect(b, 0, w - b, h);
    g.fillStyle = css('--muted');
    for (let s = 0; s <= this.total; s += 5) g.fillText(s + ' s', X(t0 + s * 1000) - 6 * d, h - 1 * d);
  }

  /* ---------- Enregistrement ---------- */

  async _save() {
    const q = this.q, name = q('[data-name]').value.trim() || SignalRecorder.sampleName(this.n, this.createdAt);
    const stored = this.el.querySelector('input[name=stored]:checked').value;
    q('[data-save]').disabled = true;
    q('[data-msg]').textContent = 'Enregistrement…';
    // L'autorisation d'écrire dans le dossier doit être demandée tout de suite (pendant le clic)
    let folder = null;
    try { folder = await SampleFolder.obtain(); } catch (e) { folder = null; }
    try {
      const rec = Recording.fromArrays(this.arrays, {
        n: this.n, name, createdAt: this.createdAt,
        task: q('[data-task]').value.trim() || 'libre', notes: q('[data-notes]').value.trim(),
        powerLine: +q('[data-mains]').value,
        include: { ppg: q('[data-ppg]').checked, motion: q('[data-motion]').checked },
        crop: this.cropRange, pipeline: stored === 'filtered' ? this.pipeline : null,
        events: q('[data-events]').checked ? this.events : [],
      });
      const meta = await this.recorder.saveRecording(rec);
      meta.folder = null;
      if (folder) {
        try { await SampleFolder.write(rec, folder); meta.folder = folder.name; } catch (e) { meta.folderError = e.message; }
      }
      this.close();
      this.onSaved(meta);
    } catch (e) {
      console.error(e);
      q('[data-msg]').textContent = 'Échec : ' + e.message;
      q('[data-save]').disabled = false;
    }
  }
}
