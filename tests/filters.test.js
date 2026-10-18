/* Tests de lib/filters.js (SignalPipeline, Biquad), de lib/signal.js (welch, stats, bandes, coefficients d'ordre 1)
 * et de lib/simulator.js. */
(function () {
  const R = 256;
  const sine = (f, amp, n, phase = 0) => Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * f * i / R + phase));
  const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
  const tail = (a, n) => a.slice(a.length - n);

  // Pipeline avec seulement les étapes données ; entrée [4][n] -> sortie [4][n]
  function run(stages, input, params = {}) {
    const p = new SignalPipeline(R);
    SignalPipeline.STAGES.forEach((s) => p.setEnabled(s.id, stages.includes(s.id)));
    Object.entries(params).forEach(([id, v]) => p.setParam(id, v));
    const n = input[0].length, out = [0, 1, 2, 3].map(() => new Array(n));
    for (let i = 0; i < n; i++) {
      const y = p.processFrame([input[0][i], input[1][i], input[2][i], input[3][i]]);
      for (let c = 0; c < 4; c++) out[c][i] = y[c];
    }
    return out;
  }
  const same = (x) => [x, x, x, x];
  const N = 4 * R;

  /* Filtre secteur */
  let y = run(['notch'], same(sine(50, 20, N)));
  check('filtres : le coupe-bande atténue le 50 Hz de plus de 20 dB', rms(tail(y[0], 2 * R)) < 0.1 * rms(sine(50, 20, N)), rms(tail(y[0], 2 * R)).toFixed(2) + ' µV');
  y = run(['notch'], same(sine(10, 20, N)));
  const g10 = rms(tail(y[0], 2 * R)) / rms(sine(10, 20, N));
  check('filtres : le coupe-bande laisse passer 10 Hz', g10 > 0.95 && g10 < 1.05, 'gain ' + g10.toFixed(3));
  y = run(['notch'], same(sine(60, 20, N)), { notch: 60 });
  check('filtres : réglage 60 Hz', rms(tail(y[0], 2 * R)) < 2, rms(tail(y[0], 2 * R)).toFixed(2) + ' µV');

  /* Retrait de la dérive */
  const drift = sine(0.05, 100, 8 * R).map((v) => v + 300);
  y = run(['highpass'], same(drift));
  check('filtres : le passe-haut retire décalage et dérive lente', rms(tail(y[0], 2 * R)) < 2, rms(tail(y[0], 2 * R)).toFixed(2) + ' µV');
  y = run(['highpass'], same(sine(10, 20, N)));
  const gHp = rms(tail(y[0], 2 * R)) / rms(sine(10, 20, N));
  check('filtres : le passe-haut laisse passer 10 Hz', gHp > 0.97 && gHp < 1.03, 'gain ' + gHp.toFixed(3));

  /* Passe-bas */
  y = run(['lowpass'], same(sine(80, 20, N)));
  check('filtres : le passe-bas atténue 80 Hz de plus de 20 dB', rms(tail(y[0], 2 * R)) < 0.1 * rms(sine(80, 20, N)), rms(tail(y[0], 2 * R)).toFixed(2) + ' µV');
  y = run(['lowpass'], same(sine(10, 20, N)));
  const gLp = rms(tail(y[0], 2 * R)) / rms(sine(10, 20, N));
  check('filtres : le passe-bas laisse passer 10 Hz', gLp > 0.97 && gLp < 1.03, 'gain ' + gLp.toFixed(3));

  /* Tout désactivé = signal inchangé */
  const anyIn = [sine(7, 30, 300), sine(13, 5, 300), sine(50, 9, 300), sine(2, 40, 300)];
  y = run([], anyIn);
  check('filtres : tout désactivé = signal identique', y.every((ch, c) => ch.every((v, i) => v === anyIn[c][i])));

  /* Pics isolés */
  let seed = 3;
  const g = () => { seed = (seed * 1664525 + 1013904223) >>> 0; const u = seed / 2 ** 32; seed = (seed * 1664525 + 1013904223) >>> 0; return 5 * Math.sqrt(-2 * Math.log(u + 1e-12)) * Math.cos(2 * Math.PI * seed / 2 ** 32); };
  const noisy = Array.from({ length: 2 * R }, g);
  const spiky = noisy.slice(); spiky[300] += 400;
  y = run(['despike'], same(spiky));
  check('filtres : un pic isolé est supprimé', Math.abs(y[0][300]) < 30, y[0][300].toFixed(1) + ' µV au lieu de ' + spiky[300].toFixed(0));
  const kept = rms(run(['despike'], same(noisy))[0]) / rms(noisy);
  check('filtres : le bruit normal est presque intact', kept > 0.95, 'rapport ' + kept.toFixed(3));

  /* Référence moyenne commune */
  const common = sine(23, 50, N), alpha = sine(10, 20, N);
  y = run(['car'], [common.map((v, i) => v + alpha[i]), common, common, common]);
  check('filtres : la référence moyenne retire le signal commun', Math.abs(rms(y[1]) - rms(alpha) / 4) < 0.5, rms(y[1]).toFixed(2) + ' µV (attendu ' + (rms(alpha) / 4).toFixed(2) + ')');

  /* Réduction des clignements (simulateur sans secteur ni pics) */
  const simCfg = { mains: 0, spikePerS: 0, drift: 0 };
  const sig = new SignalSimulator(simCfg, R, 99).generate(60 * R);
  const withEog = run(['highpass', 'eog'], sig), without = run(['highpass'], sig);
  const last = 15 * R;
  const peak = (a) => Math.max(...tail(a, last).map(Math.abs));
  const ratio = peak(withEog[1]) / peak(without[1]);
  check('filtres : les clignements frontaux sont réduits de plus de 50 %', ratio < 0.5, 'pic AF7 ×' + ratio.toFixed(2));
  const alphaKept = Signal.powerBetween(Signal.welch(tail(withEog[0], last), R), 9, 11) / Signal.powerBetween(Signal.welch(tail(without[0], last), R), 9, 11);
  check('filtres : l’alpha de TP9 est conservé', alphaKept > 0.7 && alphaKept < 1.3, 'rapport ' + alphaKept.toFixed(2));

  /* Welch */
  const spec = Signal.welch(sine(10, 10, 8 * R), R);
  const kMax = spec.psd.indexOf(Math.max(...spec.psd));
  check('signal : Welch place le pic à 10 Hz', spec.freqs[kMax] === 10, spec.freqs[kMax] + ' Hz');
  const p10 = Signal.powerBetween(spec, 8, 12);
  check('signal : Welch conserve la puissance (A²/2 = 50 µV²)', p10 > 40 && p10 < 60, p10.toFixed(1) + ' µV²');
  // segments choisis : un éclat de 50 µV à 20 Hz dans la 1re seconde, absent des segments gardés
  const burst = sine(10, 10, 4 * R).map((v, i) => v + (i < R ? 50 * Math.sin((2 * Math.PI * 20 * i) / R) : 0));
  const pg = Signal.periodograms(burst, R), all = Signal.welch(burst, R), late = Signal.welch(burst, R, 256, [3, 4, 5, 6]);
  check('signal : un périodogramme par segment de 1 s (recouvrement 50 %)', pg.list.length === 7 && pg.list[2].start === 256 && all.segments === 7 && late.segments === 4);
  check('signal : Welch sur les segments gardés seulement (éclat écarté)', Signal.powerBetween(all, 18, 22) > 100 && Signal.powerBetween(late, 18, 22) < 0.5
    && Math.abs(Signal.powerBetween(late, 8, 12) - 50) < 10, `${Signal.powerBetween(all, 18, 22).toFixed(1)} / ${Signal.powerBetween(late, 18, 22).toFixed(3)} µV²`);

  /* Réglages partagés entre projets */
  let backup = null;
  backup = Profiles.get('pipeline', null);
  const shared = new SignalPipeline(R);
  shared.setEnabled('eog', true); shared.setParam('notch', 60); shared.setEnabled('lowpass', false);
  shared.save();
  const again = SignalPipeline.loadSaved(R);
  check('réglages : mémorisés puis repris par un autre projet', again.isEnabled('eog') && again.getParam('notch') === 60 && !again.isEnabled('lowpass'), again.summary());
  check('réglages : résumé lisible', again.summary() === 'Dérive 1 Hz · Secteur 60 Hz · Clignements', again.summary());
  Profiles.set('pipeline', { enabled: { notch: true }, params: { notch: 999 } });
  check('réglages : valeur invalide ignorée', SignalPipeline.loadSaved(R).getParam('notch') === 50);
  if (backup === null) Profiles.unset('pipeline'); else Profiles.set('pipeline', backup);
  check('réglages : par défaut sans mémoire', new SignalPipeline(R).summary() === 'Dérive 1 Hz · Secteur 50 Hz · Passe-bas 40 Hz');

  /* Simulateur + réglages par défaut */
  const simSig = new SignalSimulator({}, R, 5).generate(8 * R);
  const pipe = new SignalPipeline(R);
  const out = [0, 1, 2, 3].map(() => []);
  for (let i = 0; i < simSig[0].length; i++) pipe.processFrame([simSig[0][i], simSig[1][i], simSig[2][i], simSig[3][i]]).forEach((v, c) => out[c].push(v));
  const mainsBefore = Signal.powerBetween(Signal.welch(tail(simSig[0], 4 * R), R), 49, 51);
  const mainsAfter = Signal.powerBetween(Signal.welch(tail(out[0], 4 * R), R), 49, 51);
  check('simulateur : réglages par défaut, secteur atténué de plus de 20 dB', 10 * Math.log10(mainsBefore / mainsAfter) > 20, (10 * Math.log10(mainsBefore / mainsAfter)).toFixed(1) + ' dB');
  check('simulateur : déterministe à graine égale', new SignalSimulator({}, R, 1).generate(50)[1][49] === new SignalSimulator({}, R, 1).generate(50)[1][49]);

})();

