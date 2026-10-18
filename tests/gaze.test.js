/* Tests du modèle du regard (lib/gaze-model.js) et de la calibration « Regard étalonné » (lib/gaze-calibration.js).
 * Signaux synthétiques et simulateur (graine fixe), horloge manuelle : profil de test intact. */
(function () {
  const M = GazeModel, FR = 64;
  /* ---------- Protocole ---------- */
  check('regard : protocole de 38 s', M.DURATION === 38 && M.target(-1) === null && M.target(39) === null);
  check('regard : centre, fixations puis balayage', M.target(1) === 0 && M.target(3) === 0.5 && M.target(2 + 3 * 5) === -1 && Math.abs(M.target(26 + 3)) < 1e-9 + 1 && M.target(26 + 3) === 1);
  check('regard : 8 fixations de 3 s', M.holds().length === 8 && M.holds().every((h) => h.to - h.from === 3));

  /* ---------- Analyse d'un essai synthétique : d = offset + gain · position(t − décalage) ---------- */
  const trace = (fn) => { const out = []; for (let i = 0; i <= 38 * FR; i++) { const t = i / FR; out.push({ t, d: fn(t) }); } return out; };
  const noise = (i) => Math.sin(i * 12.9898) * 0.4;   // bruit déterministe de ±0,4 µV
  const a1 = M.analyse(trace((t) => 3 + 40 * (M.target(t - 0.25) || 0) + noise(t * FR)), { halfAngleDeg: 15 });
  check('regard : gain, décalage et offset retrouvés', Math.abs(a1.gain - 40) < 2 && Math.abs(a1.lagS - 0.25) < 0.051 && Math.abs(a1.offset - 3) < 1, JSON.stringify(a1));
  check('regard : corrélation ~1, pas d’asymétrie, pas d’affaissement', a1.r > 0.99 && a1.asymmetry < 0.1 && a1.droop > 0.9, `r=${a1.r} asym=${a1.asymmetry} droop=${a1.droop}`);
  check('regard : rapport à la théorie (2,5 µV/° × 15°)', Math.abs(a1.theoryGain - 37.5) < 1e-9 && Math.abs(a1.ratio - 40 / 37.5) < 0.1);
  check('regard : verdict « bon » quand tout concorde', M.verdict(a1).level === 'bon', M.verdict(a1).text);

  const a2 = M.analyse(trace((t) => { const p = M.target(t - 0.2) || 0; return p > 0 ? 50 * p : 20 * p; }), { halfAngleDeg: 15 });
  check('regard : asymétrie gauche / droite détectée', a2.asymmetry > 0.5 && a2.gainLeft > a2.gainRight, `${a2.gainLeft} ${a2.gainRight} ${a2.asymmetry}`);

  // Affaissement : pendant une fixation, le signal retombe (passe-haut du matériel, hypothèse à vérifier sur casque)
  const sag = trace((t) => {
    const h = M.holds().find((x) => t - 0.2 >= x.from && t - 0.2 < x.to);
    return h ? 40 * h.pos * Math.exp(-(t - 0.2 - h.from) / 2) : 40 * (M.target(t - 0.2) || 0);
  });
  const a3 = M.analyse(sag, { halfAngleDeg: 15 });
  check('regard : affaissement pendant les fixations mesuré', a3.droop !== null && a3.droop < 0.6, `droop=${a3.droop}`);

  // Dérive lente (cubique, ~60 µV) et pics de clignement : la position doit rester retrouvée
  const dirty = M.analyse(trace((t) => { const u = t / 38 - 0.5; return 40 * (M.target(t - 0.2) || 0) + 150 * u * u * u + 30 * u + (Math.round(t * FR) % 190 < 6 ? 120 : 0) + noise(t * FR); }), { halfAngleDeg: 15 });
  check('regard : dérive et pics retirés, gain retrouvé', Math.abs(dirty.gain - 40) < 4 && dirty.r > 0.95 && dirty.driftPtp > 30 && dirty.rejected > 0, JSON.stringify({ g: dirty.gain, r: dirty.r, p: dirty.driftPtp, rej: dirty.rejected }));

  const a4 = M.analyse(trace((t) => noise(t * FR * 7) * 10), { halfAngleDeg: 15 });
  check('regard : un signal qui ne suit pas le point est refusé', Math.abs(a4.r) < M.MIN_R && M.verdict(a4).level === 'faible', `r=${a4.r}`);
  check('regard : trop peu de données -> null', M.analyse([{ t: 1, d: 0 }]) === null && M.verdict(null).level === 'faible');
  check('regard : angle de l’écran (34 cm à 60 cm ≈ 15°)', Math.abs(M.halfAngle(34, 60) - 14.9) < 0.2);

  /* ---------- GazeMeter : écart AF7 − AF8 passe-bas, 64 images par seconde ---------- */
  const meter = new GazeMeter(256);
  for (let k = 0; k < 8; k++) {
    meter.feed(1, new Array(32).fill(25)); meter.feed(2, new Array(32).fill(15));
    meter.feed(0, new Array(32).fill(999));   // autres canaux ignorés
  }
  check('GazeMeter : 64 images/s, valeur = AF7 − AF8', meter.frames.length === 64 && Math.abs(meter.frames[63].d - 10) < 1e-9 && Math.abs(meter.frames[1].t - 1 / 64) < 1e-9);

  /* ---------- Calibration sur le simulateur (suit le point : gain = GAZE_UV µV pour ±1) ---------- */
  const R = 256, B = 32;
  const sim = new SignalSimulator({ spikePerS: 0, drift: 5 }, R, 21), ctx = new CalibrationContext(R);
  const drive = (seconds, each) => {
    for (let k = 0; k < (seconds * R) / B; k++) { sim.generate(B).forEach((s, c) => ctx.feed(c, s)); if (each) each((B * 1000) / R); }
  };
  drive(6);
  const runner = new GazeCalibrator(ctx, { clock: false });
  let elapsed = 0, recording = false, done = null;
  runner.onProgress = (st) => {
    const rec = st.phase === 'record' && st.step && st.step.target;
    if (rec && !recording) elapsed = 0;
    recording = !!rec;
    sim.look(rec ? st.step.target(st.step.seconds - st.remainingS) : null);
  };
  runner.onDone = (cal, statuses) => { done = { cal, statuses }; };
  check('calibration regard : démarre quand le signal est prêt', runner.start());
  for (let k = 0; k < 400 && runner.running; k++) drive(B / R, (ms) => runner.advance(ms));
  sim.look(null);
  check('calibration regard : terminée et réussie sur le simulateur', done && done.statuses[0].status === 'ok', done && done.statuses[0].message);
  const saved = GazeCalibrator.load();
  check('calibration regard : gain proche de celui du simulateur (60 µV)', saved && Math.abs(saved.gain - SignalSimulator.GAZE_UV) < 12 && saved.r > 0.9, JSON.stringify(saved));
  check('calibration regard : inscrite au registre, état lisible', Calibrations.get('regard').status().done && Calibrations.get('regard').status().summary.includes('µV'));
  GazeCalibrator.clear();
  check('calibration regard : oubliable', !Calibrations.get('regard').status().done);
  window.ASYNC_TESTS.push((async () => {
    /* ---------- Enregistrement d'une expérience dans experience/<nom>/ (faux dossier en mémoire) ---------- */
    class FakeFile { constructor() { this.data = null; this.kind = 'file'; } async createWritable() { return { write: async (d) => { this.data = d; }, close: async () => {} }; } }
    class FakeDir {
      constructor() { this.kind = 'directory'; this.items = new Map(); }
      async getDirectoryHandle(n, o = {}) { if (!this.items.has(n)) { if (!o.create) throw new Error('absent'); this.items.set(n, new FakeDir()); } return this.items.get(n); }
      async getFileHandle(n, o = {}) { if (!this.items.has(n)) { if (!o.create) throw new Error('absent'); this.items.set(n, new FakeFile()); } return this.items.get(n); }
    }
    const fakeRoot = new FakeDir(), seconds = 3, af7 = Array.from({ length: seconds * 256 }, (_, i) => 10 + (i % 7)), af8 = af7.map((v) => v - 5);
    const files = GazeModel.experimentFiles({ name: 'essai', notes: 'test', source: 'casque', af7, af8, analysis: a1, setup: { widthCm: 34, distanceCm: 60 } });
    const lines = files[0].data.split('\n'), meta = JSON.parse(files[1].data);
    check('expérience : signal.csv (brut, écart, position) et meta.json', files.length === 2 && lines[0] === 't_s,af7_uv,af8_uv,diff_uv,position_demandee'
      && lines.length === seconds * 256 + 2 && lines[1].endsWith(',5.00,0.0000') && meta.mesures.gain > 30 && !('drift' in meta.mesures));
    const w1 = await SampleFolder.writeExperiment('Mon essai 1', files, fakeRoot), w2 = await SampleFolder.writeExperiment('Mon essai 1', files, fakeRoot);
    check('expérience : écrite dans experience/<nom>/, un nom déjà pris reçoit un suffixe', w1.name === 'Mon-essai-1' && w1.paths[0] === 'experience/Mon-essai-1/signal.csv' && w2.name === 'Mon-essai-1-2'
      && (await (await fakeRoot.getDirectoryHandle('experience')).getDirectoryHandle('Mon-essai-1-2')).items.size === 2);
  })().catch((e) => check('expérience : exception', false, e.message)));
})();
