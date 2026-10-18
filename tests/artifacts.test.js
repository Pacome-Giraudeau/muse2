/* Tests de lib/artifacts.js, lib/calibration.js, lib/contact.js sur signaux synthétiques. */
const RATE = 256;
const OFFSET = [0, 300, -200, 50]; // décalages continus réalistes par canal (TP9, AF7, AF8, TP10)
const out = document.getElementById('out');
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  out.innerHTML += `<span class="${ok ? 'pass' : 'fail'}">${ok ? 'PASS' : 'FAIL'}</span> ${name} ${detail}\n`;
};

let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const gauss = (s) => s * Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

// Signal synthétique 4 canaux : bruit + décalage continu + gestes décrits dans `items`
//   blink {t, amp}  frown {t, d, sigma}  jaw {t, d, sigma}  yawn {t, d, sigma, eye}  gaze {t, d, dev (+ = gauche)}
function synth(seconds, items, noise = 5) {
  const N = Math.round(seconds * RATE), ch = [0, 1, 2, 3].map(() => new Float64Array(N));
  for (let c = 0; c < 4; c++) for (let i = 0; i < N; i++) ch[c][i] = gauss(noise) + OFFSET[c];
  const at = (t) => Math.round(t * RATE);
  const add = (c, a, b, fn) => { for (let i = at(a); i < Math.min(N, at(b)); i++) ch[c][i] += fn(i - at(a), at(b) - at(a)); };
  const noiseFn = (s) => () => gauss(s);
  const pulse = (amp, len) => (k) => (k < len ? amp * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / len)) : 0);
  for (const it of items) {
    if (it.type === 'blink') [1, 2].forEach((c) => add(c, it.t, it.t + 0.25, pulse(it.amp, 0.25 * RATE)));
    // sourcils avec grande déflexion lente (mesuré : 300 à 900 µV, 1,5 à 2,8 s) : {t, d, amp, sigma}
    if (it.type === 'brow') [1, 2].forEach((c) => { add(c, it.t, it.t + it.d, pulse(it.amp, it.d * RATE)); add(c, it.t, it.t + it.d, noiseFn(it.sigma)); });
    if (it.type === 'frown') [1, 2].forEach((c) => add(c, it.t, it.t + it.d, noiseFn(it.sigma)));
    if (it.type === 'jaw') {
      [0, 3].forEach((c) => add(c, it.t, it.t + it.d, noiseFn(it.sigma)));
      [1, 2].forEach((c) => add(c, it.t, it.t + it.d, noiseFn(it.sigma / 4)));
    }
    if (it.type === 'yawn') {
      [0, 3].forEach((c) => add(c, it.t, it.t + it.d, noiseFn(it.sigma)));
      [1, 2].forEach((c) => add(c, it.t, it.t + it.d, noiseFn(it.sigma / 3)));
      [1, 2].forEach((c) => add(c, it.t + 0.2, it.t + 0.8, pulse(it.eye, 0.6 * RATE)));
    }
    if (it.type === 'cues') { // regards secs : une impulsion à chaque consigne de Calibrator.GAZE_CUES (réaction 0,3 s), puis le retour (signe opposé, 1,2 x)
      for (const c of Calibrator.GAZE_CUES) {
        const dev = (c.side > 0 ? it.devL : it.devR) || it.dev, at0 = c.t + 0.3, back = c.t + Calibrator.GAZE_HOLD_S + 0.3;
        add(1, at0, at0 + 0.3, pulse(c.side * dev / 2, 0.3 * RATE)); add(2, at0, at0 + 0.3, pulse(-c.side * dev / 2, 0.3 * RATE));
        add(1, back, back + 0.3, pulse(-1.2 * c.side * dev / 2, 0.3 * RATE)); add(2, back, back + 0.3, pulse(1.2 * c.side * dev / 2, 0.3 * RATE));
      }
    }
    if (it.type === 'gaze') {
      const ramp = 0.1 * RATE;
      const f = (k, len) => Math.min(1, k / ramp, (len - k) / ramp);
      add(1, it.t, it.t + it.d, (k, len) => (it.dev / 2) * f(k, len));
      add(2, it.t, it.t + it.d, (k, len) => (-it.dev / 2) * f(k, len));
    }
  }
  return ch;
}

