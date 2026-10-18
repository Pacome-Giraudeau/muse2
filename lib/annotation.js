/* Annotation d'un enregistrement (globale `Annotation`) : étiquettes, protocole « forcé », séance, comparaison avec le
 * détecteur. Sans interface, sans horloge propre (les instants sont fournis, en ms absolus Date.now()) : testable.
 * Interface : projets/09-annotation/annotation.js, ui/annotation-stage.js. Méthode : docs/science.html (section annotation).
 *
 * Étiquettes — Annotation.LABELS : [{ id, name, emoji, cue (consigne), kind: 'instant' | 'held', windowS, detector, group? }]
 *   group 'mental' (Annotation.isMental(id)) : états mentaux (mental-relax / -focus / -drowsy / -neutral), fenêtres de 45 s, sans
 *   détecteur ; leurs fenêtres sont ignorées par les confusions et fausses alarmes de compare(). Les autres : gestes.
 *   kind 'instant' (clignement) : un appui = un geste bref ; 'held' : on maintient la touche pendant le geste.
 *   detector = type d'événement de lib/artifacts.js que cette étiquette doit déclencher (null : pas de détecteur, ex. repos).
 *   Annotation.label(id)
 *
 * Deux façons d'annoter (champ `source` de chaque annotation) :
 *   'forced'      l'application demande un geste (AnnotationRunner) : la vérité est la FENÊTRE de la consigne, posée avant
 *                 le geste (aucun biais de détection), précision de l'ordre de la fenêtre (le geste est quelque part dedans).
 *   'spontaneous' la personne marque elle-même en direct (touche maintenue / bouton) ; l'instant est corrigé de son
 *                 temps de réaction (`delayMs`, 350 ms par défaut — hypothèse, à mesurer) ; un geste bref reçoit une
 *                 fenêtre de ± 0,5 s autour de l'instant estimé. Corrigeable ensuite (revue).
 *
 *   const plan = Annotation.plan({ labels, reps: 3, seed: 1, leadS: 3, gapS: [1.5, 3] })
 *       -> { trials: [{ label, cueS, durationS }], totalS }   blocs équilibrés (chaque étiquette une fois par bloc,
 *          mêlées avec une graine, jamais deux fois la même d'affilée), pauses aléatoires entre les consignes
 *   const session = new Annotation.Session({ delayMs: 350 })
 *   session.forced(label, startMs, durationMs)      session.tap(label, t)      session.press(label, t) / session.release(label, t)
 *   session.finish(t)                                ferme les touches encore maintenues
 *   session.flag(id, 'ok' | 'doubtful')              « raté » : exclue de la comparaison
 *   session.edit(id, { label, start, end, quality }) session.remove(id)   session.shift(ms)   session.list   session.pending
 *   annotation : { id, label, start, end (ms), source, quality: 'ok' | 'doubtful', precision: 'window' | 'marked', delayMs? }
 *
 *   const run = new Annotation.Runner(plan, session, { onChange })     // protocole forcé, pilotée par run.tick(now)
 *   run.start(now); run.tick(now) -> état { phase: 'idle'|'lead'|'cue'|'gap'|'done', index, total, trial, next, remainingS, progress }
 *
 *   Annotation.detectionFrom(événement du détecteur) -> { type, start, end } | null   (null : début d'épisode)
 *   Annotation.compare(annotations, détections, { tolMs: 1000 }) -> {
 *     perLabel: { <id>: { n, hits, recall, latencyMs (médiane, début de fenêtre -> 1re détection) } },
 *     confusions: [{ label, got, n }]    geste détecté dans la fenêtre d'une AUTRE étiquette (hors clignements)
 *     restFalseAlarms: { <type>: n }     détections dans une fenêtre de repos (hors clignements)
 *     precision: { <type>: n/total }     détections de ce type tombées dans une fenêtre de leur étiquette
 *     unlabelled: n                      détections hors de toute fenêtre (non comptées comme erreurs)
 *   }   Les clignements spontanés ne sont jamais comptés comme erreur (on cligne toujours). Annotations 'doubtful' ignorées.
 *   Annotation.applyTo(rec, annotations, { delayMs, detections, mode }) -> rec   écrit rec.events (BIDS *_events.tsv, colonnes
 *     supplémentaires source/quality/precision/delay_ms, voir Recording.EVENT_EXTRA) et rec.annotation (métadonnées +
 *     détections, qui ne sont PAS la vérité). Les trous de flux (interruption_flux) sont conservés.
 */