/* Signal.stats (rms = valeur efficace, std = écart-type), bandes par Welch, coefficients d'ordre 1 */
(function () {
  const R = 256;
  const sine = (f, amp, n) => Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * f * i / R));
  const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
  const tail = (a, n) => a.slice(a.length - n);
  const st = Signal.stats([3, 3, 3, 3]), st2 = Signal.stats(sine(10, 2, 4 * R).map((v) => v + 5));
  check('stats : rms = valeur efficace (décalage compris), std = 0 pour une constante', st.rms === 3 && st.std === 0 && st.mean === 3, JSON.stringify(st));
  check('stats : sinus 2 µV + 5 µV continu (rms = √(5² + 2²/2), std = 2/√2)', Math.abs(st2.rms - Math.sqrt(27)) < 1e-6 && Math.abs(st2.std - Math.SQRT2) < 1e-6, st2.rms.toFixed(4) + ' / ' + st2.std.toFixed(4));
  check('stats : tableau vide', Signal.stats([]).rms === 0 && Signal.stats([]).n === 0);

  /* Bandes relatives par Welch (remplace l'ancien Signal.bandPowers) */
  const bp = Signal.bandPowersFromPsd(Signal.welch(sine(10, 20, 2 * R)));
  check('bandes : sinus 10 Hz -> Alpha dominante (Welch)', bp[2] > 0.9 && Math.abs(bp.reduce((a, b) => a + b, 0) - 1) < 1e-9, bp.map((p) => p.toFixed(2)).join(' '));
  check('bandes : Signal.bandPowers supprimé (une seule méthode)', typeof Signal.bandPowers === 'undefined');

  /* Coefficients d'ordre 1 (utilisés par lib/contact.js et lib/artifacts.js) */
  const a = Signal.onePoleCoef(0.5, R), b = Signal.smoothCoef(2, R);
  check('signal : onePoleCoef = 1 − e^(−2π·fc/rate)', Math.abs(a - (1 - Math.exp((-2 * Math.PI * 0.5) / R))) < 1e-15 && a > 0 && a < 1, a);
  check('signal : smoothCoef = 1 − e^(−1/(τ·rate))', Math.abs(b - (1 - Math.exp(-1 / (2 * R)))) < 1e-15, b);
  let y = 0; // réponse indicielle : après τ secondes, le lissage atteint 1 − 1/e ≈ 63 %
  for (let i = 0; i < 2 * R; i++) y += b * (1 - y);
  check('signal : smoothCoef, 63 % de la marche après τ', Math.abs(y - (1 - Math.exp(-1))) < 1e-3, y.toFixed(4));
  let z = 0; // filtre d'ordre 1 à fc : gain √½ (−3 dB) à la fréquence de coupure
  const c5 = Signal.onePoleCoef(5, R), outLp = sine(5, 1, 8 * R).map((v) => (z += c5 * (v - z)));
  const g = rms(tail(outLp, 4 * R)) / rms(tail(sine(5, 1, 8 * R), 4 * R));
  check('signal : onePoleCoef, environ −3 dB à fc', Math.abs(g - Math.SQRT1_2) < 0.03, g.toFixed(3));
})();