function feedAll(det, ch) {
  for (let p = 0; p + 12 <= ch[0].length; p += 12) {
    for (let c = 0; c < 4; c++) det.feed(c, ch[c].subarray(p, p + 12));
  }
}

// Scénario d'évaluation : 4 clignements, 1 sourcils, 1 mâchoire, 1 bâillement, 1 regard à gauche, 1 à droite
function scenario(k) {
  return [
    { type: 'blink', t: 6, amp: k.blink }, { type: 'blink', t: 9, amp: k.blink },
    { type: 'frown', t: 12, d: 1.5, sigma: k.muscle },
    { type: 'jaw', t: 16, d: 1, sigma: k.muscle },
    { type: 'yawn', t: 21, d: 3, sigma: k.muscle, eye: k.blink },
    { type: 'gaze', t: 28, d: 2, dev: k.gaze }, { type: 'gaze', t: 33, d: 2, dev: -k.gaze },
    { type: 'blink', t: 38, amp: k.blink }, { type: 'blink', t: 41, amp: k.blink },
  ];
}
const EXPECTED = { blink: 4, frown: 1, jaw: 1, yawn: 1, 'gaze-left': 1, 'gaze-right': 1 };
const matches = (det) => Object.keys(EXPECTED).every((key) => det.counts[key] === EXPECTED[key]);

function evaluate(name, det, k) {
  det.reset();
  feedAll(det, synth(45, scenario(k)));
  check(name, matches(det), JSON.stringify(det.counts));
}

// Enregistrements de calibration : les trames émises par le détecteur pendant chaque étape
function record(k) {
  const det = new ArtifactDetector();
  feedAll(det, synth(6, [])); // apprentissage du bruit de fond
  const gestures = {
    rest: [],
    blink: [1, 3, 5, 7, 9].map((t) => ({ type: 'blink', t, amp: k.blink })),
    frown: [1, 3, 5, 7].map((t) => ({ type: 'frown', t, d: 1, sigma: k.muscle })),
    jaw: [1, 3, 5, 7].map((t) => ({ type: 'jaw', t, d: 1, sigma: k.muscle })),
    yawn: [1, 6].map((t) => ({ type: 'yawn', t, d: 3, sigma: k.muscle, eye: k.blink })),
    gaze: [{ type: 'cues', dev: k.gaze }],
  };
  const rec = {};
  for (const step of Calibrator.STEPS) {
    rec[step.id] = [];
    det.onFrame = (f) => rec[step.id].push({ blink: f.blink, frown: f.frontalHF, jaw: f.temporalHF, gaze: f.gaze });
    feedAll(det, synth(step.seconds + 2, gestures[step.id]));
  }
  return rec;
}

const clearSaved = () => Calibrator.clearSaved();
clearSaved();

/* --- 1. Gestes francs, seuils par défaut --- */
evaluate('défauts, gestes francs', new ArtifactDetector(), { blink: 150, muscle: 60, gaze: 50 });

/* --- 2. Utilisateur "faible" : les défauts ne suffisent pas, la calibration corrige --- */
const weak = { blink: 40, muscle: 14, gaze: 16 };
const uncal = new ArtifactDetector();
feedAll(uncal, synth(45, scenario(weak)));
check('défauts, gestes faibles : détection incomplète (cas que la calibration doit corriger)', !matches(uncal), JSON.stringify(uncal.counts));