const Annotation = (() => {
  const LABELS = [
    { id: 'rest', name: 'Repos', emoji: '😐', cue: 'Ne bouge pas, regarde l’écran', kind: 'held', windowS: 5, detector: null },
    { id: 'blink', name: 'Clignement', emoji: '😉', cue: 'Cligne des yeux 3 fois', kind: 'instant', windowS: 4, detector: 'blink' },
    { id: 'frown', name: 'Sourcils', emoji: '😠', cue: 'Fronce les sourcils', kind: 'held', windowS: 3, detector: 'frown' },
    { id: 'jaw', name: 'Mâchoire', emoji: '😬', cue: 'Serre la mâchoire', kind: 'held', windowS: 3, detector: 'jaw' },
    { id: 'yawn', name: 'Bâillement', emoji: '🥱', cue: 'Bâille', kind: 'held', windowS: 5, detector: 'yawn' },
    { id: 'gaze-left', name: 'Regard à gauche', emoji: '👈', cue: 'Regarde à gauche, sans tourner la tête', kind: 'held', windowS: 3, detector: 'gaze-left' },
    { id: 'gaze-right', name: 'Regard à droite', emoji: '👉', cue: 'Regarde à droite, sans tourner la tête', kind: 'held', windowS: 3, detector: 'gaze-right' },
    { id: 'closed', name: 'Yeux fermés', emoji: '😌', cue: 'Ferme les yeux', kind: 'held', windowS: 6, detector: null },
    // États mentaux (group 'mental') : fenêtres longues, aucun détecteur d'artefact ; mêmes états que lib/mental-state.js
    { id: 'mental-relax', name: 'Détendu', emoji: '🧘', cue: 'Détends-toi : respire calmement, laisse aller tes pensées', kind: 'held', windowS: 45, detector: null, group: 'mental' },
    { id: 'mental-focus', name: 'Concentré', emoji: '🎯', cue: 'Concentre-toi : compte à rebours de 7 en 7 depuis 500, sans bouger', kind: 'held', windowS: 45, detector: null, group: 'mental' },
    { id: 'mental-drowsy', name: 'Somnolent', emoji: '😴', cue: 'Laisse-toi aller vers le sommeil, yeux mi-clos, sans t’endormir', kind: 'held', windowS: 45, detector: null, group: 'mental' },
    { id: 'mental-neutral', name: 'Neutre', emoji: '😐', cue: 'Regarde l’écran sans rien faire de particulier', kind: 'held', windowS: 45, detector: null, group: 'mental' },
  ];
  const isMental = (id) => (label(id) || {}).group === 'mental';
  const label = (id) => LABELS.find((l) => l.id === id);

  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  function plan({ labels = LABELS.map((l) => l.id), reps = 3, seed = 1, leadS = 3, gapS = [1.5, 3] } = {}) {
    const rand = rng(seed), trials = [];
    let prev = null, t = leadS;
    for (let b = 0; b < reps; b++) {
      const block = labels.slice();
      for (let i = block.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [block[i], block[j]] = [block[j], block[i]]; }
      if (block.length > 1 && block[0] === prev) block.push(block.shift()); // jamais deux fois la même d'affilée
      for (const id of block) {
        const d = label(id).windowS;
        trials.push({ label: id, cueS: +t.toFixed(3), durationS: d });
        t += d + gapS[0] + rand() * (gapS[1] - gapS[0]);
        prev = id;
      }
    }
    return { trials, totalS: +(t).toFixed(3) };
  }

  class Session {
    constructor({ delayMs = 350 } = {}) { this.delayMs = delayMs; this.list = []; this.pending = {}; this._id = 0; }

    _add(a) { const full = { id: ++this._id, quality: 'ok', ...a }; this.list.push(full); return full; }

    forced(lab, start, durationMs) {
      return this._add({ label: lab, start, end: start + durationMs, source: 'forced', precision: 'window' });
    }

    tap(lab, t) { // geste bref marqué après coup : fenêtre ± 0,5 s autour de l'instant estimé
      const c = t - this.delayMs;
      return this._add({ label: lab, start: c - 500, end: c + 500, source: 'spontaneous', precision: 'marked', delayMs: this.delayMs });
    }

    press(lab, t) {
      if (label(lab).kind === 'instant') return this.tap(lab, t);
      if (!this.pending[lab]) this.pending[lab] = t;
      return null;
    }

    release(lab, t) {
      if (label(lab).kind === 'instant' || this.pending[lab] == null) return null;
      const start = this.pending[lab] - this.delayMs, end = Math.max(t - this.delayMs, start + 300);
      delete this.pending[lab];
      return this._add({ label: lab, start, end, source: 'spontaneous', precision: 'marked', delayMs: this.delayMs });
    }

    finish(t) { Object.keys(this.pending).forEach((l) => this.release(l, t)); }

    flag(id, quality) { const a = this.list.find((x) => x.id === id); if (a) a.quality = quality; return a; }
    edit(id, patch) { const a = this.list.find((x) => x.id === id); if (a) Object.assign(a, patch); return a; }
    remove(id) { this.list = this.list.filter((x) => x.id !== id); }
    shift(ms) { this.list.forEach((a) => { a.start += ms; a.end += ms; }); }
    sorted() { return this.list.slice().sort((a, b) => a.start - b.start); }
  }

  class Runner {
    constructor(p, session, { onChange } = {}) {
      this.plan = p; this.session = session; this.onChange = onChange; this.t0 = null; this.done = false; this._cued = 0;
    }

    start(now) { this.t0 = now; this._cued = 0; this.done = false; return this.tick(now); }

    tick(now) {
      const trials = this.plan.trials, s = (now - this.t0) / 1000;
      while (this._cued < trials.length && s >= trials[this._cued].cueS) { // consigne franchie : la fenêtre est posée à l'heure PRÉVUE
        const tr = trials[this._cued++];
        this.session.forced(tr.label, this.t0 + tr.cueS * 1000, tr.durationS * 1000);
      }
      let st;
      if (s >= this.plan.totalS || (this._cued === trials.length && s >= trials[trials.length - 1].cueS + trials[trials.length - 1].durationS)) {
        st = { phase: 'done', index: trials.length, total: trials.length, trial: null, next: null, remainingS: 0, progress: 1 };
        this.done = true;
      } else {
        const i = this._cued - 1, cur = i >= 0 ? trials[i] : null, next = trials[this._cued] || null;
        if (cur && s < cur.cueS + cur.durationS) {
          st = { phase: 'cue', index: i, trial: cur, next, remainingS: cur.cueS + cur.durationS - s, progress: (s - cur.cueS) / cur.durationS };
        } else {
          st = { phase: cur ? 'gap' : 'lead', index: i, trial: null, next, remainingS: next ? next.cueS - s : 0, progress: 0 };
        }
        st.total = trials.length;
      }
      st.elapsedS = s;
      if (this.onChange) this.onChange(st);
      return st;
    }
  }

  function detectionFrom(e) {
    if (!e || e.phase === 'start') return null;
    const end = e.time || Date.now();
    return { type: e.type, start: end - (e.durationMs || 0), end };
  }

  function compare(annotations, detections, { tolMs = 1000 } = {}) {
    const ok = annotations.filter((a) => a.quality !== 'doubtful');
    const near = (a, d, tol) => d.end >= a.start - tol && d.start <= a.end + tol;
    const perLabel = {}, conf = {}, restFA = {}, hitDet = new Set();
    const median = (v) => (v.length ? v.slice().sort((x, y) => x - y)[Math.floor(v.length / 2)] : null);
    for (const lab of LABELS.filter((l) => l.detector)) {
      const mine = ok.filter((a) => a.label === lab.id), lat = [];
      let hits = 0;
      for (const a of mine) {
        const m = detections.filter((d) => d.type === lab.detector && near(a, d, tolMs));
        if (m.length) { hits++; lat.push(Math.min(...m.map((d) => d.end)) - a.start); m.forEach((d) => hitDet.add(d)); }
      }
      perLabel[lab.id] = { n: mine.length, hits, recall: mine.length ? hits / mine.length : null, latencyMs: median(lat) };
    }
    let unlabelled = 0;
    const total = {}, good = {};
    for (const d of detections) {
      total[d.type] = (total[d.type] || 0) + 1;
      if (hitDet.has(d)) { good[d.type] = (good[d.type] || 0) + 1; continue; }
      const inside = ok.filter((a) => near(a, d, 0) && !isMental(a.label)); // une fenêtre d'état mental ne dit rien des gestes
      if (!inside.length) { unlabelled++; continue; }
      if (d.type === 'blink') continue; // un clignement naturel n'est pas une erreur
      for (const a of inside) {
        const lab = label(a.label);
        if (a.label === 'rest') restFA[d.type] = (restFA[d.type] || 0) + 1;
        else if (lab.detector !== d.type) { const k = a.label + '>' + d.type; conf[k] = (conf[k] || 0) + 1; }
      }
    }
    const precision = {};
    for (const k of Object.keys(total)) precision[k] = { good: good[k] || 0, total: total[k] };
    const confusions = Object.entries(conf).map(([k, n]) => { const [l, got] = k.split('>'); return { label: l, got, n }; });
    return { perLabel, confusions, restFalseAlarms: restFA, precision, unlabelled };
  }

  function applyTo(rec, annotations, { delayMs = null, detections = [], mode = null } = {}) {
    const eeg = rec.streams.eeg, t0 = eeg.t[0], tEnd = t0 + (eeg.t.length / eeg.rate) * 1000;
    const gaps = rec.events.filter((e) => e.trial_type === Recording.EVENT_TYPES.gap);
    const evs = annotations
      .filter((a) => a.end > t0 && a.start < tEnd)
      .map((a) => {
        const on = Math.max(0, (a.start - t0) / 1000), off = Math.min((a.end - t0) / 1000, (tEnd - t0) / 1000);
        return {
          onset: +on.toFixed(4), duration: +(off - on).toFixed(4), trial_type: Recording.EVENT_TYPES[a.label] || a.label,
          sample: Math.round(on * eeg.rate), source: a.source, quality: a.quality, precision: a.precision,
          delay_ms: a.source === 'spontaneous' ? a.delayMs : undefined,
        };
      });
    rec.events = [...gaps, ...evs].sort((x, y) => x.onset - y.onset);
    rec.task = 'annotation';
    rec.annotation = {
      version: 1, mode, delayMs,
      labels: LABELS.map(({ id, name, cue, kind, detector, group }) => ({ id, trial_type: Recording.EVENT_TYPES[id] || id, name, cue, kind, detector, group: group || 'gesture' })),
      detections: detections.map((d) => ({ type: d.type, onset: +((d.start - t0) / 1000).toFixed(3), duration: +((d.end - d.start) / 1000).toFixed(3) })),
      note: 'Les détections sont la sortie du détecteur pendant la séance : elles ne sont PAS la vérité terrain.',
    };
    return rec;
  }

  return { LABELS, label, isMental, plan, Session, Runner, detectionFrom, compare, applyTo };
})();
