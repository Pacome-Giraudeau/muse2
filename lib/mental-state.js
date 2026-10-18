/* Estimation d'un « état mental » à partir des bandes theta, alpha, bêta (globale `MentalState`).
 * Indépendant de l'interface. Utilisé par projets/03-etat, projets/04-etude et lib/mental-baseline.js. Explications et
 * limites : docs/science.html, section « Peut-on lire un état mental ? ».
 *
 *   const ms = new MentalState({ baseline });          // baseline : référence personnelle (ou null = automatique)
 *   const m = MentalState.measure(fenêtres, { rate, raw, events, t0 })   // mesure d'une fenêtre de 4 s, par électrode
 *   const r = ms.update(m, 1);                         // dt en s ; m = tableau par électrode (null = électrode écartée)
 *                                                      //   ou un seul objet { theta, alpha, beta } (µV²)
 *   r -> { state, candidate, scores: { relax, focus, drowsy }, deviations: { theta, alpha, beta } | null, indices,
 *          used, muscle (électrodes tendues), focusSuspended, muscleGuard, threshold, ready, paused, baselineProgress }
 *   ms.threshold                                       // seuils { relax, focus, drowsy, fromSpread } (S5)
 *   MentalState.indices(bandes)                        // les 3 indices d'un jeu de bandes
 *   MentalState.bandsFrom(fenêtres) / bandsPerChannel(fenêtres)   // Welch : moyenne des électrodes / une par électrode
 *   MentalState.baselineFrom(mesures, { spread })      // référence (médianes par électrode, puissances, témoin, dispersion)
 *   MentalState.thresholds(référence)                  // seuils tirés de la dispersion de la référence (ou 0,18)
 *   MentalState.statePipeline(pipe)                    // { pipeline, removed } : copie de la chaîne SANS la piste « eog »
 *   MentalState.excluded({ blink, frown, jaw, gaze, yawn })   // électrodes à écarter (Set) selon des drapeaux
 *   MentalState.excludedFor(events, a, b)              // LA règle : électrodes écartées pour l'intervalle [a, b] (s) ;
 *                                                      //   events [{ type, onset, duration }] en s (ZONES, MARGIN_S)
 *   const log = new MentalState.EventLog();            // en direct : detector.onEvent = (e) => log.add(e)
 *   log.recent(detector.active, 4, now)                //   événements récents [{ type, onset, duration }] (s) -> measure
 *   log.excluded(detector.active, 4, now)              //   Set des électrodes touchées sur les 4 dernières secondes
 *   MentalState.timeline(canaux, { rate, raw, baseline, baselineRange, events })   // états seconde par seconde
 *
 * Trois indices, chacun comparé à SA PROPRE référence (aucune valeur absolue n'a de sens d'une personne à l'autre) :
 *   relax  = α / (θ + α + β)      part de l'alpha : plus d'alpha au repos = éveil calme (Barry et al. 2007)
 *   focus  = β / (α + θ)          indice d'engagement de Pope et al. (1995)
 *   drowsy = θ / (α + β)          montée du theta face aux rythmes plus rapides (Santamaria & Chiappa 1987)
 * Bandes : θ 4–8, α 8–13, β 13–20 Hz (BANDS). Le bêta s'arrête à 20 Hz : au-dessus, en AF7/AF8 et TP9/TP10, l'activité
 * des muscles du front et des tempes domine (S3). Les références « version 2 » (avant ce changement) ont été mesurées
 * avec β 13–30 Hz : elles restent utilisables, comparées à un bêta 13–30 Hz (betaWide) pour rester cohérentes.
 * Par électrode : score = ln(indice / référence de CETTE électrode) ; moyenne sur les électrodes disponibles, puis lissage
 * exponentiel sur ~5 s (SMOOTH_S). 0 = comme la référence. Comparer chaque électrode à sa propre référence évite
 * qu'écarter une électrode (artefact) ne biaise le résultat (l'alpha est plus fort derrière les oreilles qu'au front).
 * Écarts bruts (S6) : ln(θ/θréf), ln(α/αréf), ln(β/βréf), mêmes électrodes et même lissage (affichage, pas de décision).
 *
 * Seuil (S5) : un état s'affiche quand son score lissé dépasse k × σ (THRESHOLD_K = 2), σ = écart-type du score LISSÉ au
 * repos, tiré des ~30 mesures de la référence ; borné à [THRESHOLD_MIN, THRESHOLD_MAX]. Sans dispersion connue
 * (référence version 2, moins de SPREAD_MIN_N mesures, ou référence = médiane d'un enregistrement entier) : THRESHOLD
 * = 0,18 (≈ +20 %). Méthode (smoothingFactor) : σ_brut = 1,4826 × MAD des scores seconde par seconde de la référence
 * (robuste à quelques secondes atypiques) ; le lissage réduit cet écart-type d'un facteur
 *   f = √( a/(2−a) · [1 + 2 Σ_h ρ(h)(1−a)^h] ),  a = 1 − e^(−1/SMOOTH_S),  ρ(h) = 1 − h/4 (h < 4)
 * où ρ est l'autocorrélation des scores due au recouvrement des fenêtres de 4 s avancées de 1 s (3/4 de données
 * communes entre deux secondes voisines…). Avec SMOOTH_S = 5 : f ≈ 0,56. Prendre σ_brut sans ce facteur surestimerait
 * le seuil (×1,8). Hypothèse : la fluctuation au repos est surtout du bruit d'estimation ; une dérive lente (vigilance,
 * contact) n'est pas réduite par le lissage, f la sous-estime alors — d'où le plancher THRESHOLD_MIN.
 * Décision : parmi les scores au-dessus de leur seuil, le plus fort RELATIVEMENT à son seuil ; sinon « neutre ».
 * Un changement doit tenir HOLD_S secondes. Sans référence fournie, les AUTO_BASELINE_S premières secondes mesurables
 * servent de référence (avec leur dispersion).
 *
 * Témoin musculaire (S3) : puissance 30–45 Hz (EMG_HZ) de chaque électrode, mesurée sur le signal BRUT (avant les
 * filtres : le passe-bas réglable à 30/40/45 Hz l'atténuerait d'une quantité qui dépend du réglage), médiane des
 * segments propres (un pic isolé n'y pèse pas), comparée à sa valeur de référence. Au-delà de EMG_RATIO × la référence,
 * l'électrode est « tendue » : elle ne compte plus pour l'indice focus (un bêta gonflé par les muscles ne peut que
 * FAIRE MONTER « Concentré » ; il fait baisser relax et drowsy, qui ne peuvent donc pas être déclenchés à tort). Si toutes
 * les électrodes sont tendues, l'indice focus est gelé (focusSuspended) et « Concentré » ne peut pas être choisi.
 * Pas de témoin dans la référence (version 2) ou pas de brut (timeline sans `raw`) : pas de garde (muscleGuard = false).
 *
 * Artefacts (rejet par segment) : la DSP de Welch d'une fenêtre de 4 s moyenne 7 segments de 1 s (recouvrement 50 %).
 * Pour chaque électrode, on ne garde que les segments qu'aucun événement de SA zone ne touche (ZONES : clignement,
 * sourcils, regard -> front ; mâchoire -> tempes ; bâillement -> toutes ; marge MARGIN_S comprise : la règle
 * excludedFor appliquée au segment). L'électrode n'est écartée que s'il reste moins de MIN_SEGMENTS segments propres ;
 * la mesure n'est suspendue que si aucune électrode ne reste. Même règle en direct (EventLog.recent -> measure) et hors
 * ligne (timeline). Avec 15–20 clignements/min, l'ancienne règle « tout événement qui touche la fenêtre écarte
 * l'électrode » écartait le front presque en permanence.
 *
 * Piste « eog » de lib/filters.js (S4) : elle soustrait en permanence une part de la moyenne frontale < 6 Hz (theta
 * frontal en partie effacé, poids qui évoluent après la référence). L'état mental se calcule donc sur une copie de la
 * chaîne sans cette piste (statePipeline), en direct, pour la référence (CalibrationContext) et hors ligne (étude).
 */
