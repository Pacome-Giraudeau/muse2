/* Détection d'artefacts en temps réel (globale `ArtifactDetector`) : clignements, sourcils, mâchoire,
 * bâillements, regards gauche/droite. Dépend de Muse.EEG_NAMES, Signal (lib/signal.js) et, à la construction, de
 * Biquad (lib/filters.js, coupe-bande secteur). Indépendant de l'interface.
 *
 * Usage :
 *   const detector = ArtifactDetector.forProfile();   // calibration, sensibilité et secteur (50/60 Hz) du profil actif
 *   const detector = new ArtifactDetector();          // ou : réglages par défaut ({ mainsHz: 60 } pour le secteur à 60 Hz)
 *   muse.onEEG = (canal, echantillons) => detector.feed(canal, echantillons);
 *   detector.onEvent = (e) => {};
 *   detector.setSensitivity(1);       // < 1 = plus sensible, > 1 = moins sensible (multiplie les seuils)
 *   detector.applyCalibration(cal);   // seuils personnalisés, voir lib/calibration.js
 *   detector.isContaminated(1000);    // un artefact récent/en cours ? (EEG à ignorer)
 *   detector.resync();                // sur muse.on('resync') : files et filtres à neuf, compteurs gardés
 *
 * État lisible :
 *   detector.ready        false pendant ~3 s d'apprentissage du bruit de fond
 *   detector.active       { frown, jaw, gaze } en cours
 *   detector.counts       { blink, frown, jaw, yawn, 'gaze-left', 'gaze-right' } depuis reset()
 *   detector.features     valeurs mesurées en µV : { blink, frontalHF, temporalHF, gaze (signé) } + ppg (rapport sans unité, voir feedPpg)
 *   detector.levels       features / seuil : 1 = seuil atteint { blink, frown, jaw, gaze, ppg (0 si pas de seuil de pouls) }
 *   detector.feedPpg(canal, échantillons)   // pouls (canal 1 = infrarouge, 64 Hz) : indice fort des sourcils (seuil calibré
 *                         thresholds.ppg, sinon cfg.ppgFrown = 4,5) ; sans appel : EEG seul, comme avant
 *   detector.thresholds   seuils effectifs en µV { blink, frown, jaw, gaze } (gazeLeft / gazeRight : un seuil par direction si calibré)
 *   detector.onFrame      callback(features) ~32 fois/s (utilisé par la calibration)
 *   ArtifactDetector.detectOffline(canaux, heures, { calibration, mainsHz })   détection sur un enregistrement entier
 *   ArtifactDetector.profileMainsHz()   secteur du profil actif (50 / 60 Hz), ex. detectOffline(…, { mainsHz: … })
 *
 * Événements (onEvent), `time` = Date.now() :
 *   { type: 'blink', amplitude, durationMs }                         un seul événement
 *   { type: 'frown' | 'gaze-left' | 'gaze-right', phase: 'start' | 'end', level, durationMs? }
 *   { type: 'jaw' | 'yawn', phase: 'end', level, durationMs }        émis à la fin de l'épisode ; un épisode
 *       de mâchoire long impliquant yeux/front est classé 'yawn' (bâillement) au lieu de 'jaw'.
 *   Pour la mâchoire, un 'start' (type 'jaw') est aussi émis dès que l'activité commence (voyant en direct).
 *
 * Principe (heuristique ; les seuils réels viennent de la calibration). Le détecteur travaille TOUJOURS sur le signal BRUT
 * (jamais sur la sortie de lib/filters.js : passe-haut, passe-bas et référence moyenne déplacent les niveaux, mesuré :
 * mâchoire et regard disparaissent, clignement x3) ; sa calibration aussi. Il juge la FORME, pas seulement le seuil :
 *   - clignement : déflexion lente (< 10 Hz) de la moyenne AF7/AF8, BRÈVE (< 450 ms tant que le front est actif) et sans
 *     indice du front ; une déflexion qui dure avec de l'énergie rapide au front, ou un pouls au-dessus du seuil, est
 *     abandonnée (ce sont des sourcils) et le clignement ne se réarme qu'une fois le signal sous la moitié du seuil
 *   - sourcils : énergie > 15 Hz sur AF7+AF8 ; le pouls est un indice fort : pouls au-dessus du seuil ET EEG du front à
 *     PPG_ASSIST (50 %) de son seuil suffisent ; un clignement en cours ne les bloque pas s'il y a indice du front
 *   - mâchoire : énergie > 15 Hz sur TP9+TP10, secteur (mainsHz et son harmonique) retiré par un coupe-bande avant
 *     l'enveloppe ; le plus fort (relatif à son seuil) gagne ; pendant un clignement, un pic des tempes n'est une mâchoire
 *     que s'il dépasse jawBlinkMinLevel (un clignement appuyé recrute un peu les tempes) ; jamais pendant des sourcils
 *   - regard : différence AF7 − AF8 par rapport à une ligne de base très lente (signe = gauche/droite), figée pendant
 *     clignement, sourcils, mâchoire et écart énorme ; seuil propre à chaque direction (gazeLeft / gazeRight) ; la
 *     contre-déviation du retour au centre (jusqu'à 1,5 fois le pic, dans les 1,2 s qui suivent) n'est pas comptée comme
 *     un regard de l'autre côté ; pas de regard pour un écart > 8 fois le seuil (sourcils) ni 2 s après des sourcils
 *   - bâillement : épisode de mâchoire long + front/yeux engagés
 */
