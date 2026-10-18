/* Tests de l'annotation : plan forcé, séance, exécuteur, comparaison, écriture dans un enregistrement (lib/annotation.js,
 * lib/annotation-capture.js). Temps fourni à la main, graine fixe : reproductible. */
(function () {
  const ids = ['blink', 'frown', 'gaze-left', 'rest'];

  /* ---------- Plan ---------- */
  const p = Annotation.plan({ labels: ids, reps: 3, seed: 7 });
  const count = {};
  p.trials.forEach((t) => (count[t.label] = (count[t.label] || 0) + 1));
  check('annotation : plan équilibré (chaque geste autant de fois)', ids.every((i) => count[i] === 3) && p.trials.length === 12, JSON.stringify(count));
  check('annotation : jamais deux fois le même geste d’affilée', p.trials.every((t, i) => !i || t.label !== p.trials[i - 1].label));
  check('annotation : consignes espacées (durée + pause)', p.trials.every((t, i) => !i || t.cueS >= p.trials[i - 1].cueS + p.trials[i - 1].durationS + 1.5 - 1e-6));
  check('annotation : plan reproductible avec la même graine', JSON.stringify(p) === JSON.stringify(Annotation.plan({ labels: ids, reps: 3, seed: 7 })));

  /* ---------- Exécuteur forcé ---------- */
  const s1 = new Annotation.Session();
  const run = new Annotation.Runner(p, s1);
  const T0 = 1000000;
  let st = run.start(T0);
  check('annotation : phase de préparation au départ', st.phase === 'lead' && st.next.label === p.trials[0].label);
  st = run.tick(T0 + (p.trials[0].cueS + 1) * 1000);
  check('annotation : consigne en cours, fenêtre posée à l’heure prévue', st.phase === 'cue' && s1.list.length === 1 && s1.list[0].start === T0 + p.trials[0].cueS * 1000 && s1.list[0].source === 'forced');
  for (let s = 0; s <= p.totalS + 2 && !run.done; s += 0.25) run.tick(T0 + s * 1000);
  check('annotation : séance terminée, une fenêtre par consigne', run.done && s1.list.length === p.trials.length);
  check('annotation : les fenêtres ne se chevauchent pas', s1.sorted().every((a, i, l) => !i || a.start >= l[i - 1].end));

  /* ---------- Séance spontanée ---------- */
  const s2 = new Annotation.Session({ delayMs: 400 });
  s2.press('frown', 10000); s2.release('frown', 12000);
  check('annotation : geste maintenu, temps de réaction retranché', s2.list[0].start === 9600 && s2.list[0].end === 11600 && s2.list[0].source === 'spontaneous');
  s2.press('blink', 20000); s2.release('blink', 20050);
  const b = s2.list[1];
  check('annotation : geste bref = fenêtre ±0,5 s autour de l’instant corrigé', b.start === 19100 && b.end === 20100);
  s2.press('jaw', 30000); s2.finish(31000);
  check('annotation : finish ferme les touches encore maintenues', s2.list.length === 3 && Object.keys(s2.pending).length === 0);
  s2.release('gaze-left', 40000);
  check('annotation : relâcher sans appui ne crée rien', s2.list.length === 3);
  s2.shift(1000); s2.flag(s2.list[0].id, 'doubtful'); s2.edit(s2.list[1].id, { label: 'jaw' }); s2.remove(s2.list[2].id);
  check('annotation : revue (décaler, exclure, changer d’étiquette, supprimer)', s2.list.length === 2 && s2.list[0].start === 10600 && s2.list[0].quality === 'doubtful' && s2.list[1].label === 'jaw');

  /* ---------- Comparaison ---------- */
  const A = (label, start, end, quality = 'ok') => ({ id: Math.random(), label, start, end, source: 'forced', quality });
  const ann = [A('frown', 0, 3000), A('frown', 10000, 13000), A('gaze-left', 20000, 23000), A('rest', 30000, 35000), A('jaw', 40000, 43000, 'doubtful')];
  const det = [
    { type: 'frown', start: 800, end: 2000 },        // bon
    { type: 'gaze-right', start: 21000, end: 22000 }, // confusion (signe inversé)
    { type: 'jaw', start: 31000, end: 32000 },        // fausse alarme au repos
    { type: 'blink', start: 32500, end: 32600 },      // clignement naturel : jamais une erreur
    { type: 'jaw', start: 60000, end: 61000 },        // hors de toute fenêtre
  ];
  const c = Annotation.compare(ann, det);
  check('annotation : rappel par geste', c.perLabel.frown.n === 2 && c.perLabel.frown.hits === 1 && c.perLabel.frown.recall === 0.5 && c.perLabel['gaze-left'].hits === 0);
  check('annotation : annotation douteuse ignorée', c.perLabel.jaw.n === 0);
  check('annotation : confusion regard inversé repérée', c.confusions.length === 1 && c.confusions[0].label === 'gaze-left' && c.confusions[0].got === 'gaze-right');
  check('annotation : fausse alarme au repos, clignement naturel épargné', c.restFalseAlarms.jaw === 1 && !c.restFalseAlarms.blink);
  check('annotation : détection hors fenêtre non comptée comme erreur', c.unlabelled === 1);
  check('annotation : délai médian depuis le début de la fenêtre', c.perLabel.frown.latencyMs === 2000, String(c.perLabel.frown.latencyMs));

  /* ---------- Détections du détecteur ---------- */
  check('annotation : début d’épisode ignoré, fin convertie en intervalle', Annotation.detectionFrom({ type: 'frown', phase: 'start', time: 5000 }) === null
    && JSON.stringify(Annotation.detectionFrom({ type: 'frown', phase: 'end', time: 5000, durationMs: 800 })) === '{"type":"frown","start":4200,"end":5000}');

  /* ---------- Capture longue + enregistrement ---------- */
  const bus = { l: {}, on(e, f) { (this.l[e] = this.l[e] || []).push(f); return () => { this.l[e] = this.l[e].filter((x) => x !== f); }; }, emit(e, ...a) { (this.l[e] || []).forEach((f) => f(...a)); } };
  const cap = new AnnotationCapture(bus, { seconds: 60 });
  cap.start();
  const sig = new SignalSimulator().generate(256 * 10);
  for (let k = 0; k + 12 <= sig[0].length; k += 12) for (let ch = 0; ch < 4; ch++) bus.emit('eeg', ch, sig[ch].slice(k, k + 12));
  cap.stop();
  const kept = cap.freeze().eeg[0].t.length;
  check('annotation : capture longue (10 s gardées, au-delà des 30 s possibles)', cap.seconds > 9.5 && kept > 2400, `${kept} échantillons`);
  bus.emit('eeg', 0, [1, 2, 3]);
  check('annotation : plus rien n’est capté après stop()', cap.freeze().eeg[0].t.length === kept);

  const frozen = cap.freeze(), start = frozen.eeg[0].t[0];
  const rec = Recording.fromArrays(frozen, { n: 1, name: 'test-annotation', include: { ppg: false, motion: false } });
  const ss = new Annotation.Session({ delayMs: 350 });
  ss.forced('frown', start + 2000, 3000); ss.press('blink', start + 6000); ss.forced('rest', start + 9000, 5000);
  Annotation.applyTo(rec, ss.sorted(), { mode: 'forced', detections: [{ type: 'frown', start: start + 3000, end: start + 4000 }] });
  check('annotation : événements BIDS écrits (onset en s, étiquette française)', rec.events.length === 3 && rec.events[0].trial_type === 'sourcils' && Math.abs(rec.events[0].onset - 2) < 0.01 && rec.events[2].trial_type === 'repos', JSON.stringify(rec.events.map((e) => e.trial_type)));
  check('annotation : fenêtre coupée à la fin de l’enregistrement', rec.events[2].onset + rec.events[2].duration <= rec.eeg.RecordingDuration + 0.01);
  const tsv = Recording.eventsTsv(rec).split('\n');
  check('annotation : colonnes supplémentaires dans events.tsv', tsv[0] === 'onset\tduration\ttrial_type\tsample\tsource\tquality\tprecision\tdelay_ms' && tsv[1].includes('forced'), tsv[0]);
  check('annotation : détections gardées à part, signalées comme non vérité', rec.annotation.detections.length === 1 && /PAS la vérité/.test(rec.annotation.note) && rec.task === 'annotation');
  const back = Recording.fromJSON(Recording.toJSON(rec));
  check('annotation : aller-retour JSON sans perte des annotations', back.events.length === 3 && back.annotation.labels.length === Annotation.LABELS.length && back.events[0].source === 'forced');
  /* ---------- États mentaux ---------- */
  const mids = Annotation.LABELS.filter((l) => Annotation.isMental(l.id)).map((l) => l.id);
  check('annotation : quatre états mentaux, sans détecteur, distincts des gestes', mids.length === 4 && !Annotation.isMental('blink') && mids.every((id) => Annotation.label(id).detector === null));
  const mp = Annotation.plan({ labels: mids, reps: 2, seed: 3 });
  check('annotation : plan d’états équilibré, fenêtres de 45 s', mp.trials.length === 8 && mp.trials.every((t) => t.durationS === 45));
  const ms2 = new Annotation.Session({ delayMs: 0 });
  ms2.forced('mental-relax', 0, 45000);
  const mc = Annotation.compare(ms2.list, [{ type: 'jaw', start: 5000, end: 6000 }]);
  check('annotation : une fenêtre d’état mental ne produit ni confusion ni fausse alarme', !mc.confusions.length && !Object.keys(mc.restFalseAlarms).length && mc.unlabelled === 1);
  ms2.press('mental-focus', 50000); ms2.release('mental-focus', 80000);
  check('annotation : état maintenu en spontané', ms2.list[1].label === 'mental-focus' && ms2.list[1].end - ms2.list[1].start === 30000 && ms2.list[1].source === 'spontaneous');
  const rec2 = Recording.fromArrays(cap.freeze(), { n: 2, name: 'test-etat', include: { ppg: false, motion: false } });
  const s3 = new Annotation.Session(); s3.forced('mental-drowsy', start + 1000, 5000);
  Annotation.applyTo(rec2, s3.list, { mode: 'forced' });
  check('annotation : état écrit dans events.tsv (etat_somnolent)', rec2.events[0].trial_type === 'etat_somnolent' && rec2.annotation.labels.find((l) => l.id === 'mental-drowsy').group === 'mental');
})();