class MentalState {
  static STATES = {
    neutral: { label: 'Neutre', emoji: '😐', description: 'Proche de ta référence.' },
    relaxed: { label: 'Détendu', emoji: '😌', description: 'Plus d’alpha que ta référence : éveil calme, relâchement.' },
    focused: { label: 'Concentré', emoji: '🎯', description: 'Indice d’engagement au-dessus de ta référence : activité rapide (bêta) plus présente.' },
    drowsy: { label: 'Somnolent', emoji: '😴', description: 'Theta en hausse face à l’alpha et au bêta : baisse de vigilance possible.' },
    unknown: { label: 'En attente', emoji: '⏳', description: 'Pas encore assez de signal propre.' },
  };
  static KEYS = { relaxed: 'relax', focused: 'focus', drowsy: 'drowsy' };
  static VERSION = 3;                 // format de la référence (2 : indices seuls, β 13–30 Hz)
  static BANDS = { theta: [4, 8], alpha: [8, 13], beta: [13, 20] };
  static BETA_WIDE = [13, 30];        // bêta des références version 2
  static EMG_HZ = [30, 45];           // témoin musculaire (sur le brut ; sous le secteur 50 Hz)
  static EMG_RATIO = 2;               // électrode « tendue » au-delà de 2 × sa puissance 30–45 Hz de référence
  static THRESHOLD = 0.18;            // seuil de repli (≈ +20 %) sans dispersion connue
  static THRESHOLD_K = 2;             // seuil = k × écart-type du score lissé au repos
  static THRESHOLD_MIN = 0.1;         // ≈ +10 %
  static THRESHOLD_MAX = 0.5;         // ≈ +65 %
  static SPREAD_MIN_N = 20;           // mesures nécessaires pour estimer la dispersion
  static HOLD_S = 3;
  static SMOOTH_S = 5;
  static WINDOW_S = 4;                // fenêtre analysée (s), avancée de 1 s
  static SEGMENT_S = 1;               // segment de Welch (s), recouvrement 50 %
  static MIN_SEGMENTS = 3;            // segments propres nécessaires pour garder une électrode (≥ 2 s de signal)
  static AUTO_BASELINE_S = 30;
  static FRONTAL = [1, 2];   // AF7, AF8
  static TEMPORAL = [0, 3];  // TP9, TP10
  static PIPELINE_OFF = ['eog'];      // pistes de lib/filters.js jamais appliquées au calcul d'état

