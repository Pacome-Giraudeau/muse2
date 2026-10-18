/* Mémoire glissante et persistante des 30 dernières secondes de signal (globales `TimedRing`, `SignalRecorder`).
 * Indépendant de l'interface. Créé une seule fois par app/shell.js : il enregistre quelle que soit la page ouverte.
 *
 * Usage :
 *   const recorder = new SignalRecorder(muse);        // s'abonne au casque, recharge la mémoire précédente
 *   await recorder.ready;                             // fin du rechargement depuis le navigateur
 *   recorder.duration('eeg')                          // secondes de signal en mémoire (0 à 30)
 *   recorder.snapshot()                               // copie ordonnée de tous les flux (voir plus bas)
 *   recorder.toCSV('eeg' | 'ppg' | 'accel' | 'gyro')  // texte CSV, une ligne par instant
 *   recorder.toJSON()                                 // tous les flux en JSON
 *   await recorder.save();  await recorder.clear();
 *
 * Échantillons (copies figées et nommées de la mémoire, conservées jusqu'à suppression) — format : lib/recording.js
 *   const arrays = recorder.freeze();                 // copie figée de la mémoire (pour l'aperçu)
 *   const n = await recorder.nextSampleNumber();
 *   await recorder.saveRecording(Recording.fromArrays(arrays, { n, name, … }))
 *   await recorder.createSample(options)              // raccourci : toute la mémoire, données brutes
 *   await recorder.listSamples({ all })               // du profil actif (ou de tous) : [{ n, name, createdAt, seconds, task, stored, events, profile }]
 *   await recorder.getSample(n)                       // enregistrement complet (Recording)
 *   await recorder.deleteSample(n)  await recorder.reassignSamples(deProfil, versProfil)
 *   Numérotation : n = plus grand numéro existant + 1 (un numéro supprimé n'est pas réutilisé tant qu'un plus grand existe).
 *
 * Ce qui est gardé : les 30 dernières secondes DE SIGNAL de chaque flux (par nombre d'échantillons : 30 × fréquence),
 * même si le casque s'est déconnecté entre-temps. Données brutes, telles que reçues (aucun filtre).
 *   eeg   4 canaux (TP9, AF7, AF8, TP10) à 256 Hz, µV
 *   ppg   3 canaux (ambiant, infrarouge, rouge) à 64 Hz, valeur brute du capteur
 *   accel x, y, z à 52 Hz, g        gyro  x, y, z à 52 Hz, °/s
 * Horodatage (ms, Date.now()) : chaque échantillon suit le précédent de 1/fréquence ; recalage sur l'heure d'arrivée du
 * paquet seulement si elle est plus tardive (reprise après coupure). Strictement croissant. Précision absolue limitée
 * par la latence Bluetooth (quelques dizaines de ms).
 *
 * Persistance : IndexedDB (base `muse2` v2 ; magasin `buffers`, clé `last30s` ; magasin `samples`, clé = numéro n), sauvegarde toutes les 2 s si quelque chose
 * a changé, et quand la page est masquée ou fermée. Au pire, les ~2 dernières secondes peuvent manquer après une
 * fermeture brutale. Si IndexedDB est indisponible (navigation privée…), la mémoire reste active mais non persistante
 * (`recorder.persistent === false`).
 *
 * snapshot() -> { savedAt, seconds, streams: { eeg: { rate, unit, names, channels: [{ t: [ms], v: [valeurs] }] }, … } }
 */
class TimedRing {
  constructor(capacity, width = 1) {
    this.cap = capacity;
    this.width = width;
    this.t = new Float64Array(capacity);
    this.v = new Float32Array(capacity * width);
    this.start = 0;
    this.length = 0;
  }

  push(time, values) {
    const i = (this.start + this.length) % this.cap;
    if (this.length < this.cap) this.length++;
    else this.start = (this.start + 1) % this.cap;
    this.t[i] = time;
    for (let k = 0; k < this.width; k++) this.v[i * this.width + k] = values[k];
  }

