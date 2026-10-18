/* Tests du bus d'événements et de l'indice de liaison de lib/muse.js (sans casque). */
(function () {
  const muse = new Muse();
  const got = [];
  const off = muse.on('eeg', (c, s) => got.push([c, s.length]));
  muse._emit('eeg', 2, [1, 2, 3]);
  check('muse : on() reçoit les événements', got.length === 1 && got[0][0] === 2 && got[0][1] === 3);
  off();
  muse._emit('eeg', 0, [1]);
  check('muse : le désabonnement fonctionne', got.length === 1);

  const link = (rate, state = 'connected') => { muse.state = state; muse.stats.rate = rate; return muse.link; };
  check('muse : plein débit = 4 barres', link(85).bars === 4, JSON.stringify(link(85)));
  check('muse : 60 % du débit = 2 barres', link(50).bars === 2, JSON.stringify(link(50)));
  check('muse : débit nul = 0 barre', link(0).bars === 0);
  check('muse : non connecté = 0 barre', link(85, 'disconnected').bars === 0);
})();

// Paquets EEG : numéro de séquence, trous comblés, alignement des canaux (faux paquets, sans Bluetooth)
(function () {
  // Paquet de 20 octets : séquence (uint16 gros-boutiste) + 12 échantillons 12 bits de valeur brute `raw`
  const packet = (seq, raw = 2048) => {
    const b = new Uint8Array(20);
    b[0] = seq >> 8; b[1] = seq & 0xff;
    for (let k = 0; k < 6; k++) { b[2 + 3 * k] = raw >> 4; b[3 + 3 * k] = ((raw & 0x0f) << 4) | (raw >> 8); b[4 + 3 * k] = raw & 0xff; }
    return new DataView(b.buffer);
  };
  const muse = new Muse(), counts = [0, 0, 0, 0], gaps = [], chunks = [];
  muse.on('eeg', (c, s) => { counts[c] += s.length; chunks.push([c, s]); });
  muse.on('gap', (c, n, d) => gaps.push([c, n, d.filled]));
  check('muse : décodage d’un faux paquet (raw 2148 = +48,8 µV)', Math.abs(Muse._decodeEEG(packet(0, 2148))[5] - 48.828125) < 1e-9);

  for (let c = 0; c < 4; c++) muse._onEegPacket(c, packet(100, 2148));
  muse._onEegPacket(0, packet(101));
  muse._onEegPacket(1, packet(101));
  muse._onEegPacket(2, packet(104)); // 3 paquets perdus sur AF8
  muse._onEegPacket(3, packet(101));
  check('muse : trou détecté (canal 2, 3 paquets)', gaps.length === 1 && gaps[0][0] === 2 && gaps[0][1] === 3 && gaps[0][2] === true, JSON.stringify(gaps));
  check('muse : paquets perdus comptés (stats.lost)', muse.stats.lost === 3 && muse.stats.packets === 8, JSON.stringify(muse.stats));
  const fill = chunks.find(([c, s]) => c === 2 && s.length === 36);
  check('muse : trou comblé par la dernière valeur (pas NaN)', fill && fill[1].every((v) => v === Muse._decodeEEG(packet(0, 2148))[0]), fill && fill[1].slice(0, 3).join(','));
  check('muse : comblement émis avant le paquet', chunks.indexOf(fill) === chunks.length - 3 && counts[2] === 12 * 5, counts.join(','));

  for (let c = 0; c < 4; c++) muse._onEegPacket(c, packet(105)); // 102..104 perdus aussi sur les autres canaux
  check('muse : 4 canaux toujours alignés (même nombre d’échantillons)', new Set(counts).size === 1 && muse.stats.lost === 12, counts.join(',') + ' perdus ' + muse.stats.lost);

  muse._onEegPacket(0, packet(65535)); // séquence « reculée » (écart > 32768) : resynchronisation, rien de compté
  muse._onEegPacket(0, packet(0));     // 65535 -> 0 : paquet suivant, pas de trou
  check('muse : séquence qui recule = resynchro ; 65535 -> 0 sans trou', muse.stats.lost === 12 && muse.stats.resyncs === 1 && gaps[gaps.length - 1][1] === 0, JSON.stringify(muse.stats));

  muse._resetSequences();              // (re)connexion : les départs communs du resync précédent sont oubliés
  for (let c = 0; c < 4; c++) muse._onEegPacket(c, packet(300));
  const n0 = counts[1];
  muse._onEegPacket(1, packet(300)); // doublon : ignoré
  check('muse : paquet en double ignoré', counts[1] === n0);

  muse._onEegPacket(1, packet(300 + 1 + 100)); // 100 paquets perdus (> ~1 s)
  check('muse : long trou non comblé, signalé', gaps[gaps.length - 1][2] === false && gaps[gaps.length - 1][1] === 100 && counts[1] === n0 + 12 && muse.stats.resyncs === 2 && muse.stats.lost === 112, JSON.stringify(gaps[gaps.length - 1]));

  muse._resetSequences();
  const g = gaps.length;
  muse._onEegPacket(3, packet(5000));
  check('muse : séquences oubliées à la reconnexion', gaps.length === g);
})();