  static indices({ theta, alpha, beta }) {
    const e = 1e-9;
    return { relax: alpha / (theta + alpha + beta + e), focus: beta / (alpha + theta + e), drowsy: theta / (alpha + beta + e) };
  }

  // Puissances de bande d'une DSP { freqs, psd } : { theta, alpha, beta (13–20 Hz), betaWide (13–30 Hz) }
  static _bandsOf(spec) {
    const B = MentalState.BANDS, P = (r) => Signal.powerBetween(spec, r[0], r[1]);
    return { theta: P(B.theta), alpha: P(B.alpha), beta: P(B.beta), betaWide: P(MentalState.BETA_WIDE) };
  }

  static _bands(w, rate) { return MentalState._bandsOf(Signal.welch(w, rate)); }

  // Puissances absolues (µV²) theta / alpha / bêta, moyennées sur plusieurs fenêtres (une par électrode).
  static bandsFrom(windows, rate = 256) {
    return MentalState.meanBands(windows.filter(Boolean).map((w) => MentalState._bands(w, rate)));
  }

  // Moyenne de plusieurs mesures de bandes (null ignorées) ; null si aucune
  static meanBands(list) {
    const ok = list.filter(Boolean);
    if (!ok.length) return null;
    const mean = (k) => ok.reduce((s, b) => s + b[k], 0) / ok.length;
    return { theta: mean('theta'), alpha: mean('alpha'), beta: mean('beta'), betaWide: mean('betaWide') };
  }