class ArtifactDetector {
  static PPG_ASSIST = 0.5;   // part du seuil EEG des sourcils qui suffit quand le pouls confirme un mouvement du front
  static EVENTS = ['blink', 'frown', 'jaw', 'yawn', 'gaze-left', 'gaze-right'];
  static FRAME_DECIMATION = 8; // onFrame tous les 8 échantillons

  // Valeurs par défaut (avant calibration). Les seuils sont en µV.
  static DEFAULTS = {
    blinkUv: 70, frownUv: 8, jawUv: 8, gazeUv: 25,
    kOn: 2.5,                 // seuil musculaire auto = kOn x bruit de fond appris
    blinkMinMs: 60, blinkMaxMs: 900, blinkRefractoryMs: 200,
    onMs: 60, offMs: 150, offRatio: 0.6,        // muscle : durée de validation / de fin, niveau de fin
    gazeMinMs: 150, gazeMaxMs: 8000, gazeOffMs: 100,
    gazeReturnMs: 1200, gazeReturnRatio: 1.5,  // retour au centre : contre-déviation ignorée (voir _updateGaze)
    ppgFrown: 4.5,            // rapport de pouls (features.ppg) qui trahit un mouvement du front, si la calibration n'en donne pas
    blinkFrownMs: 450,        // déflexion qui dure plus longtemps avec l'énergie rapide du front encore au-dessus du seuil : sourcils
    gazeAfterFrontMs: 2000,   // pas de regard dans ce délai après des sourcils
    gazeMaxFactor: 8,        // écart AF7 − AF8 au-delà de 8 x le seuil de regard : déflexion des sourcils, pas un regard
    jawBlinkMinLevel: 1.55,   // pendant un clignement, un pic des tempes n'est une mâchoire que s'il dépasse ce niveau (x seuil)
    yawnMinMs: 1800, yawnRatio: 0.8,
    warmupS: 3,
    mainsHz: 50, mainsQ: 5,   // coupe-bande secteur avant l'enveloppe musculaire (Q = 5 : 45–55 Hz et 90–110 Hz à -3 dB ;
                              // assez large pour un parasite dont l'amplitude change en ~0,1 s, Q = 10 ne suffisait pas)
  };

  // Détecteur réglé pour le profil actif : calibration mémorisée (lib/calibration.js), sensibilité
  // (« artifactSensitivity ») et fréquence du secteur choisie dans les filtres (« pipeline », 50 ou 60 Hz).
  static forProfile(rate = 256) {
    const det = new ArtifactDetector({ mainsHz: ArtifactDetector.profileMainsHz() }, rate);
    const cal = Calibrator.load(); // lib/calibration.js, chargé après ce fichier : référencé seulement à l'appel
    if (cal) det.applyCalibration(cal);
    det.setSensitivity(Profiles.get('artifactSensitivity', 1));
    return det;
  }