const { cal, statuses } = new Calibrator(new ArtifactDetector()).runOffline(record(weak));
statuses.forEach((s) => check('calibration : ' + s.label, s.status === 'ok', s.message));
check('calibration : signe du regard', cal.gazeSign === 1, 'gazeSign=' + cal.gazeSign);
const calibrated = new ArtifactDetector();
calibrated.applyCalibration(cal);
evaluate('après calibration, gestes faibles', calibrated, weak);

/* --- 3. Matériel inversé : regard gauche donne un écart négatif --- */
clearSaved();
const flipped = { blink: 40, muscle: 14, gaze: -16 };
const cal2 = new Calibrator(new ArtifactDetector()).runOffline(record(flipped)).cal;
check('calibration : signe du regard inversé', cal2.gazeSign === -1, 'gazeSign=' + cal2.gazeSign);
const det2 = new ArtifactDetector();
det2.applyCalibration(cal2);
evaluate('après calibration, regard inversé', det2, flipped);

/* --- 4. Pas de fausse alerte au repos (30 s de bruit) --- */
const idle = new ArtifactDetector();
feedAll(idle, synth(30, []));
check('repos : aucun événement', Object.values(idle.counts).every((v) => v === 0), JSON.stringify(idle.counts));

/* --- 5. Qualité de contact --- */
const q = new ContactQuality();
const good = synth(8, [], 8), flat = synth(8, [], 0.05), loud = synth(8, [], 200);
for (let p = 0; p + 12 <= good[0].length; p += 12) {
  q.feed(0, good[0].subarray(p, p + 12));
  q.feed(1, flat[1].subarray(p, p + 12));
  q.feed(2, loud[2].subarray(p, p + 12));
}
check('contact : signal normal = bon', q.levels[0].label === 'bon', JSON.stringify(q.levels[0]));
check('contact : signal plat = absent', q.levels[1].label === 'absent', JSON.stringify(q.levels[1]));
check('contact : signal énorme = mauvais', q.levels[2].label === 'mauvais', JSON.stringify(q.levels[2]));

/* --- 6. Refaire seulement les étapes échouées --- */
clearSaved();
const retry = new Calibrator(new ArtifactDetector());
const planIds = (c, only) => c._plan(only).join(',');
check('plan : sans repos mémorisé, le repos est ajouté', planIds(retry, ['blink']) === 'rest,blink', planIds(retry, ['blink']));

const badRec = record(weak);
badRec.frown = badRec.rest;             // un geste « raté » : pas de sourcils pendant l'étape
const first = retry.runOffline(badRec);
check('relance : étape ratée signalée', retry.failedIds.join(',') === 'frown', retry.failedIds.join(','));
check('relance : la liste des échecs est mémorisée', JSON.stringify(first.cal.failed) === '["frown"]', JSON.stringify(first.cal.failed));
const blinkBefore = first.cal.thresholds.blink;

const fresh = new Calibrator(new ArtifactDetector());   // simule un rechargement de la page
check('relance : les échecs survivent au rechargement', fresh.failedIds.join(',') === 'frown', fresh.failedIds.join(','));
check('plan : avec repos mémorisé, seule étape demandée', planIds(fresh, fresh.failedIds) === 'frown', planIds(fresh, fresh.failedIds));
check('plan : le regard guidé est une étape à part', planIds(fresh, ['gaze']) === 'gaze', planIds(fresh, ['gaze']));

const second = fresh.runOffline(record(weak), fresh.failedIds);
check('relance : étape refaite réussit', fresh._statuses.find((x) => x.id === 'frown').status === 'ok', JSON.stringify(second.cal.thresholds));
check('relance : plus rien à refaire', fresh.failedIds.length === 0 && second.cal.failed.length === 0);
check('relance : les autres seuils sont conservés', second.cal.thresholds.blink === blinkBefore, blinkBefore + ' → ' + second.cal.thresholds.blink);
check('relance : un seuil sourcils existe maintenant', second.cal.thresholds.frown > 0, String(second.cal.thresholds.frown));

fresh.reset();
check('reset : retour à zéro', fresh.cal === null && fresh.failedIds.length === 0 && fresh._statuses.every((x) => x.status === 'pending'));