  // Une mesure par électrode ; fenêtre null -> null (électrode écartée)
  static bandsPerChannel(windows, rate = 256) {
    return windows.map((w) => (w ? MentalState._bands(w, rate) : null));
  }

  /* ---------- Mesure d'une fenêtre : rejet des artefacts par segment, témoin musculaire ---------- */

  // windows : [4] fenêtres de signal FILTRÉ (null = électrode déjà écartée, ex. mauvais contact) ; raw : les mêmes
  // fenêtres en BRUT (témoin musculaire ; facultatif) ; events [{ type, onset, duration }] (s) sur la même horloge
  // que t0 = heure (s) du premier échantillon des fenêtres.
  // -> [4] { theta, alpha, beta, betaWide, emg (µV² 30–45 Hz ou null), segments (propres / total) } ou null.
  static measure(windows, { rate = 256, raw = null, events = [], t0 = 0 } = {}) {
    const nfft = Math.round(MentalState.SEGMENT_S * rate);
    let outBySeg = null; // électrodes touchées, segment par segment (même découpage pour toutes les électrodes)
    return windows.map((w, i) => {
      if (!w || w.length < nfft) return null;
      const { freqs, list } = Signal.periodograms(w, rate, nfft);
      if (!outBySeg) outBySeg = list.map((s) => MentalState.excludedFor(events, t0 + s.start / rate, t0 + (s.start + nfft) / rate));
      const keep = list.map((_, k) => k).filter((k) => !(outBySeg[k] && outBySeg[k].has(i)));
      if (keep.length < MentalState.MIN_SEGMENTS) return null;
      const psd = new Array(freqs.length).fill(0);
      for (const k of keep) for (let f = 0; f < psd.length; f++) psd[f] += list[k].psd[f] / keep.length;
      const out = { ...MentalState._bandsOf({ freqs, psd }), emg: null, segments: keep.length, of: list.length };
      if (raw && raw[i] && raw[i].length === w.length) {
        const rl = Signal.periodograms(raw[i], rate, nfft).list;
        const e = keep.map((k) => Signal.powerBetween({ freqs, psd: rl[k].psd }, ...MentalState.EMG_HZ)).sort((a, b) => a - b);
        out.emg = e.length % 2 ? e[(e.length - 1) / 2] : (e[e.length / 2 - 1] + e[e.length / 2]) / 2;
      }
      return out;
    });
  }

  // Copie de la chaîne de filtres pour le calcul d'état : mêmes réglages, sans les pistes PIPELINE_OFF (« eog »).
  // removed = pistes actives dans `pipe` et retirées ici (à signaler dans l'interface).
  static statePipeline(pipe) {
    const p = pipe.clone(), removed = MentalState.PIPELINE_OFF.filter((id) => pipe.isEnabled(id));
    removed.forEach((id) => p.setEnabled(id, false));
    return { pipeline: p, removed };
  }

  /* ---------- Artefacts : électrodes à écarter (UNE règle, en direct comme hors ligne) ---------- */

  // Électrodes touchées par chaque type d'événement du détecteur (lib/artifacts.js). Un regard latéral crée un
  // potentiel lent de dizaines de µV sur AF7/AF8 (énergie en delta/theta) : il écarte le front comme un clignement.
  static ZONES = {
    blink: [1, 2], frown: [1, 2], gaze: [1, 2], 'gaze-left': [1, 2], 'gaze-right': [1, 2],
    jaw: [0, 3], yawn: [0, 1, 2, 3],
  };
  // Marge (s) autour de l'événement : la déflexion lente d'un clignement / bâillement / regard déborde de la
  // durée détectée (et les filtres l'étalent) ; muscle (sourcils, mâchoire) : 0.
  static MARGIN_S = { blink: 0.3, yawn: 0.3, gaze: 0.3, 'gaze-left': 0.3, 'gaze-right': 0.3 };