  // Fréquence du secteur du profil actif (filtre secteur mémorisé, « pipeline ») : 60, sinon 50 Hz.
  // À passer à detectOffline({ mainsHz }) pour analyser un enregistrement comme en direct.
  static profileMainsHz() {
    const pipe = Profiles.get('pipeline', null), hz = pipe && pipe.params && pipe.params.notch;
    return hz === 60 ? 60 : 50;
  }

  constructor(config = {}, rate = 256) {
    this.cfg = { ...ArtifactDetector.DEFAULTS, ...config };
    this.rate = rate;
    this.sensitivity = 1;
    this.cal = null;
    this.onEvent = null;
    this.onFrame = null;

    const a = (fc) => Signal.onePoleCoef(fc, rate), tau = (s) => Signal.smoothCoef(s, rate);
    this._a = { base: a(0.1), lp: a(10), hf: a(15), env: tau(0.06), slow: tau(5), gaze: tau(10), fast: 0.01 };
    // Coupe-bande secteur (fréquence + harmonique sous Nyquist) avant l'enveloppe > 15 Hz : sans lui, un parasite
    // 50 Hz dont l'amplitude varie (câble, mouvement) passerait pour des sourcils. Biquad vient de lib/filters.js,
    // chargé après ce fichier : il n'est utilisé qu'à l'exécution (reset(), appelé par le constructeur), quand toutes
    // les briques sont chargées.
    this._mainsFreqs = [this.cfg.mainsHz, 2 * this.cfg.mainsHz].filter((f) => f < rate / 2 - 4);

    this.features = { blink: 0, frontalHF: 0, temporalHF: 0, gaze: 0, ppg: 0 };
    this.levels = { blink: 0, frown: 0, jaw: 0, gaze: 0, ppg: 0 };
    this._aPpg = { base: Signal.smoothCoef(1.5, 64), env: Signal.smoothCoef(0.25, 64), ref: Signal.smoothCoef(8, 64), refSlow: Signal.smoothCoef(60, 64) };
    this.reset();
  }

  /* ---------- Configuration ---------- */

  reset() {
    const notch = () => this._mainsFreqs.map((f) => new Biquad(Biquad.design('notch', f, this.rate, this.cfg.mainsQ)));
    this._ch = Muse.EEG_NAMES.map(() => ({ init: false, base: 0, lp: 0, hf: 0, env: 0, notch: notch(), queue: [] }));
    this._n = 0;
    this._m = { frown: this._newMuscle(), jaw: this._newMuscle() };
    this._blink = { inBlink: false, startN: 0, peak: 0, refractoryUntil: 0, armed: true };
    this._evidence = false;
    this._gaze = { base: null, active: false, above: 0, below: 0, startN: 0, dir: null, lastD: 0, peak: 0, last: null, thr: 0, frozen: 0, frontN: -1e9 };
    this._ppg = { base: null, env: 0, ref: 0, n: 0, lastN: -1e9 };
    this._lastArtifactAt = 0;
    this.counts = { blink: 0, frown: 0, jaw: 0, yawn: 0, 'gaze-left': 0, 'gaze-right': 0 };
    this.active = { frown: false, jaw: false, gaze: false };
  }

  // Après un « resync » de Muse (trou de paquets non comblé) : repart à neuf (files d'alignement, filtres, épisodes en
  // cours) mais garde les compteurs d'artefacts.
  resync() {
    const counts = this.counts;
    this.reset();
    this.counts = counts;
  }

  setSensitivity(factor) { this.sensitivity = factor; }

