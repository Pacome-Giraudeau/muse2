/* Amélioration numérique du signal EEG, étape par étape et activable (globales `Biquad`, `FirLowpass`, `SignalPipeline`).
 * Indépendant de l'interface. Voir ui/pipeline-panel.js pour les interrupteurs, projets/02-filtres pour la démo.
 *
 * Usage :
 *   const pipe = new SignalPipeline();                 // 256 Hz, étapes par défaut (STAGES[].default)
 *   pipe.onSamples = (brut, propre) => {};             // tableaux [4][n] alignés sur les 4 canaux
 *   muse.on('eeg', (canal, ech) => pipe.feed(canal, ech));
 *   pipe.setEnabled('notch', true);  pipe.setParam('notch', 60);  pipe.isEnabled('car');
 *   pipe.processFrame([tp9, af7, af8, tp10])           // un instant -> 4 valeurs filtrées (tests)
 *   pipe.clone()                                       // même réglages, états neufs
 *   pipe.save();  SignalPipeline.loadSaved()           // réglages partagés entre projets (profil actif, clé « pipeline »)
 *   pipe.settings(), pipe.applySettings(s), pipe.summary()   // réglages bruts, application, résumé lisible
 *   pipe.processOffline([4 tableaux])                  // tout un enregistrement, retard des clignements compensé
 *   pipe.describe()                                    // étapes actives au format BIDS « SoftwareFilters »
 *   pipe.cutoffs(), pipe.prefilterString()             // coupures (BIDS channels.tsv) et champ EDF « prefiltering »
 *
 * Étapes, dans l'ordre d'application (chaque étape est indépendante et désactivable) :
 *   despike   suppression des pics isolés (filtre de Hampel causal, fenêtre de 15 échantillons)
 *   highpass  retrait de la dérive : passe-haut Butterworth d'ordre 2
 *   notch     coupe-bande secteur (50 ou 60 Hz) et son harmonique si elle est sous Nyquist
 *   lowpass   passe-bas Butterworth d'ordre 4 (deux biquads)
 *   eog       réduction des clignements par régression adaptative (NLMS) sur la moyenne frontale lente ;
 *             filtre FIR à phase linéaire : quand l'étape est active, TOUT le signal est retardé de 250 ms
 *   car       référence moyenne commune : on soustrait la moyenne des 4 canaux
 * Les filtres sont causaux (temps réel) : ils retardent un peu le signal et déforment légèrement la phase.
 * Formules des biquads : Audio EQ Cookbook (docs/sources.html, réf. 31).
 */

/* Passe-bas FIR à phase linéaire (sinus cardinal fenêtré par Hamming). Retard constant = (taps − 1) / 2 échantillons
 * pour toutes les fréquences : indispensable pour soustraire une référence sans décalage. */
