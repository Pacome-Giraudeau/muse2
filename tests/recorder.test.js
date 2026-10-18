/* Tests de lib/recorder.js : mémoire glissante de 30 s et persistance IndexedDB (base de test séparée). */
window.ASYNC_TESTS = window.ASYNC_TESTS || [];
window.ASYNC_TESTS.push((async () => {
  const DB = 'muse2-test';
  const muse = new Muse();
  const rec = new SignalRecorder(muse, { dbName: DB, saveEveryMs: 60000 });
  await rec.ready;
  await rec.clear();
  check('mémoire : IndexedDB disponible (persistance active)', rec.persistent === true);

  // 40 s d'EEG en paquets de 12 (valeur = numéro d'échantillon), 40 s de mouvement, 40 s de PPG
  let n = 0;
  for (let p = 0; p < (40 * 256) / 12; p++) {
    const samples = Array.from({ length: 12 }, () => n++);
    for (let c = 0; c < 4; c++) muse._emit('eeg', c, samples.map((v) => v + c * 0.25));
  }
  for (let i = 0; i < 40 * 52; i++) muse._emit('accel', { x: i, y: -i, z: 1 });
  for (let p = 0; p < (40 * 64) / 6; p++) for (let c = 0; c < 3; c++) muse._emit('ppg', c, [1, 2, 3, 4, 5, 6].map((v) => 1000000 + v));

  check('mémoire : 30 s d’EEG gardées sur 40 reçues', rec.duration('eeg') === 30, rec.duration('eeg') + ' s');
  check('mémoire : 30 s de mouvement gardées', rec.duration('accel') === 30, rec.duration('accel') + ' s');
  const snap = rec.snapshot();
  const af7 = snap.streams.eeg.channels[1].v;
  check('mémoire : ce sont bien les DERNIÈRES secondes', af7[af7.length - 1] === n - 1 + 0.25 && af7[0] === n - 30 * 256 + 0.25, `${af7[0]} … ${af7[af7.length - 1]}`);
  check('mémoire : horodatage croissant', snap.streams.eeg.channels[0].t.every((t, i, a) => !i || t >= a[i - 1]));
  check('mémoire : PPG 24 bits conservé exactement', snap.streams.ppg.channels[0].v[0] === 1000001, String(snap.streams.ppg.channels[0].v[0]));

  const csv = rec.toCSV('eeg').split('\n');
  check('mémoire : export CSV (en-tête + 7680 lignes)', csv.length === 30 * 256 + 1 && csv[0].startsWith('temps_ms,heure,TP9'), csv.length + ' lignes ; ' + csv[0]);

  await rec.save();
  rec.stop();
  const reopened = new SignalRecorder(new Muse(), { dbName: DB, saveEveryMs: 60000 });
  await reopened.ready;
  const af7b = reopened.snapshot().streams.eeg.channels[1].v;
  check('persistance : la mémoire survit à un rechargement', reopened.duration('eeg') === 30 && af7b[af7b.length - 1] === af7[af7.length - 1], reopened.duration('eeg') + ' s');
  check('persistance : mouvement rechargé aussi', reopened.snapshot().streams.accel.channels[0].v.slice(-1)[0] === 40 * 52 - 1);

  /* Échantillons nommés */
  for (const e of await reopened.listSamples()) await reopened.deleteSample(e.n);
  const e1 = await reopened.createSample();
  check('échantillon : nom « échantillon-1-date »', /^échantillon-1-\d{4}-\d{2}-\d{2}_\d{2}h\d{2}$/.test(e1.name), e1.name);
  const e2 = await reopened.createSample();
  check('échantillon : numérotation croissante', e2.n === 2 && e2.name.startsWith('échantillon-2-'), e2.name);
  const got = await reopened.getSample(1);
  const v1 = got.streams.eeg.data[1];
  check('échantillon : copie identique à la mémoire', v1.length === af7.length && v1[v1.length - 1] === af7[af7.length - 1], v1.length + ' valeurs');
  for (let c = 0; c < 4; c++) reopened.muse._emit('eeg', c, new Array(12).fill(-1));
  const again = await reopened.getSample(1);
  check('échantillon : figé (la mémoire continue sans le modifier)', again.streams.eeg.data[1][again.streams.eeg.data[1].length - 1] === af7[af7.length - 1]);
  check('échantillon : export CSV', Recording.toCSV(got, 'eeg').split('\n').length === 30 * 256 + 1);
  const other = new SignalRecorder(new Muse(), { dbName: DB, saveEveryMs: 60000 });
  check('échantillon : conservé après rechargement', (await other.listSamples()).map((e) => e.n).join(',') === '2,1');
  other.stop();
  await reopened.deleteSample(1);
  const e3 = await reopened.createSample();
  check('échantillon : suppression puis numéro suivant (n = max + 1)', (await reopened.listSamples()).map((e) => e.n).join(',') === '3,2' && e3.name.startsWith('échantillon-3-'));
  for (const e of await reopened.listSamples()) await reopened.deleteSample(e.n);

  await reopened.clear();
  reopened.stop();
  const empty = new SignalRecorder(new Muse(), { dbName: DB, saveEveryMs: 60000 });
  await empty.ready;
  check('persistance : clear() vide aussi le stockage', empty.duration('eeg') === 0);
  empty.stop();
})().catch((e) => check('mémoire : exception', false, e.message)));
