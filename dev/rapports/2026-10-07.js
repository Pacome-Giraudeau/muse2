/* Rapport critique du 7 octobre 2026 : revue de l'architecture et de la cohérence scientifique et technique de
 * l'application, avec une mesure faite en direct par le vrai code de lib/filters.js (effet de la piste « clignements »
 * sur le theta). Listé dans CATALOGUE.rapports, ouvert depuis la page Développement › Rapports critiques (dev/rapports.js).
 * Revue faite par lecture du code, sans casque réel. Tout est enveloppé dans une fonction : chaque rapport peut reprendre
 * les mêmes noms (RAPPORT_CONSTATS…) sans collision. Pour mettre à jour : modifier RAPPORT_CONSTATS (un objet par constat).
 * Suivi : les constats (constat, effet) gardent l'état du code au 7 octobre ; la prise en compte est annotée par
 * RAPPORT_SUIVI (date) et, par constat, `statut` + `solution` (solution choisie, à la place du remède proposé). */
(function () {
// gravite : 'haute' | 'moyenne' | 'faible' ; axe : 'archi' | 'science' | 'tech'
// statut : 'corrigé' | 'partiel' | 'non corrigé' ; solution : ce qui a réellement été fait (ou pourquoi rien)
const RAPPORT_CONSTATS = [
  { id: 'T1', axe: 'tech', gravite: 'haute', titre: 'Paquets perdus non détectés, canaux désalignés',
    ou: 'lib/muse.js (_decodeEEG), lib/filters.js (feed), lib/artifacts.js (_flush)',
    constat: 'Les 2 octets de numéro de séquence de chaque paquet EEG sont sautés. Les 4 canaux sont ensuite appariés par simple comptage d’échantillons. Un paquet perdu sur un seul canal le décale définitivement de 12 échantillons (47 ms) par rapport aux autres, sans aucun signalement.',
    effet: 'Fausse ce qui combine les canaux : référence moyenne (CAR), référence AF7/AF8 de la piste clignements, différence AF7 − AF8 du regard. Les pertes Bluetooth ne sont pas rares en pratique.',
    statut: 'corrigé',
    solution: 'Le numéro de séquence est lu sur chaque canal (muse._onEegPacket). Un trou de 1 à 22 paquets (~1 s) est signalé par l’événement « gap », compté dans muse.stats.lost et comblé en répétant la dernière valeur : les 4 canaux restent alignés (pas de NaN, que les filtres récursifs ne supportent pas). Au-delà, ou si la séquence recule : pas de comblement, « gap » avec filled = false, stats.resyncs. Testé sur paquets fabriqués ; non vérifié sur le casque réel, et aucun projet ne réagit encore à « gap ».' },
  { id: 'S1', axe: 'science', gravite: 'haute', titre: 'Les regards latéraux ne sont jamais écartés',
    ou: 'lib/mental-state.js (excluded, timeline), projets/03-etat',
    constat: 'MentalState.excluded() ne connaît que clignement, sourcils et mâchoire. Les événements gaze-left / gaze-right, pourtant repérés par le détecteur, sont ignorés en direct comme hors ligne.',
    effet: 'Un regard sur le côté crée un potentiel lent de plusieurs dizaines de µV sur AF7/AF8, dont l’énergie tombe en delta et theta : il gonfle l’indice « somnolence ».',
    statut: 'corrigé',
    solution: 'MentalState.ZONES associe chaque type d’événement à ses électrodes : regards (gaze-left / gaze-right) et clignements → front, mâchoire → tempes, bâillement → les quatre. La même table sert en direct et hors ligne.' },
  { id: 'S2', axe: 'science', gravite: 'haute', titre: 'En direct, des artefacts restent dans la fenêtre analysée',
    ou: 'projets/03-etat/etat.js (excluded, WINDOW = 4 s)',
    constat: 'La fenêtre analysée dure 4 s, mais un clignement n’écarte le front que pendant 1,5 s, et sourcils / mâchoire seulement tant qu’ils sont « en cours ». Hors ligne, timeline() écarte toute fenêtre qu’un événement touche.',
    effet: 'Un clignement vieux de 1,5 à 4 s pollue encore le theta frontal en direct. Les deux projets appliquent deux règles différentes au même calcul.',
    statut: 'corrigé',
    solution: 'Une seule règle dans lib/ (MentalState.excludedFor, journal MentalState.EventLog en direct), affinée par segment : dans la fenêtre de 4 s, Welch ne garde pour chaque électrode que les segments de 1 s qu’aucun événement de sa zone ne touche (marge 0,3 s) ; l’électrode n’est écartée que s’il reste moins de 3 segments propres (MentalState.measure). Écarter toute la fenêtre aurait privé l’indicateur du front presque en permanence (15 à 20 clignements par minute) ; sur signal simulé, AF7 et AF8 restent utilisables 65 à 93 % du temps, contre 0 à 3 % avec la fenêtre entière.' },
  { id: 'S3', axe: 'science', gravite: 'haute', titre: '« Concentré » peut signifier « muscles tendus »',
    ou: 'lib/mental-state.js (indice focus = β / (α + θ))',
    constat: 'Le bêta (13–30 Hz) mesuré en AF7/AF8 et TP9/TP10 est dominé par les muscles du front et des tempes. Le seuil « sourcils / mâchoire » est placé à 40 % d’un geste forcé : une tension légère et continue passe dessous. L’indice de Pope a été défini sur des électrodes centrales et pariétales (à vérifier dans la réf. 41), pas sur ces sites.',
    effet: 'Une crispation discrète fait monter l’indice et afficher « Concentré » sans changement d’attention.',
    statut: 'corrigé',
    solution: 'Bêta limité à 13–20 Hz. Témoin musculaire : puissance 30–45 Hz mesurée sur le signal brut, comparée à sa valeur dans la référence ; au-delà de 2 fois, l’électrode ne compte plus pour l’indice « concentration », et si toutes sont tendues « Concentré » est suspendu (affiché). Les anciennes références, sans témoin, restent utilisables mais sans cette garde (signalé). Limites : une tension déjà présente pendant la référence n’est pas vue ; seuil non vérifié sur le casque réel.' },
  { id: 'S4', axe: 'science', gravite: 'moyenne', titre: 'La piste « clignements » efface le theta frontal',
    ou: 'lib/filters.js (_stepEog), projets/03-etat (SignalPipeline.loadSaved)',
    constat: 'La correction soustrait en permanence w × (moyenne AF7/AF8 passée sous 6 Hz). Les poids n’apprennent que pendant les clignements, puis restent proches de 1 au front. La mesure en direct ci-dessous chiffre la perte.',
    effet: 'Si la piste est active dans le projet Amélioration, elle s’applique aussi à État mental (réglages partagés) : le theta frontal disparaît en grande partie. Les poids évoluent au fil des clignements : la référence mesurée au début n’est plus comparable ensuite.',
    statut: 'corrigé',
    solution: 'La piste « clignements » n’est plus appliquée au calcul d’état : MentalState.statePipeline() en retire une copie sans elle, utilisée par État mental, Étude d’échantillon (états) et toutes les calibrations. L’interface indique la piste retirée. Elle reste disponible pour l’affichage et l’enregistrement.' },
  { id: 'S5', axe: 'science', gravite: 'moyenne', titre: 'Seuil fixe de +20 %, sans lien avec la variabilité',
    ou: 'lib/mental-state.js (THRESHOLD = 0,18)',
    constat: 'Un état s’affiche dès qu’un score dépasse ln(1,2). Rien ne dit si cet écart dépasse la fluctuation naturelle des indices au repos, qui varie selon la personne, le contact et le nombre d’électrodes gardées.',
    effet: 'Chez une personne au signal instable, les états changent au hasard ; chez une autre, ils ne bougent jamais.',
    statut: 'corrigé',
    solution: 'Seuil = 2 × écart-type robuste (1,4826 × MAD) des scores de la référence, corrigé du lissage de 5 s et du recouvrement des fenêtres (facteur ≈ 0,56, vérifié par simulation), borné entre 0,1 et 0,5. Repli sur 0,18 pour une ancienne référence, une référence de moins de 20 mesures ou la médiane d’un enregistrement entier. Les jauges montrent le seuil réel. Limite : le seuil ne tient pas compte du nombre d’électrodes disponibles à chaque instant.' },
  { id: 'S6', axe: 'science', gravite: 'moyenne', titre: 'Trois indices couplés, pilotés surtout par l’alpha',
    ou: 'lib/mental-state.js (indices)',
    constat: 'Les trois indices combinent les trois mêmes puissances. Une baisse d’alpha seule fait monter à la fois « concentration » et « somnolence » ; le choix entre les deux dépend alors du rapport θ / β.',
    effet: 'Les états sont moins indépendants qu’ils n’en ont l’air ; les ouvertures / fermetures des yeux (alpha) dominent la décision.',
    statut: 'corrigé',
    solution: 'La référence (version 3) mémorise aussi les puissances θ, α, β par électrode ; le projet État mental affiche les trois écarts bruts, lissés comme les scores. Les indices, eux, restent couplés par construction : le constat est rendu visible, pas supprimé.' },
  { id: 'A1', axe: 'archi', gravite: 'moyenne', titre: 'Règle d’exclusion écrite deux fois, dans un projet',
    ou: 'projets/03-etat/etat.js et lib/mental-state.js (timeline)',
    constat: 'Le projet État mental recode sa propre règle d’exclusion au lieu de la prendre dans lib/, contrairement à la règle du dépôt (« logique réutilisable → lib/ »). Les deux versions ont divergé (S2).',
    effet: 'Un même enregistrement ne donne pas les mêmes états en direct et dans Étude d’échantillon, et cette logique n’est pas testée.',
    statut: 'corrigé',
    solution: 'La règle vit dans lib/mental-state.js (excludedFor, EventLog, measure), testée, et sert à État mental, Étude d’échantillon et aux calibrations (CalibrationContext) ; les copies locales ont été supprimées.' },
  { id: 'A2', axe: 'archi', gravite: 'moyenne', titre: 'État mental n’utilise pas la calibration',
    ou: 'projets/03-etat/etat.js (new ArtifactDetector())',
    constat: 'Capteurs en direct applique la calibration du profil (new Calibrator) et Étude d’échantillon aussi (Calibrator.load()). État mental crée un détecteur nu, aux seuils par défaut (clignement 70 µV, regard 25 µV).',
    effet: 'La calibration, pourtant présentée comme la source des seuils (« jamais de constantes devinées »), est ignorée là où elle compte le plus.',
    statut: 'corrigé',
    solution: 'ArtifactDetector.forProfile() applique la calibration, la sensibilité et la fréquence secteur du profil ; utilisée par État mental (casque) et par les calibrations. La démonstration garde volontairement un détecteur par défaut : le signal y est fabriqué. Capteurs en direct passait déjà par la calibration.' },
  { id: 'T2', axe: 'tech', gravite: 'moyenne', titre: 'Les tests valident le code contre ses propres hypothèses',
    ou: 'tests/*.test.js, lib/simulator.js',
    constat: 'Les 158 tests passent, mais les détecteurs et l’état mental sont testés sur le simulateur : alpha en sinus pur, clignements de forme connue. Le dossier echantillons/ contient des enregistrements réels, non utilisés par les tests.',
    effet: 'Les tests prouvent la cohérence interne, pas la justesse sur un vrai cerveau. Les seuils restent non validés, ce que la doc reconnaît.',
    statut: 'non corrigé',
    solution: 'Aucune pour l’instant : il faut d’abord enregistrer et annoter à la main une séance réelle (clignements, regards, mâchoire). Seule amélioration annexe : un fichier de test qui ne se charge pas (erreur de syntaxe) compte désormais comme un échec au lieu d’être ignoré en silence.' },
  { id: 'S7', axe: 'science', gravite: 'faible', titre: 'Le secteur 50 Hz entre dans la mesure des muscles',
    ou: 'lib/artifacts.js (enveloppe > 15 Hz)',
    constat: 'L’énergie « > 15 Hz » vient d’un passe-haut d’ordre 1 sur le signal brut, 50 Hz compris. Le fond appris absorbe un parasite stable, pas un parasite qui varie quand on bouge.',
    effet: 'Fausses détections « sourcils » ou « mâchoire » possibles quand le contact change.',
    statut: 'corrigé',
    solution: 'Coupe-bande secteur (50 ou 60 Hz selon le profil, harmonique comprise, Q = 5) avant l’enveloppe musculaire, en direct comme hors ligne. Un test montre qu’un parasite 50 Hz d’amplitude variable ne déclenche plus « sourcils » ni « mâchoire ». Le niveau mesuré baisse d’environ 8 % : refaire la calibration des artefacts est conseillé.' },
  { id: 'S8', axe: 'science', gravite: 'faible', titre: 'Contact : un signal presque plat est noté « bon »',
    ou: 'lib/contact.js (_rate)',
    constat: 'Tout signal entre 0,5 et 25 µV efficaces obtient la note maximale. Un signal de 1 à 2 µV est anormalement faible pour un EEG porté.',
    effet: 'Un défaut de liaison ou un canal bloqué peut passer pour un excellent contact.',
    statut: 'partiel',
    solution: 'Nouveau niveau « suspect » entre 0,5 et 3 µV efficaces (rouge, électrode écartée comme « mauvais »). Reste à faire : vérifier ce seuil sur le casque réel avec une électrode décollée.' },
  { id: 'T3', axe: 'tech', gravite: 'faible', titre: 'Référence BIDS fausse quand la CAR est appliquée',
    ou: 'lib/recording.js (EEGReference: \'Fpz\')',
    constat: 'La fiche écrit toujours Fpz, même pour un échantillon stocké filtré avec la référence moyenne commune.',
    effet: 'Un logiciel tiers (MNE, EEGLAB) interprète mal la référence de ces fichiers.',
    statut: 'partiel',
    solution: 'EEGReference = « average » (valeur des exemples BIDS) quand l’échantillon est stocké filtré avec la piste car (Recording.eegReference). Reste à faire : les fichiers EDF écrits par l’application ne mentionnent pas CAR dans leur préfiltrage, si bien qu’un tel EDF relu revient en Fpz.' },
  { id: 'A3', axe: 'archi', gravite: 'faible', titre: 'Ordre de chargement décrit à trois endroits',
    ou: 'index.html, tests/index.html, lib/CLAUDE.md',
    constat: 'Les globales imposent un ordre des balises &lt;script&gt;, recopié à la main dans trois fichiers.',
    effet: 'Une nouvelle brique ajoutée à un seul endroit casse les tests ou la page.',
    statut: 'corrigé',
    solution: 'tools/check.py compare d’abord les scripts lib/ de index.html et de tests/index.html (mêmes fichiers, même ordre) et nomme l’écart en cas d’échec.' },
  { id: 'A4', axe: 'archi', gravite: 'faible', titre: 'Doublons de calcul dans lib/',
    ou: 'lib/signal.js, lib/artifacts.js, lib/contact.js',
    constat: 'Deux méthodes de bandes (bandPowers sur une FFT, bandPowersFromPsd sur Welch) ; des passe-bas d’ordre 1 réécrits dans chaque brique ; Signal.stats renvoie rms = écart-type.',
    effet: 'Deux pages peuvent donner des parts de bandes différentes pour le même signal.',
    statut: 'corrigé',
    solution: 'Signal.bandPowers supprimé : Welch partout (Capteurs en direct compris). Signal.onePoleCoef / smoothCoef remplacent les filtres d’ordre 1 réécrits (artifacts, contact). Signal.stats().rms est désormais la vraie valeur efficace ; Étude d’échantillon affiche l’écart-type sous son nom.' },
];

const RAPPORT_AXES = { archi: 'Architecture', science: 'Science', tech: 'Technique' };
const RAPPORT_GRAVITES = { haute: 'Haute', moyenne: 'Moyenne', faible: 'Faible' };
const RAPPORT_STATUTS = { 'corrigé': { label: 'Corrigé', css: 'ok' }, partiel: { label: 'Partiellement corrigé', css: 'part' }, 'non corrigé': { label: 'Non corrigé', css: 'non' } };
const RAPPORT_SUIVI = { date: '2026-10-08', texte: '8 octobre 2026' };

/* Schéma du trajet des données, avec les numéros des constats aux endroits concernés. */
const RAPPORT_SCHEMA = `
<svg viewBox="0 0 760 330" class="rp-svg" role="img" aria-label="Trajet des données et points faibles">
  <defs><marker id="rp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="rp-head"/></marker></defs>
  <text class="rp-title" x="20" y="24">Les points faibles se concentrent sur l’assemblage des canaux et la décision finale</text>
  <g class="rp-lines">
    <path d="M170 160H206" marker-end="url(#rp-arrow)"/>
    <path d="M360 160H380V65H398" marker-end="url(#rp-arrow)"/>
    <path d="M380 135H398" marker-end="url(#rp-arrow)"/>
    <path d="M380 160V205H398" marker-end="url(#rp-arrow)"/>
    <path d="M380 205V275H398" marker-end="url(#rp-arrow)"/>
    <path d="M570 205H590V222H606" marker-end="url(#rp-arrow)"/>
    <path d="M570 275H590V258H606" marker-end="url(#rp-arrow)"/>
  </g>
  <rect class="rp-box" x="20" y="132" width="150" height="56" rx="8"/>
  <text class="rp-name" x="95" y="156" text-anchor="middle">Casque Muse 2</text>
  <text class="rp-small" x="95" y="174" text-anchor="middle">4 canaux, 12 éch. / paquet</text>
  <rect class="rp-box" x="210" y="132" width="150" height="56" rx="8"/>
  <text class="rp-name" x="285" y="156" text-anchor="middle">lib/muse.js</text>
  <text class="rp-small" x="285" y="174" text-anchor="middle">décodage, événements</text>
  <rect class="rp-box" x="400" y="40" width="170" height="50" rx="8"/>
  <text class="rp-name" x="485" y="62" text-anchor="middle">Recorder (brut)</text>
  <text class="rp-small" x="485" y="79" text-anchor="middle">30 s, IndexedDB, EDF/BIDS</text>
  <rect class="rp-box" x="400" y="110" width="170" height="50" rx="8"/>
  <text class="rp-name" x="485" y="132" text-anchor="middle">ContactQuality</text>
  <text class="rp-small" x="485" y="149" text-anchor="middle">rms sur 1 s, médiane 5 s</text>
  <rect class="rp-box" x="400" y="180" width="170" height="50" rx="8"/>
  <text class="rp-name" x="485" y="202" text-anchor="middle">ArtifactDetector</text>
  <text class="rp-small" x="485" y="219" text-anchor="middle">sur le signal brut</text>
  <rect class="rp-box" x="400" y="250" width="170" height="50" rx="8"/>
  <text class="rp-name" x="485" y="272" text-anchor="middle">SignalPipeline</text>
  <text class="rp-small" x="485" y="289" text-anchor="middle">6 pistes, réglages partagés</text>
  <rect class="rp-box rp-accent" x="610" y="200" width="130" height="80" rx="8"/>
  <text class="rp-name" x="675" y="232" text-anchor="middle">MentalState</text>
  <text class="rp-small" x="675" y="250" text-anchor="middle">3 indices / référence</text>
  <text class="rp-small" x="675" y="266" text-anchor="middle">seuil +20 %</text>
  <text class="rp-small" x="592" y="196" text-anchor="middle">exclusion</text>
  <g class="rp-mark"><circle cx="350" cy="132" r="11"/><text x="350" y="136" text-anchor="middle">T1</text></g>
  <g class="rp-mark"><circle cx="560" cy="110" r="11"/><text x="560" y="114" text-anchor="middle">S8</text></g>
  <g class="rp-mark"><circle cx="560" cy="180" r="11"/><text x="560" y="184" text-anchor="middle">S7</text></g>
  <g class="rp-mark"><circle cx="560" cy="250" r="11"/><text x="560" y="254" text-anchor="middle">S4</text></g>
  <g class="rp-mark"><circle cx="560" cy="40" r="11"/><text x="560" y="44" text-anchor="middle">T3</text></g>
  <g class="rp-mark"><circle cx="592" cy="214" r="11"/><text x="592" y="218" text-anchor="middle">S1</text></g>
  <g class="rp-mark"><circle cx="740" cy="200" r="11"/><text x="740" y="204" text-anchor="middle">S3</text></g>
  <g class="rp-mark"><circle cx="740" cy="280" r="11"/><text x="740" y="284" text-anchor="middle">S5</text></g>
  <text class="rp-small" x="20" y="318">Les pastilles renvoient aux constats ; leur couleur donne le statut au 8 octobre (vert corrigé, orange partiel).</text>
</svg>`;

/* Mesure en direct : part du theta frontal qui survit à la piste « clignements » (lib/filters.js).
 * 1) 60 s de signal simulé avec clignements : les poids NLMS apprennent ; 2) un sinus commun aux 4 canaux à chaque
 * fréquence, 15 s chacun (5 s d'établissement ignorées) ; amplitude de sortie avec la piste / sans la piste. */
function rapportMesureEog(freqs, R = 256) {
  const avec = new SignalPipeline(R), sans = new SignalPipeline(R);
  avec.setEnabled('eog', true);
  const learn = new SignalSimulator({ spikePerS: 0, mains: 0 }, R, 7).generate(60 * R);
  for (let i = 0; i < learn[0].length; i++) {
    const fr = [learn[0][i], learn[1][i], learn[2][i], learn[3][i]];
    avec.processFrame(fr); sans.processFrame(fr);
  }
  return freqs.map((f) => {
    const ea = [0, 0, 0, 0], es = [0, 0, 0, 0];
    for (let i = 0; i < 15 * R; i++) {
      const v = 10 * Math.sin((2 * Math.PI * f * i) / R), fr = [v, v, v, v];
      const a = avec.processFrame(fr), s = sans.processFrame(fr);
      if (i >= 5 * R) for (let c = 0; c < 4; c++) { ea[c] += a[c] * a[c]; es[c] += s[c] * s[c]; }
    }
    return { f, af7: Math.sqrt(ea[1] / es[1]), tp9: Math.sqrt(ea[0] / es[0]) };
  });
}

Projets.register({
  id: 'rapport-2026-10-07',

  template: `
    <header class="proj-head">
      <a class="back" href="#/dev/rapports">← Rapports critiques</a>
      <h1>Rapport critique</h1>
    </header>
    <p class="intro">Revue du 7 octobre 2026, faite par lecture du code (lib/, projets/, tests/, docs/), sans casque réel. Les 158 tests passent et les 9 pages se chargent sans erreur.</p>

    <section class="panel rp-verdict">
      <h2 class="section">Verdict</h2>
      <p><b>Une base saine et honnête, mais l’« état mental » repose sur trois maillons fragiles.</b> L’architecture est claire et bien documentée, et le traitement du signal est correct dans le détail. Les faiblesses sont ailleurs : canaux qui peuvent se désaligner sans alerte (T1), artefacts oculaires et musculaires qui passent dans les indices (S1 à S4), et une décision prise sur un seuil fixe (S5).</p>
      <div class="rp-counts" id="rp-counts"></div>
    </section>

    <section class="panel rp-suivi">
      <h2 class="section">Prise en compte</h2>
      <p>Constats traités le <b>${RAPPORT_SUIVI.texte}</b>. Chaque constat porte son statut et la <b>solution choisie</b> (qui remplace le remède proposé) ; le constat et son effet restent ceux du 7 octobre. Toutes les corrections sont testées sur signal simulé, <b>aucune n’a encore été vérifiée sur le casque réel</b>.</p>
      <div class="rp-counts" id="rp-statuts"></div>
    </section>

    <h2 class="section">Points forts</h2>
    <div class="rp-forts">
      <div class="panel"><h3>Architecture</h3><ul>
        <li>Une seule page pour toute l’application : la connexion Bluetooth survit aux changements de page.</li>
        <li>lib/ sans DOM, ui/ réutilisable, projets/ réduits à la colle ; contrat mount / nettoyage clair.</li>
        <li>API décrite en tête de chaque fichier : lisible par un humain comme par une IA.</li>
        <li>Exports EDF+ et BIDS-EEG : les données sortent dans des formats standards.</li>
      </ul></div>
      <div class="panel"><h3>Signal</h3><ul>
        <li>Décodage conforme aux constantes connues du Muse (0,48828 µV par pas, échelles accéléromètre et gyroscope).</li>
        <li>Welch correctement normalisé (fenêtre de Hann, une face, µV²/Hz).</li>
        <li>Butterworth d’ordre 4 juste (Q 0,5412 et 1,3066), filtre de Hampel avec MAD × 1,4826.</li>
        <li>Piste clignements à FIR de phase linéaire : choix justifié et mesuré dans le code.</li>
      </ul></div>
      <div class="panel"><h3>Démarche</h3><ul>
        <li>Indices comparés à une référence propre à chaque électrode, en rapport logarithmique.</li>
        <li>Seuils d’artefacts tirés d’une calibration personnelle, pas de constantes devinées.</li>
        <li>Documentation scientifique prudente : limites et non-validation dites clairement.</li>
        <li>Sources marquées « vérifiée » ou « à vérifier » (21 / 25).</li>
      </ul></div>
    </div>

    <h2 class="section">Trajet des données et points faibles</h2>
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
      <span class="seg" id="rp-stat">
        <button type="button" data-v="" class="on">Tous statuts</button>
        <button type="button" data-v="corrigé">Corrigé</button>
        <button type="button" data-v="partiel">Partiel</button>
        <button type="button" data-v="non corrigé">Non corrigé</button>
      </span>
    </div>
    <div class="rp-list" id="rp-list"></div>

    <h2 class="section">Mesure en direct : le theta frontal après la piste « clignements » (S4)</h2>
    <div class="panel">
      <p class="hint">Calcul fait à l’instant par le vrai code de lib/filters.js : 60 s de signal simulé avec clignements pour que la correction apprenne, puis un sinus de 10 µV commun aux 4 électrodes. Valeur = amplitude gardée avec la piste, rapportée à celle sans la piste.</p>
      <table class="rp-table" id="rp-eog"><tr><td>Calcul en cours…</td></tr></table>
      <p class="hint" id="rp-eog-note"></p>
    </div>

    <h2 class="section">Recommandations, par ordre de priorité</h2>
    <p class="hint">Recommandations du 7 octobre. Au ${RAPPORT_SUIVI.texte}, seule la 7 (enregistrement réel annoté, T2) reste à faire ; S8 et T3 sont partiellement corrigés (voir les constats).</p>
    <ol class="rp-reco">
      <li><b>Aligner les canaux (T1).</b> Lire le numéro de séquence, compter et signaler les pertes, combler les trous. C’est la base de tout le reste.</li>
      <li><b>Une seule règle d’exclusion dans lib/ (S1, S2, A1).</b> Fenêtre entière, regards compris, testée, utilisée en direct et hors ligne.</li>
      <li><b>Calibration partout (A2).</b> Une fabrique de détecteur qui applique la calibration du profil.</li>
      <li><b>Témoin musculaire pour « Concentré » (S3).</b> Puissance 30–45 Hz suivie, indice suspendu quand elle monte.</li>
      <li><b>Seuil tiré de la variabilité de la référence (S5)</b>, et écarts bruts θ / α / β affichés (S6).</li>
      <li><b>Piste clignements hors du calcul d’état (S4)</b>, ou poids figés après la référence.</li>
      <li><b>Un enregistrement réel annoté comme jeu de test (T2)</b>, avec taux de détection suivis.</li>
      <li>Corrections rapides : coupe-bande avant l’enveloppe musculaire (S7), zone « suspect » du contact (S8), référence BIDS (T3), contrôle de l’ordre des scripts (A3), doublons (A4).</li>
    </ol>
    <p class="hint">Ce rapport n’a pas été confronté au casque réel : les effets décrits viennent de la lecture du code et de la mesure ci-dessus, faite sur signal simulé.</p>`,

  mount(root) {
    const $ = (id) => root.querySelector('#' + id);
    const filtre = { axe: '', grav: '', stat: '' };
    const ordre = { haute: 0, moyenne: 1, faible: 2 };

    const counts = Object.keys(RAPPORT_GRAVITES).map((g) => `<span class="rp-sev rp-${g}">${RAPPORT_CONSTATS.filter((c) => c.gravite === g).length} ${RAPPORT_GRAVITES[g].toLowerCase()}${RAPPORT_CONSTATS.filter((c) => c.gravite === g).length > 1 ? 's' : ''}</span>`);
    $('rp-counts').innerHTML = counts.join('') + `<span class="hint">sur ${RAPPORT_CONSTATS.length} constats</span>`;
    const badge = (s) => `<span class="rp-statut rp-st-${RAPPORT_STATUTS[s].css}">${RAPPORT_STATUTS[s].label}</span>`;
    $('rp-statuts').innerHTML = Object.keys(RAPPORT_STATUTS).map((s) => {
      const ids = RAPPORT_CONSTATS.filter((c) => c.statut === s).map((c) => c.id);
      return ids.length ? `${badge(s)}<span class="hint">${ids.length} : ${ids.join(', ')}</span>` : '';
    }).join('');
    // Pastilles du schéma colorées selon le statut de leur constat
    root.querySelectorAll('.rp-mark').forEach((g) => {
      const c = RAPPORT_CONSTATS.find((x) => x.id === g.textContent.trim());
      if (c) g.classList.add('rp-mk-' + RAPPORT_STATUTS[c.statut].css);
    });

    function render() {
      const list = RAPPORT_CONSTATS.filter((c) => (!filtre.axe || c.axe === filtre.axe) && (!filtre.grav || c.gravite === filtre.grav) && (!filtre.stat || c.statut === filtre.stat))
        .sort((a, b) => ordre[a.gravite] - ordre[b.gravite]);
      $('rp-list').innerHTML = list.length ? list.map((c) => `
        <article class="panel rp-item">
          <header><span class="rp-id">${c.id}</span><span class="rp-sev rp-${c.gravite}">${RAPPORT_GRAVITES[c.gravite]}</span><span class="tag">${RAPPORT_AXES[c.axe]}</span>${badge(c.statut)}<h3>${c.titre}</h3></header>
          <p class="rp-ou">${c.ou}</p>
          <dl>
            <dt>Constat</dt><dd>${c.constat}</dd>
            <dt>Effet</dt><dd>${c.effet}</dd>
            <dt>Solution choisie <small>(${RAPPORT_SUIVI.texte})</small></dt><dd>${c.solution}</dd>
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
    bindSeg('rp-stat', 'stat');
    render();

    // Mesure différée : la page s'affiche d'abord
    const timer = setTimeout(() => {
      const pct = (v) => Math.round(v * 100) + ' %';
      const rows = rapportMesureEog([3, 4, 5, 6, 7, 8, 10]);
      $('rp-eog').innerHTML = '<tr><th>Fréquence</th>' + rows.map((r) => `<th>${r.f} Hz</th>`).join('') + '</tr>'
        + '<tr><td>AF7 (front)</td>' + rows.map((r) => `<td>${pct(r.af7)}</td>`).join('') + '</tr>'
        + '<tr><td>TP9 (tempe)</td>' + rows.map((r) => `<td>${pct(r.tp9)}</td>`).join('') + '</tr>';
      const theta = rows.filter((r) => r.f >= 4 && r.f < 8), moy = theta.reduce((s, r) => s + r.af7, 0) / theta.length;
      $('rp-eog-note').textContent = `Au front, il reste en moyenne ${pct(moy)} de l’amplitude entre 4 et 7 Hz (theta). L’alpha (10 Hz) n’est pas touché. Hypothèse : un theta identique sur les 4 électrodes ; plus le theta réel est commun à AF7 et AF8, plus ce cas s’applique.`;
    }, 50);

    return () => clearTimeout(timer);
  },
});
})();