  // Copie chronologique : { t: Float64Array, v: Float32Array (length × width) }
  toArrays() {
    const t = new Float64Array(this.length), v = new Float32Array(this.length * this.width);
    for (let j = 0; j < this.length; j++) {
      const i = (this.start + j) % this.cap;
      t[j] = this.t[i];
      for (let k = 0; k < this.width; k++) v[j * this.width + k] = this.v[i * this.width + k];
    }
    return { t, v };
  }

  load({ t, v }) {
    const n = Math.min(t.length, this.cap), skip = t.length - n;
    this.start = 0;
    this.length = 0;
    for (let j = 0; j < n; j++) this.push(t[skip + j], v.subarray((skip + j) * this.width, (skip + j + 1) * this.width));
  }
}

class SignalRecorder {
  static SECONDS = 30;
  static VERSION = 1;
  static STREAMS = {
    eeg: { rate: 256, unit: 'µV', names: ['TP9', 'AF7', 'AF8', 'TP10'], perChannel: true },
    ppg: { rate: 64, unit: 'brut', names: ['ambiant', 'infrarouge', 'rouge'], perChannel: true },
    accel: { rate: 52, unit: 'g', names: ['x', 'y', 'z'], perChannel: false },
    gyro: { rate: 52, unit: '°/s', names: ['x', 'y', 'z'], perChannel: false },
  };

