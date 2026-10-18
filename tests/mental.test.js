/* Tests de lib/mental-state.js (indices, référence, décision avec maintien) et d'un scénario simulé de bout en bout. */
(function () {
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const i = MentalState.indices({ theta: 2, alpha: 4, beta: 2 });
  check('état : indices (α/(θ+α+β), β/(α+θ), θ/(α+β))', near(i.relax, 0.5) && near(i.focus, 1 / 3) && near(i.drowsy, 1 / 3), JSON.stringify(i));

  const base = { theta: 4, alpha: 10, beta: 3 };
  const ms = new MentalState();
  for (let k = 0; k < MentalState.AUTO_BASELINE_S - 1; k++) ms.update(base);
  check('état : en attente pendant la référence automatique', ms.state === 'unknown' && !ms.baseline);
  ms.update(base);
  check('état : référence automatique après 30 s', !!ms.baseline && ms.baseline.seconds === 30);
  for (let k = 0; k < 5; k++) ms.update(base);
  check('état : neutre quand tout est comme la référence', ms.state === 'neutral', ms.state);

  const relaxed = { ...base, alpha: 22 };
  let r = ms.update(relaxed);
  check('état : pas de changement sur une seule seconde (maintien)', ms.state === 'neutral', JSON.stringify(r.scores));
  for (let k = 0; k < 15; k++) r = ms.update(relaxed);
  check('état : plus d’alpha → détendu', ms.state === 'relaxed', JSON.stringify(r.scores));

  r = ms.update(null);
  check('état : mesure impossible → en pause, état conservé', r.paused && ms.state === 'relaxed');

  for (let k = 0; k < 20; k++) r = ms.update({ ...base, beta: 9, alpha: 7 });
  check('état : plus de bêta → concentré', ms.state === 'focused', JSON.stringify(r.scores));
  for (let k = 0; k < 20; k++) r = ms.update({ ...base, theta: 12, alpha: 6 });
  check('état : plus de theta → somnolent', ms.state === 'drowsy', JSON.stringify(r.scores));

  const fixed = new MentalState({ baseline: MentalState.baselineFrom([MentalState.indices(base)]) });
  fixed.update({ ...base, alpha: 22 });
  check('état : avec référence mesurée, pas d’attente', fixed.state !== 'unknown' && fixed.baseline.seconds === 1);

  /* Scénario de bout en bout : simulateur -> filtres -> Welch -> état */
  const R = 256, sim = new SignalSimulator({ theta: 6, beta: 4, spikePerS: 0, blink: 0 }, R, 77);
  const pipe = new SignalPipeline(R), buf = [[], [], [], []], state = new MentalState();
  const run = (seconds) => {
    for (let s = 0; s < seconds; s++) {
      const block = sim.generate(R);
      for (let k = 0; k < R; k++) pipe.processFrame([block[0][k], block[1][k], block[2][k], block[3][k]]).forEach((v, c) => { buf[c].push(v); if (buf[c].length > 4 * R) buf[c].shift(); });
      if (buf[0].length >= 4 * R) state.update(MentalState.bandsFrom(buf, R));
    }
  };
  run(40);
  check('scénario : référence prise puis état neutre', state.state === 'neutral', state.state + ' ' + JSON.stringify(state.scores));
  sim.cfg.gain.alpha = 2;
  run(20);
  check('scénario : alpha doublé → détendu', state.state === 'relaxed', JSON.stringify(state.scores));
  sim.cfg.gain.alpha = 1; sim.cfg.gain.beta = 3;
  run(20);
  check('scénario : bêta triplé → concentré', state.state === 'focused', JSON.stringify(state.scores));
  check('simulateur : gains propres à chaque instance', SignalSimulator.DEFAULTS.gain.beta === 1);

  /* Électrodes écartées : une seule règle (excludedFor), en direct (EventLog) comme hors ligne (timeline) */
  const ids = (set) => [...set].sort().join(',');
  check('exclusion : un regard écarte le front', ids(MentalState.excluded({ gaze: true })) === '1,2' && ids(MentalState.excluded({ jaw: true })) === '0,3');
  const evs = [{ type: 'gaze-left', onset: 10, duration: 2 }, { type: 'blink', onset: 20, duration: 0.2 }, { type: 'jaw', onset: 30, duration: 1 }];
  check('exclusion : regard qui touche la fenêtre -> front', ids(MentalState.excludedFor(evs, 8, 12)) === '1,2');
  check('exclusion : regard fini 0,2 s avant la fenêtre -> front (marge 0,3 s)', ids(MentalState.excludedFor(evs, 12.2, 16.2)) === '1,2');
  check('exclusion : clignement au DÉBUT d’une fenêtre de 4 s -> front', ids(MentalState.excludedFor(evs, 20, 24)) === '1,2');
  check('exclusion : rien dans la fenêtre -> aucune', MentalState.excludedFor(evs, 13, 17).size === 0);
  check('exclusion : mâchoire -> tempes', ids(MentalState.excludedFor(evs, 29, 33)) === '0,3');

  const log = new MentalState.EventLog(), T = 1000000; // heures en ms
  log.add({ type: 'blink', time: T + 500, durationMs: 200 });
  check('journal : clignement il y a 3,5 s encore dans la fenêtre de 4 s', ids(log.excluded({}, 4, T + 4000)) === '1,2');
  check('journal : clignement oublié après 4,3 s', log.excluded({}, 4, T + 4900).size === 0);
  log.add({ type: 'jaw', phase: 'start', time: T + 5000 });
  check('journal : mâchoire commencée sans fin -> tempes écartées', ids(log.excluded({}, 4, T + 12000)) === '0,3');
  log.add({ type: 'yawn', phase: 'end', time: T + 13000, durationMs: 7500 });
  check('journal : un bâillement clôt l’épisode « mâchoire » -> toutes', ids(log.excluded({}, 4, T + 14000)) === '0,1,2,3');
  check('journal : épisode clos puis oublié', log.excluded({}, 4, T + 20000).size === 0);
  check('journal : épisode signalé en cours (detector.active.gaze) -> front', ids(log.excluded({ gaze: true }, 4, T + 20000)) === '1,2');
  log.add({ type: 'gaze-right', phase: 'start', time: T + 21000 });
  check('journal : regard commencé -> front', ids(log.excluded({}, 4, T + 22000)) === '1,2');

  /* Hors ligne : un regard dans l'enregistrement écarte le front des fenêtres qu'il touche */
  const quiet = new SignalSimulator({ theta: 6, beta: 4, spikePerS: 0, blink: 0 }, R, 5), raw = sim2arr(quiet, 20);
  const tlg = MentalState.timeline(raw, { rate: R, events: [{ type: 'gaze-left', onset: 10, duration: 1.5 }] });
  const at = (t) => tlg.segments.find((s) => s.end === t);
  check('chronologie : regard -> fenêtres touchées sur TP9/TP10 seulement', at(12).used.join() === '0,3' && at(16).used.join() === '0,1,2,3',
    `${at(12).used} / ${at(16).used}`);
  function sim2arr(sim, s) { const out = [[], [], [], []]; for (let k = 0; k < s; k++) sim.generate(R).forEach((v, c) => out[c].push(...v)); return out; }

  /* Rejet par segment : seuls les segments de 1 s touchés (zone + marge) sont retirés, électrode par électrode */
  const win4 = sim2arr(new SignalSimulator({ theta: 6, beta: 4, spikePerS: 0, blink: 0 }, R, 8), 4);
  const m1 = MentalState.measure(win4, { rate: R, events: [{ type: 'blink', onset: 101.8, duration: 0.3 }], t0: 100 });
  check('segments : un clignement retire 3 segments sur 7 au front, garde l’électrode', m1[1] && m1[1].segments === 4 && m1[1].of === 7 && m1[0].segments === 7,
    m1.map((m) => m && m.segments).join());
  const m2 = MentalState.measure(win4, { rate: R, events: [{ type: 'blink', onset: 100.6, duration: 0.3 }, { type: 'blink', onset: 102.4, duration: 0.3 }], t0: 100 });
  check('segments : deux clignements -> moins de MIN_SEGMENTS, front écarté, tempes gardées', !m2[1] && !m2[2] && m2[0] && m2[3]);
  const m3 = MentalState.measure(win4, { rate: R, events: [{ type: 'jaw', onset: 99, duration: Infinity }], t0: 100 });
  check('segments : mâchoire en cours -> tempes écartées', !m3[0] && !m3[3] && m3[1] && m3[1].segments === 7);
  check('segments : sans brut, pas de témoin musculaire', m1[0].emg === null);
  const tlBlink = MentalState.timeline(raw, { rate: R, events: [{ type: 'blink', onset: 10, duration: 0.25 }] });
  check('chronologie : un clignement n’écarte plus le front des fenêtres qui le contiennent', tlBlink.segments.every((s) => s.used.length === 4));
  const live = new MentalState.EventLog();
  live.add({ type: 'frown', phase: 'start', time: T + 1000 });
  const rec = live.recent({}, 4, T + 3000);
  check('journal : recent() donne l’épisode ouvert (durée infinie), en s', rec.length === 1 && rec[0].onset === (T + 1000) / 1000 && rec[0].duration === Infinity);

  /* S4 : copie de la chaîne sans la piste « clignements » */
  const withEog = new SignalPipeline(R);
  withEog.setEnabled('eog', true);
  const sp = MentalState.statePipeline(withEog);
  check('chaîne d’état : piste eog retirée et signalée, original intact', sp.removed.join() === 'eog' && !sp.pipeline.isEnabled('eog') && withEog.isEnabled('eog')
    && sp.pipeline.isEnabled('lowpass') && MentalState.statePipeline(new SignalPipeline(R)).removed.length === 0);

  /* S5 : seuil tiré de la dispersion de la référence */
  check('seuil : 0,18 sans dispersion connue', MentalState.thresholds(null).relax === 0.18 && !MentalState.thresholds({ relax: [1] }).fromSpread);
  // facteur de lissage vérifié par simulation : scores = moyenne de 4 tirages consécutifs (fenêtres de 4 s avancées
  // de 1 s -> autocorrélation 1 − h/4), lissés comme dans update()
  let seed = 3;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const u = Array.from({ length: 40003 }, gauss), xs = [], ys = [];
  const aS = 1 - Math.exp(-1 / MentalState.SMOOTH_S);
  let y = 0;
  for (let k = 3; k < u.length; k++) { const x = (u[k] + u[k - 1] + u[k - 2] + u[k - 3]) / 4; y += aS * (x - y); if (k > 50) { xs.push(x); ys.push(y); } }
  const sd = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
  const fSim = sd(ys) / sd(xs), f = MentalState.smoothingFactor();
  check('seuil : facteur de lissage ≈ simulation (≈ 0,56)', Math.abs(f - fSim) < 0.03 && Math.abs(f - 0.56) < 0.01, `formule ${f.toFixed(3)}, simulation ${fSim.toFixed(3)}`);
  // référence de 30 mesures dont l'alpha fluctue (σ du ln de l'alpha = 0,6, même fluctuation sur les 4 électrodes)
  const noisy = Array.from({ length: 30 }, () => { const a = 10 * Math.exp(0.6 * gauss()); return [0, 1, 2, 3].map(() => ({ theta: 4, alpha: a, beta: 3, emg: 2 })); });
  const nb = MentalState.baselineFrom(noisy), th = MentalState.thresholds(nb);
  const lnRelax = noisy.map((m) => Math.log(MentalState.indices(m[0]).relax / nb.relax[0])), sdRelax = sd(lnRelax);
  check('seuil : référence version 3 (puissances, témoin, dispersion de 30 mesures)', nb.version === 3 && nb.bands.alpha.length === 4 && nb.emg[0] === 2 && nb.spread.n === 30);
  check('seuil : σ lissé ≈ écart-type des scores × facteur de lissage', Math.abs(nb.spread.relax / (sdRelax * f) - 1) < 0.35, `${nb.spread.relax.toFixed(3)} / ${(sdRelax * f).toFixed(3)}`);
  check('seuil : k × σ lissé, dans les bornes', th.fromSpread && th.relax > MentalState.THRESHOLD_MIN && th.relax < MentalState.THRESHOLD_MAX
    && Math.abs(th.relax - 2 * nb.spread.relax) < 1e-9, JSON.stringify(th));
  check('seuil : plancher pour une référence parfaitement stable', MentalState.thresholds(MentalState.baselineFrom(Array(30).fill([base]))).relax === MentalState.THRESHOLD_MIN);
  check('seuil : référence trop courte -> 0,18', !MentalState.baselineFrom(noisy.slice(0, 10)).spread && MentalState.thresholds(MentalState.baselineFrom(noisy.slice(0, 10))).relax === 0.18);

  /* S6 : écarts bruts θ / α / β */
  const b3 = MentalState.baselineFrom(Array(30).fill([0, 1, 2, 3].map(() => ({ theta: 4, alpha: 10, beta: 3, emg: 2 }))));
  const dev = new MentalState({ baseline: b3 });
  let rd;
  for (let k = 0; k < 40; k++) rd = dev.update([0, 1, 2, 3].map(() => ({ theta: 4, alpha: 20, beta: 3, emg: 2 })));
  check('écarts : alpha doublé -> +100 % sur α, 0 sur θ et β', Math.abs(rd.deviations.alpha - Math.log(2)) < 0.01 && Math.abs(rd.deviations.theta) < 1e-6 && rd.state === 'relaxed',
    JSON.stringify(rd.deviations));
  check('écarts : absents avec une ancienne référence', new MentalState({ baseline: { version: 2, relax: [0.5], focus: [0.2], drowsy: [0.3] } }).update({ theta: 4, alpha: 10, beta: 3 }).deviations === null);

  /* S3 : témoin musculaire */
  const tense = new MentalState({ baseline: b3 });
  let rt;
  for (let k = 0; k < 20; k++) rt = tense.update([0, 1, 2, 3].map(() => ({ theta: 4, alpha: 10, beta: 9, emg: 8 })));
  check('muscles : bêta et 30–45 Hz en hausse partout -> concentration suspendue, pas « Concentré »', rt.focusSuspended && rt.muscle.length === 4 && rt.muscleGuard && tense.state !== 'focused',
    tense.state + ' ' + JSON.stringify(rt.scores));
  const calm = new MentalState({ baseline: b3 });
  for (let k = 0; k < 20; k++) rt = calm.update([0, 1, 2, 3].map(() => ({ theta: 4, alpha: 10, beta: 9, emg: 2.4 })));
  check('muscles : bêta en hausse sans 30–45 Hz -> « Concentré »', calm.state === 'focused' && !rt.focusSuspended && rt.muscle.length === 0);
  const one = new MentalState({ baseline: b3 });
  rt = one.update([0, 1, 2, 3].map((c) => ({ theta: 4, alpha: 10, beta: c === 1 ? 30 : 3, emg: c === 1 ? 9 : 2 })));
  check('muscles : une électrode tendue ne compte plus pour la concentration', rt.muscle.join() === '1' && !rt.focusSuspended && Math.abs(rt.scores.focus) < 1e-9 && rt.used.length === 4);
  const old = new MentalState({ baseline: { version: 2, relax: [0.5, 0.5, 0.5, 0.5], focus: [0.2, 0.2, 0.2, 0.2], drowsy: [0.3, 0.3, 0.3, 0.3] } });
  rt = old.update([0, 1, 2, 3].map(() => ({ theta: 4, alpha: 10, beta: 9, emg: 8 })));
  check('muscles : ancienne référence sans témoin -> pas de garde, signalé', !rt.muscleGuard && !rt.focusSuspended && old.threshold.relax === 0.18 && old.baseline.legacy);
  // ancienne référence : comparée au bêta 13–30 Hz (betaWide), comme lors de sa mesure
  const legacyRef = MentalState.indices({ theta: 4, alpha: 10, beta: 6 });
  const leg = new MentalState({ baseline: { version: 2, relax: [legacyRef.relax], focus: [legacyRef.focus], drowsy: [legacyRef.drowsy] } });
  for (let k = 0; k < 10; k++) rt = leg.update({ theta: 4, alpha: 10, beta: 3, betaWide: 6 });
  check('référence version 2 : bêta 13–30 Hz -> neutre sans biais', leg.state === 'neutral' && Math.abs(rt.scores.focus) < 1e-6, JSON.stringify(rt.scores));

  /* Bout en bout : une crispation légère (bruit large bande ×2,5, sous les seuils sourcils / mâchoire) après 40 s calmes */
  const simT = new SignalSimulator({ theta: 6, beta: 4, spikePerS: 0, blink: 0, drift: 10 }, R, 61), rawT = sim2arr(simT, 40);
  simT.cfg.noise = 10;
  sim2arr(simT, 30).forEach((v, c) => rawT[c].push(...v));
  const filtT = new SignalPipeline(R).processOffline(rawT);
  const withGuard = MentalState.timeline(filtT, { rate: R, raw: rawT, baselineRange: [0, 38] });
  const noGuard = MentalState.timeline(filtT, { rate: R, baselineRange: [0, 38] });
  const tail2 = (tl) => tl.segments.filter((s) => s.start >= 50);
  check('muscles (simulé) : sans témoin, la crispation passe pour « Concentré »', tail2(noGuard).filter((s) => s.state === 'focused').length > 10 && !noGuard.muscleGuard,
    tail2(noGuard).map((s) => s.state[0]).join(''));
  check('muscles (simulé) : avec témoin (brut 30–45 Hz), concentration suspendue', withGuard.muscleGuard && tail2(withGuard).every((s) => s.state !== 'focused' && s.focusSuspended),
    tail2(withGuard).map((s) => s.state[0]).join(''));
  check('muscles (simulé) : référence prise sur une portion -> seuil personnel', withGuard.threshold.fromSpread && !MentalState.timeline(filtT, { rate: R, raw: rawT }).threshold.fromSpread);
})();
