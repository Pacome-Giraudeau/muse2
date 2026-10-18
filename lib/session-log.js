/* Journal de séance continu (globale `SessionLog`) : une ligne par seconde pendant toute la connexion, au format CSV.
 *
 *   const log = new SessionLog(muse, { send });           // timer: false = pas de minuteur (tests) ; send(nom, texte) : ajoute `texte` au fichier `nom` (voir serverSink)
 *   log.setSink(SessionLog.serverSink());                 // ou plus tard, une fois le serveur détecté
 *   log.csv()  log.name  log.lines  log.sent  log.where   // contenu, nom du fichier, lignes écrites, lieu ('serveur' | 'mémoire')
 *   log.tick(now)                                         // une ligne maintenant (le minuteur d'1 s l'appelle ; tests)
 *   log.stop()                                            // fin (tests) ; la séance se ferme aussi à la déconnexion
 *
 * Colonnes : temps (ISO 8601, UTC), perdus (paquets EEG perdus depuis le début de la séance), note (« reconnexion »,
 * « resync », « trou » sur la seconde concernée), puis TP9_delta … TP10_gamma : puissance ABSOLUE de chaque bande (µV²) de
 * chaque électrode, DSP de Welch des 2 dernières secondes de signal BRUT (décalage continu retiré, aucun filtre ni rejet
 * d'artefact : un clignement gonfle le delta de la seconde). Bandes de Signal.BANDS (1–45 Hz).
 * Une séance = une connexion : fichier `seance-AAAA-MM-JJ_HH-MM-SS.csv`, qui continue après une reconnexion automatique
 * (la ligne porte alors la note « reconnexion » ; les secondes sans signal n'ont pas de ligne).
 * Écriture : par paquets de FLUSH_S secondes, en ajout, dans muse2/seances/ via `python serveur.py` ; sans serveur, le
 * journal reste en mémoire (les MAX_LINES dernières lignes, ~5 h) et se télécharge depuis la barre d'état. Données personnelles :
 * seances/ est exclu du dépôt.
 */
class SessionLog {
  static FLUSH_S = 10;
  static MAX_LINES = 20000;
  static WINDOW = 512; // 2 s

  constructor(muse, { send = null, rate = Muse.EEG_RATE, timer = true } = {}) {
    this.muse = muse;
    this.rate = rate;
    this._send = send;
    this.where = send ? 'serveur' : 'mémoire';
    this._buf = Muse.EEG_NAMES.map(() => []);
    this._fresh = 0;          // échantillons reçus (canal 0) depuis la dernière ligne
    this._notes = new Set();
    this._lines = [];         // lignes du fichier en cours (en-tête exclu)
    this._unsent = [];
    this.name = null;
    this.sent = 0;
    this._lostAtStart = 0;
    this._offs = [
      muse.on('eeg', (c, s) => this._feed(c, s)),
      muse.on('gap', (c, n, d) => { if (!d.filled) this._notes.add('resync'); else this._notes.add('trou'); }),
      muse.on('state', (state) => this._onState(state)),
    ];
    this._timer = timer ? setInterval(() => this.tick(Date.now()), 1000) : null;
    if (muse.state === 'connected') this._begin(Date.now());
  }

  get lines() { return this._lines.length; }

  // Sink vers serveur.py : POST api/seances/<nom>, corps = lignes à ajouter. fetchFn : pour les tests.
  static serverSink(fetchFn = null) {
    const f = fetchFn || ((u, o) => fetch(u, o));
    return async (name, text) => {
      const r = await f('api/seances/' + encodeURIComponent(name), { method: 'POST', body: text });
      if (!r.ok) throw new Error('journal refusé (' + r.status + ')');
    };
  }

  setSink(send) {
    this._send = send;
    this.where = send ? 'serveur' : 'mémoire';
    // tout ce qui n'était pas parti (journal commencé avant la détection du serveur) repart
    this._unsent = this.name ? this._lines.slice(this.sent) : [];
  }

  static header() {
    const cols = ['temps', 'perdus', 'note'];
    for (const n of Muse.EEG_NAMES) for (const b of Signal.BANDS) cols.push(`${n}_${b.name.toLowerCase().replace('ê', 'e')}`);
    return cols.join(',') + '\n';
  }

  csv() { return this.name ? SessionLog.header() + this._lines.join('\n') + (this._lines.length ? '\n' : '') : ''; }

  _stamp(now) {
    const d = new Date(now), p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
  }

  _begin(now) {
    if (this.name) { this._notes.add('reconnexion'); return; }
    this.name = `seance-${this._stamp(now)}.csv`;
    this._lines = []; this._unsent = []; this.sent = 0;
    this._lostAtStart = this.muse.stats.lost;
    this._header = true;
  }

  _onState(state) {
    if (state === 'connected') this._begin(Date.now());
    else if (state === 'disconnected') { this._flush(true); this.name = null; this._buf.forEach((b) => (b.length = 0)); }
  }

  _feed(channel, samples) {
    if (!this.name) return;
    const b = this._buf[channel];
    for (const s of samples) b.push(s);
    if (b.length > SessionLog.WINDOW) b.splice(0, b.length - SessionLog.WINDOW);
    if (channel === 0) this._fresh += samples.length;
  }

  // Une ligne si les 4 canaux ont de quoi calculer (>= 1 s) et si du signal est arrivé depuis la ligne précédente.
  tick(now) {
    if (!this.name) return;
    if (this._fresh > 0 && this._buf.every((b) => b.length >= this.rate)) {
      const cols = [];
      for (const b of this._buf) {
        const spec = Signal.welch(b.slice(-SessionLog.WINDOW), this.rate);
        for (const band of Signal.BANDS) cols.push(Signal.powerBetween(spec, band.range[0], band.range[1]).toPrecision(4));
      }
      const note = [...this._notes].join(' ');
      this._notes.clear();
      this._fresh = 0;
      const line = [new Date(now).toISOString(), this.muse.stats.lost - this._lostAtStart, note, ...cols].join(',');
      this._lines.push(line);
      this._unsent.push(line);
      if (this._lines.length > SessionLog.MAX_LINES) { // plafond de la copie gardée pour le téléchargement
        this._lines.shift();
        if (this.sent > 0) this.sent--; else this._unsent.shift();
      }
    }
    if (this._unsent.length >= SessionLog.FLUSH_S) this._flush(false);
  }

  async _flush(final) {
    if (!this._send || !this._unsent.length || this._flushing) return;
    this._flushing = true;
    const lines = this._unsent.splice(0), first = this.sent === 0 && this._header;
    try {
      await this._send(this.name, (first ? SessionLog.header() : '') + lines.join('\n') + '\n');
      this.sent += lines.length;
      this._header = false;
      this.where = 'serveur';
    } catch (e) {
      this._unsent.unshift(...lines); // rien n'est perdu : nouvel essai au prochain paquet
      this.where = 'mémoire';
    }
    this._flushing = false;
  }

  stop() {
    clearInterval(this._timer);
    this._offs.forEach((off) => off());
  }
}