class FirLowpass {
  constructor(fc, rate, taps = 129) {
    const M = taps - 1, h = [];
    for (let i = 0; i < taps; i++) {
      const k = i - M / 2, x = (2 * fc) / rate;
      const sinc = k === 0 ? x : Math.sin(Math.PI * x * k) / (Math.PI * k);
      h.push(sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / M)));
    }
    const sum = h.reduce((a, b) => a + b, 0);
    this.h = h.map((v) => v / sum); // gain 1 en continu
    this.delay = M / 2;
    this.buf = new Float64Array(taps);
    this.pos = 0;
    this.filled = false;
  }

  // Ajoute x ; retourne { y : sortie filtrée, past : l'entrée d'il y a `delay` échantillons }.
  step(x) {
    const n = this.buf.length;
    if (!this.filled) { this.buf.fill(x); this.filled = true; } // démarrage sans saut
    this.buf[this.pos] = x;
    let y = 0;
    for (let i = 0; i < n; i++) y += this.h[i] * this.buf[(this.pos - i + n) % n];
    const past = this.buf[(this.pos - this.delay + n) % n];
    this.pos = (this.pos + 1) % n;
    return { y, past };
  }
}
class Biquad {
  // type : 'lowpass' | 'highpass' | 'notch' ; f0 en Hz ; Q = facteur de qualité
  static design(type, f0, rate, Q = Math.SQRT1_2) {
    const w0 = (2 * Math.PI * f0) / rate, cos = Math.cos(w0), alpha = Math.sin(w0) / (2 * Q);
    let b;
    if (type === 'lowpass') b = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
    else if (type === 'highpass') b = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
    else if (type === 'notch') b = [1, -2 * cos, 1];
    else throw new Error('type de filtre inconnu : ' + type);
    const a0 = 1 + alpha;
    return { b0: b[0] / a0, b1: b[1] / a0, b2: b[2] / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
  }

  constructor(coefs) {
    this.c = coefs;
    this.z1 = this.z2 = 0;
    this.primed = false;
  }

  // Met le filtre en régime établi pour une entrée constante x0 (évite le saut initial dû au décalage continu).
  prime(x0) {
    const c = this.c, y0 = ((c.b0 + c.b1 + c.b2) / (1 + c.a1 + c.a2)) * x0;
    this.z2 = c.b2 * x0 - c.a2 * y0;
    this.z1 = c.b1 * x0 - c.a1 * y0 + this.z2;
    this.primed = true;
  }

  step(x) {
    if (!this.primed) this.prime(x);
    const c = this.c, y = c.b0 * x + this.z1; // forme directe II transposée
    this.z1 = c.b1 * x - c.a1 * y + this.z2;
    this.z2 = c.b2 * x - c.a2 * y;
    return y;
  }
}

class SignalPipeline {
  static STAGES = [
    { id: 'despike', label: 'Suppression des pics', default: false,
      param: { label: 'Seuil', options: [3, 4, 6], value: 4, unit: '× écart robuste' },
      description: 'Remplace un échantillon isolé aberrant (choc, faux contact) par la médiane de ses voisins récents.' },
    { id: 'highpass', label: 'Retrait de la dérive', default: true,
      param: { label: 'Coupure', options: [0.5, 1, 2], value: 1, unit: 'Hz' },
      description: 'Passe-haut : supprime le décalage continu et les lentes dérives d’électrode (sueur, pression).' },
    { id: 'notch', label: 'Filtre secteur', default: true,
      param: { label: 'Fréquence', options: [50, 60], value: 50, unit: 'Hz' },
      description: 'Coupe-bande étroit sur la fréquence du réseau électrique (50 Hz en Europe) et son harmonique.' },
    { id: 'lowpass', label: 'Passe-bas anti-bruit', default: true,
      param: { label: 'Coupure', options: [30, 40, 45], value: 40, unit: 'Hz' },
      description: 'Atténue le bruit rapide et une partie de l’activité musculaire, au-dessus de la bande EEG utile.' },
    { id: 'eog', label: 'Réduction des clignements', default: false, param: null,
      description: 'Régression adaptative : apprend pendant les clignements la part de signal oculaire sur chaque canal et la soustrait. Retire aussi une partie de l’activité frontale lente (< 6 Hz). Retarde le signal de 250 ms.' },
    { id: 'car', label: 'Référence moyenne commune', default: false, param: null,
      description: 'Soustrait la moyenne des 4 canaux pour supprimer le bruit commun à tous. Avec seulement 4 électrodes, la moyenne est une référence imparfaite.' },
  ];

  static DESPIKE_WINDOW = 15;
  static EOG = { lowpassHz: 6, taps: 129, mu: 0.02, gate: 4, maxWeight: 2 }; // 129 coefficients = 64 éch. = 250 ms de retard

  constructor(rate = 256) {
    this.rate = rate;
    this.onSamples = null;
    this._enabled = {};
    this._param = {};
    for (const s of SignalPipeline.STAGES) {
      this._enabled[s.id] = s.default;
      this._param[s.id] = s.param ? s.param.value : null;
    }
    this.reset();
  }

  /* ---------- Réglages ---------- */

  isEnabled(id) { return !!this._enabled[id]; }
  getParam(id) { return this._param[id]; }

  setEnabled(id, on) {
    this._enabled[id] = !!on;
    this._build(id);
  }

  setParam(id, value) {
    this._param[id] = value;
    this._build(id);
  }

  /* ---------- Réglages partagés entre projets (mémorisés dans le navigateur) ---------- */

  settings() { return { enabled: { ...this._enabled }, params: { ...this._param } }; }

  applySettings(s) {
    if (!s) return;
    for (const st of SignalPipeline.STAGES) {
      if (s.enabled && st.id in s.enabled) this._enabled[st.id] = !!s.enabled[st.id];
      if (st.param && s.params && st.param.options.includes(s.params[st.id])) this._param[st.id] = s.params[st.id];
    }
    this.reset();
  }

  save() {
    Profiles.set('pipeline', this.settings());
  }

  // Chaîne avec les derniers réglages choisis (projet « Amélioration numérique »), ou les réglages par défaut.
  static loadSaved(rate = 256) {
    const p = new SignalPipeline(rate);
    p.applySettings(Profiles.get('pipeline', null));
    return p;
  }