  // Électrodes à écarter selon des drapeaux (artefact en cours ou récent)
  static excluded({ blink = false, frown = false, jaw = false, gaze = false, yawn = false } = {}) {
    const s = new Set(), on = { blink, frown, jaw, gaze, yawn };
    for (const k in on) if (on[k]) MentalState.ZONES[k].forEach((i) => s.add(i));
    return s;
  }

  // LA règle : tout événement qui touche l'intervalle [a, b] (s), marge comprise, écarte ses électrodes pour cet
  // intervalle (un segment de Welch dans measure, la fenêtre entière dans EventLog.excluded).
  // events : [{ type, onset, duration }] en s (duration = Infinity pour un épisode encore en cours).
  static excludedFor(events, a, b) {
    const s = new Set();
    for (const e of events) {
      const zone = MentalState.ZONES[e.type];
      if (!zone) continue;
      const m = MentalState.MARGIN_S[e.type] || 0;
      if (e.onset + e.duration > a - m && e.onset < b + m) zone.forEach((i) => s.add(i));
    }
    return s;
  }

  // Journal en direct des événements du détecteur (heures Date.now() ou horloge des échantillons, en ms).
  // recent() : événements récents en s ; un épisode commencé ('start') sans 'end' compte jusqu'à maintenant, de même
  // que tout épisode signalé en cours par `active` (detector.active : { frown, jaw, gaze }) sur toute la fenêtre.
  // 'yawn' clôt un 'start' jaw. excluded() : excludedFor sur la fenêtre entière (calibrations qui veulent 4 s propres).
  static EventLog = class {
    constructor() { this.clear(); }

    clear() { this.events = []; this._open = {}; }

    add(e) {
      const t = (e.time != null ? e.time : Date.now()) / 1000, d = e.durationMs != null ? e.durationMs / 1000 : 0;
      const key = e.type === 'yawn' ? 'jaw' : e.type;
      if (e.phase === 'start') { if (this._open[key] == null) this._open[key] = t; return; }
      const onset = this._open[key] != null ? Math.min(this._open[key], t - d) : t - d;
      delete this._open[key];
      this.events.push({ type: e.type, onset, duration: t - onset });
    }

    recent(active = {}, windowS = 4, now = Date.now()) {
      const a = now / 1000 - windowS;
      this.events = this.events.filter((e) => e.onset + e.duration > a - 2); // oubli des événements anciens
      const list = this.events.concat(Object.keys(this._open).map((type) => ({ type, onset: this._open[type], duration: Infinity })));
      for (const k of ['frown', 'jaw', 'gaze']) if (active && active[k]) list.push({ type: k, onset: a, duration: Infinity });
      return list;
    }

    excluded(active = {}, windowS = 4, now = Date.now()) {
      return MentalState.excludedFor(this.recent(active, windowS, now), now / 1000 - windowS, now / 1000);
    }
  };

  static _list(input) { return Array.isArray(input) ? input : [input]; }

  /* ---------- Référence ---------- */

