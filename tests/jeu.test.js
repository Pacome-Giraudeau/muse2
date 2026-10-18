/* Tests du jeu de course aux artefacts : moteur (lib/runner-game.js) et calibration dynamique (lib/dynamic-calibration.js).
 * Tout est synchrone (temps fourni à la main), graine fixe : reproductible. */
(function () {
  /* ---------- Moteur ---------- */
  const g = new RunnerGame({ level: 'moyen', seed: 5 });
  g.start();
  check('jeu : trois niveaux', Object.keys(RunnerGame.LEVELS).join() === 'facile,moyen,difficile');
  check('jeu : départ au centre, vies du niveau', g.state.lane === 1 && g.state.lives === RunnerGame.LEVELS.moyen.lives);
  g.input('left'); g.input('left');
  check('jeu : le couloir reste dans les limites', g.state.lane === 0);
  g.input('right'); g.input('right'); g.input('right');
  check('jeu : changement de couloir à droite', g.state.lane === 2);
  check('jeu : saut puis retombée', g.input('jump') && g.state.jumping && !g.input('jump') && (g.advance(1300), !g.state.jumping));

  // Le geste attendu mène toujours à un couloir libre (ou un saut), sur de longues parties
  let okPlan = true, bars = 0, walls = 0;
  for (const level of Object.keys(RunnerGame.LEVELS)) {
    const p = new RunnerGame({ level, seed: 9 });
    p.start();
    for (let t = 0; t < 120000 && p.state.running; t += 50) {
      const n = p.needed();
      if (n) {
        if (!['left', 'right', 'jump'].includes(n.action)) okPlan = false;
        p.input(n.action); // le joueur parfait agit dès que c'est attendu
      }
      p.advance(50);
      p.state.obstacles.forEach((o) => { if (o.kind === 'bar') bars++; else { walls++; if (o.lanes.length > 2) okPlan = false; } });
    }
    check(`jeu (${level}) : un joueur parfait ne perd aucune vie en 2 min`, p.state.hits === 0 && p.state.passed >= 10, `touchés ${p.state.hits}, évités ${p.state.passed}`);
  }
  check('jeu : murs et barrières apparaissent, toujours un couloir libre', okPlan && bars > 0 && walls > 0);

  // Un joueur immobile finit par perdre
  const idle = new RunnerGame({ level: 'difficile', seed: 2 });
  let over = false;
  idle.onEvent = (e) => { if (e.type === 'over') over = true; };
  idle.start();
  for (let t = 0; t < 300000 && !over; t += 50) idle.advance(50);
  check('jeu : sans action, la partie se termine', over && idle.state.over && idle.state.lives <= 0);
  check('jeu : après une action, plus rien n’est attendu pendant le délai de retombée', (() => {
    const q = new RunnerGame({ level: 'facile', seed: 4 });
    q.start();
    for (let t = 0; t < 20000 && !q.needed(); t += 50) q.advance(50);
    const n = q.needed();
    q.input(n.action);
    return q.needed() === null;
  })());

  const inf = new RunnerGame({ level: 'difficile', seed: 2, infinite: true });
  inf.start();
  for (let t = 0; t < 120000; t += 50) inf.advance(50);
  check('jeu : mode infini, jamais perdu malgré les obstacles touchés', inf.state.running && !inf.state.over && inf.state.hits > 5 && inf.state.lives === Infinity);

  /* ---------- Calibration dynamique ---------- */
  const det = new ArtifactDetector();
  det.applyCalibration({ version: 1, date: 'x', floors: {}, thresholds: { blink: 100, gaze: 80 }, failed: [] });
  const dyn = new DynamicCalibration(det);
  let now = 0;
  const frame = (blink, gaze, action) => { dyn.observe({ blink, gaze, frontalHF: 0, temporalHF: 0 }, action, now); now += 31; };
  const rest = (ms) => { for (let k = 0; k < ms / 31; k++) frame(10 + (k % 5), 5, null); };
  const trial = (action, peak) => { for (let k = 0; k < 20; k++) frame(action === 'jump' ? peak * Math.sin((k / 19) * Math.PI) : 0, action === 'left' ? peak : action === 'right' ? -peak : 0, action); };

  rest(8000);
  for (let i = 0; i < 4; i++) { trial('jump', 60); rest(3500); trial('left', 40); rest(3500); trial('right', 40); rest(3500); }
  const before = det.thresholds;
  check('dynamique : bruit de repos mesuré', dyn.stats().rest.blink > 9 && dyn.stats().rest.blink < 20, JSON.stringify(dyn.stats().rest));
  check('dynamique : essais retenus', dyn.stats().jump.used === 4 && dyn.stats().gaze.used === 8, JSON.stringify(dyn.stats()));
  check('dynamique : un seuil trop haut descend vers les gestes réels', dyn.apply() && det.thresholds.blink < before.blink && det.thresholds.gaze < before.gaze,
    JSON.stringify([before, det.thresholds]));
  check('dynamique : un pas à la fois (jamais sous ×0,6), au-dessus du repos', det.thresholds.blink > 14 && det.thresholds.blink >= 0.6 * before.blink && det.thresholds.gaze > 5 && det.thresholds.gaze >= 0.6 * before.gaze);
  const t1 = det.thresholds.blink;
  for (let i = 0; i < 6; i++) { dyn.apply(); }
  check('dynamique : convergence sans dépasser la cible (R + 40 % de l’écart)', det.thresholds.blink < t1 && det.thresholds.blink > 14 + 0.4 * (60 - 14) - 2, String(det.thresholds.blink));
  check('dynamique : les seuils sourcils / mâchoire ne sont pas touchés', det.cal.thresholds.frown === undefined && det.cal.thresholds.jaw === undefined);

  // Gestes absents (le joueur ne fait rien) : aucun changement
  const det2 = new ArtifactDetector();
  det2.applyCalibration({ version: 1, date: 'x', floors: {}, thresholds: { blink: 100, gaze: 80 }, failed: [] });
  const dyn2 = new DynamicCalibration(det2);
  now = 0;
  const f2 = (b, gz, a) => { dyn2.observe({ blink: b, gaze: gz }, a, now); now += 31; };
  for (let k = 0; k < 400; k++) f2(10, 5, null);
  for (let i = 0; i < 5; i++) { for (let k = 0; k < 20; k++) f2(11, 6, 'jump'); for (let k = 0; k < 120; k++) f2(10, 5, null); }
  check('dynamique : essais sans geste réel écartés, rien ne change', dyn2.apply() === false && det2.thresholds.blink === 100);

  // Regard à droite : le signe de la calibration est respecté (gazeSign = -1 inverse gauche / droite)
  const det3 = new ArtifactDetector();
  det3.applyCalibration({ version: 1, date: 'x', floors: {}, thresholds: { blink: 100, gaze: 80 }, gazeSign: -1, failed: [] });
  const dyn3 = new DynamicCalibration(det3);
  check('dynamique : mesure du regard orientée par gazeSign', dyn3._value('left', { gaze: -30 }) === 30 && dyn3._value('right', { gaze: -30 }) === -30);

  // Sans calibration préalable : les étapes non couvertes restent « à refaire »
  const det4 = new ArtifactDetector(), dyn4 = new DynamicCalibration(det4);
  now = 0;
  const f4 = (b, a) => { dyn4.observe({ blink: b, gaze: 0 }, a, now); now += 31; };
  for (let k = 0; k < 400; k++) f4(10, null);
  for (let i = 0; i < 4; i++) { for (let k = 0; k < 20; k++) f4(70, 'jump'); for (let k = 0; k < 150; k++) f4(10, null); }
  check('dynamique : sans calibration, seuil de clignement créé et reste à refaire', dyn4.apply() && det4.cal.thresholds.blink > 0 && det4.cal.failed.includes('frown'), JSON.stringify(det4.cal));

  // Sens du regard inversé : les regards « à gauche » se lisent négatifs -> gazeSign est retourné, puis le seuil s'affine
  const det5 = new ArtifactDetector();
  det5.applyCalibration({ version: 1, date: 'x', floors: {}, thresholds: { blink: 100, gaze: 80 }, failed: [] });
  const dyn5 = new DynamicCalibration(det5);
  now = 0;
  const f5 = (gz, a) => { dyn5.observe({ blink: 0, gaze: gz }, a, now); now += 31; };
  for (let k = 0; k < 400; k++) f5(4, null);
  const sens = (a, sgn) => { for (let k = 0; k < 20; k++) f5(sgn * 40, a); for (let k = 0; k < 150; k++) f5(4, null); };
  for (let i = 0; i < 3; i++) { sens('left', -1); sens('right', 1); }
  check('dynamique : sens du regard inversé détecté et corrigé', dyn5.apply() && det5.cal.gazeSign === -1 && dyn5.stats().flips === 1, JSON.stringify(det5.cal));
  const g0 = det5.thresholds.gaze;
  for (let i = 0; i < 4; i++) { sens('left', -1); sens('right', 1); } // mêmes gestes physiques : maintenant lus du bon côté
  check('dynamique : après correction, plus d’inversion et le seuil de regard s’affine', dyn5.apply() && dyn5.stats().flips === 1 && det5.thresholds.gaze < g0, g0 + ' -> ' + det5.thresholds.gaze);
})();
