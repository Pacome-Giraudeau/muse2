/* Barre d'état du casque (globale `StatusBar`) : état de connexion, liaison Bluetooth, batterie, boutons.
 *
 *   new StatusBar(document.getElementById('statusbar'), muse, recorder);
 *
 * Affichée en permanence dans l'en-tête de l'application (voir app/shell.js). C'est ici qu'on connecte le casque.
 * Indice Bluetooth : 4 barres d'après le débit de paquets reçus (muse.link), pas la puissance radio (RSSI), que
 * Web Bluetooth ne fournit pas pour un appareil connecté. Vert = plein débit, orange = dégradé, rouge = très faible.
 * Mémoire (si `recorder` est fourni) : « ⏺ 30 s » = secondes de signal gardées ; clic = menu : téléchargements,
 * « Créer un échantillon » (ouvre l'aperçu ui/sample-dialog.js avant création) et liste des échantillons
 * (télécharger en EDF+, dossier BIDS .zip, CSV ou JSON ; supprimer).
 */
class StatusBar {
  static STATE_LABEL = {
    disconnected: 'Non connecté',
    connecting: 'Connexion…',
    connected: 'Connecté',
    reconnecting: 'Reconnexion…',
  };

  constructor(container, muse, recorder = null) {
    this.muse = muse;
    this.recorder = recorder;
    container.innerHTML = `
      <span class="pill"><span class="dot" data-dot></span><span data-status>Non connecté</span></span>
      <span class="pill" data-bt title="Liaison Bluetooth">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 7l10 10-5 5V2l5 5L7 17" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>
        <span class="bars"><i></i><i></i><i></i><i></i></span>
      </span>
      <span class="pill" data-battery title="Batterie du casque">🔋 –</span>
      <details class="rec" data-rec ${recorder ? '' : 'hidden'}>
        <summary class="pill" data-rec-label>⏺ 0 s</summary>
        <div class="rec-menu">
          <p data-rec-info></p>
          <button class="btn ghost" data-dl="eeg">EEG (CSV)</button>
          <button class="btn ghost" data-dl="ppg">Pouls (CSV)</button>
          <button class="btn ghost" data-dl="motion">Mouvement (CSV)</button>
          <button class="btn ghost" data-dl="json">Tout (JSON)</button>
          <hr>
          <button class="btn" data-sample>📌 Créer un échantillon</button>
          <p data-sample-msg></p>
          <ul class="samples" data-samples></ul>
        </div>
      </details>
      <button class="btn" data-connect>Connecter le Muse 2</button>
      <button class="btn ghost" data-disconnect hidden>Déconnecter</button>`;
    this.el = container;
    const q = (s) => container.querySelector(s);

    q('[data-connect]').onclick = async () => {
      try {
        await muse.connect();
      } catch (e) {
        console.error(e);
        q('[data-status]').textContent = e.name === 'NotFoundError' ? 'Aucun casque choisi' : 'Échec : ' + (e.message || e);
      }
    };
    q('[data-disconnect]').onclick = () => muse.disconnect();

    if (!Muse.supported()) {
      q('[data-connect]').disabled = true;
      q('[data-status]').textContent = 'Web Bluetooth indisponible (utilise Chrome ou Edge)';
    }

    muse.on('state', (state, detail) => this._onState(state, detail));
    muse.on('telemetry', () => this._battery());
    this._onState(muse.state, {});
    this._battery();
    if (recorder) {
      container.querySelectorAll('[data-dl]').forEach((b) => (b.onclick = () => this._download(b.dataset.dl)));
      q('[data-sample]').onclick = () => this._createSample();
      q('[data-rec]').addEventListener('toggle', () => { if (q('[data-rec]').open) this._listSamples(); });
      q('[data-samples]').onclick = (e) => this._sampleAction(e.target.closest('[data-act]'));
      recorder.ready.then(() => this._memory());
    }
    setInterval(() => { this._link(); this._memory(); }, 1000);
  }

  _memory() {
    const r = this.recorder;
    if (!r) return;
    const s = Math.round(r.duration('eeg'));
    this.el.querySelector('[data-rec-label]').textContent = `⏺ ${s} s`;
    const saved = r.savedAt ? `dernière sauvegarde : ${new Date(r.savedAt).toLocaleTimeString()}` : 'pas encore sauvegardé';
    this.el.querySelector('[data-rec-info]').textContent = r.persistent
      ? `${s} s de signal gardées en mémoire, conservées même après fermeture (${saved}).`
      : `${s} s de signal gardées en mémoire, mais pas après fermeture : stockage du navigateur indisponible.`;
    this.el.querySelector('[data-rec]').title = `Les ${r.seconds} dernières secondes de signal brut sont enregistrées en continu.`;
  }