  // Pouls (PPG infrarouge, canal 1, 64 Hz) : le capteur est sur le FRONT, froncer les sourcils le déforme et fait bouger la
  // lumière reçue. `features.ppg` = enveloppe de l'écart à une ligne de base lente (τ 1,5 s) rapportée à sa valeur
  // « calme » (suivie lentement, τ 8 s) : ≈ 1 au repos, grand pendant un mouvement du front. Il ne sert que si la
  // calibration des sourcils a trouvé un seuil `thresholds.ppg` (le pouls réagit bien chez cette personne).
  feedPpg(channel, samples) {
    if (channel !== 1) return;
    const p = this._ppg, a = this._aPpg;
    for (const x of samples) {
      if (p.base === null) p.base = x;
      p.base += a.base * (x - p.base);
      p.env += a.env * (Math.abs(x - p.base) - p.env);
      p.n++;
      if (p.n < 128) { p.ref = p.env; this.features.ppg = 1; continue; }   // 2 s d'apprentissage de la référence
      const ratio = p.env / Math.max(p.ref, 1e-3);
      // la référence « calme » ne suit pas un mouvement (rapide), mais se recale très lentement (τ 60 s) si le capteur change
      p.ref += (ratio < 1.5 ? a.ref : a.refSlow) * (p.env - p.ref);
      this.features.ppg = ratio;
    }
    p.lastN = this._n;
  }
  applyCalibration(cal) { this.cal = cal; }
  clearCalibration() { this.cal = null; }
  get calibrated() { return !!this.cal; }
  get ready() { return this._n >= this.cfg.warmupS * this.rate; }

  get thresholds() {
    return { blink: this._thr('blink'), frown: this._thr('frown'), jaw: this._thr('jaw'), gaze: this._thr('gaze') };
  }

  isContaminated(windowMs = 1000) {
    const a = this.active;
    return a.frown || a.jaw || a.gaze || Date.now() - this._lastArtifactAt < windowMs;
  }

  _thr(name) {
    const s = this.sensitivity, d = this.cfg;
    if (name === 'gazeLeft' || name === 'gazeRight') { // un seuil par direction si la calibration en a mesuré un
      const c = this.cal && this.cal.thresholds && this.cal.thresholds[name];
      return c != null ? c * s : this._thr('gaze');
    }
    const calibrated = this.cal && this.cal.thresholds && this.cal.thresholds[name];
    if (calibrated != null) return calibrated * s;
    if (name === 'blink') return d.blinkUv * s;
    if (name === 'gaze') return d.gazeUv * s;
    const base = this._m[name].base || 0; // muscle : seuil auto = max(minimum, kOn x bruit de fond)
    return Math.max((name === 'frown' ? d.frownUv : d.jawUv) * s, d.kOn * base);
  }

  _samples(ms) { return (ms / 1000) * this.rate; }
  _newMuscle() { return { base: null, active: false, above: 0, below: 0, startN: 0, peak: 0, peakEye: 0, peakFront: 0 }; }

  /* ---------- Entrée des données ---------- */

  // Reçoit un paquet d'échantillons d'un canal ; traite dès que les 4 canaux ont de la donnée.
  feed(channel, samples) {
    const c = this._ch[channel], a = this._a;
    for (const s of samples) {
      if (!c.init) { c.base = c.lp = s; c.init = true; }
      c.base += a.base * (s - c.base);   // dérive lente
      c.lp += a.lp * (s - c.lp);         // passe-bas 10 Hz
      const x = c.notch.reduce((v, f) => f.step(v), s) - c.base; // secteur retiré (le continu passe, gain 1)
      c.hf += a.hf * (x - c.hf);
      c.env += a.env * (Math.abs(x - c.hf) - c.env); // enveloppe de l'énergie > 15 Hz, hors secteur
      c.queue.push({ blink: c.lp - c.base, lp: c.lp, env: c.env });
    }
    this._flush();
  }

  _flush() {
    const q = this._ch.map((c) => c.queue);
    const n = Math.min(...q.map((x) => x.length));
    for (let i = 0; i < n; i++) this._step(q.map((x) => x[i]));
    q.forEach((x) => x.splice(0, n));
    q.forEach((x) => { if (x.length > 512) x.splice(0, x.length - 512); }); // canal muet : on ne laisse pas grossir
  }

  /* ---------- Traitement d'un instant (4 canaux alignés) ---------- */