clearSaved();

/* --- 7. Détecteur réglé pour le profil actif (profils de test « muse2test ») --- */
{
  const keep = { pipeline: Profiles.get('pipeline', null), sens: Profiles.get('artifactSensitivity', null) };
  const plain = ArtifactDetector.forProfile();
  check('profil : sans calibration ni réglage, détecteur par défaut', !plain.calibrated && plain.sensitivity === 1 && plain.cfg.mainsHz === 50
    && ArtifactDetector.profileMainsHz() === 50);
  Calibrator.save(cal);
  Profiles.set('artifactSensitivity', 1.5);
  Profiles.set('pipeline', { enabled: { notch: true }, params: { notch: 60 } });
  const own = ArtifactDetector.forProfile(256);
  check('profil : calibration, sensibilité et secteur 60 Hz appliqués', own.calibrated && own.sensitivity === 1.5 && own.cfg.mainsHz === 60
    && own.thresholds.blink === cal.thresholds.blink * 1.5, `seuil clignement ${own.thresholds.blink} / ${cal.thresholds.blink}`);
  check('profil : secteur du profil pour detectOffline (profileMainsHz)', ArtifactDetector.profileMainsHz() === 60);
  clearSaved();
  if (keep.pipeline == null) Profiles.unset('pipeline'); else Profiles.set('pipeline', keep.pipeline);
  if (keep.sens == null) Profiles.unset('artifactSensitivity'); else Profiles.set('artifactSensitivity', keep.sens);
}

/* --- 8. Parasite secteur dont l'amplitude varie (câble qui bouge) : pas de « sourcils » --- */
{
  // 10 µV au repos (le bruit de fond est appris dessus), puis toutes les 4 s le parasite monte à 50 µV pendant ~1,5 s
  // (montée et descente de 0,1 s), sur les 4 électrodes, comme le parasite du simulateur (+ harmonique 100 Hz à 20 %).
  // Un saut instantané d'amplitude reste, lui, un vrai transitoire large bande (il peut être détecté).
  const ch = synth(40, []);
  const amp = (t) => { const k = t < 8 ? -1 : (t - 8) % 4; const up = k < 0 ? 0 : Math.min(1, k / 0.1, Math.max(0, (1.7 - k) / 0.1)); return 10 + 40 * up; };
  for (let c = 0; c < 4; c++) for (let i = 0; i < ch[c].length; i++) {
    const t = i / RATE;
    ch[c][i] += amp(t) * (Math.sin(2 * Math.PI * 50 * t) + 0.2 * Math.sin(4 * Math.PI * 50 * t));
  }
  const withNotch = new ArtifactDetector();
  feedAll(withNotch, ch);
  check('secteur 50 Hz variable : aucun sourcils ni mâchoire', withNotch.counts.frown === 0 && withNotch.counts.jaw === 0, JSON.stringify(withNotch.counts));
  const noNotch = new ArtifactDetector({ mainsHz: 1000 }); // fréquence hors bande : pas de coupe-bande (ancien comportement)
  feedAll(noNotch, ch);
  check('secteur 50 Hz variable : sans coupe-bande, fausses alertes (le test a du sens)', noNotch.counts.frown + noNotch.counts.jaw > 0, JSON.stringify(noNotch.counts));
  const sixty = new ArtifactDetector({ mainsHz: 60 });
  feedAll(sixty, synth(45, scenario({ blink: 150, muscle: 60, gaze: 50 })));
  check('secteur 60 Hz : gestes francs toujours détectés', matches(sixty), JSON.stringify(sixty.counts));
}

