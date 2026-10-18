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

  const n0 = counts[1];
  muse._onEegPacket(1, packet(105)); // doublon : ignoré
  check('muse : paquet en double ignoré', counts[1] === n0);

  muse._onEegPacket(1, packet(105 + 1 + 100)); // 100 paquets perdus (> ~1 s)
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