  _step([tp9, af7, af8, tp10]) {
    const n = ++this._n, f = this.features, g = this._gaze, a = this._a, ready = this.ready, cfg = this.cfg;
    const sign = (this.cal && this.cal.gazeSign) || 1;

    f.blink = Math.abs((af7.blink + af8.blink) / 2);
    f.frontalHF = (af7.env + af8.env) / 2;
    f.temporalHF = (tp9.env + tp10.env) / 2;

    const d = af7.lp - af8.lp;
    g.lastD = d;
    if (g.base === null) g.base = d;
    const tg = this._thr((d - g.base) * sign > 0 ? 'gazeLeft' : 'gazeRight'); // seuil de la direction de l'écart
    if (!ready) g.base += a.fast * (d - g.base);
    else if (!g.active) {
      // Base très lente, figée pendant un regard, un clignement, un froncement ou une mâchoire, et tant que l'écart
      // reste énorme (> 3 x le seuil : froncement qui s'éteint) pour qu'ils ne la décalent pas ; au-delà de 10 s
      // d'écart énorme, c'est un vrai décalage durable et la base le suit.
      const huge = Math.abs(d - g.base) > 3 * tg && g.frozen < 10 * this.rate;
      g.frozen = huge ? g.frozen + 1 : 0;
      const busy = this.active.frown || this.active.jaw || this._blink.inBlink || this._evidence;
      if (!huge && !busy) g.base += a.gaze * (d - g.base);
    }
    f.gaze = d - g.base;

    if (this._m.frown.base === null) { this._m.frown.base = f.frontalHF; this._m.jaw.base = f.temporalHF; }

    const tb = this._thr('blink'), tf = this._thr('frown'), tj = this._thr('jaw');
    const L = this.levels;
    L.blink = f.blink / tb; L.frown = f.frontalHF / tf; L.jaw = f.temporalHF / tj; L.gaze = Math.abs(f.gaze) / tg;
    // Sourcils + pouls : le pouls (capteur sur le front) ne bouge presque que pour les sourcils. Seuil calibré
    // (thresholds.ppg), sinon ppgFrown. Si le front bouge (pouls au-dessus du seuil, mesuré en direct) ET que l'EEG rapide
    // du front monte déjà à mi-chemin du seuil, on compte un froncement (deux indices faibles qui concordent).
    const tp = (this.cal && this.cal.thresholds && this.cal.thresholds.ppg) || cfg.ppgFrown, ppgFresh = n - this._ppg.lastN < this.rate;
    L.ppg = ppgFresh ? f.ppg / (tp * this.sensitivity) : 0;
    const frownLevel = L.ppg >= 1 && L.frown >= ArtifactDetector.PPG_ASSIST ? Math.max(L.frown, 1.01) : L.frown;
    // Le front travaille franchement (pouls, ou déflexion longue dont l'énergie rapide ne retombe pas : un clignement,
    // même appuyé, n'y reste pas) : ce n'est pas un clignement, et les pics des tempes qui l'accompagnent ne sont pas
    // une mâchoire. Mesuré : sourcils 1,5 à 2,8 s de déflexion, clignements < 0,5 s.
    const bl = this._blink;
    this._evidence = L.ppg >= 1 || (bl.inBlink && n - bl.startN > this._samples(cfg.blinkFrownMs) && L.frown >= 1);

    if (n % ArtifactDetector.FRAME_DECIMATION === 0 && this.onFrame) this.onFrame(f);

    if (!ready) {
      this._m.frown.base += a.fast * (f.frontalHF - this._m.frown.base);
      this._m.jaw.base += a.fast * (f.temporalHF - this._m.jaw.base);
      return;
    }
    const b = this._blink;
    const blinkBusy = b.inBlink || n < b.refractoryUntil;
    // Un clignement n'empêche les sourcils que sans indice du front ; il n'empêche la mâchoire que si le pic des tempes
    // est faible (un clignement appuyé les recrute un peu) ; sourcils en cours ou indice du front : pas de mâchoire.
    this._updateMuscle('frown', f.frontalHF, frownLevel, L.jaw, blinkBusy && !this._evidence);
    this._updateMuscle('jaw', f.temporalHF, L.jaw, L.frown,
      (blinkBusy && L.jaw < cfg.jawBlinkMinLevel) || this.active.frown || this._evidence);
    this._updateBlink(f.blink, tb);
    this._updateGaze(f.gaze, tg, blinkBusy, sign);
  }