// Vocabulaire Muse (horseshoe 1/2/4, isGood)
(function () {
  const q = new ContactQuality();
  check('contact : vocabulaire Muse (absent = 4, pas de isGood)', q.levels.every((l) => l.horseshoe === 4 && l.isGood === false), JSON.stringify(q.levels[0]));
  const good = ContactQuality._rate([{ rms: 10, sat: 0 }]), mid = ContactQuality._rate([{ rms: 70, sat: 0 }]), bad = ContactQuality._rate([{ rms: 200, sat: 0 }]);
  check('contact : bon = horseshoe 1 + isGood', good.horseshoe === 1 && good.isGood === true, JSON.stringify(good));
  check('contact : moyen = horseshoe 2, pas isGood', mid.horseshoe === 2 && mid.isGood === false, JSON.stringify(mid));
  check('contact : mauvais = horseshoe 4', bad.horseshoe === 4 && bad.isGood === false, JSON.stringify(bad));
  const weak = ContactQuality._rate([{ rms: 1.5, sat: 0 }]), flat = ContactQuality._rate([{ rms: 0.2, sat: 0 }]), low = ContactQuality._rate([{ rms: 4, sat: 0 }]);
  check('contact : signal trop faible (0,5 à 3 µV) = suspect, horseshoe 4', weak.label === 'suspect' && weak.horseshoe === 4 && weak.isGood === false && weak.score === 0, JSON.stringify(weak));
  check('contact : < 0,5 µV reste absent, 4 µV reste bon', flat.label === 'absent' && low.label === 'bon', flat.label + ' / ' + low.label);
  // Bout en bout : sinus de 2 µV d'amplitude (≈ 1,4 µV rms) pendant 2 s
  const q2 = new ContactQuality();
  q2.feed(0, Array.from({ length: 512 }, (_, i) => 2 * Math.sin((2 * Math.PI * 10 * i) / 256)));
  check('contact : signal réel très faible noté suspect', q2.levels[0].label === 'suspect', JSON.stringify(q2.levels[0]));
})();

