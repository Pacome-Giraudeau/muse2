/* Qualité de contact de chaque électrode (globale `ContactQuality`). Indépendant de l'interface.
 *
 * Usage :
 *   const contact = new ContactQuality();
 *   muse.onEEG = (canal, echantillons) => contact.feed(canal, echantillons);
 *   contact.levels   // par canal (ordre Muse.EEG_NAMES) : { rms, score, label, horseshoe, isGood }
 *
 * Vocabulaire aligné sur celui de Muse (SDK / OSC, voir docs/sources.html, réf. 29) :
 *   horseshoe : 1 = bon, 2 = moyen, 4 = mauvais, suspect ou absent (Muse : >= 3 = mauvais)
 *   isGood    : indicateur strict, vrai seulement si 'bon' (équivalent de /muse/elements/is_good)
 *   'absent'  : aucun contact (le « fer à cheval » vide de l'appli Muse)
 *   'suspect' : signal présent mais anormalement faible (pas de vocabulaire Muse équivalent) ; horseshoe 4 et
 *               électrode NON utilisable (les appelants ne retiennent que 'bon' / 'moyen'), car un EEG de scalp
 *               fait typiquement 10 à 50 µV rms : < 3 µV évoque une électrode court-circuitée avec la référence
 *               (pont de gel, sueur, électrodes qui se touchent) ou un signal écrêté/bloqué, pas un bon contact.
 * ATTENTION : l'algorithme interne de Muse n'est pas public. Seul le VOCABULAIRE et la logique générale sont
 * alignés ; les seuils ci-dessous restent des estimations.
 *
 * Méthode : valeur efficace (rms) du signal sans dérive lente, mesurée par fenêtres d'1 s ; on garde la médiane
 * des 5 dernières secondes (un clignement isolé ne dégrade donc pas la note).
 *   rms < 0,5 µV ou pas de données  -> 'absent'    (électrode sans contact / signal plat)   ABSENT_RMS
 *   > 5 % d'échantillons saturés    -> 'mauvais'
 *   rms < 3 µV                      -> 'suspect'   (score 0)                                SUSPECT_RMS
 *   sinon score = 1 − (rms − 25) / 95, borné à [0, 1] : >= 0,66 'bon', >= 0,33 'moyen', sinon 'mauvais'.
 * Seuils heuristiques : un bon contact donne typiquement 10 à 50 µV rms. Le seuil « suspect » de 3 µV N'A PAS été
 * vérifié sur le casque réel (à confirmer : mesurer le rms d'électrodes bien posées, au repos, yeux ouverts).
 */
class ContactQuality {
  static HORSESHOE = { bon: 1, moyen: 2, suspect: 4, mauvais: 4, absent: 4 };
  static ABSENT_RMS = 0.5;  // µV rms : en dessous, signal plat
  static SUSPECT_RMS = 3;   // µV rms : en dessous, trop faible pour un EEG porté (estimation, non vérifiée sur le casque)

  constructor(rate = 256) {
    this.rate = rate;
    this._hp = Signal.onePoleCoef(0.5, rate); // suivi de la dérive lente (< 0,5 Hz), retiré avant le calcul du rms
    this.reset();
  }

  reset() {
    this._ch = Muse.EEG_NAMES.map(() => ({ base: null, sq: 0, n: 0, sat: 0, windows: [] }));
    this.levels = Muse.EEG_NAMES.map(() => ContactQuality._level(null, 0, 'absent'));
  }

  feed(channel, samples) {
    const c = this._ch[channel];
    for (const s of samples) {
      if (c.base === null) c.base = s;
      c.base += this._hp * (s - c.base);
      const x = s - c.base;
      c.sq += x * x;
      if (Math.abs(s) >= 990) c.sat++; // l'EEG 12 bits sature vers ±1000 µV
      if (++c.n >= this.rate) {
        c.windows.push({ rms: Math.sqrt(c.sq / c.n), sat: c.sat / c.n });
        if (c.windows.length > 5) c.windows.shift();
        c.sq = 0; c.n = 0; c.sat = 0;
        this.levels[channel] = ContactQuality._rate(c.windows);
      }
    }
  }

  static _level(rms, score, label) {
    return { rms, score, label, horseshoe: ContactQuality.HORSESHOE[label], isGood: label === 'bon' };
  }

  static _median(values) {
    const s = [...values].sort((a, b) => a - b);
    return s[Math.floor((s.length - 1) / 2)];
  }

  static _rate(windows) {
    const rms = ContactQuality._median(windows.map((w) => w.rms));
    const sat = ContactQuality._median(windows.map((w) => w.sat));
    if (rms < ContactQuality.ABSENT_RMS) return ContactQuality._level(rms, 0, 'absent');
    if (sat > 0.05) return ContactQuality._level(rms, 0, 'mauvais');
    if (rms < ContactQuality.SUSPECT_RMS) return ContactQuality._level(rms, 0, 'suspect');
    const score = Math.max(0, Math.min(1, 1 - (rms - 25) / 95));
    return ContactQuality._level(rms, score, score >= 0.66 ? 'bon' : score >= 0.33 ? 'moyen' : 'mauvais');
  }
}