/* --- 7. Regards secs : le point saute d'un côté puis de l'autre --- */
{
  const G = Calibrator.gazeTarget, C = Calibrator.GAZE_CUES, gz = (r) => r.statuses.find((x) => x.id === 'gaze');
  check('regards secs : trajectoire du point (centre, saut, retour, fin)',
    G(0) === 0 && G(2) === 1 && G(3) === 1 && G(3.3) === 0 && G(5) === -1 && G(33) === null && G(-1) === null);
  check('regards secs : 10 consignes, 5 de chaque côté, jamais plus de 2 de suite',
    C.length === 10 && C.filter((c) => c.side > 0).length === 5 && !C.some((c, i) => i > 1 && c.side === C[i - 1].side && c.side === C[i - 2].side));
  clearSaved();
  const rec7 = record(weak);
  const r0 = new Calibrator(new ArtifactDetector()).runOffline(rec7);
  check('regards secs : étape réussie, sens normal, seuils par direction', gz(r0).status === 'ok' && r0.cal.gazeSign === 1
    && r0.cal.thresholds.gazeLeft > 0 && r0.cal.thresholds.gazeRight > 0 && r0.cal.thresholds.gaze === Math.min(r0.cal.thresholds.gazeLeft, r0.cal.thresholds.gazeRight), JSON.stringify(gz(r0)));
  // retour au centre plus grand que l'aller (mesuré : 24 essais sur 24) : le sens est celui de la PREMIÈRE impulsion
  check('regards secs : le retour plus grand que l’aller ne retourne pas le sens', r0.cal.gazeSign === 1);
  // décalage de réaction supplémentaire de ~0,4 s
  const lagFrames = 12, delayed = rec7.gaze.map((f, i) => ({ ...f, gaze: rec7.gaze[Math.max(0, i - lagFrames)].gaze }));
  clearSaved();
  const r1 = new Calibrator(new ArtifactDetector()).runOffline({ ...rec7, gaze: delayed });
  check('regards secs : un retard de réaction de 0,4 s est toléré', gz(r1).status === 'ok' && r1.cal.gazeSign === 1, JSON.stringify(gz(r1)));
  // sens inversé : impulsions de signe opposé
  clearSaved();
  const r2 = new Calibrator(new ArtifactDetector()).runOffline({ ...rec7, gaze: rec7.gaze.map((f) => ({ ...f, gaze: -f.gaze })) });
  check('regards secs : sens inversé reconnu', gz(r2).status === 'ok' && r2.cal.gazeSign === -1, JSON.stringify(gz(r2)));
  // gauche plus fort que droite : seuils différents
  clearSaved();
  const asym = record({ ...weak, gaze: 0 }); // base du bruit, puis cibles avec amplitudes différentes
  const det8 = new ArtifactDetector(); feedAll(det8, synth(6, []));
  const frames8 = []; det8.onFrame = (f) => frames8.push({ gaze: f.gaze });
  feedAll(det8, synth(34, [{ type: 'cues', dev: 20, devL: 80, devR: 30 }]));
  const r3 = new Calibrator(new ArtifactDetector()).runOffline({ ...rec7, gaze: frames8 });
  check('regards secs : seuils par direction différents (gauche 80 µV, droite 30 µV)', gz(r3).status === 'ok' && r3.cal.thresholds.gazeLeft > 1.5 * r3.cal.thresholds.gazeRight, JSON.stringify(r3.cal.thresholds));
  // pas de regard (repos) : étape ratée, pas de seuil inventé
  clearSaved();
  const r4 = new Calibrator(new ArtifactDetector()).runOffline({ ...rec7, gaze: rec7.rest.concat(rec7.rest, rec7.rest, rec7.rest) });
  check('regards secs : sans regard, l’étape échoue et ne mémorise pas de seuil', gz(r4).status === 'failed' && r4.cal.thresholds.gaze === undefined && r4.cal.thresholds.gazeLeft === undefined, JSON.stringify(gz(r4)));
  // un seul côté : échec explicite
  clearSaved();
  const oneSide = rec7.gaze.map((f, i) => ({ ...f, gaze: Math.abs(f.gaze) < 0 ? f.gaze : f.gaze }));
  const dev1 = new ArtifactDetector(); feedAll(dev1, synth(6, []));
  const f1 = []; dev1.onFrame = (f) => f1.push({ gaze: f.gaze });
  feedAll(dev1, synth(34, [{ type: 'cues', dev: 40, devR: 0.0001 }]));
  const r5 = new Calibrator(new ArtifactDetector()).runOffline({ ...rec7, gaze: f1 });
  check('regards secs : un seul côté exploitable = échec explicite', gz(r5).status === 'failed' && /droite/.test(gz(r5).message), JSON.stringify(gz(r5)));
  // sens incohérent : une moitié des impulsions inversées
  clearSaved();
  const mixed = rec7.gaze.map((f, i) => ({ ...f, gaze: i * (ArtifactDetector.FRAME_DECIMATION / 256) >= 17 ? -f.gaze : f.gaze }));
  const r6 = new Calibrator(new ArtifactDetector()).runOffline({ ...rec7, gaze: mixed });
  check('regards secs : un sens qui change en cours d’étape est refusé', gz(r6).status === 'failed', JSON.stringify(gz(r6)));
  // anciennes calibrations : « left » / « right » à refaire deviennent « gaze »
  Calibrator.save({ version: 1, date: 'x', floors: { blink: 1 }, thresholds: { blink: 50 }, failed: ['left', 'right'] });
  check('regards secs : anciens échecs left / right = regard à refaire', new Calibrator(new ArtifactDetector()).failedIds.join() === 'gaze');
  clearSaved();
  // étapes à la carte
  check('plan : étapes à la carte, repos ajouté si jamais mesuré', new Calibrator(new ArtifactDetector())._plan(['gaze', 'blink']).join() === 'rest,blink,gaze');
}

