/* Tests des formats : lib/recording.js (modèle BIDS), lib/edf.js (EDF+), lib/zip.js, lib/bids.js,
 * SignalPipeline.processOffline / describe, ArtifactDetector.detectOffline. */
window.ASYNC_TESTS = window.ASYNC_TESTS || [];
window.ASYNC_TESTS.push((async () => {
  // 12 s de signal de démonstration (avec clignements), enregistrés comme par le casque
  const muse = new Muse(), rec = new SignalRecorder(muse, { dbName: 'muse2-test-formats', saveEveryMs: 60000 });
  await rec.ready;
  await rec.clear();
  const sim = new SignalSimulator({ spikePerS: 0, blinkEveryS: 3 }, 256, 21).generate(12 * 256);
  for (let i = 0; i < sim[0].length; i += 12) for (let c = 0; c < 4; c++) muse._emit('eeg', c, sim[c].slice(i, i + 12));
  for (let i = 0; i < 12 * 64; i += 6) for (let c = 0; c < 3; c++) muse._emit('ppg', c, [1, 2, 3, 4, 5, 6].map((k) => 100000 + 50 * Math.sin((i + k) / 10) + c));
  for (let i = 0; i < 12 * 52; i++) { muse._emit('accel', { x: 0.01 * i % 1, y: 0, z: 1 }); muse._emit('gyro', { x: 1, y: -2, z: 3 }); }
  const arrays = rec.freeze();
  rec.stop();
  await rec.clear();

  /* Détection hors temps réel */
  const events = ArtifactDetector.detectOffline(arrays.eeg.map((c) => c.v), arrays.eeg[0].t);
  const blinks = events.filter((e) => e.type === 'blink');
  check('formats : détection hors temps réel (clignements trouvés)', blinks.length >= 2, `${blinks.length} clignements, ${events.length} événements`);

  /* Filtres hors temps réel */
  const pipe = new SignalPipeline();
  const eegData = arrays.eeg.map((c) => c.v);
  const off = pipe.processOffline(eegData), live = pipe.clone();
  const streamed = Array.from(eegData[1]).map((_, i) => live.processFrame([eegData[0][i], eegData[1][i], eegData[2][i], eegData[3][i]])[1]);
  check('formats : processOffline = traitement en continu (sans clignements)', off[1].every((v, i) => Math.abs(v - streamed[i]) < 1e-6));
  pipe.setEnabled('eog', true);
  const withEog = pipe.processOffline(eegData);
  check('formats : retard des clignements compensé (même longueur)', withEog[1].length === eegData[1].length);
  const desc = pipe.describe();
  check('formats : description BIDS des filtres', typeof desc === 'object' && desc['Passe-haut Butterworth ordre 2']['coupure (Hz)'] === 1, Object.keys(desc).join(' | '));
  check('formats : champ EDF de préfiltrage', pipe.prefilterString().startsWith('HP:1Hz LP:40Hz N:50Hz'), pipe.prefilterString());

  /* Modèle d'enregistrement */
  const r = Recording.fromArrays(arrays, { n: 7, name: 'échantillon-7-test', task: 'repos yeux fermés', notes: 'essai', events, crop: { start: 1, end: 11 } });
  check('enregistrement : schéma et version', r.schema === 'muse2lab/recording' && r.version === 2);
  check('enregistrement : recadrage 1 → 11 s', Math.abs(r.eeg.RecordingDuration - 10) < 0.01, r.eeg.RecordingDuration + ' s');
  const req = ['TaskName', 'EEGReference', 'SamplingFrequency', 'PowerLineFrequency', 'SoftwareFilters'];
  check('enregistrement : champs BIDS obligatoires présents', req.every((k) => r.eeg[k] !== undefined), req.map((k) => `${k}=${JSON.stringify(r.eeg[k])}`).join(' '));
  check('enregistrement : 4 EEG + 3 PPG + 6 MISC', r.channels.length === 13 && r.channels.filter((c) => c.type === 'EEG').length === 4 && r.channels.filter((c) => c.type === 'MISC').length === 6);
  check('enregistrement : unités BIDS (uV)', r.channels[0].units === 'uV');
  check('enregistrement : événements recadrés (onset ≥ 0)', r.events.every((e) => e.onset >= 0 && e.onset <= 10) && r.events.some((e) => e.trial_type === 'clignement'), r.events.map((e) => e.trial_type + '@' + e.onset.toFixed(2)).join(' '));
  const tsv = Recording.channelsTsv(r).split('\n');
  check('enregistrement : channels.tsv (name, type, units en tête)', tsv[0].startsWith('name\ttype\tunits') && tsv[1].startsWith('TP9\tEEG\tuV'), tsv[1]);
  check('enregistrement : events.tsv (onset, duration)', Recording.eventsTsv(r).startsWith('onset\tduration\ttrial_type'));
  const rf = Recording.fromArrays(arrays, { n: 8, pipeline: pipe, include: { ppg: false, motion: false } });
  check('enregistrement : version filtrée documentée', rf.processing.stored === 'filtré' && rf.eeg.SoftwareFilters !== 'n/a' && rf.channels[0].low_cutoff === 1 && rf.channels.length === 4);
  check('enregistrement : référence Fpz (brut ou filtré sans CAR)', r.eeg.EEGReference === 'Fpz' && rf.eeg.EEGReference === 'Fpz', `${r.eeg.EEGReference} / ${rf.eeg.EEGReference}`);
  const pipeCar = pipe.clone();
  pipeCar.setEnabled('car', true);
  const rc = Recording.fromArrays(arrays, { n: 9, pipeline: pipeCar, include: { ppg: false, motion: false } });
  check('enregistrement : référence moyenne (BIDS « average ») si CAR active', rc.eeg.EEGReference === 'average' && Recording.eegReference(false) === 'Fpz', rc.eeg.EEGReference);
  const legacy = Recording.fromLegacy({ n: 2, name: 'échantillon-2-ancien', createdAt: Date.now(), streams: arrays });
  check('enregistrement : conversion de l’ancien format', legacy.schema === 'muse2lab/recording' && legacy.streams.eeg.data.length === 4);

  /* EDF+ : écriture puis relecture */
  const bytes = EdfWriter.write(r), edf = EdfWriter.read(bytes);
  check('EDF : en-tête EDF+C, version 0', edf.header.reserved === 'EDF+C' && edf.header.version === '0', edf.header.reserved);
  check('EDF : 10 enregistrements de 1 s', edf.header.records === 10 && edf.header.recordDuration === 1);
  check('EDF : 13 signaux + annotations', edf.header.ns === 14 && edf.signals[13].label === 'EDF Annotations');
  check('EDF : taille cohérente', bytes.length === edf.header.headerBytes + edf.header.records * edf.signals.reduce((a, s) => a + 2 * s.perRecord, 0));
  check('EDF : fréquences propres (256 / 64 / 52)', edf.signals[0].perRecord === 256 && edf.signals[4].perRecord === 64 && edf.signals[7].perRecord === 52);
  const orig = r.streams.eeg.data[1], back = edf.signals[1].values;
  const maxErr = Math.max(...back.map((v, i) => Math.abs(v - orig[i])));
  check('EDF : valeurs EEG relues à la résolution 16 bits près', maxErr < 0.04, `erreur max ${maxErr.toFixed(4)} µV`);
  check('EDF : horodatage de chaque enregistrement', edf.annotations.filter((a) => a.timekeeping).length === 10);
  const edfEvents = edf.annotations.filter((a) => a.text);
  check('EDF : événements en annotations', edfEvents.length === r.events.filter((e) => e.onset < 10).length && edfEvents.some((a) => a.text === 'clignement'), edfEvents.map((a) => a.text).join(' '));
  check('EDF : en-tête en ASCII (accents retirés)', edf.header.recording.includes('echantillon-7-test'), edf.header.recording);

  /* ZIP */
  check('ZIP : CRC-32 de référence (« 123456789 » = CBF43926)', ZipWriter.crc32(new TextEncoder().encode('123456789')).toString(16) === 'cbf43926');
  const z = ZipWriter.create([{ path: 'a.txt', data: 'bonjour' }, { path: 'dossier/é.txt', data: new Uint8Array([1, 2, 3]) }]);
  const zv = new DataView(z.buffer);
  check('ZIP : signatures locale et finale', zv.getUint32(0, true) === 0x04034b50 && zv.getUint32(z.length - 22, true) === 0x06054b50 && zv.getUint16(z.length - 12, true) === 2);

  /* BIDS */
  const files = Bids.files(r);
  const paths = files.map((f) => f.path);
  const base = 'sub-01/eeg/sub-01_task-reposyeuxfermes_run-7';
  check('BIDS : arborescence et noms de fichiers', ['dataset_description.json', 'README', 'participants.tsv', base + '_eeg.edf', base + '_eeg.json', base + '_channels.tsv', base + '_events.tsv'].every((p) => paths.includes(p)), paths.join(' '));
  const dd = JSON.parse(files.find((f) => f.path === 'dataset_description.json').data);
  check('BIDS : dataset_description (Name, BIDSVersion)', dd.Name && dd.BIDSVersion === Bids.VERSION);
  const zipBytes = Bids.zip(r);
  check('BIDS : archive .zip produite', zipBytes.length > bytes.length && new DataView(zipBytes.buffer).getUint32(0, true) === 0x04034b50, (zipBytes.length / 1024).toFixed(0) + ' Ko');
})().catch((e) => check('formats : exception', false, e.message + ' ' + (e.stack || '').split('\n')[1])));
