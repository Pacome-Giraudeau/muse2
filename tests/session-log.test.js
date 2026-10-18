/* Tests du journal de séance (lib/session-log.js) : une ligne par seconde, bandes absolues, envoi par paquets, reconnexion. */
window.ASYNC_TESTS = window.ASYNC_TESTS || [];
window.ASYNC_TESTS.push((async () => {
  const muse = new Muse(), sent = [];
  const log = new SessionLog(muse, { send: async (name, text) => { sent.push([name, text]); }, timer: false }); // tick() appelé à la main
  check('journal : pas de séance avant la connexion', log.name === null && log.csv() === '');

  muse.state = 'connecting';
  muse._setState('connected');
  check('journal : séance ouverte à la connexion', /^seance-\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.csv$/.test(log.name), String(log.name));

  // 10 Hz (alpha) d'amplitude 20 µV sur les 4 canaux, 3 s, avec une seconde de plus pour 10 lignes
  const sine = (i0, n) => Array.from({ length: n }, (_, i) => 20 * Math.sin((2 * Math.PI * 10 * (i0 + i)) / 256));
  let t = 1000;
  for (let sec = 0; sec < 12; sec++) {
    for (let k = 0; k < 256; k += 16) for (let c = 0; c < 4; c++) muse._emit('eeg', c, sine(sec * 256 + k, 16));
    log.tick((t += 1000));
  }
  const rows = log.csv().trim().split('\n');
  const head = rows[0].split(',');
  check('journal : en-tête = temps, perdus, note, 4 électrodes × 5 bandes', head.length === 23 && head[3] === 'TP9_delta' && head[7] === 'TP9_gamma' && head[22] === 'TP10_gamma' && head.includes('AF7_beta'), head.join(','));
  check('journal : une ligne par seconde (dès 1 s de signal)', rows.length - 1 === 12, 'lignes ' + (rows.length - 1));
  const cols = rows[rows.length - 1].split(',');
  const band = (name) => +cols[head.indexOf(name)];
  check('journal : 10 Hz → l’alpha domine la puissance absolue (µV²)', band('AF7_alpha') > 20 * band('AF7_theta') && band('AF7_alpha') > 20 * band('AF7_beta') && band('AF7_alpha') > 10, `alpha ${band('AF7_alpha')} thêta ${band('AF7_theta')} bêta ${band('AF7_beta')}`);
  check('journal : valeurs finies, perdus = 0', cols.length === 23 && cols.slice(3).every((v) => isFinite(+v)) && cols[1] === '0');

  await new Promise((r) => setTimeout(r, 20));
  check('journal : envoyé par paquets de ≥ 10 lignes, en-tête au 1er envoi', sent.length >= 1 && sent[0][0] === log.name && sent[0][1].startsWith('temps,perdus,note,') && log.sent >= 10, JSON.stringify([sent.length, log.sent]));

  // trou non comblé + reconnexion : notes sur la ligne suivante
  muse._emit('gap', 1, 30, { filled: false });
  muse._setState('reconnecting');
  muse._setState('connected');
  for (let k = 0; k < 256; k += 16) for (let c = 0; c < 4; c++) muse._emit('eeg', c, sine(k, 16));
  log.tick((t += 1000));
  const last = log.csv().trim().split('\n').pop().split(',');
  check('journal : notes « resync » et « reconnexion » sur la ligne', last[2].includes('resync') && last[2].includes('reconnexion'), last[2]);
  check('journal : la reconnexion garde le même fichier', log.name === sent[0][0]);

  const total = log.lines;
  log.tick((t += 1000));   // aucun signal nouveau : pas de ligne inventée
  check('journal : pas de ligne sans signal nouveau', log.lines === total);

  muse._setState('disconnected');
  await new Promise((r) => setTimeout(r, 20));
  check('journal : fermeture à la déconnexion, tout envoyé', log.name === null && log.sent === total, `${log.sent}/${total}`);

  // sans serveur : tout reste en mémoire et se télécharge
  const m2 = new Muse(), mem = new SessionLog(m2, { timer: false });
  m2._setState('connected');
  for (let k = 0; k < 256; k += 16) for (let c = 0; c < 4; c++) m2._emit('eeg', c, sine(k, 16));
  mem.tick(5000);
  check('journal : sans serveur, en mémoire', mem.where === 'mémoire' && mem.lines === 1 && mem.csv().split('\n').length === 3);

  // échec d'envoi : rien de perdu, nouvel essai
  let fail = true; const got = [];
  const m3 = new Muse(), flaky = new SessionLog(m3, { send: async (n, tx) => { if (fail) throw new Error('x'); got.push(tx); }, timer: false });
  m3._setState('connected');
  for (let sec = 0; sec < 11; sec++) { for (let k = 0; k < 256; k += 16) for (let c = 0; c < 4; c++) m3._emit('eeg', c, sine(sec * 256 + k, 16)); flaky.tick(1000 * (sec + 1)); }
  await new Promise((r) => setTimeout(r, 20));
  check('journal : échec d’envoi → lignes gardées, lieu « mémoire »', flaky.sent === 0 && flaky.where === 'mémoire' && flaky._unsent.length === 11);
  fail = false;
  for (let k = 0; k < 256; k += 16) for (let c = 0; c < 4; c++) m3._emit('eeg', c, sine(k, 16));
  flaky.tick(20000);
  await new Promise((r) => setTimeout(r, 20));
  check('journal : renvoi réussi, 12 lignes d’un coup, lieu « serveur »', flaky.sent === 12 && flaky.where === 'serveur' && got.length === 1 && got[0].startsWith('temps,'), JSON.stringify([flaky.sent, flaky.where, got.length]));

  const probe = [];
  await SessionLog.serverSink(async (u, o) => { probe.push([u, o.method, o.body]); return { ok: true }; })('seance a.csv', 'x\n');
  check('journal : sink serveur = POST api/seances/<nom>', probe[0][0] === 'api/seances/seance%20a.csv' && probe[0][1] === 'POST' && probe[0][2] === 'x\n');
})().catch((e) => check('journal : exécution sans erreur', false, e.stack || e.message)));