  static _save(text, name, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async _createSample() {
    const msg = this.el.querySelector('[data-sample-msg]');
    if (this.recorder.duration('eeg') < 1) { msg.textContent = 'Mémoire vide : rien à copier pour l\u2019instant.'; return; }
    this.el.querySelector('[data-rec]').open = false;
    SampleDialog.open(this.recorder, {
      onSaved: (e) => {
        msg.textContent = `Créé : ${e.name} (${e.seconds.toFixed(0)} s, ${e.stored})`
          + (e.folder ? ` — écrit dans « ${e.folder} »` : e.folderError ? ` — dossier : ${e.folderError}` : ' — dans le navigateur seulement')
          + (this.recorder.persistent ? '' : ' — non conservé après fermeture.');
        this._listSamples();
      },
    });
  }

  async _listSamples() {
    const list = await this.recorder.listSamples();
    this.el.querySelector('[data-samples]').innerHTML = list.length
      ? list.map((e) => `<li><span title="${new Date(e.createdAt).toLocaleString()} · ${e.seconds.toFixed(0)} s">${e.name}</span>
          <button data-act="study" data-n="${e.n}" title="Étudier cet échantillon">🔍</button><button data-act="edf" data-n="${e.n}" title="EDF+ : format d'échange EEG (EDFbrowser, MNE, EEGLAB…)">EDF</button><button data-act="bids" data-n="${e.n}" title="Dossier BIDS complet (.zip)">BIDS</button><button data-act="eeg" data-n="${e.n}" title="EEG en CSV (tableur)">CSV</button><button data-act="json" data-n="${e.n}" title="Tout en JSON">JSON</button><button data-act="del" data-n="${e.n}" title="Supprimer">🗑</button></li>`).join('')
      : '<li class="empty">Aucun échantillon pour l\u2019instant.</li>';
  }

  async _sampleAction(btn) {
    if (!btn) return;
    const n = +btn.dataset.n, act = btn.dataset.act;
    if (act === 'del') {
      if (!confirm('Supprimer cet échantillon ? C\u2019est définitif.')) return;
      await this.recorder.deleteSample(n);
      return this._listSamples();
    }
    if (act === 'study') { this.el.querySelector('[data-rec]').open = false; location.hash = '#/p/etude/' + n; return; }
    const sample = await this.recorder.getSample(n);
    if (!sample) return;
    try {
      if (act === 'json') StatusBar._save(Recording.toJSON(sample), `${sample.name}.json`, 'application/json');
      else if (act === 'edf') StatusBar._save(EdfWriter.write(sample), `${sample.name}.edf`, 'application/octet-stream');
      else if (act === 'bids') StatusBar._save(Bids.zip(sample), `${sample.name}-bids.zip`, 'application/zip');
      else StatusBar._save(Recording.toCSV(sample, 'eeg'), `${sample.name}-eeg.csv`, 'text/csv');
    } catch (e) {
      this.el.querySelector('[data-sample-msg]').textContent = 'Export impossible : ' + e.message;
    }
  }

  _download(kind) {
    const r = this.recorder, stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const save = StatusBar._save;
    if (kind === 'json') save(r.toJSON(), `muse2-30s-${stamp}.json`, 'application/json');
    else if (kind === 'motion') {
      save(r.toCSV('accel'), `muse2-accelerometre-${stamp}.csv`, 'text/csv');
      save(r.toCSV('gyro'), `muse2-gyroscope-${stamp}.csv`, 'text/csv');
    } else save(r.toCSV(kind), `muse2-${kind}-${stamp}.csv`, 'text/csv');
  }

  _onState(state, detail) {
    const q = (s) => this.el.querySelector(s);
    let label = StatusBar.STATE_LABEL[state];
    if (state === 'reconnecting') label += ` (essai ${detail.attempt || 1})`;
    q('[data-status]').textContent = label;
    q('[data-dot]').className = 'dot' + (state === 'connected' ? ' on' : state === 'reconnecting' ? ' warn' : '');
    q('[data-connect]').disabled = state !== 'disconnected' || !Muse.supported();
    q('[data-disconnect]').hidden = state === 'disconnected';
    this._link();
  }

  _battery() {
    const t = this.muse.telemetry;
    this.el.querySelector('[data-battery]').textContent = '🔋 ' + (t ? t.battery.toFixed(0) + ' %' : '–');
  }

  _link() {
    const bt = this.el.querySelector('[data-bt]');
    const { rate, ratio, bars } = this.muse.link;
    const tone = this.muse.state === 'reconnecting' ? 'warn' : bars === 4 ? 'good' : bars >= 2 ? 'mid' : bars === 1 ? 'bad' : 'none';
    bt.className = `pill bt bt-${tone} bars-${bars}`;
    bt.title = this.muse.connected
      ? `Liaison Bluetooth : ${rate} paquets/s (${(ratio * 100).toFixed(0)} % du débit attendu), ${this.muse.stats.disconnects} coupure(s)`
      : 'Liaison Bluetooth : aucun flux';
  }
}
