/* Simulateur de signal Muse (globale `SignalSimulator`) : fabrique un EEG réaliste et ses défauts typiques,
 * pour tester sans casque. Mêmes événements 'eeg' que lib/muse.js (canal, 12 échantillons en µV).
 *
 *   const sim = new SignalSimulator();
 *   const off = sim.on('eeg', (canal, echantillons) => {});
 *   sim.start();  sim.stop();
 *   sim.generate(n)   // -> [4][n] échantillons, sans temps réel (tests)
 *   sim.act(geste)    // « joue » un geste en boucle jusqu'au prochain act() (démonstration des calibrations) :
 *                     //   'blink' | 'frown' | 'jaw' | 'yawn' | 'left' | 'right' | 'closed' (yeux fermés) | null (rien)
 *   sim.on('ppg', (canal, échantillons) => …) ; sim.generatePpg(n) -> [3][n] : pouls 64 Hz (la pulsation + un mouvement du front pendant 'frown')
 *   sim.look(p)       // regard guidé : suit un point de -1 (droite) à +1 (gauche), null = rien (étape « Regard guidé »)
 *
 * Contenu (canaux TP9, AF7, AF8, TP10) : décalage continu, dérive lente, rythme alpha à 10 Hz (plus fort
 * derrière les oreilles), theta 6 Hz et bêta 18-23 Hz optionnels (cfg.theta, cfg.beta ; cfg.gain modifiable en marche),
 * bruit de fond, parasite secteur 50 Hz (+ harmonique 100 Hz), clignements sur le front
 * (un peu sur TP9/TP10), pics isolés rares. Les amplitudes (`SignalSimulator.DEFAULTS`) sont des ordres de
 * grandeur plausibles, pas des mesures.
 * Gestes joués (act) : sourcils = bouffées musculaires (bruit large bande) sur le front 1 s sur 2, mâchoire = idem sur
 * les tempes, bâillement = 2,5 s sur 6 sur tous les canaux, regards = écart AF7/AF8 de ±GAZE_UV µV 2 s sur 4,
 * clignements toutes les ~1,5 s, yeux fermés = alpha × CLOSED_ALPHA et plus de clignements. Formes simplifiées.
 */
class SignalSimulator {
  static DEFAULTS = {
    offsets: [20, 300, -200, 50],   // µV, décalage continu par canal
    drift: 80,                      // µV, amplitude de la dérive lente
    alpha: [14, 8, 8, 14],          // µV, rythme alpha 10 Hz par canal
    theta: 0, beta: 0,              // µV, theta (6 Hz) et bêta (18 + 23 Hz), absents par défaut
    gain: { theta: 1, alpha: 1, beta: 1 }, // multiplicateurs modifiables en marche (démonstrations)
    noise: 4,                       // µV, bruit de fond
    mains: 25, mainsHz: 50,         // µV, parasite secteur
    blink: 150, blinkSide: 0.2,     // µV sur le front ; fraction vue sur TP9/TP10
    blinkEveryS: 4,
    spikePerS: 0.3, spike: 400,     // pics isolés : fréquence moyenne par canal, amplitude µV
  };

  static GAZE_UV = 60;
  static PPG_MOTION = 2500;   // amplitude brute du mouvement du front vu par le pouls (4 × l'amplitude de la pulsation)
  static CLOSED_ALPHA = 2.5;

  constructor(config = {}, rate = 256, seed = 12345) {
    this.cfg = { ...SignalSimulator.DEFAULTS, ...config };
    this.cfg.gain = { ...SignalSimulator.DEFAULTS.gain, ...(config.gain || {}) }; // copie : propre à ce simulateur
    this.rate = rate;
    this._seed = seed;
    this._n = 0;
    this._nextBlink = this.cfg.blinkEveryS * rate;
    this._blinkAt = -1;
    this._handlers = [];
    this._ppgHandlers = []; this._np = 0;
    this._timer = null;
    this._act = null;
    this._look = null; this._lookV = 0;
    this._actN = 0;
  }

  act(gesture) {
    if (gesture === this._act) return;
    this._act = gesture || null;
    this._actN = this._n;
    if (gesture === 'blink') this._nextBlink = this._n + Math.round(0.5 * this.rate);
  }

  // Regard guidé : position du point suivi, de -1 (droite) à +1 (gauche), null = pas de point. L'écart AF7 − AF8 vaut
  // GAZE_UV × position, rattrapé en ~0,15 s (le regard ne saute pas instantanément).
  look(p) { this._look = p == null ? null : Math.max(-1, Math.min(1, p)); if (p == null) this._lookV = 0; }

  // Contribution du geste joué à l'instant courant : { front, temples (écart-type µV du bruit musculaire), gaze (µV) }
  _gesture() {
    const t = (this._n - this._actN) / this.rate, on = (period, len) => t % period < len;
    switch (this._act) {
      case 'frown': return { front: on(2, 1) ? 70 : 0, temples: on(2, 1) ? 8 : 0, gaze: 0 };
      case 'jaw': return { front: on(2, 1) ? 10 : 0, temples: on(2, 1) ? 80 : 0, gaze: 0 };
      case 'yawn': return { front: on(6, 2.5) ? 50 : 0, temples: on(6, 2.5) ? 80 : 0, gaze: 0 };
      case 'left': case 'right': {
        const p = t % 4, ramp = Math.min(1, p / 0.1, Math.max(0, (2.1 - p) / 0.1)); // aller-retour adouci
        return { front: 0, temples: 0, gaze: (p < 2.1 ? ramp : 0) * SignalSimulator.GAZE_UV * (this._act === 'left' ? 1 : -1) };
      }
      default: return { front: 0, temples: 0, gaze: this._look == null ? 0 : this._lookNow() };
    }
  }