/* --- 8. Retour au centre : la contre-déviation n'est pas un regard de l'autre côté --- */
{
  const run = (items) => { const d = new ArtifactDetector(); feedAll(d, synth(8, [{ type: 'blink', t: 7.5, amp: 0 }, ...items])); return d.counts; };
  const A = 50;
  const back = run([{ type: 'gaze', t: 4, d: 2, dev: A }, { type: 'gaze', t: 6.1, d: 0.5, dev: -0.6 * A }]);
  check('regard : le retour au centre (60 % du pic) ne compte pas un regard à droite', back['gaze-left'] === 1 && back['gaze-right'] === 0, JSON.stringify(back));
  const off = new ArtifactDetector({ gazeReturnRatio: 0 });
  feedAll(off, synth(8, [{ type: 'gaze', t: 4, d: 2, dev: A }, { type: 'gaze', t: 6.1, d: 0.5, dev: -0.6 * A }]));
  check('regard : sans la règle du retour, la contre-déviation compte à tort (le test a du sens)', off.counts['gaze-right'] === 1, JSON.stringify(off.counts));
  const real = run([{ type: 'gaze', t: 3, d: 1.5, dev: A }, { type: 'gaze', t: 5, d: 1.5, dev: -A }]);
  check('regard : un vrai regard de l’autre côté, de même amplitude, compte', real['gaze-left'] === 1 && real['gaze-right'] === 1, JSON.stringify(real));
  const late = run([{ type: 'gaze', t: 2, d: 1.5, dev: A }, { type: 'gaze', t: 5, d: 1.5, dev: -0.6 * A }]);
  check('regard : un regard faible de l’autre côté bien après le premier compte', late['gaze-right'] === 1, JSON.stringify(late));
}