  // Référence = médiane, électrode par électrode, sur une série de mesures (chaque mesure : tableau par électrode de
  // résultats de measure / bandsPerChannel, null = électrode écartée ; ou, ancien format, objets d'indices).
  // -> { version: 3, betaHz, relax[], focus[], drowsy[], bands: { theta[], alpha[], beta[] } | null, emg[] | null,
  //      spread: { relax, focus, drowsy, n } | null, seconds, date }
  // spread = écart-type estimé du score LISSÉ au repos (voir l'en-tête) ; spread: false pour ne pas l'estimer.
  static baselineFrom(list, { spread = true } = {}) {
    const rows = list.map(MentalState._list), nCh = Math.max(...rows.map((r) => r.length));
    const idx = rows.map((r) => r.map((m) => (!m ? null : m.relax != null ? m : MentalState.indices(m))));
    const med = (src, k, c) => {
      const s = src.map((r) => r[c] && r[c][k]).filter((v) => v != null).sort((a, b) => a - b);
      return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
    };
    const per = (src, k) => Array.from({ length: nCh }, (_, c) => med(src, k, c));
    const has = (k) => rows.some((r) => r.some((m) => m && m[k] != null));
    const b = { version: MentalState.VERSION, betaHz: MentalState.BANDS.beta.slice(),
      relax: per(idx, 'relax'), focus: per(idx, 'focus'), drowsy: per(idx, 'drowsy'),
      bands: has('theta') ? { theta: per(rows, 'theta'), alpha: per(rows, 'alpha'), beta: per(rows, 'beta') } : null,
      emg: has('emg') ? per(rows, 'emg') : null, spread: null, seconds: list.length, date: new Date().toISOString() };
    if (spread) b.spread = MentalState._spread(idx, b);
    return b;
  }

  // Écart-type robuste (1,4826 × MAD) des scores seconde par seconde de la référence, × facteur de lissage
  static _spread(idx, base) {
    const out = { n: 0 };
    for (const k of ['relax', 'focus', 'drowsy']) {
      const s = idx.map((r) => {
        const v = r.map((m, c) => (m && base[k][c] != null ? Math.log((m[k] + 1e-12) / (base[k][c] + 1e-12)) : null)).filter((x) => x != null);
        return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null;
      }).filter((x) => x != null);
      if (s.length < MentalState.SPREAD_MIN_N) return null;
      const medOf = (a) => { const t = a.slice().sort((x, y) => x - y), n = t.length; return n % 2 ? t[(n - 1) / 2] : (t[n / 2 - 1] + t[n / 2]) / 2; };
      const m = medOf(s), mad = medOf(s.map((x) => Math.abs(x - m)));
      out[k] = 1.4826 * mad * MentalState.smoothingFactor();
      out.n = s.length;
    }
    return out;
  }

  // Rapport écart-type du score lissé / écart-type du score par seconde (voir l'en-tête) : lissage exponentiel de
  // coefficient a appliqué à des scores corrélés par le recouvrement des fenêtres (ρ(h) = 1 − h·step/WINDOW_S).
  static smoothingFactor(stepS = 1) {
    const a = 1 - Math.exp(-stepS / MentalState.SMOOTH_S), L = MentalState.WINDOW_S / stepS;
    let sum = 1;
    for (let h = 1; h < L; h++) sum += 2 * (1 - h / L) * (1 - a) ** h;
    return Math.sqrt((a / (2 - a)) * sum);
  }

  // Seuils de décision d'une référence : k × spread, bornés ; THRESHOLD sans dispersion connue
  static thresholds(baseline) {
    const sp = baseline && baseline.spread, M = MentalState;
    const f = (k) => (sp && sp[k] != null ? Math.min(M.THRESHOLD_MAX, Math.max(M.THRESHOLD_MIN, M.THRESHOLD_K * sp[k])) : M.THRESHOLD);
    return { relax: f('relax'), focus: f('focus'), drowsy: f('drowsy'), fromSpread: !!sp };
  }

  // Référence au format actuel. Anciennes références : globales (un nombre par indice) ou version 2 (sans puissances,
  // témoin ni dispersion, β 13–30 Hz) : restent utilisables (legacy = true).
  static _norm(b) {
    if (!b) return null;
    const arr = (v) => (Array.isArray(v) ? v : [v]);
    return { ...b, relax: arr(b.relax), focus: arr(b.focus), drowsy: arr(b.drowsy), bands: b.bands || null, emg: b.emg || null,
      spread: b.spread || null, legacy: !b.betaHz };
  }

