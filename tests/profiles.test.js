/* Tests de lib/profiles.js : profils, réglages isolés par profil, migration, export / import, échantillons par profil.
 * S'exécute APRÈS les autres tests asynchrones (il change le profil actif) et restaure ensuite le préfixe de test. */
window.ASYNC_TESTS = window.ASYNC_TESTS || [];
(function () {
  const before = [...window.ASYNC_TESTS];
  window.ASYNC_TESTS.push((async () => {
    await Promise.all(before);
    const P = 'muse2testprofiles', wipe = () => { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k.startsWith(P + '.')) localStorage.removeItem(k); } };
    wipe();
    try {
      /* Premier lancement et reprise des anciens réglages */
      localStorage.setItem(P + '.calibration', JSON.stringify({ date: '2026-10-01T10:00:00Z', thresholds: { blink: 33 } }));
      localStorage.setItem(P + '.live.enhance', '1');
      const first = Profiles.init({ prefix: P });
      check('profils : « Profil 1 » créé au premier lancement', first.name === 'Profil 1' && Profiles.list().length === 1);
      check('profils : anciens réglages repris dans le premier profil', Profiles.get('calibration').thresholds.blink === 33 && Profiles.get('liveEnhance') === true && localStorage.getItem(P + '.calibration') === null);

      /* Réglages isolés par profil */
      let changes = 0;
      const off = Profiles.onChange(() => changes++);
      const p2 = Profiles.create('  Roberto   Dupont ');
      check('profils : nom nettoyé', Profiles.list().find((p) => p.id === p2).name === 'Roberto Dupont');
      Profiles.switchTo(p2);
      check('profils : changement de profil signalé', changes === 1 && Profiles.activeId() === p2);
      check('profils : un nouveau profil part de zéro', Calibrator.load() === null && SignalPipeline.loadSaved().summary() === 'Dérive 1 Hz · Secteur 50 Hz · Passe-bas 40 Hz');
      const pipe = new SignalPipeline(); pipe.setEnabled('eog', true); pipe.save();
      Profiles.set('mentalBaseline', { relax: [0.5], focus: [0.3], drowsy: [0.2], date: '2026-10-07' });
      Profiles.switchTo('p1');
      check('profils : réglages du profil 1 intacts', Calibrator.load().thresholds.blink === 33 && !SignalPipeline.loadSaved().isEnabled('eog') && Profiles.get('mentalBaseline') === null);
      Profiles.switchTo(p2);
      check('profils : réglages du profil 2 retrouvés', SignalPipeline.loadSaved().isEnabled('eog') && Profiles.get('mentalBaseline').date === '2026-10-07');
      check('profils : étiquette de sujet BIDS', Profiles.label() === 'robertodupont', Profiles.label());

      /* Persistance : relecture comme à la session suivante */
      Profiles._state = null;
      Profiles.init({ prefix: P });
      check('profils : persistants (profil actif et liste relus)', Profiles.activeId() === p2 && Profiles.list().length === 2);

      /* Export / import */
      const exp = Profiles.exportProfile();
      const p3 = Profiles.importProfile(exp);
      check('profils : export puis import (copie des réglages)', Profiles.list().find((p) => p.id === p3).name === 'Roberto Dupont (importé)' && Profiles.get('pipeline', null, p3).enabled.eog === true);
      let err = '';
      try { Profiles.importProfile({ schema: 'autre' }); } catch (e) { err = e.message; }
      check('profils : fichier étranger refusé', /pas un profil/.test(err));

      /* Échantillons par profil */
      const muse = new Muse(), rec = new SignalRecorder(muse, { dbName: 'muse2-test-profiles', saveEveryMs: 60000 });
      await rec.ready;
      for (const s of await rec.listSamples({ all: true })) await rec.deleteSample(s.n);
      for (let p = 0; p < 300; p++) for (let c = 0; c < 4; c++) muse._emit('eeg', c, new Array(12).fill(c));
      const mine = await rec.createSample();
      check('profils : échantillon rattaché au profil actif', mine.profile === p2 && mine.subject === 'robertodupont');
      const full = await rec.getSample(mine.n);
      check('profils : sujet BIDS = profil', Bids.files(full).some((f) => f.path.startsWith('sub-robertodupont/eeg/')) && Bids.files(full).find((f) => f.path === 'participants.tsv').data.includes('sub-robertodupont'));
      Profiles.switchTo('p1');
      check('profils : chaque profil ne voit que ses échantillons', (await rec.listSamples()).length === 0 && (await rec.listSamples({ all: true })).length === 1);
      await rec.reassignSamples(p2, 'p1');
      check('profils : échantillons rattachés à un autre profil', (await rec.listSamples()).length === 1 && (await rec.getSample(mine.n)).subject === 'profil1');

      /* Suppression */
      Profiles.remove(p2);
      check('profils : suppression efface les réglages', Profiles.get('pipeline', null, p2) === null && !Profiles.list().some((p) => p.id === p2));
      Profiles.remove(p3);
      err = '';
      try { Profiles.remove('p1'); } catch (e) { err = e.message; }
      check('profils : le dernier profil ne peut pas être supprimé', /dernier/.test(err));
      off();
      for (const s of await rec.listSamples({ all: true })) await rec.deleteSample(s.n);
      rec.stop();
    } finally {
      wipe();
      Profiles._state = null;
      Profiles.init({ prefix: 'muse2test' });
    }
  })().catch((e) => check('profils : exception', false, e.message + ' ' + (e.stack || '').split('\n')[1])));
})();