/* --- 9. Forme des événements (mesurée sur les séances annotées) : arbitrage clignement / sourcils / mâchoire --- */
{
  seed = 99; // graine propre à la section : le test de la mâchoire faible est près du seuil, il ne doit pas dépendre des tests précédents
  const run = (items, config = {}, cal = null) => { const d = new ArtifactDetector(config); if (cal) d.applyCalibration(cal); feedAll(d, synth(12, items)); return d.counts; };
  const brow = run([{ type: 'brow', t: 5, d: 1.5, amp: 300, sigma: 30 }]);
  check('forme : sourcils avec grande déflexion lente = 1 froncement, 0 clignement', brow.frown === 1 && brow.blink === 0, JSON.stringify(brow));
  const blink = run([{ type: 'blink', t: 5, amp: 150 }]);
  check('forme : un clignement franc reste un clignement (pas de froncement)', blink.blink === 1 && blink.frown === 0, JSON.stringify(blink));
  const twoBlinks = run([{ type: 'brow', t: 3, d: 1.5, amp: 300, sigma: 30 }, { type: 'blink', t: 8, amp: 150 }]);
  check('forme : un clignement après des sourcils est compté (réarmement)', twoBlinks.blink === 1 && twoBlinks.frown === 1, JSON.stringify(twoBlinks));
  // mâchoire faible qui accompagne un clignement : pas une mâchoire ; mâchoire franche pendant un clignement : une mâchoire
  // (seuils fixés par une calibration : niveau des tempes = énergie / 20 µV ; sigma 37 donne un niveau juste sous jawBlinkMinLevel, seulement 35 à 39 conviennent : réglé avec la graine fixe de la section)
  const fixed = { version: 1, thresholds: { blink: 70, frown: 60, jaw: 20, gaze: 25 } };
  const weakJaw = run([{ type: 'jaw', t: 5, d: 0.5, sigma: 37 }], {}, fixed);
  const weakJawBlink = run([{ type: 'jaw', t: 5, d: 0.5, sigma: 37 }, { type: 'blink', t: 5, amp: 150 }], {}, fixed);
  check('forme : une mâchoire faible seule est détectée (le test a du sens)', weakJaw.jaw === 1, JSON.stringify(weakJaw));
  check('forme : le même pic des tempes pendant un clignement n’est pas une mâchoire', weakJawBlink.jaw === 0 && weakJawBlink.blink === 1, JSON.stringify(weakJawBlink));
  const strongJawBlink = run([{ type: 'jaw', t: 5, d: 0.5, sigma: 90 }, { type: 'blink', t: 5, amp: 150 }], {}, fixed);
  check('forme : une mâchoire franche pendant un clignement compte', strongJawBlink.jaw === 1, JSON.stringify(strongJawBlink));
  // regard : le retour au centre, AUSSI GRAND que l'aller, ne compte pas
  const A = 50, back = run([{ type: 'gaze', t: 4, d: 0.4, dev: A }, { type: 'gaze', t: 4.9, d: 0.4, dev: -A }]);
  check('forme : retour au centre aussi grand que l’aller = un seul regard', back['gaze-left'] === 1 && back['gaze-right'] === 0, JSON.stringify(back));
  // regard : une déflexion énorme (sourcils) n'est pas un regard, ni juste après
  const huge = run([{ type: 'gaze', t: 4, d: 2, dev: 25 * 12 }]);
  check('forme : un écart AF7 − AF8 énorme (12 x le seuil) n’est pas un regard', huge['gaze-left'] + huge['gaze-right'] === 0, JSON.stringify(huge));
  // regard : seuil par direction
  const dirCal = { version: 1, thresholds: { blink: 70, frown: 8, jaw: 8, gaze: 25, gazeRight: 60 }, gazeSign: 1 };
  const det = new ArtifactDetector(); det.applyCalibration(dirCal);
  feedAll(det, synth(12, [{ type: 'gaze', t: 3, d: 1.5, dev: 50 }, { type: 'gaze', t: 7, d: 1.5, dev: -50 }]));
  check('regard : seuil par direction (droite 60 µV : un regard à droite de 50 µV n’est pas détecté, à gauche oui)', det.counts['gaze-left'] === 1 && det.counts['gaze-right'] === 0, JSON.stringify(det.counts));
  check('regard : seuil par direction, repli sur le seuil commun', new ArtifactDetector()._thr('gazeLeft') === 25);
}
