/* Rapport critique du 8 octobre 2026 (deuxième revue) : relecture de l'ensemble de l'application après les corrections
 * du premier rapport (dev/rapports/2026-10-07.js). Listé dans CATALOGUE.rapports, ouvert depuis Développement › Rapports
 * critiques. Revue faite par lecture du code (app/, lib/, ui/, projets/, serveur.py, tests/), sans casque réel, avec une
 * mesure faite en direct par le vrai code de lib/muse.js et lib/filters.js (décalage des canaux après un trou de paquets).
 * Tout est enveloppé dans une fonction : chaque rapport peut reprendre les mêmes noms sans collision.
 * Pour suivre la prise en compte plus tard : ajouter `statut` + `solution` aux constats et un RAPPORT_SUIVI (modèle : 2026-10-07.js). */
(function () {
// gravite : 'haute' | 'moyenne' | 'faible' ; axe : 'archi' | 'science' | 'tech'
const RAPPORT_CONSTATS = [
  { id: 'T4', axe: 'tech', gravite: 'haute', titre: 'Les trous de paquets sont signalés, mais personne ne les écoute',
    ou: 'lib/muse.js (_onEegPacket), lib/filters.js (feed), lib/artifacts.js (_flush), ui/status-bar.js',
    constat: 'Le correctif de T1 comble les trous de 1 à 22 paquets, mais au-delà (ou si la séquence recule) il émet « gap » avec filled = false et NE comble PAS. Aucun abonné n’écoute « gap » (ni SignalPipeline, ni ArtifactDetector, ni ContactQuality, ni les projets), et muse.stats.lost / resyncs ne sont affichés nulle part. Le canal concerné reste donc décalé (en avance) sur les trois autres de toute la durée perdue, pour de bon : les files d’alignement n’en sont vidées que si elles dépassent 512 échantillons.',
    effet: 'Après un trou de plus de ~1 s sur un seul canal, CAR, piste clignements, différence AF7 − AF8 du regard et moyenne frontale du détecteur combinent des instants différents, sans aucun message, jusqu’à la prochaine reconnexion. La mesure ci-dessous chiffre le décalage. Le correctif de T1 est donc sûr pour les petites pertes seulement.',
    remede: 'Sur « gap » non comblé (ou à chaque « resync »), vider les files des abonnés et remettre à zéro pipeline, détecteur, contact, EventLog (un seul point : un événement « resync » émis par Muse, écouté par le shell qui prévient les briques actives). Afficher stats.lost dans la barre d’état.' },
  { id: 'S10', axe: 'science', gravite: 'haute', titre: 'Le seuil d’état mental repose sur ~8 observations indépendantes et n’a jamais été confronté à du réel',
    ou: 'lib/mental-state.js (_spread, thresholds), tests/mental.test.js, echantillons/',
    constat: 'Le seuil = 2 × écart-type robuste tiré de la référence de 30 s. Or les fenêtres de 4 s avancent de 1 s (75 % de recouvrement) : 30 scores corrélés valent environ 8 à 10 mesures indépendantes, et une MAD sur si peu de points est très incertaine. La dérive lente au repos (vigilance, contact, sueur) n’est pas dans 30 s, donc pas dans le seuil. Le plancher 0,1 et le plafond 0,5 sont des choix, non des mesures. Le 1,6 Mo d’enregistrements réels de echantillons/ n’a jamais servi à mesurer le taux de changements d’état au repos (T2 du premier rapport, toujours non traité).',
    effet: 'On ne sait pas combien de fois par heure l’indicateur change d’état sans raison chez une personne immobile. En outre « Détendu » (alpha en hausse) se déclenche aussi par simple fermeture des yeux si la référence a été prise yeux ouverts : il mesure l’état des yeux autant que la détente.',
    remede: 'Mesurer, sur les enregistrements réels de repos, le nombre de changements d’état par heure et la part du temps en « neutre », et en faire un test de non-régression. Allonger la référence (2 min) ou la prendre en deux temps pour inclure une dérive. Dire dans l’interface que « Détendu » dépend de l’état des yeux.' },
  { id: 'S9', axe: 'science', gravite: 'moyenne', titre: 'Les échantillons « bruts » contiennent des valeurs inventées, sans trace',
    ou: 'lib/muse.js (comblement), lib/recorder.js (_subscribe), lib/recording.js (events)',
    constat: 'Pour combler un trou, Muse émet 12 × n échantillons répétant la dernière valeur, par le même événement « eeg » que les vraies données. Le Recorder les range comme du signal reçu ; rien n’est écrit dans les événements BIDS ni dans l’EDF.',
    effet: 'Un échantillon censé être le signal « tel que reçu » contient des plateaux plats de 47 ms à 1 s, qu’un logiciel tiers (MNE, EEGLAB) analysera comme de l’EEG : chute locale de puissance et de variance, bords brusques.',
    remede: 'Écouter « gap » dans le Recorder et ajouter un événement (trial_type = gap, début, durée) à l’enregistrement, exporté en BIDS events.tsv et en annotation EDF+. À défaut, marquer les segments comblés pour que MentalState.measure les écarte.' },
  { id: 'T5', axe: 'tech', gravite: 'moyenne', titre: 'Le serveur local se laisse écrire par une page web tierce (DNS rebinding)',
    ou: 'serveur.py (do_PUT, do_GET)',
    constat: 'La protection tient à « Origin == http://<Host> ». Un site hostile dont le nom DNS est reconduit vers 127.0.0.1 envoie lui-même un Host et un Origin identiques, donc passe. Un PUT sans en-tête Origin (script, curl) passe aussi. Le Host n’est jamais comparé à localhost / 127.0.0.1, et la taille du corps n’est pas plafonnée (Content-Length lu tel quel). Le serveur sert en outre tout le dépôt, pas seulement echantillons/.',
    effet: 'Tant que python serveur.py tourne, une page ouverte dans le navigateur peut écrire des fichiers de taille quelconque dans echantillons/ et lire les enregistrements. Écoute limitée à 127.0.0.1, usage domestique : risque faible mais réel.',
    remede: 'Refuser toute requête dont le Host n’est pas localhost:<port> ou 127.0.0.1:<port> ; exiger l’en-tête Origin sur PUT ; plafonner Content-Length (par ex. 64 Mo) ; n’accepter que les extensions de BIDS (.json, .tsv, .edf, .md…).' },
  { id: 'T7', axe: 'tech', gravite: 'moyenne', titre: 'État mental compte le temps en « ticks » d’une seconde, pas en secondes',
    ou: 'projets/03-etat/etat.js (setInterval(tick, 1000), state.update(…, 1), measuring.list.length >= 30)',
    constat: 'Le lissage (5 s), le maintien d’un état (3 s) et la référence (30 « secondes ») supposent un tick par seconde exactement. Un setInterval n’est pas garanti : un onglet masqué est ralenti par le navigateur (et fortement après quelques minutes), un onglet chargé retarde ses ticks. dt vaut toujours 1.',
    effet: 'Onglet en arrière-plan : les durées affichées et décidées deviennent fausses (référence « de 30 s » étalée sur plusieurs minutes, état maintenu 3 ticks au lieu de 3 s). Non testé sur le casque ni en arrière-plan réel.',
    remede: 'Calculer dt à partir de l’horloge des échantillons (déjà tenue : `received`), ou de performance.now(), et faire avancer le suivi d’après elle ; compter la référence en secondes de signal.' },
  { id: 'A5', axe: 'archi', gravite: 'moyenne', titre: 'Le câblage « signal → état » existe en deux exemplaires',
    ou: 'projets/03-etat/etat.js (setSource, measureNow, tick) et lib/calibration-context.js',
    constat: 'CalibrationContext réunit déjà pipeline sans « eog », détecteur du profil, contact, EventLog, tampons, horloge des échantillons, canaux utilisables et measureState(). État mental refait la même chose à la main (feed, tampons, received, measureNow, canaux « good »). La règle a été unifiée (A1) mais pas son branchement.',
    effet: 'Toute évolution (T4, T7, un nouveau témoin) doit être faite deux fois, et les deux copies peuvent diverger comme avant A1. La copie d’etat.js n’est couverte par aucun test.',
    remede: 'Faire de CalibrationContext la source unique (renommer en « contexte de mesure » si besoin) et réduire etat.js à l’affichage ; passer aussi le projet Étude d’échantillon par là.' },
  { id: 'A6', axe: 'archi', gravite: 'moyenne', titre: 'La colle des projets et ui/ ne sont pas testés',
    ou: 'tests/, tools/check.py, projets/*, ui/*',
    constat: 'Les 325 tests portent sur lib/. check.py charge chaque page et cherche des erreurs de console : il prouve que la page démarre, pas qu’elle calcule juste. Les défauts les plus coûteux de ces deux rapports (horloge d’etat.js, câblage, gap ignoré) se logent dans cette colle.',
    effet: 'Un changement de projets/ ou ui/ peut fausser un affichage ou une décision sans qu’aucun test ne le voie.',
    remede: 'Un test par projet sur le signal simulé (tools/shot.py --js sait déjà évaluer du JS en temps réel) : scénario « yeux fermés » → « Détendu » affiché, « mâchoire » → électrodes écartées. Commencer par État mental.' },
  { id: 'T6', axe: 'tech', gravite: 'faible', titre: 'Noms d’échantillons et de fichiers insérés dans le HTML sans échappement',
    ou: 'ui/status-bar.js (_listSamples), projets/04-etude/etude.js (lignes pick, sel-msg, folder-pick), ui/profile-menu.js',
    constat: 'e.name, sub.name et f.file sont placés dans des gabarits innerHTML tels quels ; le menu des profils échappe seulement « < » (pas « & » ni les guillemets, inutile ici mais incomplet). Les noms viennent du champ de saisie, d’un fichier importé ou du dossier BIDS choisi.',
    effet: 'Un fichier ou un dossier de nom « <img onerror=…> » exécute du code dans l’origine de l’application (profils, API d’écriture). Peu probable chez un usage personnel.',
    remede: 'Une fonction d’échappement unique dans ui/ (ou textContent / createElement) pour tout texte venu de l’utilisateur ou d’un fichier.' },
  { id: 'T8', axe: 'tech', gravite: 'faible', titre: 'Un projet qui échoue au montage laisse ses abonnements actifs',
    ou: 'app/shell.js (project : unmount = def.mount(…))',
    constat: 'Aucun try / catch autour de mount(). Si mount lève une exception après avoir abonné muse.on(…) ou lancé un timer, la fonction de nettoyage n’est jamais récupérée ; la vue reste à moitié construite.',
    effet: 'Une erreur dans un projet fuit ses abonnements et ses timers jusqu’au rechargement de la page, et les pages suivantes en pâtissent (double traitement du flux).',
    remede: 'Entourer mount d’un try / catch qui affiche un message dans la vue ; faire que muse.on et les timers passent par un petit « porte-nettoyage » (scope) que le shell vide toujours.' },
  { id: 'S11', axe: 'science', gravite: 'faible', titre: 'Les profils importés ne sont pas validés',
    ou: 'lib/profiles.js (importProfile)',
    constat: 'Un profil importé (JSON) recopie toute valeur sous une clé connue sans en contrôler la forme : seuils d’artefacts, référence d’état mental, pipeline.',
    effet: 'Une calibration importée avec une valeur absente ou non numérique (NaN, chaîne) fait calculer des seuils faux sans message, la détection ou l’état s’en trouvant faussés. Deux profils dont les noms diffèrent seulement par accents ou espaces ont aussi la même étiquette de sujet BIDS.',
    remede: 'Un contrôle de forme par clé (nombres finis, listes de 4 valeurs…) à l’import ; rendre l’étiquette BIDS unique (suffixe numérique).' },
];

const RAPPORT_AXES = { archi: 'Architecture', science: 'Science', tech: 'Technique' };
const RAPPORT_GRAVITES = { haute: 'Haute', moyenne: 'Moyenne', faible: 'Faible' };

/* Vérification des corrections du premier rapport, faite en relisant le code. */
const RAPPORT_VERIF = [
  ['T1', 'Séquences lues, trous comblés, canaux alignés', 'Vérifié dans le code pour les trous de 1 à 22 paquets ; au-delà, voir T4.'],
  ['S1 · S2 · A1', 'Une règle d’exclusion unique, par segment de 1 s', 'Vérifié : MentalState.excludedFor sert en direct (EventLog), hors ligne (timeline) et aux calibrations. Plus de copie locale.'],
  ['S3', 'Bêta 13–20 Hz et témoin musculaire 30–45 Hz', 'Vérifié. Le témoin ne voit pas une tension déjà présente pendant la référence (limite écrite dans le code).'],
  ['S4', 'Piste clignements retirée du calcul d’état', 'Vérifié : MentalState.statePipeline, utilisée par État mental, l’étude et les calibrations.'],
  ['S5', 'Seuil tiré de la fluctuation de la référence', 'Appliqué, mais fragile : voir S10.'],
  ['A2', 'Calibration du profil appliquée à État mental', 'Vérifié : ArtifactDetector.forProfile (la démonstration garde un détecteur par défaut, voulu).'],
  ['T2', 'Jeu de test réel annoté', 'Toujours non fait : voir S10.'],
];

const RAPPORT_SCHEMA = `
<svg viewBox="0 0 760 250" class="rp-svg" role="img" aria-label="Où les trous de paquets décalent les canaux">
  <defs><marker id="rp8-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="rp-head"/></marker></defs>
  <text class="rp-title" x="20" y="24">Un « gap » non comblé n’est capté par aucune brique : le décalage reste jusqu’à la reconnexion</text>
  <g class="rp-lines">
    <path d="M170 125H206" marker-end="url(#rp8-arrow)"/>
    <path d="M360 125H395V60H410" marker-end="url(#rp8-arrow)"/>
    <path d="M395 125H410" marker-end="url(#rp8-arrow)"/>
    <path d="M395 125V190H410" marker-end="url(#rp8-arrow)"/>
    <path d="M580 60H610V110" marker-end="url(#rp8-arrow)"/>
    <path d="M580 125H610" marker-end="url(#rp8-arrow)"/>
    <path d="M580 190H610V140" marker-end="url(#rp8-arrow)"/>
  </g>
  <rect class="rp-box" x="20" y="97" width="150" height="56" rx="8"/>
  <text class="rp-name" x="95" y="121" text-anchor="middle">Casque Muse 2</text>
  <text class="rp-small" x="95" y="139" text-anchor="middle">paquets perdus</text>
  <rect class="rp-box rp-accent" x="210" y="97" width="150" height="56" rx="8"/>
  <text class="rp-name" x="285" y="121" text-anchor="middle">lib/muse.js</text>
  <text class="rp-small" x="285" y="139" text-anchor="middle">comble ≤ 22, sinon « gap »</text>
  <rect class="rp-box" x="412" y="36" width="168" height="48" rx="8"/>
  <text class="rp-name" x="496" y="57" text-anchor="middle">SignalPipeline</text>
  <text class="rp-small" x="496" y="74" text-anchor="middle">files par canal (CAR, eog)</text>
  <rect class="rp-box" x="412" y="101" width="168" height="48" rx="8"/>
  <text class="rp-name" x="496" y="122" text-anchor="middle">ArtifactDetector</text>
  <text class="rp-small" x="496" y="139" text-anchor="middle">files par canal (regard, blink)</text>
  <rect class="rp-box" x="412" y="166" width="168" height="48" rx="8"/>
  <text class="rp-name" x="496" y="187" text-anchor="middle">Recorder</text>
  <text class="rp-small" x="496" y="204" text-anchor="middle">garde le comblement</text>
  <rect class="rp-box" x="612" y="95" width="130" height="60" rx="8"/>
  <text class="rp-name" x="677" y="121" text-anchor="middle">Indices, états</text>
  <text class="rp-small" x="677" y="139" text-anchor="middle">décalés, sans alerte</text>
  <g class="rp-mark rp-mk-non"><circle cx="395" cy="125" r="11"/><text x="395" y="129" text-anchor="middle">T4</text></g>
  <g class="rp-mark rp-mk-non"><circle cx="580" cy="190" r="11"/><text x="580" y="194" text-anchor="middle">S9</text></g>
  <text class="rp-small" x="20" y="238">Rouge : constats non traités. Aucun abonné ne lit « gap ».</text>
</svg>`;

/* Mesure en direct : décalage entre canaux après un trou de paquets, par le vrai Muse (lib/muse.js).
 * Paquets fabriqués (20 octets : séquence + 12 échantillons de 12 bits) contenant une rampe : la valeur d'un échantillon
 * dit à quel instant il a été pris. Le canal AF7 (1) perd `lostPackets` paquets, les autres non. SignalPipeline et
 * ArtifactDetector apparient les canaux par RANG d'échantillon : on compare donc, au même rang, l'instant réel d'AF7 et
 * celui de TP9. */
function rapportMesureGap(lostPackets) {
  const muse = new Muse(), got = [[], [], [], []], gaps = [];
  muse.on('eeg', (c, s) => got[c].push(...s));
  muse.on('gap', (c, lost, info) => gaps.push({ c, lost, filled: info.filled }));
  const packet = (seq, t0) => {
    const b = new Uint8Array(20); b[0] = seq >> 8; b[1] = seq & 255;
    for (let i = 0; i < 12; i++) {
      const raw = t0 + i, bit = 16 + i * 12, byte = bit >> 3;
      if (bit % 8 === 0) { b[byte] = raw >> 4; b[byte + 1] = (b[byte + 1] & 0x0f) | ((raw & 0x0f) << 4); }
      else { b[byte] = (b[byte] & 0xf0) | (raw >> 8); b[byte + 1] = raw & 255; }
    }
    return new DataView(b.buffer);
  };
  muse._resetSequences();
  for (let p = 1; p <= 40 + lostPackets; p++) {   // le temps avance pour tous ; AF7 manque les paquets 21 à 20 + lostPackets
    for (let c = 0; c < 4; c++) if (!(c === 1 && p > 20 && p <= 20 + lostPackets)) muse._onEegPacket(c, packet(p, p * 12));
  }
  const n = Math.min(...got.map((g) => g.length)), tAt = (c) => (got[c][n - 1] / 0.48828125) + 2048;
  return { gaps, filled: gaps.some((g) => g.filled), decalageMs: Math.abs(Math.round(((tAt(0) - tAt(1)) / 256) * 1000)) };
}

Projets.register({
  id: 'rapport-2026-10-08',

  template: `
    <header class="proj-head">
      <a class="back" href="#/dev/rapports">← Rapports critiques</a>
      <h1>Rapport critique n° 2</h1>
    </header>
    <p class="intro">Deuxième revue de l’ensemble de l’application, le 8 octobre 2026, après les corrections du premier rapport. Faite par lecture du code (app/, lib/, ui/, projets/, serveur.py, tests/), sans casque réel. Les 325 tests passent et les 18 pages se chargent sans erreur de console.</p>

    <section class="panel rp-verdict">
      <h2 class="section">Verdict</h2>
      <p><b>Les corrections du premier rapport sont réelles et propres ; les nouveaux défauts sont aux jointures.</b> La règle d’exclusion, le témoin musculaire, le retrait de la piste clignements et la calibration partout sont bien en place dans lib/. Reste (1) le cas que le correctif des trous de paquets ne couvre pas, qui désaligne les canaux sans alerte (T4) ; (2) un seuil de décision qui n’a jamais été éprouvé sur du signal réel (S10) ; (3) une colle (projets/, ui/, shell) ni testée ni dédoublonnée (A5, A6, T7). Côté sécurité, rien de grave pour un usage personnel, mais le serveur local se protège mal (T5).</p>
      <div class="rp-counts" id="rp-counts"></div>
    </section>

    <h2 class="section">Les corrections du premier rapport, vérifiées</h2>
    <div class="panel"><table class="rp-table" id="rp-verif"></table></div>

    <h2 class="section">Où les trous de paquets décalent les canaux</h2>
    <div class="panel">${RAPPORT_SCHEMA}</div>

    <h2 class="section">Constats</h2>
    <div class="toolbar">
      <span class="seg" id="rp-axe">
        <button type="button" data-v="" class="on">Tout</button>
        <button type="button" data-v="archi">Architecture</button>
        <button type="button" data-v="science">Science</button>
        <button type="button" data-v="tech">Technique</button>
      </span>
      <span class="seg" id="rp-grav">
        <button type="button" data-v="" class="on">Toutes gravités</button>
        <button type="button" data-v="haute">Haute</button>
        <button type="button" data-v="moyenne">Moyenne</button>
        <button type="button" data-v="faible">Faible</button>
      </span>
    </div>
    <div class="rp-list" id="rp-list"></div>

    <h2 class="section">Mesure en direct : décalage des canaux après un trou de paquets (T4)</h2>
    <div class="panel">
      <p class="hint">Calcul fait à l’instant par le vrai code de lib/muse.js et lib/filters.js, sur des paquets fabriqués : le canal AF7 perd N paquets d’affilée, les trois autres non. Le décalage est l’écart entre l’instant réel de TP9 et celui d’AF7 au même rang d’échantillon, donc ce que verrait SignalPipeline (CAR, clignements) ou ArtifactDetector (regard) en les combinant.</p>
      <table class="rp-table" id="rp-gap"><tr><td>Calcul en cours…</td></tr></table>
      <p class="hint" id="rp-gap-note"></p>
    </div>

    <h2 class="section">Recommandations, par ordre de priorité</h2>
    <ol class="rp-reco">
      <li><b>Traiter le « resync » (T4).</b> Un événement unique qui remet à zéro pipeline, détecteur, contact et journal d’événements ; stats.lost visible dans la barre d’état.</li>
      <li><b>Marquer les trous dans les enregistrements (S9).</b> Événement BIDS / annotation EDF+ plutôt que des valeurs inventées sans trace.</li>
      <li><b>Éprouver le seuil sur du réel (S10).</b> Changements d’état par heure au repos mesurés sur echantillons/, puis référence plus longue.</li>
      <li><b>Un seul câblage signal → état (A5)</b>, avec une horloge d’échantillons pour le temps (T7).</li>
      <li><b>Durcir le serveur local (T5)</b> : Host contrôlé, Origin exigée, taille plafonnée.</li>
      <li><b>Tester la colle (A6)</b> : un scénario simulé par projet, en commençant par État mental.</li>
      <li>Petits points : échappement HTML commun (T6), mount protégé (T8), validation des profils importés (S11).</li>
    </ol>
    <p class="hint">Ce rapport n’a pas été confronté au casque réel : les effets décrits viennent de la lecture du code et de la mesure ci-dessus, faite sur paquets fabriqués. Les constats sont à l’état « non traité » à la date du rapport.</p>`,

  mount(root) {
    const $ = (id) => root.querySelector('#' + id);
    const filtre = { axe: '', grav: '' };
    const ordre = { haute: 0, moyenne: 1, faible: 2 };

    const n = (g) => RAPPORT_CONSTATS.filter((c) => c.gravite === g).length;
    $('rp-counts').innerHTML = Object.keys(RAPPORT_GRAVITES).map((g) => `<span class="rp-sev rp-${g}">${n(g)} ${RAPPORT_GRAVITES[g].toLowerCase()}${n(g) > 1 ? 's' : ''}</span>`).join('')
      + `<span class="hint">sur ${RAPPORT_CONSTATS.length} constats</span>`;
    $('rp-verif').innerHTML = '<tr><th>Constat</th><th>Correction</th><th>Relecture</th></tr>'
      + RAPPORT_VERIF.map(([id, quoi, res]) => `<tr><td>${id}</td><td>${quoi}</td><td>${res}</td></tr>`).join('');
    root.querySelectorAll('.rp-mark').forEach((g) => g.classList.add('rp-mk-non'));

    function render() {
      const list = RAPPORT_CONSTATS.filter((c) => (!filtre.axe || c.axe === filtre.axe) && (!filtre.grav || c.gravite === filtre.grav))
        .sort((a, b) => ordre[a.gravite] - ordre[b.gravite]);
      $('rp-list').innerHTML = list.length ? list.map((c) => `
        <article class="panel rp-item">
          <header><span class="rp-id">${c.id}</span><span class="rp-sev rp-${c.gravite}">${RAPPORT_GRAVITES[c.gravite]}</span><span class="tag">${RAPPORT_AXES[c.axe]}</span><h3>${c.titre}</h3></header>
          <p class="rp-ou">${c.ou}</p>
          <dl>
            <dt>Constat</dt><dd>${c.constat}</dd>
            <dt>Effet</dt><dd>${c.effet}</dd>
            <dt>Remède proposé</dt><dd>${c.remede}</dd>
          </dl>
        </article>`).join('') : '<p class="hint">Aucun constat pour ce filtre.</p>';
    }

    const bindSeg = (id, key) => root.querySelectorAll(`#${id} button`).forEach((b) => (b.onclick = () => {
      filtre[key] = b.dataset.v;
      root.querySelectorAll(`#${id} button`).forEach((x) => x.classList.toggle('on', x === b));
      render();
    }));
    bindSeg('rp-axe', 'axe');
    bindSeg('rp-grav', 'grav');
    render();

    // Mesure différée : la page s'affiche d'abord
    const timer = setTimeout(() => {
      const cas = [5, 22, 23, 40, 100].map((lost) => ({ lost, ...rapportMesureGap(lost) }));
      $('rp-gap').innerHTML = '<tr><th>Paquets perdus sur AF7</th>' + cas.map((r) => `<th>${r.lost}</th>`).join('') + '</tr>'
        + '<tr><td>Signalé par « gap »</td>' + cas.map((r) => `<td>${r.gaps.length ? 'oui' : 'non'}</td>`).join('') + '</tr>'
        + '<tr><td>Comblé</td>' + cas.map((r) => `<td>${r.filled ? 'oui' : 'non'}</td>`).join('') + '</tr>'
        + '<tr><td>Écart d’instant AF7 / TP9</td>' + cas.map((r) => `<td>${r.decalageMs} ms</td>`).join('') + '</tr>';
      const pire = cas.filter((r) => !r.filled && r.decalageMs !== 0);
      $('rp-gap-note').textContent = pire.length
        ? `À partir de ${pire[0].lost} paquets perdus, rien n’est comblé : les échantillons d’AF7 sont appariés à ceux des autres canaux avec ${pire[0].decalageMs} ms d’écart (davantage pour un trou plus long), pour toute la suite du flux. Le message « gap » est émis, mais aucune brique ne remet ses files à zéro.`
        : 'Aucun décalage durable mesuré dans ces cas : le constat T4 est peut-être corrigé.';
    }, 50);

    return () => clearTimeout(timer);
  },
});
})();
