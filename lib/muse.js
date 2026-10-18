/* Pilote Muse 2 via Web Bluetooth (Chrome / Edge). Globale `Muse`.
 *
 * Une seule instance est partagée par toute l'application (créée par app/shell.js, passée aux projets) : la
 * connexion survit donc aux changements de page.
 *
 * Usage :
 *   const off = muse.on('eeg', (canal, echantillons) => {});  // retourne la fonction de désabonnement
 *   muse.off('eeg', fn);
 *   await muse.connect();      // à appeler depuis un clic (sélecteur du navigateur)
 *   muse.disconnect();         // déconnexion volontaire, pas de reconnexion auto
 *
 * Événements :
 *   'eeg'        (canal, échantillons)  µV, 256 Hz, canal 0..3 = TP9, AF7, AF8, TP10
 *   'accel'      ({x, y, z})            g
 *   'gyro'       ({x, y, z})            °/s
 *   'ppg'        (canal, échantillons)  64 Hz, canal 0 ambiant, 1 infrarouge, 2 rouge
 *   'telemetry'  ({battery, temperature})   % de batterie ; dernier relevé aussi dans muse.telemetry
 *   'state'      (état, détail)         ETATS ci-dessous
 *   'gap'        (canal, perdus, { filled })   paquets EEG perdus sur ce canal (émis AVANT le comblement)
 *   'resync'     ({ canal, perdus, depart })   trou trop long pour être comblé : les 4 canaux repartent ensemble au
 *                paquet `depart` (voir ci-dessous). Les briques qui apparient les canaux par rang (SignalPipeline,
 *                ArtifactDetector, GazeMeter, CalibrationContext) doivent remettre leurs files à zéro (reset / resync()).
 *
 * Fiabilité : après la 1re connexion, toute coupure (ou flux silencieux > STALL_MS) déclenche une
 * reconnexion automatique avec délai croissant, sans rouvrir le sélecteur.
 * Paquets EEG perdus : chaque paquet porte un numéro de séquence 16 bits (par canal). Un trou de n paquets
 * (modulo 65536) est comblé par 12 × n échantillons répétant la dernière valeur reçue (pas NaN : les filtres en
 * aval ne le supportent pas), émis en 'eeg' avant le paquet : les 4 canaux restent alignés. Au-delà de
 * MAX_FILL_PACKETS (~1 s) ou si la séquence recule, rien n'est comblé : 'gap' avec filled = false, stats.resyncs++,
 * puis 'resync'. Départ commun = premier numéro qu'aucun des 4 canaux n'a encore émis (le plus avancé + 1) ; chaque
 * canal écarte ses paquets plus anciens (au plus quelques-uns). Les 4 canaux repartent ainsi au MÊME instant, sans
 * décalage ; l'horodatage du SignalRecorder se recale sur l'heure d'arrivée.
 * Paquet en double : ignoré. Séquences oubliées à chaque (re)connexion. Logique testable sans Bluetooth :
 * muse._onEegPacket(canal, dataView).
 *
 * Deux sources de paquets, mêmes décodeurs et mêmes événements : Web Bluetooth (connect(), Chrome / Edge, au clic) ou le
 * pont Python (connectBridge() : `python serveur.py --pont` pilote le casque avec bleak et relaie les paquets BLE bruts
 * sur /api/pont ; Muse.bridgeAvailable() dit s'il tourne).
 * `muse.stats` : { disconnects, reconnects, packets, lost (paquets EEG perdus, cumul), resyncs (trous non comblés),
 *                  rate (paquets EEG/s), connectedSince, lastDisconnect }.
 * `muse.link` : { rate, ratio, bars } qualité de la liaison Bluetooth (0..1, 0..4 barres) d'après le débit reçu.
 *
 * ETATS : 'disconnected' | 'connecting' | 'connected' | 'reconnecting' (détail = { attempt, delayMs })
 */
class Muse {
  static EEG_NAMES = ['TP9', 'AF7', 'AF8', 'TP10'];
  static EEG_RATE = 256;
  static PPG_RATE = 64;
  static EXPECTED_PACKET_RATE = (4 * 256) / 12; // paquets EEG attendus par seconde, 4 canaux (~85)