// Trou non comblé : « resync » + départ commun, les 4 canaux restent alignés (rampe : la valeur dit l'instant)
(function () {
  const ramp = (seq) => {
    const b = new Uint8Array(20);
    b[0] = seq >> 8; b[1] = seq & 0xff;
    for (let i = 0; i < 12; i++) {
      const raw = (seq * 12 + i) % 4096, bit = 16 + i * 12, byte = bit >> 3;
      if (bit % 8 === 0) { b[byte] = raw >> 4; b[byte + 1] = (b[byte + 1] & 0x0f) | ((raw & 0x0f) << 4); }
      else { b[byte] = (b[byte] & 0xf0) | (raw >> 8); b[byte + 1] = raw & 255; }
    }
    return new DataView(b.buffer);
  };
  const muse = new Muse(), pipe = new SignalPipeline(), resyncs = [], rows = [];
  muse.on('eeg', (c, s) => pipe.feed(c, s));
  muse.on('resync', (r) => { resyncs.push(r); pipe.reset(); });
  pipe.onSamples = (raw) => rows.push(raw.map((ch) => ch.slice()));
  muse._resetSequences();
  for (let p = 1; p <= 200; p++) {                       // AF7 (1) perd les paquets 21 à 120 : 100 paquets, > ~1 s
    for (let c = 0; c < 4; c++) if (!(c === 1 && p > 20 && p <= 120)) muse._onEegPacket(c, ramp(p));
  }
  const aligned = rows.every((r) => r[0].every((v, i) => v === r[1][i] && v === r[2][i] && v === r[3][i]));
  const last = rows[rows.length - 1];
  check('muse : « resync » émis une fois, avec le départ commun', resyncs.length === 1 && resyncs[0].canal === 1 && resyncs[0].perdus === 100 && resyncs[0].depart === 122, JSON.stringify(resyncs));
  check('muse : 4 canaux alignés après un long trou (pipeline remis à zéro au resync)', aligned && rows.length > 10, 'lignes ' + rows.length);
  check('muse : le flux reprend jusqu’au dernier paquet', last && last[0][last[0].length - 1] === ((200 * 12 + 11) % 4096 - 2048) * 0.48828125);

  const m2 = new Muse(), seen = [0, 0, 0, 0];
  m2.on('eeg', (c, s) => (seen[c] += s.length));
  m2._resetSequences();
  for (let c = 0; c < 4; c++) m2._onEegPacket(c, ramp(10));
  m2._onEegPacket(2, ramp(10 + 200));                    // AF8 saute de 199 paquets, les autres sont restés à 10
  check('muse : un canal en avance au resync garde son paquet (départ = ce numéro)', seen[2] === 24 && m2._skipUntil[2] === null && m2._skipUntil[0] === 210, seen.join(',') + ' ' + JSON.stringify(m2._skipUntil));
  m2._onEegPacket(0, ramp(11));                          // antérieur au départ : écarté, aucun comblement
  check('muse : un paquet antérieur au départ commun est écarté', seen[0] === 12 && m2.stats.resyncs === 1);
  m2._onEegPacket(0, ramp(210));
  check('muse : le canal reprend au départ commun', seen[0] === 24 && m2._skipUntil[0] === null);
})();

// Pont Python : aiguillage des notifications brutes et détection du serveur (sans réseau)
window.ASYNC_TESTS = window.ASYNC_TESTS || [];
window.ASYNC_TESTS.push((async () => {
  const muse = new Muse(), eeg = [], acc = [], bat = [], ppg = [];
  muse.on('eeg', (c, s) => eeg.push([c, s.length]));
  muse.on('accel', (a) => acc.push(a));
  muse.on('telemetry', (t) => bat.push(t));
  muse.on('ppg', (c, s) => ppg.push([c, s.length]));
  const dv = (n) => new DataView(new Uint8Array(n).buffer);
  muse._route(0x0005, dv(20));  // EEG canal 2
  muse._route(0x000a, dv(20));  // accéléromètre : 3 échantillons
  muse._route(0x000b, dv(20));  // télémétrie
  muse._route(0x0010, dv(20));  // PPG canal 1
  muse._route(0x0007, dv(20));  // caractéristique inconnue : ignorée
  check('muse : _route aiguille EEG, accéléromètre, télémétrie, PPG', eeg.length === 1 && eeg[0][0] === 2 && eeg[0][1] === 12 && acc.length === 3 && bat.length === 1 && ppg.length === 1 && ppg[0][0] === 1, JSON.stringify([eeg, acc.length, bat.length, ppg]));
  const ok = await Muse.bridgeAvailable(async () => ({ ok: true, json: async () => ({ disponible: true }) }));
  const non = await Muse.bridgeAvailable(async () => ({ ok: true, json: async () => ({ disponible: false }) }));
  const err = await Muse.bridgeAvailable(async () => { throw new Error('réseau'); });
  check('muse : bridgeAvailable lit /api/pont/etat (vrai, faux, injoignable)', ok === true && non === false && err === false);
})().catch((e) => check('muse : pont, exécution sans erreur', false, e.stack || e.message)));