  // Clignement : déflexion lente BRÈVE sans indice du front. Une déflexion qui s'accompagne de sourcils (pouls ou énergie
  // rapide du front) n'est pas un clignement : on l'abandonne, et on ne se réarme qu'une fois le signal revenu sous la
  // moitié du seuil (sinon la déflexion des sourcils, qui s'éteint lentement, donnerait des clignements en série).
  _updateBlink(amp, thr) {
    const b = this._blink, cfg = this.cfg, n = this._n, ms = (k) => (k / this.rate) * 1000;
    const front = this.active.frown || this._evidence;
    if (!b.inBlink) {
      if (amp < thr * 0.5) b.armed = true;
      else if (front || this.active.jaw) b.armed = false;
      if (amp > thr && b.armed && n >= b.refractoryUntil && !this.active.jaw && !front) { b.inBlink = true; b.startN = n; b.peak = amp; }
      return;
    }
    if (front) { b.inBlink = false; b.armed = false; b.refractoryUntil = n + this._samples(cfg.blinkRefractoryMs); return; }
    b.peak = Math.max(b.peak, amp);
    const durationMs = ms(n - b.startN);
    if (amp < thr * 0.5) {
      b.inBlink = false;
      b.refractoryUntil = n + this._samples(cfg.blinkRefractoryMs);
      if (durationMs >= cfg.blinkMinMs && durationMs <= cfg.blinkMaxMs) {
        this.counts.blink++;
        this._emit({ type: 'blink', amplitude: b.peak, durationMs });
      }
    } else if (durationMs > cfg.blinkMaxMs) { // déflexion trop longue : ce n'est pas un clignement
      b.inBlink = false; b.armed = false;
      b.refractoryUntil = n + this.rate;
    }
  }

  // Activité musculaire : 'frown' (AF7/AF8) ou 'jaw' (TP9/TP10). `level` = valeur / seuil.
  _updateMuscle(type, value, level, otherLevel, suppress) {
    const m = this._m[type], cfg = this.cfg, n = this._n, L = this.levels;
    if (!m.active) {
      if (level < 1) m.base += this._a.slow * (value - m.base);
      m.above = !suppress && level > 1 && level >= otherLevel ? m.above + 1 : 0;
      if (m.above < this._samples(cfg.onMs)) return;
      m.active = true; this.active[type] = true;
      m.startN = n - m.above; m.below = 0;
      m.peak = level; m.peakEye = L.blink; m.peakFront = L.frown;
      if (type === 'frown') this.counts.frown++;
      this._emit({ type, phase: 'start', level });
      return;
    }
    m.peak = Math.max(m.peak, level);
    m.peakEye = Math.max(m.peakEye, L.blink);
    m.peakFront = Math.max(m.peakFront, L.frown);
    m.below = level < cfg.offRatio ? m.below + 1 : 0;
    this._lastArtifactAt = Date.now();
    if (m.below < this._samples(cfg.offMs)) return;

    m.active = false; this.active[type] = false; m.above = 0;
    const durationMs = ((n - m.below - m.startN) / this.rate) * 1000;
    if (type === 'frown') return this._emit({ type, phase: 'end', level: m.peak, durationMs });

    const yawnMinMs = (this.cal && this.cal.yawnMinMs) || cfg.yawnMinMs;
    const involved = m.peakEye >= cfg.yawnRatio || m.peakFront >= cfg.yawnRatio;
    if (durationMs >= yawnMinMs && involved) {
      this.counts.yawn++;
      this._emit({ type: 'yawn', phase: 'end', level: m.peak, durationMs });
    } else {
      this.counts.jaw++;
      this._emit({ type: 'jaw', phase: 'end', level: m.peak, durationMs });
    }
  }

