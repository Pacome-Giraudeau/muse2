/* Mesure partagée par toutes les calibrations d'une séance (globale `CalibrationContext`). Sans interface.
 * Une seule chaîne de traitement pour toutes les calibrations enchaînées : détecteur d'artefacts
 * (ArtifactDetector.forProfile : calibration, sensibilité et secteur du profil actif), qualité de contact, filtres
 * mémorisés du profil SAUF la piste « clignements » (MentalState.statePipeline : elle efface une partie du theta
 * frontal et ses poids évoluent au fil des clignements), et 4 s de signal filtré et brut par canal.
 *
 *   const ctx = new CalibrationContext();
 *   const off = muse.on('eeg', (c, s) => ctx.feed(c, s));   // ou simulator.on('eeg', …)
 *   const offPpg = muse.on('ppg', (c, s) => ctx.feedPpg(c, s));   // facultatif : pouls, aide pour les sourcils
 *   ctx.ready                 // bruit de fond appris (détecteur) ET fenêtre de 4 s remplie
 *   ctx.window(s = 4)         // [4][s × 256] dernières secondes de signal FILTRÉ, ou null si pas encore assez
 *   ctx.rawWindow(s = 4)      // idem en BRUT (témoin musculaire de l'état mental)
 *   ctx.usableChannels()      // électrodes au contact correct (bon / moyen) qu'aucun artefact ne touche dans la fenêtre de 4 s
 *   ctx.measureState()        // MentalState.measure des 4 dernières secondes (contact correct, rejet par segment,
 *                             //   témoin musculaire) : [4] mesure | null, ou null si la fenêtre n'est pas remplie
 *   const offEv = ctx.onEvent((e) => {});   // événements du détecteur (clignements, gestes…), plusieurs abonnés
 *   ctx.detector  ctx.contact  ctx.pipeline  ctx.removedStages (pistes du profil retirées ici)  ctx.events (EventLog)
 *
 * Écarter une électrode suit LA règle de lib/mental-state.js (excludedFor, zones et marges) : usableChannels l'applique
 * à toute la fenêtre de 4 s (calibrations qui veulent 4 s propres), measureState segment par segment (état mental).
 * Horloge = échantillons reçus (et non Date.now()) : juste même si les paquets arrivent par rafales ou en test accéléré.
 */
class CalibrationContext {
  static WINDOW_S = 4;

  constructor(rate = 256) {
    this.rate = rate;
    this.detector = ArtifactDetector.forProfile(rate);
    this.contact = new ContactQuality(rate);
    const sp = MentalState.statePipeline(SignalPipeline.loadSaved(rate));
    this.pipeline = sp.pipeline;
    this.removedStages = sp.removed;
    this.events = new MentalState.EventLog();
    this._n = 0; // échantillons reçus sur le canal 0
    this._buf = [[], [], [], []];
    this._raw = [[], [], [], []];
    this._listeners = [];
    this.detector.onEvent = (e) => {
      this.events.add({ ...e, time: (e.sample * 1000) / rate });
      this._listeners.forEach((fn) => fn(e));
    };
    const max = CalibrationContext.WINDOW_S * rate;
    const keep = (b, v) => { b.push(...v); if (b.length > max) b.splice(0, b.length - max); };
    this.pipeline.onSamples = (raw, clean) => clean.forEach((v, c) => { keep(this._buf[c], v); keep(this._raw[c], raw[c]); });
  }

  feed(channel, samples) {
    if (channel === 0) this._n += samples.length;
    this.pipeline.feed(channel, samples);
    this.detector.feed(channel, samples); // le détecteur et le contact travaillent sur le BRUT (seuils définis sur le brut)
    this.contact.feed(channel, samples);
  }

  feedPpg(channel, samples) { this.detector.feedPpg(channel, samples); }   // pouls : voir ArtifactDetector.feedPpg

  onEvent(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter((f) => f !== fn); };
  }

  get ready() {
    return this.detector.ready && this._buf[0].length >= CalibrationContext.WINDOW_S * this.rate;
  }

  window(seconds = CalibrationContext.WINDOW_S) { return this._last(this._buf, seconds); }

  rawWindow(seconds = CalibrationContext.WINDOW_S) { return this._last(this._raw, seconds); }

  _last(bufs, seconds) {
    const n = Math.round(seconds * this.rate);
    if (bufs.some((b) => b.length < n)) return null;
    return bufs.map((b) => b.slice(b.length - n));
  }

  _goodContact() {
    return this.contact.levels.map((l, i) => (l.label === 'bon' || l.label === 'moyen' ? i : -1)).filter((i) => i >= 0);
  }

  usableChannels() {
    const out = this.events.excluded(this.detector.active, CalibrationContext.WINDOW_S, (this._n * 1000) / this.rate);
    return this._goodContact().filter((i) => !out.has(i));
  }

  measureState() {
    const W = CalibrationContext.WINDOW_S, win = this.window(W), raw = this.rawWindow(W);
    if (!win || !raw) return null;
    const good = this._goodContact(), now = (this._n * 1000) / this.rate;
    return MentalState.measure(win.map((w, i) => (good.includes(i) ? w : null)),
      { rate: this.rate, raw, events: this.events.recent(this.detector.active, W, now), t0: now / 1000 - W });
  }
}
