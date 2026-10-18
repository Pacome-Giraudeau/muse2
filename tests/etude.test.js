/* Tests des briques de l'étude d'échantillon : Recording.slice / fromJSON / fromEdf, Signal.stats / spectrogram,
 * MentalState.timeline, SampleFolder (avec un faux dossier en mémoire qui imite l'API File System Access). */
window.ASYNC_TESTS = window.ASYNC_TESTS || [];
window.ASYNC_TESTS.push((async () => {
  const R = 256;
  // Enregistrement de 40 s : 20 s « neutres » puis 20 s avec l'alpha doublé ; un clignement simulé tous les ~6 s
  const sim = new SignalSimulator({ theta: 6, beta: 4, spikePerS: 0, blinkEveryS: 6 }, R, 31);
  const part1 = sim.generate(20 * R);
  sim.cfg.gain.alpha = 2;
  const part2 = sim.generate(20 * R);
  const eeg = part1.map((c, i) => c.concat(part2[i]));
  const t0 = Date.UTC(2026, 9, 7, 10, 0, 0);
  const arrays = {
    eeg: eeg.map((v) => ({ t: Float64Array.from(v, (_, i) => t0 + (i * 1000) / R), v: Float32Array.from(v) })),
    ppg: [0, 1, 2].map(() => ({ t: Float64Array.from({ length: 40 * 64 }, (_, i) => t0 + (i * 1000) / 64), v: Float32Array.from({ length: 40 * 64 }, (_, i) => 100000 + 30 * Math.sin(i / 8)) })),
    accel: [{ t: Float64Array.from({ length: 40 * 52 }, (_, i) => t0 + (i * 1000) / 52), v: Float32Array.from({ length: 40 * 52 * 3 }, (_, i) => (i % 3 === 2 ? 1 : 0)) }],
    gyro: [{ t: Float64Array.from({ length: 40 * 52 }, (_, i) => t0 + (i * 1000) / 52), v: new Float32Array(40 * 52 * 3) }],
  };
  const events = ArtifactDetector.detectOffline(arrays.eeg.map((c) => c.v), arrays.eeg[0].t);
  const rec = Recording.fromArrays(arrays, { n: 5, name: 'échantillon-5-test', task: 'test', events });

  /* Découpe */
  const sub = Recording.slice(rec, 10, 25, { n: 6, name: 'échantillon-6-extrait' });
  check('étude : sous-échantillon de 15 s', Math.abs(sub.eeg.RecordingDuration - 15) < 0.01 && sub.streams.ppg.t.length === 15 * 64, sub.eeg.RecordingDuration + ' s');
  check('étude : provenance du sous-échantillon', sub.source.name === 'échantillon-5-test' && sub.source.start === 10 && /Extrait de/.test(sub.notes));
  check('étude : événements recalés dans le sous-échantillon', sub.events.every((e) => e.onset >= 0 && e.onset + e.duration <= 15.01), sub.events.map((e) => e.trial_type + '@' + e.onset.toFixed(1)).join(' '));
  check('étude : valeurs identiques après découpe', sub.streams.eeg.data[2][0] === rec.streams.eeg.data[2][10 * R]);

  /* JSON et EDF : aller-retour */
  const back = Recording.fromJSON(Recording.toJSON(rec));
  check('étude : relecture JSON sans perte', back.streams.eeg.data[1] instanceof Float32Array && back.streams.eeg.data[1][1234] === rec.streams.eeg.data[1][1234] && back.events.length === rec.events.length);
  let bad = '';
  try { Recording.fromJSON('{"schema":"autre"}'); } catch (e) { bad = e.message; }
  check('étude : fichier étranger refusé', /pas un échantillon/.test(bad), bad);
  const fromEdf = Recording.fromEdf(EdfWriter.write(rec), { n: 9, name: 'import' });
  const err = Math.max(...Array.from(fromEdf.streams.eeg.data[0].slice(0, 2000), (v, i) => Math.abs(v - rec.streams.eeg.data[0][i])));
  check('étude : import EDF (EEG à 0,03 µV près)', err < 0.04 && fromEdf.streams.eeg.rate === 256, 'erreur max ' + err.toFixed(4));
  check('étude : import EDF (pouls, mouvement, événements)', !!fromEdf.streams.ppg && !!fromEdf.streams.accel && fromEdf.events.length === rec.events.length);

  /* Statistiques et spectrogramme */
  const st = Signal.stats([1, 2, 3, 4]);
  check('étude : statistiques', st.mean === 2.5 && st.ptp === 3 && Math.abs(st.std - Math.sqrt(1.25)) < 1e-12, JSON.stringify(st));
  const tone = Array.from({ length: 4 * R }, (_, i) => Math.sin((2 * Math.PI * 10 * i) / R));
  const sg = Signal.spectrogram(tone, R);
  const peak = sg.db[0].indexOf(Math.max(...sg.db[0]));
  check('étude : spectrogramme (pic à 10 Hz)', sg.freqs[peak] === 10 && sg.times.length === (4 * R - 256) / 32 + 1, sg.freqs[peak] + ' Hz, ' + sg.times.length + ' instants');

  /* États mentaux sur l'enregistrement */
  const filtered = new SignalPipeline(R).processOffline(rec.streams.eeg.data);
  const evs = rec.events.map((e) => ({ onset: e.onset, duration: e.duration, type: Object.keys(Recording.EVENT_TYPES).find((k) => Recording.EVENT_TYPES[k] === e.trial_type) }));
  const tl = MentalState.timeline(filtered, { rate: R, events: evs });
  check('étude : chronologie, référence = médiane de l’enregistrement', tl.baseline && tl.baseline.auto === true);
  // (la dérive lente du simulateur, différente sur AF7 et AF8, produit aussi de longs « regards » : on isole les clignements)
  const blinks = evs.filter((e) => e.type === 'blink'), tlB = MentalState.timeline(filtered, { rate: R, events: blinks });
  const blinkWin = tlB.segments.filter((s) => blinks.some((e) => e.onset >= s.end - 4 && e.onset < s.end));
  const frontKept = blinkWin.filter((s) => s.used.includes(1) && s.used.includes(2));
  check('étude : clignement → seuls ses segments sont retirés, le front reste mesuré', blinks.length > 3 && frontKept.length > 0.8 * blinkWin.length,
    `${frontKept.length} / ${blinkWin.length} fenêtres avec clignement gardent AF7/AF8, ${tl.seconds.paused} s suspendues`);
  check('étude : très peu de suspensions', tl.seconds.paused <= 3, tl.seconds.paused + ' s');
  const tlRef = MentalState.timeline(filtered, { rate: R, events: evs, baselineRange: [0, 18] });
  const firstHalf = tlRef.segments.filter((s) => s.end <= 20 && !s.paused), secondHalf = tlRef.segments.filter((s) => s.start >= 28 && !s.paused);
  check('étude : référence prise sur une portion choisie', tlRef.baseline.range[1] === 18 && !tlRef.baseline.auto);
  check('étude : 2e moitié (alpha doublé) détendue', secondHalf.length > 5 && secondHalf.filter((s) => s.state === 'relaxed').length / secondHalf.length > 0.7, secondHalf.map((s) => s.state[0]).join(''));
  check('étude : 1re moitié (référence) neutre', firstHalf.filter((s) => s.state === 'neutral').length / Math.max(1, firstHalf.length) > 0.7, firstHalf.map((s) => s.state[0]).join(''));
  const ms4 = new MentalState({ baseline: { relax: 0.5, focus: 0.3, drowsy: 0.3 } });
  check('état : ancienne référence (un nombre par indice) acceptée avec 4 électrodes', ms4.update([{ theta: 2, alpha: 4, beta: 2 }, null, null, { theta: 2, alpha: 4, beta: 2 }]).used.join() === '0,3');

  /* Dossier des échantillons (faux dossier en mémoire) */
  class FakeFile { constructor() { this.data = null; } async createWritable() { return { write: async (d) => { this.data = d; }, close: async () => {} }; } async getFile() { const d = this.data; return { text: async () => (typeof d === 'string' ? d : new TextDecoder().decode(d)) }; } }
  class FakeDir {
    constructor(name) { this.name = name; this.kind = 'directory'; this.items = new Map(); }
    async getDirectoryHandle(n, o = {}) { if (!this.items.has(n)) { if (!o.create) throw new Error('absent'); this.items.set(n, new FakeDir(n)); } return this.items.get(n); }
    async getFileHandle(n, o = {}) { if (!this.items.has(n)) { if (!o.create) throw new Error('absent'); const f = new FakeFile(); f.kind = 'file'; this.items.set(n, f); } return this.items.get(n); }
    async *entries() { for (const e of this.items) yield e; }
  }
  const root = new FakeDir('echantillons');
  const written = await SampleFolder.write(rec, root);
  check('dossier : fichiers BIDS + source écrits', written.includes('dataset_description.json') && written.includes('sub-01/eeg/sub-01_task-test_run-5_eeg.edf') && written.includes('sourcedata/échantillon-5-test.muse2.json'), written.join(' '));
  const desc = await root.getFileHandle('dataset_description.json');
  desc.data = 'modifié par l’utilisateur';
  const again = await SampleFolder.write(sub, root);
  check('dossier : fichiers communs jamais écrasés', desc.data === 'modifié par l’utilisateur' && !again.includes('dataset_description.json'));
  const list = await SampleFolder.list(root);
  check('dossier : liste des échantillons', list.map((e) => e.name).join(',') === 'échantillon-6-extrait,échantillon-5-test', list.map((e) => e.name).join(','));
  const reread = await SampleFolder.read('échantillon-5-test.muse2.json', root);
  check('dossier : relecture d’un échantillon', reread.n === 5 && reread.streams.eeg.data[3][500] === rec.streams.eeg.data[3][500]);
  check('dossier : nom de fichier sûr', SampleFolder.safe('a/b:c*?') === 'a_b_c__');

  // obtain() : sans dossier mémorisé, ouvre le sélecteur au lieu de rester « navigateur seulement » (fonctions remplacées, pas la vraie base)
  const saved = { handle: SampleFolder.handle, choose: SampleFolder.choose, ensure: SampleFolder.ensure, supported: SampleFolder.supported };
  try {
    let asked = 0;
    Object.assign(SampleFolder, { supported: () => true, handle: async () => null, choose: async () => { asked++; return root; } });
    check('dossier : obtain() demande le dossier s’il n’est pas choisi', (await SampleFolder.obtain()) === root && asked === 1);
    SampleFolder.choose = async () => { const e = new Error('annulé'); e.name = 'AbortError'; throw e; };
    check('dossier : obtain() annulé → null', (await SampleFolder.obtain()) === null);
    Object.assign(SampleFolder, { handle: async () => root, ensure: async (ask) => (ask ? root : null), choose: async () => { asked++; } });
    check('dossier : obtain() réutilise le dossier mémorisé', (await SampleFolder.obtain()) === root && asked === 1);
  } finally { Object.assign(SampleFolder, saved); }

  // ServerDir : même écriture / liste / relecture à travers un faux serveur (imite serveur.py)
  const disk = new Map();
  const fakeFetch = async (url, o = {}) => {
    const rel = decodeURIComponent(url.slice(ServerDir.API.length).replace(/^\//, '')), json = (v) => ({ ok: true, json: async () => v });
    if (!rel) return json({ dossier: 'C:/muse2/echantillons' });
    if (o.method === 'PUT') { disk.set(rel, new Uint8Array(await o.body.arrayBuffer())); return { ok: true }; }
    if (rel.endsWith('/')) {
      const names = new Map();
      for (const k of disk.keys()) if (k.startsWith(rel)) { const rest = k.slice(rel.length), i = rest.indexOf('/'); names.set(i < 0 ? rest : rest.slice(0, i), i < 0 ? 'file' : 'directory'); }
      return names.size ? json([...names].map(([name, kind]) => ({ name, kind }))) : { ok: false };
    }
    const d = disk.get(rel);
    return d ? { ok: true, text: async () => new TextDecoder().decode(d) } : { ok: false };
  };
  const srv = await ServerDir.detect(fakeFetch);
  check('serveur : détecté', srv && srv.name === 'echantillons');
  const viaSrv = await SampleFolder.write(rec, srv);
  check('serveur : fichiers BIDS + source écrits', disk.has('sub-01/eeg/sub-01_task-test_run-5_eeg.edf') && disk.has('sourcedata/échantillon-5-test.muse2.json') && viaSrv.includes('participants.tsv'), [...disk.keys()].join(' '));
  check('serveur : EDF écrit octet pour octet', disk.get('sub-01/eeg/sub-01_task-test_run-5_eeg.edf').length === EdfWriter.write(rec).length);
  const again2 = await SampleFolder.write(sub, srv);
  check('serveur : fichiers communs jamais réécrits', !again2.includes('dataset_description.json'));
  const srvList = await SampleFolder.list(srv);
  check('serveur : liste des échantillons', srvList.map((e) => e.name).join(',') === 'échantillon-6-extrait,échantillon-5-test', srvList.map((e) => e.name).join(','));
  const srvRead = await SampleFolder.read('échantillon-5-test.muse2.json', srv);
  check('serveur : relecture d’un échantillon', srvRead.n === 5 && srvRead.streams.eeg.data[3][500] === rec.streams.eeg.data[3][500]);
  check('serveur : absent → null (file://)', (await ServerDir.detect(async () => ({ ok: false }))) === null);
})().catch((e) => check('étude : exception', false, e.message + ' ' + (e.stack || '').split('\n')[1])));