  // Regard latéral : écart AF7 − AF8 maintenu. Signe positif = gauche (inversé si calibration le demande).
  _updateGaze(dev, thr, blinkBusy, sign = 1) {
    const g = this._gaze, cfg = this.cfg, n = this._n, abs = Math.abs(dev);
    if (!g.active) {
      if (this._evidence || this.active.frown) g.frontN = n;
      // Pas de regard pendant les sourcils ni dans les gazeAfterFrontMs qui suivent (la déflexion s'éteint lentement)
      const free = !blinkBusy && !this.active.jaw && n - g.frontN > this._samples(cfg.gazeAfterFrontMs) && abs < cfg.gazeMaxFactor * thr;
      // Retour au centre : juste après un regard, l'œil qui revient (et le filtre passe-haut du casque) donne une
      // contre-déviation de signe opposé, aussi grande que l'aller (mesuré : 0,8 à 1,3 fois le pic). Dans les gazeReturnMs
      // qui suivent, tant qu'elle reste sous gazeReturnRatio fois le pic, ce n'est pas un regard de l'autre côté.
      const last = g.last, back = last && (dev * sign > 0 ? 'gaze-left' : 'gaze-right') !== last.dir
        && n - last.endN < this._samples(cfg.gazeReturnMs) && abs < cfg.gazeReturnRatio * last.peak;
      g.above = free && !back && abs > thr ? g.above + 1 : 0;
      if (g.above < this._samples(cfg.gazeMinMs)) return;
      g.active = true; this.active.gaze = true;
      g.dir = dev * sign > 0 ? 'gaze-left' : 'gaze-right';
      g.startN = n - g.above; g.below = 0; g.peak = abs; g.thr = thr;
      this.counts[g.dir]++;
      this._emit({ type: g.dir, phase: 'start', level: abs / thr });
      return;
    }
    g.below = abs < g.thr * 0.5 ? g.below + 1 : 0;
    g.peak = Math.max(g.peak, abs);
    this._lastArtifactAt = Date.now();
    const tooLong = n - g.startN > this._samples(cfg.gazeMaxMs);
    const notGaze = abs > cfg.gazeMaxFactor * g.thr || this._evidence; // déflexion énorme ou front engagé : sourcils, pas regard
    if (g.below < this._samples(cfg.gazeOffMs) && !tooLong && !notGaze) return;
    if (tooLong) g.base = g.lastD; // décalage durable : on le prend comme nouvelle référence
    g.active = false; this.active.gaze = false; g.above = 0;
    g.last = { dir: g.dir, peak: g.peak, endN: n };
    this._emit({ type: g.dir, phase: 'end', durationMs: ((n - g.startN) / this.rate) * 1000 });
  }

  _emit(event) {
    this._lastArtifactAt = Date.now();
    if (this.onEvent) this.onEvent({ time: Date.now(), sample: this._n, ...event });
  }

  // Détection sur un enregistrement entier (hors temps réel). channels : 4 tableaux alignés ; times : heure (ms) de
  // chaque échantillon. Retourne [{ type, start (ms), duration (ms) }] : un élément par événement complet.
  static detectOffline(channels, times, { calibration = null, rate = 256, mainsHz = 50 } = {}) {
    const det = new ArtifactDetector({ mainsHz }, rate), out = [], open = {};
    if (calibration) det.applyCalibration(calibration);
    const at = (sample) => times[Math.max(0, Math.min(times.length - 1, sample - 1))];
    det.onEvent = (e) => {
      const t = at(e.sample);
      if (e.type === 'blink') out.push({ type: 'blink', start: t - e.durationMs, duration: e.durationMs });
      else if (e.phase === 'start') open[e.type] = t;
      else {
        const key = e.type === 'yawn' ? 'jaw' : e.type; // un bâillement termine un épisode commencé comme « mâchoire »
        const start = open[key] != null ? open[key] : t - e.durationMs;
        delete open[key];
        out.push({ type: e.type, start, duration: e.durationMs != null ? e.durationMs : t - start });
      }
    };
    const n = Math.min(...channels.map((c) => c.length));
    for (let i = 0; i < n; i += 12) for (let c = 0; c < 4; c++) det.feed(c, Array.from(channels[c].slice(i, Math.min(n, i + 12))));
    return out;
  }
}