  _lookNow() {   // appelé une fois par échantillon (via _gesture) : lissage d'ordre 1, tau ≈ 0,15 s
    this._lookV += (this._look * SignalSimulator.GAZE_UV - this._lookV) / (0.15 * this.rate);
    return this._lookV;
  }

  on(event, fn) {
    if (event === 'ppg') {
      this._ppgHandlers.push(fn);
      return () => { this._ppgHandlers = this._ppgHandlers.filter((h) => h !== fn); };
    }
    if (event === 'eeg') this._handlers.push(fn);
    return () => { this._handlers = this._handlers.filter((h) => h !== fn); };
  }

  start() {
    if (this._timer) return;
    let last = performance.now(), budget = 0, ppgBudget = 0;
    this._timer = setInterval(() => {
      const now = performance.now();
      budget += ((now - last) / 1000) * this.rate;
      ppgBudget += ((now - last) / 1000) * 64;
      last = now;
      while (ppgBudget >= 6 && this._ppgHandlers.length) {
        ppgBudget -= 6;
        this.generatePpg(6).forEach((samples, c) => this._ppgHandlers.forEach((h) => h(c, samples)));
      }
      if (!this._ppgHandlers.length) ppgBudget = 0;
      while (budget >= 12) { // paquets de 12 échantillons, comme le casque
        budget -= 12;
        const block = this.generate(12);
        block.forEach((samples, c) => this._handlers.forEach((h) => h(c, samples)));
      }
    }, 20);
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
  }

  // Pouls : [3][n] échantillons à 64 Hz (ambiant, infrarouge, rouge), valeurs brutes. Pulsation à 1,2 Hz (≈ 72/min) ;
  // pendant le geste 'frown' (1 s sur 2), le front bouge : oscillation lente d'amplitude PPG_MOTION (hypothèse de
  // démonstration : non mesurée sur un vrai casque).
  generatePpg(n) {
    const out = [0, 1, 2].map(() => new Array(n));
    for (let i = 0; i < n; i++, this._np++) {
      const t = this._np / 64, ph = (t * 1.2) % 1, pulse = Math.exp(-(((ph - 0.1) / 0.06) ** 2));
      const ta = (this._n - this._actN) / this.rate, moving = this._act === 'frown' && ta % 2 < 1;
      const motion = moving ? SignalSimulator.PPG_MOTION * Math.sin(2 * Math.PI * 2.5 * t) : 0;
      out[0][i] = 20000 + this._gauss(20);
      out[1][i] = 100000 + 600 * pulse + motion + this._gauss(15);
      out[2][i] = 80000 + 400 * pulse + 0.7 * motion + this._gauss(15);
    }
    return out;
  }

  _rnd() { this._seed = (this._seed * 1664525 + 1013904223) >>> 0; return this._seed / 2 ** 32; }
  _gauss(s) { return s * Math.sqrt(-2 * Math.log(this._rnd() + 1e-12)) * Math.cos(2 * Math.PI * this._rnd()); }

  generate(n) {
    const c = this.cfg, out = [0, 1, 2, 3].map(() => new Array(n));
    const blinkLen = Math.round(0.3 * this.rate);
    for (let i = 0; i < n; i++, this._n++) {
      const t = this._n / this.rate;
      const closed = this._act === 'closed', g = this._gesture();
      if (this._n >= this._nextBlink && !closed) {
        this._blinkAt = this._n;
        const every = this._act === 'blink' ? 1.5 : c.blinkEveryS;
        this._nextBlink = this._n + Math.round((every * (0.6 + 0.8 * this._rnd())) * this.rate);
      }
      const k = this._n - this._blinkAt;
      const blink = k >= 0 && k < blinkLen ? c.blink * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / blinkLen)) : 0;
      const mains = c.mains * Math.sin(2 * Math.PI * c.mainsHz * t) + 0.2 * c.mains * Math.sin(4 * Math.PI * c.mainsHz * t);
      const alphaWave = Math.sin(2 * Math.PI * 10 * t) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 0.2 * t)) * c.gain.alpha
        * (closed ? SignalSimulator.CLOSED_ALPHA : 1);
      const thetaWave = c.theta * c.gain.theta * Math.sin(2 * Math.PI * 6 * t + 1);
      const betaWave = c.beta * c.gain.beta * (Math.sin(2 * Math.PI * 18 * t + 2) + Math.sin(2 * Math.PI * 23 * t + 4)) / 2;
      for (let ch = 0; ch < 4; ch++) {
        const frontal = ch === 1 || ch === 2;
        const drift = c.drift * (Math.sin(2 * Math.PI * 0.03 * t + ch) + 0.5 * Math.sin(2 * Math.PI * 0.07 * t + 2 * ch));
        let v = c.offsets[ch] + drift + c.alpha[ch] * alphaWave + thetaWave + betaWave + this._gauss(c.noise) + mains
          + blink * (frontal ? 1 : c.blinkSide);
        const emg = frontal ? g.front : g.temples;
        if (emg) v += this._gauss(emg);
        if (g.gaze && frontal) v += (ch === 1 ? 0.5 : -0.5) * g.gaze;
        if (this._rnd() < c.spikePerS / this.rate) v += (this._rnd() < 0.5 ? -1 : 1) * c.spike;
        out[ch][i] = v;
      }
    }
    return out;
  }
}