  // Résumé lisible des étapes actives, ex. « Dérive 1 Hz · Secteur 50 Hz · Passe-bas 40 Hz »
  summary() {
    const short = { despike: 'Anti-pics', highpass: 'Dérive', notch: 'Secteur', lowpass: 'Passe-bas', eog: 'Clignements', car: 'Réf. moyenne' };
    const units = { despike: '', highpass: ' Hz', notch: ' Hz', lowpass: ' Hz' };
    const parts = SignalPipeline.STAGES.filter((s) => this._enabled[s.id])
      .map((s) => short[s.id] + (s.param ? ' ' + this._param[s.id] + units[s.id] : ''));
    return parts.length ? parts.join(' · ') : 'aucune piste active';
  }

  // Copie avec les mêmes réglages et des états neufs.
  clone() {
    const p = new SignalPipeline(this.rate);
    p._enabled = { ...this._enabled };
    p._param = { ...this._param };
    p.reset();
    return p;
  }

  // Traite un enregistrement entier (4 canaux de même longueur) avec une copie neuve de la chaîne.
  // Hors temps réel, on peut compenser le retard du FIR des clignements : la sortie reste alignée sur l'entrée.
  processOffline(channels) {
    const p = this.clone(), n = channels[0].length, out = channels.map(() => new Float64Array(n));
    const delay = p.isEnabled('eog') ? (SignalPipeline.EOG.taps - 1) / 2 : 0;
    for (let i = 0; i < n + delay; i++) {
      const j = Math.min(i, n - 1); // au-delà de la fin, on répète le dernier échantillon pour vider le retard
      const y = p.processFrame([channels[0][j], channels[1][j], channels[2][j], channels[3][j]]);
      if (i >= delay) for (let c = 0; c < 4; c++) out[c][i - delay] = y[c];
    }
    return out;
  }

  // Description des étapes actives au format BIDS « SoftwareFilters » (objet d'objets), ou 'n/a'.
  describe() {
    const d = {}, on = this._enabled, p = this._param;
    if (on.despike) d['Suppression des pics (Hampel causal)'] = { 'fenetre (echantillons)': SignalPipeline.DESPIKE_WINDOW, 'seuil (x MAD normalise)': p.despike };
    if (on.highpass) d['Passe-haut Butterworth ordre 2'] = { 'coupure (Hz)': p.highpass };
    if (on.notch) d['Coupe-bande secteur'] = { 'frequences (Hz)': [p.notch, 2 * p.notch].filter((f) => f < this.rate / 2 - 4), Q: 25 };
    if (on.lowpass) d['Passe-bas Butterworth ordre 4'] = { 'coupure (Hz)': p.lowpass };
    if (on.eog) d['Reduction des clignements (regression adaptative NLMS)'] = { reference: 'moyenne AF7/AF8, passe-bas FIR 6 Hz', 'retard compense (ms)': 250 };
    if (on.car) d['Reference moyenne commune'] = { canaux: 4 };
    return Object.keys(d).length ? d : 'n/a';
  }

  // Coupures effectives pour le tableau des canaux BIDS et l'en-tête EDF (null si l'étape est inactive).
  cutoffs() {
    return {
      low: this._enabled.highpass ? this._param.highpass : null,
      high: this._enabled.lowpass ? this._param.lowpass : null,
      notch: this._enabled.notch ? this._param.notch : null,
    };
  }

  // Champ « prefiltering » d'un en-tête EDF, ex. « HP:1Hz LP:40Hz N:50Hz »
  prefilterString() {
    const c = this.cutoffs(), parts = [];
    if (c.low != null) parts.push(`HP:${c.low}Hz`);
    if (c.high != null) parts.push(`LP:${c.high}Hz`);
    if (c.notch != null) parts.push(`N:${c.notch}Hz`);
    if (this._enabled.despike) parts.push('Hampel');
    if (this._enabled.eog) parts.push('EOG-NLMS');
    if (this._enabled.car) parts.push('CAR');
    return parts.join(' ');
  }

  // Remet à zéro tous les états internes (à faire après une coupure du flux).
  reset() {
    this._queues = [0, 1, 2, 3].map(() => []);
    for (const s of SignalPipeline.STAGES) this._build(s.id);
  }