  /* ---------- Enregistrement entier ---------- */

  // États seconde par seconde (canaux déjà filtrés, de préférence avec statePipeline). Fenêtres de `windowS` s tous les
  // `stepS` s, mesurées par measure (rejet par segment ; témoin musculaire si `raw` = canaux bruts alignés est fourni).
  // events : [{ onset, duration, type }] en s. Référence : `baseline` fournie ; sinon médiane des fenêtres situées dans
  // `baselineRange` [début, fin] (s), avec sa dispersion ; sinon médiane de tout l'enregistrement (états RELATIFS à
  // l'enregistrement ; pas de dispersion : elle contiendrait les changements d'état eux-mêmes -> seuil 0,18).
  // Retour : { segments: [{ start, end, state, paused, used, muscle, focusSuspended, scores, deviations }], baseline,
  //            seconds: { état: durée }, threshold, muscleGuard }
  static timeline(channels, { rate = 256, raw = null, baseline = null, baselineRange = null, events = [], windowS = 4, stepS = 1 } = {}) {
    const n = Math.min(...channels.map((c) => c.length)), W = Math.round(windowS * rate), S = Math.round(stepS * rate);
    const sub = (c, end) => (c.subarray ? c.subarray(end - W, end) : c.slice(end - W, end));
    const windows = [];
    for (let end = W; end <= n; end += S) {
      const a = (end - W) / rate, b = end / rate;
      const m = MentalState.measure(channels.map((c) => sub(c, end)), { rate, raw: raw ? raw.map((c) => sub(c, end)) : null, events, t0: a });
      windows.push({ a, b, bands: m.some(Boolean) ? m : null });
    }
    let base = MentalState._norm(baseline);
    if (!base) {
      const pool = windows.filter((w) => w.bands && (!baselineRange || (w.a >= baselineRange[0] - 1e-9 && w.b <= baselineRange[1] + 1e-9)));
      if (pool.length) base = { ...MentalState.baselineFrom(pool.map((w) => w.bands), { spread: !!baselineRange }), auto: !baselineRange, range: baselineRange };
    }
    const ms = new MentalState({ baseline: base });
    const seconds = { neutral: 0, relaxed: 0, focused: 0, drowsy: 0, unknown: 0, paused: 0 };
    let guard = false;
    const segments = windows.map((w) => {
      const r = ms.update(w.bands, stepS);
      guard = guard || !!r.muscleGuard;
      seconds[r.paused ? 'paused' : ms.state] += stepS;
      return { start: w.b - stepS, end: w.b, state: ms.state, paused: r.paused, used: r.used || [], muscle: r.muscle || [],
        focusSuspended: !!r.focusSuspended, scores: r.scores, deviations: r.deviations };
    });
    return { segments, baseline: base, seconds, threshold: ms.threshold, muscleGuard: guard };
  }

  /* ---------- Suivi en continu ---------- */

  constructor({ baseline = null } = {}) {
    this.auto = !baseline;
    this._collect = [];
    this.history = []; // [{ t, state, paused }]
    this.state = 'unknown';
    this._candidate = null;
    this._held = 0;
    this.since = Date.now();
    this._setBase(MentalState._norm(baseline));
  }

  _setBase(b) {
    this.baseline = b;
    this.threshold = MentalState.thresholds(b);
    this.scores = { relax: 0, focus: 0, drowsy: 0 };
    this.deviations = b && b.bands ? { theta: 0, alpha: 0, beta: 0 } : null;
  }

  setBaseline(b) {
    this._setBase(MentalState._norm(b));
    this.auto = false;
  }

  resetBaseline() {
    this._setBase(null);
    this.auto = true;
    this._collect = [];
    this.state = 'unknown';
  }

