/* Tests du registre des calibrations (lib/calibrations.js), du contexte partagé, des calibrations par étapes
 * (lib/step-calibrator.js, lib/alpha-calibration.js, lib/mental-baseline.js), des gestes joués par le simulateur
 * et du défi des gestes (lib/gesture-challenge.js). Tout est synchrone (horloge manuelle) : profil de test intact. */
(function () {
  /* ---------- Registre ---------- */
  const ids = Calibrations.list().map((d) => d.id);
  check('calibrations : registre complet et ordonné (artefacts, regard, alpha, état)', ids.join() === 'artefacts,regard,alpha,etat', ids.join());
  const bad = Calibrations.list().filter((d) => !(d.label && d.emoji && d.description && d.profileKey && typeof d.create === 'function'
    && typeof d.status === 'function' && d.steps.length && d.steps.every((s) => s.id && s.label && s.seconds > 0 && s.instruction)));
  check('calibrations : chaque définition respecte le contrat', !bad.length, bad.map((d) => d.id).join());
  check('calibrations : clés mémorisées déclarées dans Profiles.KEYS', Calibrations.list().every((d) => Profiles.KEYS.includes(d.profileKey)));
  const st = Calibrations.list().map((d) => d.status());
  check('calibrations : status() lisible même sans mesure', st.every((s) => typeof s.done === 'boolean' && typeof s.summary === 'string'));
  check('calibrations : durée estimée d’une sélection', Calibrations.seconds(['etat']) === 33 && Calibrations.seconds() > Calibrations.seconds(['alpha']));

  /* ---------- Simulateur + contexte : alimentation par paquets de 32 échantillons (125 ms) ---------- */
  const R = 256, B = 32;
  const drive = (sim, ctx, seconds, each) => {
    for (let k = 0; k < (seconds * R) / B; k++) {
      sim.generate(B).forEach((s, c) => ctx.feed(c, s));
      sim.generatePpg(8).forEach((s, c) => ctx.feedPpg(c, s)); // pouls : 8 échantillons à 64 Hz = 125 ms
      if (each) each((B * 1000) / R);
    }
  };

  /* Calibration des artefacts sur les gestes joués par le simulateur */
  const sim1 = new SignalSimulator({ spikePerS: 0, drift: 15 }, R, 11), ctx1 = new CalibrationContext(R);
  ctx1.detector.clearCalibration();
  drive(sim1, ctx1, 6);
  check('contexte : prêt après l’apprentissage et 4 s de signal', ctx1.ready && ctx1.window(4)[0].length === 4 * R);
  check('contexte : électrodes utilisables (contact correct)', ctx1.usableChannels().length >= 2, JSON.stringify(ctx1.contact.levels.map((l) => l.label)));
  const recs = {};
  for (const s of Calibrator.STEPS) {
    sim1.act(s.id === 'rest' || s.target ? null : s.id);
    sim1.look(null);
    drive(sim1, ctx1, 1);
    const frames = [];
    ctx1.detector.onFrame = (f) => frames.push({ blink: f.blink, frown: f.frontalHF, jaw: f.temporalHF, gaze: f.gaze, ppg: f.ppg });
    let el = 0;
    drive(sim1, ctx1, s.seconds, (ms) => { if (s.target) sim1.look(s.target(el)); el += ms / 1000; }); // le simulateur suit le point
    sim1.look(null);
    ctx1.detector.onFrame = null;
    recs[s.id] = frames;
  }
  sim1.act(null);
  const calib = new Calibrator(ctx1.detector), { cal, statuses } = calib.runOffline(recs);
  const failed = statuses.filter((s) => s.status !== 'ok');
  check('simulateur : chaque geste joué se calibre', !failed.length, failed.map((s) => s.id + ' : ' + s.message).join(' ; '));

  /* Défi des gestes, sur les seuils calibrés : le simulateur joue le geste demandé 0,8 s après le signal */
  const game = new GestureChallenge(ctx1, { rounds: 10, seed: 3, clock: false });
  let goT = null, summary = null;
  game.onProgress = (p) => {
    if (p.phase === 'go' && goT === null) goT = 0;
    if (p.phase !== 'go') { goT = null; sim1.act(null); }
  };
  game.onDone = (s) => { summary = s; };
  check('défi : démarre quand le détecteur est prêt', game.start());
  for (let k = 0; k < 600 && game.running; k++) {
    drive(sim1, ctx1, B / R, (ms) => {
      if (goT !== null) { goT += ms; if (goT >= 800) sim1.act(game._list[game._round].id); }
      game.advance(ms);
    });
  }
  check('défi : chaque geste demandé au moins une fois', new Set(game.results.map((r) => r.gesture)).size === GestureChallenge.GESTURES.length);
  check('défi : gestes joués reconnus (≥ 8 / 10)', summary && summary.hits >= 8, JSON.stringify(summary && summary.perGesture));
  check('défi : points = 100 par réussite + bonus de rapidité', summary && summary.score >= 100 * summary.hits && summary.score <= 150 * summary.hits);
  Calibrator.clearSaved();

  /* Défi : confusion et étape à refaire (contexte factice) */
  const fake = { detector: { ready: true }, onEvent(fn) { this.fn = fn; return () => {}; } };
  const g2 = new GestureChallenge(fake, { rounds: 2, seed: 5, clock: false });
  let s2 = null;
  g2.onDone = (s) => { s2 = s; };
  g2.start();
  g2.advance(2000);
  const want = g2._list[0], other = GestureChallenge.GESTURES.find((g) => g !== want);
  fake.fn({ type: other.events[0], phase: 'start' });
  g2.advance(5000);
  check('défi : mauvais geste → raté, confusion notée', g2.results[0] && !g2.results[0].ok && g2.results[0].got === other.events[0]);
  g2.advance(3200);
  fake.fn({ type: g2._list[1].events[0], phase: 'start' });
  g2.advance(1300);
  check('défi : bon geste → réussi ; bilan et étapes à refaire', s2 && s2.hits === 1 && s2.toRedo.includes(want.step), JSON.stringify(s2));

  /* ---------- Profil alpha (yeux ouverts / fermés) ---------- */
  const sim2 = new SignalSimulator({ spikePerS: 0, blinkEveryS: 6 }, R, 21), ctx2 = new CalibrationContext(R);
  drive(sim2, ctx2, 6);
  const alpha = new AlphaCalibrator(ctx2, { clock: false });
  alpha.reset();
  alpha.onProgress = (p) => sim2.act(p.phase === 'record' && p.step.id === 'closed' ? 'closed' : null);
  check('alpha : démarre (contexte prêt)', alpha.start(['closed']));
  check('alpha : les deux étapes vont ensemble', alpha._queue.length === 2);
  for (let k = 0; k < 2000 && alpha.running; k++) drive(sim2, ctx2, B / R, (ms) => alpha.advance(ms));
  const p = AlphaCalibrator.load();
  check('alpha : deux étapes réussies', alpha.statuses.every((s) => s.status === 'ok'), JSON.stringify(alpha.statuses));
  check('alpha : réactivité yeux fermés ≈ ×6 (amplitude ×2,5)', p && p.reactivity > 3 && p.reactivity < 9, p && p.reactivity);
  check('alpha : pic alpha individuel ≈ 10 Hz', p && Math.abs(p.iaf - 10) < 0.5, p && p.iaf);
  const flat = AlphaCalibrator.analyse({ freqs: [8, 9, 10, 11, 12], open: [[1, 1, 1, 1, 1], null, null, null], closed: [[1, 1, 1, 1, 1], null, null, null] });
  check('alpha : pas d’effet de Berger → réactivité 1 (sous le seuil)', Math.abs(flat.reactivity - 1) < 1e-6 && flat.reactivity < AlphaCalibrator.MIN_REACTIVITY);
  check('alpha : pic affiné entre deux raies', Math.abs(AlphaCalibrator.peak([9, 10, 11], [1, 3, 3], 7, 13) - 10.5) < 1e-9);
  alpha.reset();
  check('alpha : réinitialisation efface le profil', AlphaCalibrator.load() === null);

  /* ---------- Référence de l'état mental ---------- */
  const sim3 = new SignalSimulator({ spikePerS: 0, theta: 6, beta: 4 }, R, 31), ctx3 = new CalibrationContext(R);
  drive(sim3, ctx3, 6);
  const base = new BaselineCalibrator(ctx3, { clock: false });
  base.reset();
  let last = null;
  base.onProgress = (s) => { last = s; };
  base.start();
  for (let k = 0; k < 1000 && base.running; k++) drive(sim3, ctx3, B / R, (ms) => base.advance(ms));
  const b = BaselineCalibrator.load();
  check('référence : mesurée et mémorisée (30 s propres)', b && b.seconds === 30 && base.statuses[0].status === 'ok', base.statuses[0].message);
  check('référence : progression en secondes propres', last && last.phase === 'done');
  check('référence : utilisable par MentalState (une valeur par électrode)', b && b.relax.length === 4 && new MentalState({ baseline: b }).baseline !== null);
  check('référence : version 3 (puissances θ/α/β, témoin musculaire, dispersion)', b && b.version === 3 && b.bands && b.bands.theta.length === 4
    && b.emg && b.emg.every((v) => v > 0) && b.spread && b.spread.n === 30 && new MentalState({ baseline: b }).threshold.fromSpread,
    b && JSON.stringify({ emg: b.emg, spread: b.spread }));
  base.reset();

  /* ---------- Pouls et sourcils ---------- */
  check('pouls : la calibration des sourcils trouve un seuil de pouls (le front bouge dans le simulateur)', cal.thresholds.ppg > 1, JSON.stringify(cal.thresholds));
  check('pouls : le repos fournit un plancher de pouls', cal.floors.ppg > 0 && cal.floors.ppg < 3, JSON.stringify(cal.floors));
  const frownLevelPeak = (cal.thresholds.frown - cal.floors.frown) / 0.4 + cal.floors.frown;   // pic typique d'un froncement
  const weakFrown = { ...cal, thresholds: { ...cal.thresholds, frown: frownLevelPeak / 0.7 } };   // seuil EEG trop haut : le froncement n'atteint que 70 %
  const frownCount = (withPpg, calib) => {
    const sim = new SignalSimulator({ spikePerS: 0, drift: 15, blinkEveryS: 60 }, R, 21), c = new CalibrationContext(R);
    c.detector.applyCalibration(calib);
    drive(sim, c, 5);
    sim.act('frown');
    for (let k = 0; k < (14 * R) / B; k++) {
      sim.generate(B).forEach((x, ch) => c.feed(ch, x));
      if (withPpg) sim.generatePpg(8).forEach((x, ch) => c.feedPpg(ch, x));
    }
    return c.detector.counts.frown;
  };
  const alone = frownCount(false, weakFrown), assisted = frownCount(true, weakFrown);
  check('pouls : seuil EEG trop haut, les sourcils sont ratés sans le pouls et repérés avec', alone === 0 && assisted >= 3, `sans ${alone}, avec ${assisted}`);
  const noThr = { ...weakFrown, thresholds: { ...weakFrown.thresholds, ppg: undefined } };
  check('pouls : sans seuil calibré, le seuil par défaut (ppgFrown) s’applique', frownCount(true, noThr) >= 3, String(frownCount(true, noThr)));
  check('pouls : sans pouls fourni, EEG seul (comme avant)', frownCount(false, noThr) === 0);
  // le pouls seul ne fait rien (pas de fausse alerte quand l'EEG ne bouge pas : repos, pouls qui bouge)
  const simQ = new SignalSimulator({ spikePerS: 0, drift: 15, blinkEveryS: 60 }, R, 22), cq = new CalibrationContext(R);
  cq.detector.applyCalibration(cal);
  drive(simQ, cq, 5);
  for (let k = 0; k < (10 * R) / B; k++) {
    simQ.generate(B).forEach((x, ch) => cq.feed(ch, x));
    simQ.generatePpg(8).forEach((x, ch) => { x[0] += 0; cq.feedPpg(ch, ch === 1 ? x.map((v, i) => v + 3000 * Math.sin((k * 8 + i) / 4)) : x); });
  }
  check('pouls : un mouvement du pouls seul (EEG au repos) ne crée pas de sourcils', cq.detector.counts.frown === 0, String(cq.detector.counts.frown));

  /* ---------- Bac à sable des réglages (démonstrations) ---------- */
  Profiles.set('alphaProfile', { iaf: 9 });
  Profiles.sandbox(true);
  check('bac à sable : lit les vrais réglages', Profiles.get('alphaProfile').iaf === 9 && Profiles.sandboxed);
  Profiles.set('alphaProfile', { iaf: 11 });
  Profiles.unset('mentalBaseline');
  check('bac à sable : modifications visibles pendant la démonstration', AlphaCalibrator.load().iaf === 11);
  Profiles.sandbox(false);
  check('bac à sable : vrais réglages intacts à la sortie', AlphaCalibrator.load().iaf === 9 && !Profiles.sandboxed);
  AlphaCalibrator.clear();
})();