  static SERVICE = 0xfe8d;
  static MAX_FILL_PACKETS = Math.ceil(256 / 12); // trou comblé jusqu'à 22 paquets (~1 s) ; au-delà, pas de comblement
  static RESYNC_WINDOW = 256;            // un canal est « en avance » au resync s'il l'est de moins de 256 paquets (~3 s)
  static STALL_MS = 4000;               // aucun paquet EEG pendant ce délai => liaison considérée morte
  static RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000]; // le dernier est répété indéfiniment
  static uuid = (n) => `273e${n.toString(16).padStart(4, '0')}-4c4d-454d-96be-f03bac821358`;

  static supported() {
    return !!navigator.bluetooth;
  }

  // Le serveur local a-t-il été lancé avec --pont ? (faux hors serveur, ex. file://)
  static async bridgeAvailable(fetchFn = null) {
    if (!fetchFn) {
      if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return false;
      fetchFn = (u, o) => fetch(u, o);
    }
    try {
      const r = await fetchFn('api/pont/etat', { cache: 'no-store' });
      return r.ok && !!(await r.json()).disponible;
    } catch (e) { return false; }
  }

  constructor({ ppg = true, autoReconnect = true } = {}) {
    this.ppg = ppg;
    this.autoReconnect = autoReconnect;
    this.device = null;
    this.control = null;
    this.state = 'disconnected';
    this.stats = { disconnects: 0, reconnects: 0, packets: 0, lost: 0, resyncs: 0, rate: 0, connectedSince: null, lastDisconnect: null };
    this.telemetry = null;
    this._resetSequences();
    this._handlers = {};
    this._lastPackets = 0;

    this._wantConnected = false; // true entre connect() et disconnect()
    this._retrying = false;
    this._lastPacketAt = 0;
    this._watchdog = null;
    this._bridge = null;     // EventSource du pont Python (voir connectBridge)
    this._viaBridge = false;
  }

  get connected() {
    return this.state === 'connected';
  }

  get link() {
    const rate = this.connected ? this.stats.rate : 0;
    const ratio = Math.min(1, rate / Muse.EXPECTED_PACKET_RATE);
    const bars = ratio > 0.9 ? 4 : ratio > 0.7 ? 3 : ratio > 0.4 ? 2 : ratio > 0 ? 1 : 0;
    return { rate, ratio, bars };
  }

  /* ---------- Événements ---------- */

  on(event, fn) {
    (this._handlers[event] = this._handlers[event] || []).push(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    this._handlers[event] = (this._handlers[event] || []).filter((h) => h !== fn);
  }

  _emit(event, ...args) {
    for (const fn of this._handlers[event] || []) fn(...args);
  }

  /* ---------- Connexion ---------- */

  async connect() {
    this._wantConnected = true;
    this._setState('connecting');
    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'Muse' }],
        optionalServices: [Muse.SERVICE],
      });
      this.device.addEventListener('gattserverdisconnected', () => this._onLinkLost());
      await this._open();
    } catch (e) {
      this._wantConnected = false;
      this._setState('disconnected');
      throw e;
    }
  }

  // Connexion par le pont Python : le casque est piloté par bleak côté serveur (reconnexion comprise).
  async connectBridge() {
    this._wantConnected = true;
    this._viaBridge = true;
    this._setState('connecting');
    try {
      await this._openBridge();
    } catch (e) {
      this._wantConnected = false;
      this._viaBridge = false;
      this._setState('disconnected');
      throw e;
    }
  }

  async disconnect() {
    this._wantConnected = false;
    this._stopWatchdog();
    if (this._bridge) { this._bridge.close(); this._bridge = null; }
    this._viaBridge = false;
    if (this.device && this.device.gatt.connected) {
      try { await this._cmd('h'); } catch (e) { /* ignoré */ }
      this.device.gatt.disconnect();
    }
    this._setState('disconnected');
  }

  // Aiguille une notification BLE (identifiant de caractéristique 0x0003…) vers son décodeur.
  _route(id, dv) {
    if (id >= 0x0003 && id <= 0x0006) this._onEegPacket(id - 0x0003, dv);
    else if (id === 0x000b) {
      this.telemetry = { battery: dv.getUint16(2) / 512, temperature: dv.getUint16(8) };
      this._emit('telemetry', this.telemetry);
    } else if (id === 0x000a) Muse._decodeXYZ(dv, 0.0000610352).forEach((s) => this._emit('accel', s));
    else if (id === 0x0009) Muse._decodeXYZ(dv, 0.0074768).forEach((s) => this._emit('gyro', s));
    else if (id >= 0x000f && id <= 0x0011 && this.ppg) this._emit('ppg', id - 0x000f, Muse._decodePPG(dv));
  }

  // Ouvre le flux du pont ; résolu quand le serveur annonce « connected ». Si la liaison avec le serveur tombe,
  // l'EventSource se rouvre seul ; le casque, lui, est reconnecté par le serveur.
  _openBridge() {
    return new Promise((resolve, reject) => {
      let opened = false;
      const es = new EventSource('api/pont');
      this._bridge = es;
      es.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.i !== undefined) {
          const bin = atob(m.d), bytes = new Uint8Array(bin.length);
          for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
          this._route(m.i, new DataView(bytes.buffer));
        } else if (m.etat === 'connected') {
          this._resetSequences();
          this._lastPacketAt = Date.now();
          this._lastPackets = this.stats.packets;
          this.stats.connectedSince = Date.now();
          if (opened) this.stats.reconnects++;
          this._startWatchdog();
          this._setState('connected');
          if (!opened) { opened = true; resolve(); }
        } else if (m.etat === 'connecting' || m.etat === 'reconnecting') {
          if (this.state === 'connected') { this.stats.disconnects++; this.stats.lastDisconnect = Date.now(); this.stats.connectedSince = null; }
          this.stats.rate = 0;
          this._stopWatchdog();
          if (opened) this._setState('reconnecting', { attempt: m.essai || 1, delayMs: 0 });
        } else if (m.etat === 'erreur') {
          es.close();
          this._bridge = null;
          if (!opened) reject(new Error(m.message || 'Pont Python indisponible'));
          else { this._wantConnected = false; this._setState('disconnected'); }
        }
      };
      es.onerror = () => {
        if (opened) { this.stats.rate = 0; this._setState('reconnecting', { attempt: 1, delayMs: 0 }); }
        else { es.close(); this._bridge = null; reject(new Error('Pont Python injoignable (python serveur.py --pont)')); }
      };
    });
  }

  // Ouvre la liaison GATT, s'abonne aux flux et démarre le streaming.
  async _open() {
    if (this._viaBridge) return this._openBridge();
    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(Muse.SERVICE);

    this.control = await service.getCharacteristic(Muse.uuid(0x0001));
    await this._subscribe(service, 0x0001, () => {}); // réponses de contrôle, ignorées

    this._resetSequences();
    // EEG 0x0003-0x0006, télémétrie 0x000b, accéléromètre 0x000a, gyroscope 0x0009, PPG 0x000f-0x0011
    const ids = [0x0003, 0x0004, 0x0005, 0x0006, 0x000b, 0x000a, 0x0009];
    if (this.ppg) ids.push(0x000f, 0x0010, 0x0011);
    for (const id of ids) await this._subscribe(service, id, (dv) => this._route(id, dv));

    // Séquence de démarrage : pause, preset (p50 = EEG + PPG, p21 = EEG seul), start, resume
    await this._cmd('h');
    await this._cmd(this.ppg ? 'p50' : 'p21');
    await this._cmd('s');
    await this._cmd('d');

    this._lastPacketAt = Date.now();
    this._lastPackets = this.stats.packets;
    this.stats.connectedSince = Date.now();
    this._startWatchdog();
    this._setState('connected');
  }

  /* ---------- Paquets EEG : séquence, trous, comblement ---------- */

  // Oublie les numéros de séquence (à chaque (re)connexion : le casque peut repartir d'un autre numéro).
  _resetSequences() {
    this._seq = Muse.EEG_NAMES.map(() => null);
    this._lastEeg = Muse.EEG_NAMES.map(() => 0);
    this._skipUntil = Muse.EEG_NAMES.map(() => null); // départ commun après un « resync » (null = rien à écarter)
  }

  // Traite un paquet EEG reçu sur un canal (dv : DataView, ou tout objet offrant getUint16 / getUint8).
  // Paquet perdu : émet 'gap', puis 12 × n échantillons répétant la dernière valeur (canaux gardés alignés),
  // puis le paquet. Au-delà de MAX_FILL_PACKETS, pas de comblement (voir l'en-tête).
  _onEegPacket(channel, dv) {
    this._lastPacketAt = Date.now();
    this.stats.packets++;
    const seq = dv.getUint16(0), prev = this._seq[channel];
    const step = prev === null ? 1 : (seq - prev + 65536) % 65536;
    if (step === 0) return; // paquet en double : ignoré
    this._seq[channel] = seq;
    const samples = Muse._decodeEEG(dv);
    if (this._skipUntil[channel] !== null) {
      // Après un « resync » : ce canal écarte ses paquets antérieurs au départ commun, sans rien combler.
      if ((seq - this._skipUntil[channel] + 65536) % 65536 >= 32768) return;
      this._skipUntil[channel] = null;
    } else if (step > 1) {
      const lost = step - 1;
      if (lost <= Muse.MAX_FILL_PACKETS) {
        this.stats.lost += lost;
        this._emit('gap', channel, lost, { filled: true });
        this._emit('eeg', channel, new Array(12 * lost).fill(this._lastEeg[channel]));
      } else {
        // Trou trop long (ou séquence repartie en arrière) : on ne fabrique pas de signal ; le numéro reçu sert de
        // nouvelle origine. Les abonnés peuvent remettre leurs états à zéro, comme après une reconnexion.
        if (lost < 32768) this.stats.lost += lost;
        this.stats.resyncs++;
        this._emit('gap', channel, lost < 32768 ? lost : 0, { filled: false });
        // Départ commun : premier numéro qu'aucun canal n'a encore émis. Les autres canaux sont au plus à quelques
        // paquets de celui-ci ; un écart plus grand (numérotation repartie de zéro) n'est pas « en avance ».
        let ahead = -1;
        this._seq.forEach((q, k) => {
          const d = q === null || k === channel ? 65536 : (q - seq + 65536) % 65536;
          if (d < Muse.RESYNC_WINDOW) ahead = Math.max(ahead, d);
        });
        const depart = (seq + ahead + 1) % 65536;
        this._skipUntil = this._skipUntil.map(() => depart);
        this._emit('resync', { canal: channel, perdus: lost < 32768 ? lost : 0, depart });
        if ((seq - depart + 65536) % 65536 >= 32768) return; // ce paquet-ci précède lui-même le départ : écarté
        this._skipUntil[channel] = null;
      }
    }
    this._lastEeg[channel] = samples[samples.length - 1];
    this._emit('eeg', channel, samples);
  }

  /* ---------- Reconnexion automatique ---------- */

  _onLinkLost() {
    if (this.state === 'connected') {
      this.stats.disconnects++;
      this.stats.lastDisconnect = Date.now();
      this.stats.connectedSince = null;
    }
    this.stats.rate = 0;
    this._stopWatchdog();
    if (this._wantConnected && this.autoReconnect) this._retryLoop();
    else this._setState('disconnected');
  }

  async _retryLoop() {
    if (this._retrying) return;
    this._retrying = true;
    for (let attempt = 1; this._wantConnected; attempt++) {
      const delayMs = Muse.RETRY_DELAYS_MS[Math.min(attempt - 1, Muse.RETRY_DELAYS_MS.length - 1)];
      this._setState('reconnecting', { attempt, delayMs });
      await new Promise((r) => setTimeout(r, delayMs));
      if (!this._wantConnected) break;
      try {
        await this._open();
        this.stats.reconnects++;
        break;
      } catch (e) {
        if (this.device && this.device.gatt.connected) this.device.gatt.disconnect();
      }
    }
    this._retrying = false;
  }

  // Une liaison peut rester "connectée" sans plus rien envoyer : on la coupe pour relancer la boucle.
  _startWatchdog() {
    this._stopWatchdog();
    this._watchdog = setInterval(() => {
      this.stats.rate = this.stats.packets - this._lastPackets;
      this._lastPackets = this.stats.packets;
      if (this.state === 'connected' && Date.now() - this._lastPacketAt > Muse.STALL_MS) {
        if (this._bridge) { this._bridge.close(); this._bridge = null; this._onLinkLost(); } // _retryLoop rouvre le pont
        else this.device.gatt.disconnect();
      }
    }, 1000);
  }

  _stopWatchdog() {
    clearInterval(this._watchdog);
    this._watchdog = null;
  }

  _setState(state, detail = {}) {
    this.state = state;
    this._emit('state', state, detail);
  }

  /* ---------- Bas niveau ---------- */

  async _subscribe(service, id, handler) {
    const ch = await service.getCharacteristic(Muse.uuid(id));
    ch.addEventListener('characteristicvaluechanged', (e) => handler(e.target.value));
    await ch.startNotifications();
  }

  // Commande texte : [longueur, ...ascii, '\n'] sur la caractéristique de contrôle
  async _cmd(str) {
    const bytes = [str.length + 1, ...[...str].map((c) => c.charCodeAt(0)), 10];
    await this.control.writeValueWithoutResponse(new Uint8Array(bytes));
  }

  // Paquet EEG : 2 octets de séquence + 12 échantillons de 12 bits
  static _decodeEEG(dv) {
    const out = [];
    for (let i = 0; i < 12; i++) {
      const bit = 16 + i * 12;
      const byte = bit >> 3;
      const raw = bit % 8 === 0
        ? (dv.getUint8(byte) << 4) | (dv.getUint8(byte + 1) >> 4)
        : ((dv.getUint8(byte) & 0x0f) << 8) | dv.getUint8(byte + 1);
      out.push((raw - 2048) * 0.48828125);
    }
    return out;
  }

  // Accéléromètre / gyroscope : 2 octets de séquence + 3 × (x, y, z) int16
  static _decodeXYZ(dv, scale) {
    const out = [];
    for (let i = 0; i < 3; i++) {
      const o = 2 + i * 6;
      out.push({ x: dv.getInt16(o) * scale, y: dv.getInt16(o + 2) * scale, z: dv.getInt16(o + 4) * scale });
    }
    return out;
  }

  // PPG : 2 octets de séquence + 6 échantillons de 24 bits
  static _decodePPG(dv) {
    const out = [];
    for (let i = 0; i < 6; i++) {
      const o = 2 + i * 3;
      out.push((dv.getUint8(o) << 16) | (dv.getUint8(o + 1) << 8) | dv.getUint8(o + 2));
    }
    return out;
  }
}