  update(bands, dt = 1) {
    const now = Date.now();
    const result = (extra) => {
      this.history.push({ t: now, state: this.state, paused: !!extra.paused });
      if (this.history.length > 600) this.history.shift();
      return { state: this.state, candidate: this._candidate, scores: { ...this.scores },
        deviations: this.deviations ? { ...this.deviations } : null, threshold: this.threshold, ready: !!this.baseline,
        baselineProgress: this.baseline ? 1 : this._collect.length / MentalState.AUTO_BASELINE_S,
        muscle: [], focusSuspended: false, muscleGuard: false, ...extra };
    };
    const list = bands ? MentalState._list(bands) : [];
    // ancienne référence (β 13–30 Hz) : on compare le même bêta
    const wide = this.baseline && this.baseline.legacy;
    const meas = list.map((m) => (m && wide && m.betaWide != null ? { ...m, beta: m.betaWide } : m));
    const idx = meas.map((b) => (b ? MentalState.indices(b) : null));
    const used = idx.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    if (!used.length) return result({ paused: true, used: [] });
    const mean = (k) => used.reduce((s, i) => s + idx[i][k], 0) / used.length;
    const indices = { relax: mean('relax'), focus: mean('focus'), drowsy: mean('drowsy') };

    if (!this.baseline) { // référence automatique : les premières secondes mesurables
      this._collect.push(list);
      if (this._collect.length >= MentalState.AUTO_BASELINE_S) this._setBase(MentalState._norm(MentalState.baselineFrom(this._collect)));
      return result({ paused: false, indices, used });
    }

    const B = this.baseline, base = (k, i) => { const arr = B[k]; return arr.length === 1 ? arr[0] : arr[i]; };
    const comparable = used.filter((i) => base('relax', i) != null);
    if (!comparable.length) return result({ paused: true, used });
    // témoin musculaire : électrodes dont la puissance 30–45 Hz dépasse EMG_RATIO × sa référence
    const guarded = comparable.filter((i) => B.emg && B.emg[i] != null && meas[i].emg != null);
    const muscle = guarded.filter((i) => meas[i].emg > MentalState.EMG_RATIO * B.emg[i]);
    const focusCh = comparable.filter((i) => !muscle.includes(i));
    const a = 1 - Math.exp(-dt / MentalState.SMOOTH_S);
    const ln = (x, ref) => Math.log((x + 1e-12) / (ref + 1e-12));
    for (const k of ['relax', 'focus', 'drowsy']) {
      const ch = k === 'focus' ? focusCh : comparable;
      if (!ch.length) continue; // focus gelé : toutes les électrodes sont tendues
      const s = ch.reduce((acc, i) => acc + ln(idx[i][k], base(k, i)), 0) / ch.length;
      this.scores[k] += a * (s - this.scores[k]);
    }
    if (this.deviations) for (const k of ['theta', 'alpha', 'beta']) {
      const ch = comparable.filter((i) => B.bands[k][i] != null && meas[i][k] != null);
      if (ch.length) this.deviations[k] += a * (ch.reduce((acc, i) => acc + ln(meas[i][k], B.bands[k][i]), 0) / ch.length - this.deviations[k]);
    }
    const focusSuspended = !focusCh.length;
    const thr = this.threshold;
    const best = Object.entries(MentalState.KEYS).filter(([, k]) => !(k === 'focus' && focusSuspended))
      .map(([st, k]) => [st, this.scores[k] / thr[k]]).sort((x, y) => y[1] - x[1])[0];
    const candidate = best && best[1] > 1 ? best[0] : 'neutral';
    if (candidate === this.state) { this._candidate = null; this._held = 0; }
    else {
      if (candidate === this._candidate) this._held += dt; else { this._candidate = candidate; this._held = dt; }
      if (this._held >= MentalState.HOLD_S || this.state === 'unknown') {
        this.state = candidate; this.since = now; this._candidate = null; this._held = 0;
      }
    }
    return result({ paused: false, indices, used: comparable, muscle, focusSuspended, muscleGuard: guarded.length > 0 });
  }
}