  // (Re)crée l'état d'une étape : filtres neufs avec les paramètres courants.
  _build(id) {
    const rate = this.rate, p = this._param[id], ch = () => [0, 1, 2, 3];
    if (id === 'despike') this._despike = ch().map(() => []);
    if (id === 'highpass') this._hp = ch().map(() => new Biquad(Biquad.design('highpass', p, rate)));
    if (id === 'notch') {
      const freqs = [p, 2 * p].filter((f) => f < rate / 2 - 4);
      this._notch = ch().map(() => freqs.map((f) => new Biquad(Biquad.design('notch', f, rate, 25))));
    }
    if (id === 'lowpass') { // Butterworth d'ordre 4 = deux biquads aux facteurs Q 0,5412 et 1,3066
      this._lp = ch().map(() => [0.5412, 1.3066].map((q) => new Biquad(Biquad.design('lowpass', p, rate, q))));
    }
    if (id === 'eog') {
      const lp = () => new FirLowpass(SignalPipeline.EOG.lowpassHz, rate, SignalPipeline.EOG.taps);
      this._eog = { ref: lp(), low: ch().map(lp), w: [0, 0, 0, 0], power: 0, powerLong: 0 };
    }
  }

  /* ---------- Traitement ---------- */

  feed(channel, samples) {
    this._queues[channel].push(...samples);
    const n = Math.min(...this._queues.map((q) => q.length));
    if (!n) {
      this._queues.forEach((q) => { if (q.length > 512) q.splice(0, q.length - 512); });
      return;
    }
    const raw = this._queues.map((q) => q.splice(0, n));
    const clean = raw.map(() => new Array(n));
    for (let i = 0; i < n; i++) {
      const y = this.processFrame([raw[0][i], raw[1][i], raw[2][i], raw[3][i]]);
      for (let c = 0; c < 4; c++) clean[c][i] = y[c];
    }
    if (this.onSamples) this.onSamples(raw, clean);
  }

  // Un instant des 4 canaux (TP9, AF7, AF8, TP10) -> 4 valeurs après les étapes actives.
  processFrame(frame) {
    let x = frame.slice();
    const on = this._enabled;
    if (on.despike) x = x.map((v, c) => this._stepDespike(c, v));
    if (on.highpass) x = x.map((v, c) => this._hp[c].step(v));
    if (on.notch) x = x.map((v, c) => this._notch[c].reduce((acc, f) => f.step(acc), v));
    if (on.lowpass) x = x.map((v, c) => this._lp[c].reduce((acc, f) => f.step(acc), v));
    if (on.eog) x = this._stepEog(x);
    if (on.car) { const m = (x[0] + x[1] + x[2] + x[3]) / 4; x = x.map((v) => v - m); }
    return x;
  }

  // Filtre de Hampel causal : écart à la médiane des derniers échantillons, comparé à k × MAD × 1,4826.
  _stepDespike(c, v) {
    const win = this._despike[c], W = SignalPipeline.DESPIKE_WINDOW;
    let out = v;
    if (win.length === W) {
      const sorted = [...win].sort((a, b) => a - b), med = sorted[W >> 1];
      const mad = [...win].map((u) => Math.abs(u - med)).sort((a, b) => a - b)[W >> 1];
      if (mad > 0 && Math.abs(v - med) > this._param.despike * 1.4826 * mad) out = med;
    }
    win.push(v); // valeur d'origine : la fenêtre garde des statistiques non biaisées
    if (win.length > W) win.shift();
    return out;
  }

  // Régression adaptative (NLMS) : référence r = moyenne AF7/AF8 passée dans un passe-bas FIR 6 Hz.
  // Le FIR retarde toutes les fréquences de la même durée ; on retarde donc chaque canal d'autant avant de
  // soustraire w × r : le clignement et sa référence sont alignés. (Avec un filtre récursif, le retard dépend de
  // la fréquence et la soustraction laisse un résidu important : essayé, ~80 % du clignement restait.)
  // Le poids de chaque canal apprend sur la partie lente du canal, passée dans le même filtre.
  // Apprentissage seulement pendant les fortes déflexions (clignements) ; soustraction permanente.
  _stepEog(x) {
    const e = this._eog, cfg = SignalPipeline.EOG;
    const r = e.ref.step((x[1] + x[2]) / 2).y;
    e.power += 0.01 * (r * r - e.power);              // puissance récente (~0,4 s)
    e.powerLong += 0.0005 * (r * r - e.powerLong);    // puissance de fond (~8 s)
    const learn = r * r > cfg.gate * e.powerLong && e.powerLong > 0;
    return x.map((v, c) => {
      const { y: low, past } = e.low[c].step(v);
      if (learn) {
        e.w[c] += (cfg.mu * (low - e.w[c] * r) * r) / (e.power + 1e-6);
        e.w[c] = Math.max(-cfg.maxWeight, Math.min(cfg.maxWeight, e.w[c]));
      }
      return past - e.w[c] * r; // canal retardé de `delay` échantillons, aligné sur la référence
    });
  }
}