  constructor(muse, { dbName = 'muse2', seconds = SignalRecorder.SECONDS, saveEveryMs = 2000 } = {}) {
    this.muse = muse;
    this.dbName = dbName;
    this.seconds = seconds;
    this.persistent = false;
    this.savedAt = null;
    this._dirty = false;
    this._memSamples = new Map(); // échantillons si IndexedDB est indisponible
    this._rings = {};
    for (const [name, s] of Object.entries(SignalRecorder.STREAMS)) {
      const cap = Math.round(seconds * s.rate);
      this._rings[name] = s.perChannel ? s.names.map(() => new TimedRing(cap, 1)) : [new TimedRing(cap, 3)];
    }

    // Recharge d'abord la mémoire précédente, puis enregistre le flux du casque.
    this.ready = this._open()
      .then(() => this._load())
      .catch((e) => { console.warn('Mémoire du signal non persistante :', e); this.persistent = false; })
      .then(() => this._subscribe());

    this._timer = setInterval(() => { if (this._dirty) this.save(); }, saveEveryMs);
    this._onHide = () => { if (document.visibilityState === 'hidden') this.save(); };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._onHide);
      window.addEventListener('pagehide', () => this.save());
    }
  }

  /* ---------- Enregistrement ---------- */

  _subscribe() {
    // Horodatage : chaque échantillon suit le précédent de 1/fréquence ; on ne se recale sur l'heure d'arrivée que
    // si elle est plus tardive (reprise après une coupure). Ainsi des paquets arrivés groupés ne se chevauchent pas.
    const stamp = (ring, rate, arrivalOfThis) => {
      const last = ring.length ? ring.t[(ring.start + ring.length - 1) % ring.cap] : -Infinity;
      return Math.max(last + 1000 / rate, arrivalOfThis);
    };
    const add = (name, ch, samples) => {
      const rate = SignalRecorder.STREAMS[name].rate, now = Date.now(), ring = this._rings[name][ch];
      samples.forEach((s, i) => ring.push(stamp(ring, rate, now - ((samples.length - 1 - i) * 1000) / rate), [s]));
      this._dirty = true;
    };
    const addXYZ = (name, s) => {
      const ring = this._rings[name][0];
      ring.push(stamp(ring, SignalRecorder.STREAMS[name].rate, Date.now()), [s.x, s.y, s.z]);
      this._dirty = true;
    };
    this._unsubscribe = [
      this.muse.on('eeg', (c, s) => add('eeg', c, s)),
      this.muse.on('ppg', (c, s) => add('ppg', c, s)),
      this.muse.on('accel', (s) => addXYZ('accel', s)),
      this.muse.on('gyro', (s) => addXYZ('gyro', s)),
    ];
  }

  // Arrête l'enregistrement (tests).
  stop() {
    clearInterval(this._timer);
    (this._unsubscribe || []).forEach((off) => off());
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this._onHide);
  }

  duration(name = 'eeg') {
    const rings = this._rings[name];
    return Math.min(...rings.map((r) => r.length)) / SignalRecorder.STREAMS[name].rate;
  }

  /* ---------- Lecture et export ---------- */

  // Copie brute des anneaux : { eeg: [{ t: Float64Array, v: Float32Array }, …], … } (format de stockage)
  _arrays() {
    const out = {};
    for (const [name, rings] of Object.entries(this._rings)) out[name] = rings.map((r) => r.toArrays());
    return out;
  }

  // Format de stockage -> format lisible { streams: { eeg: { rate, unit, names, channels: [{ t, v }] } } }
  static _readable(arrays) {
    const streams = {};
    for (const [name, s] of Object.entries(SignalRecorder.STREAMS)) {
      const a = arrays[name] || [];
      let channels;
      if (s.perChannel) channels = s.names.map((_, i) => ({ t: Array.from(a[i] ? a[i].t : []), v: Array.from(a[i] ? a[i].v : []) }));
      else {
        const t = Array.from(a[0] ? a[0].t : []);
        channels = s.names.map((_, k) => ({ t, v: t.map((_, j) => a[0].v[j * 3 + k]) }));
      }
      streams[name] = { rate: s.rate, unit: s.unit, names: s.names, channels };
    }
    return streams;
  }

  snapshot() {
    return { savedAt: this.savedAt, seconds: this.seconds, streams: SignalRecorder._readable(this._arrays()) };
  }

  // CSV d'un instantané ou d'un échantillon : temps_ms, heure ISO, une colonne par canal (alignés par rang).
  static toCSV(snap, name) {
    const s = snap.streams[name], n = Math.min(...s.channels.map((c) => c.t.length));
    const lines = [['temps_ms', 'heure', ...s.names.map((x) => `${x} (${s.unit})`)].join(',')];
    for (let j = 0; j < n; j++) {
      const t = s.channels[0].t[j];
      lines.push([t.toFixed(1), new Date(t).toISOString(), ...s.channels.map((c) => +c.v[j].toFixed(4))].join(','));
    }
    return lines.join('\n');
  }

  toCSV(name) { return SignalRecorder.toCSV(this.snapshot(), name); }
  toJSON() { return JSON.stringify(this.snapshot()); }

  /* ---------- Échantillons nommés ---------- */

  // « échantillon-<n>-AAAA-MM-JJ_HHhMM » (heure locale)
  static sampleName(n, date = new Date()) {
    const p = (x) => String(x).padStart(2, '0');
    return `échantillon-${n}-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}h${p(date.getMinutes())}`;
  }

  // Copie figée de la mémoire, au format de stockage des anneaux (point de départ d'un échantillon).
  freeze() { return this._arrays(); }

  async nextSampleNumber() {
    const existing = await this.listSamples({ all: true }); // numéros uniques tous profils confondus
    return existing.reduce((m, e) => Math.max(m, e.n), 0) + 1;
  }

  // Enregistre un enregistrement (lib/recording.js) comme échantillon, sous la clé rec.n.
  async saveRecording(rec) {
    await this.ready;
    // L'échantillon appartient au profil qui l'enregistre (sujet BIDS = étiquette du profil)
    rec.profile = Profiles.activeId();
    rec.subject = Profiles.label();
    if (this.persistent && this._db) await this._request('readwrite', (st) => st.put(rec, rec.n), 'samples');
    else this._memSamples.set(rec.n, rec);
    return Recording.meta(rec);
  }

  // Raccourci sans aperçu : échantillon de toute la mémoire, données brutes, options de Recording.fromArrays.
  async createSample(options = {}) {
    await this.ready;
    const n = await this.nextSampleNumber(), createdAt = new Date();
    const rec = Recording.fromArrays(this.freeze(), { n, name: SignalRecorder.sampleName(n, createdAt), createdAt, ...options });
    return this.saveRecording(rec);
  }

  // Liste : [{ n, name, createdAt (ms), seconds, task, stored, events }], du plus récent au plus ancien
  // { all: true } : tous les profils ; sinon ceux du profil actif (les échantillons d'avant les profils vont au premier)
  async listSamples({ all = false } = {}) {
    await this.ready;
    let list = this.persistent && this._db ? await this._request('readonly', (st) => st.getAll(), 'samples') : [...this._memSamples.values()];
    if (!all) list = list.filter((s) => (s.profile || Profiles.defaultId()) === Profiles.activeId());
    return list.map((s) => (s.schema === Recording.SCHEMA ? Recording.meta(s)
      : { n: s.n, name: s.name, createdAt: s.createdAt, seconds: s.seconds, task: 'inconnue', stored: 'brut', events: 0 }))
      .sort((x, y) => y.n - x.n);
  }

  // Enregistrement complet (lib/recording.js) ; les échantillons de l'ancien format sont convertis à la volée.
  async getSample(n) {
    await this.ready;
    const s = this.persistent && this._db ? await this._request('readonly', (st) => st.get(n), 'samples') : this._memSamples.get(n);
    if (!s) return null;
    return s.schema === Recording.SCHEMA ? s : Recording.fromLegacy(s);
  }

  // Rattache à un autre profil tous les échantillons d'un profil (avant sa suppression)
  async reassignSamples(fromId, toId) {
    await this.ready;
    const all = this.persistent && this._db ? await this._request('readonly', (st) => st.getAll(), 'samples') : [...this._memSamples.values()];
    const target = Profiles.list().find((p) => p.id === toId);
    for (const s of all.filter((x) => (x.profile || Profiles.defaultId()) === fromId)) {
      s.profile = toId;
      s.subject = Profiles.label(target);
      if (this.persistent && this._db) await this._request('readwrite', (st) => st.put(s, s.n), 'samples');
      else this._memSamples.set(s.n, s);
    }
  }

  async deleteSample(n) {
    await this.ready;
    if (this.persistent && this._db) await this._request('readwrite', (st) => st.delete(n), 'samples');
    else this._memSamples.delete(n);
  }

  /* ---------- Persistance (IndexedDB) ---------- */

  _open() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB indisponible'));
      const req = indexedDB.open(this.dbName, 2); // v1 : buffers ; v2 : + samples
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('buffers')) db.createObjectStore('buffers');
        if (!db.objectStoreNames.contains('samples')) db.createObjectStore('samples');
      };
      req.onsuccess = () => { this._db = req.result; this.persistent = true; resolve(); };
      req.onerror = () => reject(req.error);
    });
  }

  _request(mode, fn, storeName = 'buffers') {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, mode), req = fn(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  async _load() {
    const data = await this._request('readonly', (store) => store.get('last30s'));
    if (!data || data.version !== SignalRecorder.VERSION) return;
    for (const [name, rings] of Object.entries(this._rings)) {
      const saved = data.streams[name];
      if (saved) rings.forEach((r, i) => saved[i] && r.load(saved[i]));
    }
    this.savedAt = data.savedAt;
  }

  async save() {
    if (!this.persistent || !this._db) return;
    this._dirty = false;
    const streams = this._arrays();
    const savedAt = Date.now();
    try {
      await this._request('readwrite', (store) => store.put({ version: SignalRecorder.VERSION, savedAt, streams }, 'last30s'));
      this.savedAt = savedAt;
    } catch (e) {
      this._dirty = true;
      console.warn('Sauvegarde du signal impossible :', e);
    }
  }

  async clear() {
    for (const rings of Object.values(this._rings)) rings.forEach((r) => { r.start = 0; r.length = 0; });
    this._dirty = false;
    if (this.persistent && this._db) await this._request('readwrite', (store) => store.delete('last30s'));
    this.savedAt = null;
  }
}
