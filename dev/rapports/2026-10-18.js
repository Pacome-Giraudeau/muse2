/* Rapport critique du 18 octobre 2026 (n° 3) : muse2 comparé au projet Muse-Realtime-Monitor (Projets/Muse-Realtime-Monitor,
 * ~300 lignes de Python : bleak + scipy + pyqtgraph, bandes de fréquences en direct et journal CSV). Listé dans
 * CATALOGUE.rapports, ouvert depuis Développement › Rapports critiques.
 * Revue faite par lecture du code des deux projets, sans casque réel et sans lancer Muse-Realtime-Monitor.
 * Tout est enveloppé dans une fonction : chaque rapport peut reprendre les mêmes noms sans collision.
 * Suivi : les constats (constat, effet, remède) gardent l'état du code à la rédaction ; la prise en compte est annotée par
 * RAPPORT_SUIVI (date) et, par constat, `statut` + `solution` (ce qui a réellement été fait). */
(function () {
// gravite : 'haute' | 'moyenne' | 'faible' ; axe : 'archi' | 'science' | 'tech'
const RAPPORT_CONSTATS = [
  { id: 'C1', axe: 'tech', gravite: 'haute', titre: 'L’acquisition n’existe que dans un navigateur, au clic, avec un onglet ouvert',
    ou: 'lib/muse.js, serveur.py, tests/run_tests.py',
    constat: 'Toute la chaîne dépend de Web Bluetooth : Chrome ou Edge uniquement, appel obligatoirement déclenché par un clic, onglet au premier plan. Muse-Realtime-Monitor passe par bleak (MuseProxy.py) : script lancé en ligne de commande, adresse MAC en argument, reconnexion en tâche de fond, aucune interface requise. muse2 a déjà un serveur Python (serveur.py), mais il ne sert qu’à écrire des fichiers.',
    effet: 'Impossible de laisser tourner une séance sans surveillance, de brancher MNE-Python ou scipy en direct, ou de tester l’acquisition sans navigateur ; Firefox et Safari sont exclus. Toute la fiabilité Bluetooth (T1, T4) repose sur la pile du navigateur, hors de notre contrôle.',
    remede: 'Garder le mode navigateur par défaut (zéro dépendance), mais prévoir un pont facultatif : un petit processus bleak qui sert les mêmes événements (eeg, accel, gyro, ppg, gap) par WebSocket local, branché derrière l’interface actuelle de Muse. Les projets n’y verraient aucune différence.',
    statut: 'partiel',
    solution: 'python serveur.py --pont [ADRESSE | simule] pilote le casque avec bleak (tools/pont_ble.py) et relaie les paquets BLE bruts au navigateur par un flux SSE (/api/pont) ; Muse.connectBridge() les rejoue dans les mêmes décodeurs (Muse._route), donc mêmes événements, et le bouton « Connecter via Python » n’apparaît que si le pont tourne. Vérifié de bout en bout, dans Chrome, avec un faux casque (--pont simule : 84 paquets/s, aucun perdu, journal écrit). Reste à faire : bleak n’est pas installé sur la machine de développement, le code BLE réel n’a jamais tourné avec un vrai Muse 2 ; Firefox et Safari non essayés.' },
  { id: 'C2', axe: 'science', gravite: 'haute', titre: 'Aucun enregistrement continu : 30 secondes en mémoire, le reste est manuel',
    ou: 'lib/recorder.js (SECONDS = 30), lib/recording.js, projets/01-live/live.js',
    constat: 'Le Monitor écrit une ligne de puissances de bande par seconde dans un CSV pendant toute la séance. muse2 ne garde que les 30 dernières secondes ; tout le reste dépend d’un échantillon figé à la main. Il n’y a ni journal de séance, ni série temporelle des bandes sur plusieurs minutes.',
    effet: 'On ne peut pas observer une dérive de vigilance, une séance de relaxation ou de méditation entière, ni éprouver le seuil d’état mental sur des durées réelles (c’est exactement ce que demande S10 du rapport n° 2). La mesure de référence de 30 s reste la seule base du seuil.',
    remede: 'Un journal de séance additif : une ligne par seconde (bandes absolues par électrode, contact, états d’artefact, trous de paquets), écrit en ajout par serveur.py, relu par la page Étude. Les échantillons BIDS restent pour les épisodes à analyser en détail.',
    statut: 'partiel',
    solution: 'lib/session-log.js : une ligne par seconde pendant toute la connexion (même fichier après une reconnexion), 4 électrodes × 5 bandes en µV², trous et resynchronisations notés, écrite en ajout dans seances/ par serveur.py (POST /api/seances/<nom>.csv) ou gardée en mémoire et téléchargeable sans serveur ; un envoi raté est retenté sans rien perdre. Reste à faire : la page Étude ne relit pas encore ces journaux ; les valeurs sont celles du signal brut, sans filtre ni rejet d’artefact.' },
  { id: 'C3', axe: 'science', gravite: 'moyenne', titre: 'Les bandes en direct sont relatives seulement, sans historique',
    ou: 'projets/01-live/live.js (updateBands), lib/signal.js (bandPowersFromPsd)',
    constat: 'Les barres affichent la part de chaque bande (somme = 100 %). Le Monitor trace la puissance absolue de chaque bande avec les 200 dernières valeurs, ce qui, malgré ses autres défauts, montre l’évolution. Dans muse2, seul État mental a un tracé d’historique ; les bandes de Capteurs en direct n’ont que la valeur du moment.',
    effet: 'Les parts sont liées entre elles : une dérive basse fréquence ou un clignement qui gonfle le delta fait « baisser » l’alpha sans que l’alpha ait changé. Sans valeur absolue ni historique, on ne peut pas voir si c’est la bande qui bouge ou le total.',
    remede: 'Bouton relatif / absolu (µV²/Hz, échelle log) et mini-courbe de 60 s par bande, calculée à partir du même Signal.welch (rien de plus à écrire côté lib/).',
    statut: 'corrigé',
    solution: 'Capteurs en direct : bascule Relatif (%) / Absolu (µV², barre logarithmique de 0,1 à 10 000 µV²), mémorisée dans le profil (clé liveBands), et mini-courbe des 60 dernières secondes sous chaque bande. Vu dans Chrome avec le pont simulé ; non vu sur un signal de casque réel.' },
  { id: 'C4', axe: 'archi', gravite: 'moyenne', titre: 'Le constat T4 (trous de paquets non traités) est toujours ouvert',
    ou: 'lib/muse.js (_onEegPacket), ui/status-bar.js, lib/filters.js',
    constat: 'Relu le 18 octobre : « gap » n’est émis que par lib/muse.js et aucun fichier de lib/, ui/, projets/ ou app/ ne s’y abonne. Le Monitor a le même type de défaut en pire (après une trame perdue, toutes les suivantes sont rejetées jusqu’à la reconnexion), mais muse2 est censé avoir une meilleure garantie, et le rapport n° 2 l’avait déjà identifié.',
    effet: 'Après un trou de plus d’une seconde sur un canal, les canaux sont combinés (CAR, regard, clignements) avec un décalage durable et silencieux.',
    remede: 'Celui du rapport n° 2 : un événement « resync » qui remet à zéro pipeline, détecteur, contact et journal, plus stats.lost dans la barre d’état. À faire avant d’ajouter quoi que ce soit (C1, C2).',
    statut: 'corrigé',
    solution: 'Muse émet « resync » après un trou non comblé et fait repartir les 4 canaux ensemble : départ commun = premier numéro qu’aucun canal n’a émis, paquets plus anciens écartés (au plus quelques-uns). Pipeline, détecteur d’artefacts, regard et calibrations se remettent à zéro à cet événement (ArtifactDetector.resync, GazeMeter.resync, CalibrationContext.resync) ; l’infobulle de la liaison affiche paquets perdus et resynchronisations. Testé sur paquets fabriqués (canaux alignés après un trou de 100 paquets) ; jamais observé sur casque réel.' },
  { id: 'C5', axe: 'archi', gravite: 'moyenne', titre: 'Le périmètre a dépassé ce que le casque a prouvé',
    ou: 'projets/ (9 projets), lib/ (~11 300 lignes de JS au total), docs/resultats.html',
    constat: 'Le Monitor fait une chose (bandes en direct + CSV) en ~300 lignes et s’arrête là. muse2 compte neuf projets dont trois « en travaux », et les modules les plus coûteux sont les moins validés : le regard a donné r = −0,06 sur casque réel (docs/science.html), le seuil d’état est sans confrontation au réel (S10), plusieurs seuils sont « choisis a priori » (docs/resultats.html). La règle « chaque fonctionnalité met à jour cinq documents » alourdit encore chaque ajout.',
    effet: 'Le cœur utile (capteurs en direct, qualité de contact, amélioration du signal, export BIDS) est enfoui parmi des fonctions expérimentales, et chaque correction (T4, S9, S10) rivalise avec de nouvelles fonctions pour le temps disponible.',
    remede: 'Geler regard et annotation tant qu’un essai réel ne les valide pas ; faire du « noyau » (live, filtres, export) le parcours principal de l’accueil, au niveau de simplicité du Monitor ; ne rouvrir les projets expérimentaux qu’avec un protocole d’essai écrit d’avance.',
    statut: 'non corrigé',
    solution: 'Non traité à cette date : c’est une décision de périmètre (geler le regard et l’annotation, remettre le noyau au premier plan), pas une correction de code.' },
  { id: 'C6', axe: 'archi', gravite: 'faible', titre: 'La première page du dépôt : README mélangé, pas de prérequis, pas de licence, pas d’avertissement',
    ou: 'README.md (lignes 1-30), racine du dépôt',
    constat: 'Le README commence par un BOM, puis la liste des fonctionnalités, puis, sans titre, un second paragraphe de présentation (« Projets autour du casque EEG… », ligne 20) : deux textes ont été assemblés. Il n’indique ni les prérequis (navigateur, Bluetooth de la machine, localhost contre file://) ni qu’il ne s’agit pas d’un dispositif médical. Le Monitor a ces trois éléments (prérequis, avertissement, licence MIT) ; muse2 n’a pas de fichier LICENSE.',
    effet: 'Sans licence, personne ne peut légalement réutiliser le code, même s’il est public. L’état mental (« détendu / concentré / somnolent ») affiché sans avertissement peut être pris pour une mesure clinique.',
    remede: 'Réécrire le haut du README : une phrase, trois étapes de démarrage, prérequis, avertissement non médical (déjà dans les docs), puis la structure. Ajouter un LICENSE (choix de l’autrice).',
    statut: 'corrigé',
    solution: 'README : avertissement non médical, démarrage en 3 étapes avec prérequis, lancement et fichiers, licence. Fichier LICENSE (MIT) ajouté. Titulaire : Pacôme Giraudeau. La licence MIT a été choisie à la place du créateur : à confirmer ou changer.' },
];

const RAPPORT_STATUTS = { 'corrigé': { label: 'Corrigé', css: 'ok' }, partiel: { label: 'Partiellement corrigé', css: 'part' }, 'non corrigé': { label: 'Non corrigé', css: 'non' } };
const RAPPORT_SUIVI = { date: '2026-10-18', texte: '18 octobre 2026' };
const RAPPORT_AXES = { archi: 'Architecture', science: 'Science', tech: 'Technique' };
const RAPPORT_GRAVITES = { haute: 'Haute', moyenne: 'Moyenne', faible: 'Faible' };

/* Comparaison point par point, relue dans le code. avantage : 'muse2' | 'monitor' | 'égal' */
const RAPPORT_COMPARE = [
  ['Mise en route', 'Python + 5 paquets, adresse MAC à copier dans le code (find_muse.py aide)', 'Aucune installation, sélecteur du navigateur', 'muse2'],
  ['Dépendances', 'requirements.txt non valide (« numpy&nbsp;&nbsp;pip install numpy » sur chaque ligne), versions libres', 'Aucune', 'muse2'],
  ['Paquets perdus', 'Une trame perdue : toutes les suivantes rejetées jusqu’à la reconnexion (last_tm n’avance plus)', 'Comblement jusqu’à ~1 s, compteurs, resynchronisation (mais voir C4)', 'muse2'],
  ['Prétraitement', 'Aucun : le 50 / 60 Hz et les clignements entrent dans les bandes', 'Secteur, passe-haut / bas, anti-pics, CAR, correction des clignements', 'muse2'],
  ['Bandes', '0,5–100 Hz : le gamma est surtout du bruit musculaire sur ce casque', '1–45 Hz, témoin musculaire séparé', 'muse2'],
  ['Canaux', 'Moyenne des 4 électrodes, tempes et front confondus', 'Par électrode, qualité de contact, rejet par segment', 'muse2'],
  ['Unités', 'Axe « µV² » pour une densité spectrale (µV²/Hz)', 'µV²/Hz documentés', 'muse2'],
  ['Tests', 'Aucun', '~325 tests navigateur + chargement des pages', 'muse2'],
  ['Honnêteté des limites', 'Aucune mention des limites (« fonctionnement stable » seulement)', 'Limites, sources et essais ratés consignés', 'muse2'],
  ['Fonctionnement sans interface', 'Oui (bleak, script)', 'Non', 'monitor'],
  ['Journal continu de séance', 'Oui (CSV, une ligne par fenêtre de 1 s)', 'Non, 30 s en mémoire', 'monitor'],
  ['Puissance absolue et historique des bandes', 'Oui (200 valeurs par bande)', 'Relatif seulement, pas d’historique', 'monitor'],
  ['Temps jusqu’au premier résultat', 'Quelques minutes une fois l’adresse connue', 'Quelques minutes, mais devant neuf projets', 'égal'],
  ['Licence, avertissement, prérequis', 'MIT, avertissement, prérequis', 'Aucun des trois dans le README', 'monitor'],
];
const RAPPORT_AVANTAGE = { muse2: 'muse2', monitor: 'Monitor', 'égal': 'égal' };

Projets.register({
  id: 'rapport-2026-10-18',

  template: `
    <header class="proj-head">
      <a class="back" href="#/dev/rapports">← Rapports critiques</a>
      <h1>Rapport critique n° 3 : muse2 face à Muse-Realtime-Monitor</h1>
    </header>
    <p class="intro">Troisième revue, le 18 octobre 2026. Comparaison faite par lecture du code des deux projets (Muse-Realtime-Monitor : main.py, proxies/MuseProxy.py, find_muse.py, README), sans casque réel et sans lancer le Monitor. Le Monitor sert de point de référence : très petit, il montre ce que muse2 a perdu en simplicité et en durée d’observation, tout en étant lui-même bien moins rigoureux.</p>

    <section class="panel rp-verdict">
      <h2 class="section">Verdict</h2>
      <p><b>muse2 est nettement plus rigoureux que le Monitor ; il lui manque ses trois qualités pratiques.</b> Sur le traitement du signal, la tenue aux pertes de paquets, la qualité par électrode, les tests et l’honnêteté scientifique, l’avantage est net (tableau ci-dessous). Mais le Monitor tourne sans interface (C1), enregistre toute une séance (C2) et montre l’évolution des bandes (C3), et muse2 non. Deux défauts viennent de muse2 lui-même : le trou de paquets signalé mais ignoré, déjà relevé il y a dix jours (C4), et un périmètre qui a pris de l’avance sur les essais réels (C5).</p>
      <div class="rp-counts" id="rp-counts"></div>
    </section>

    <section class="panel">
      <h2 class="section">Prise en compte</h2>
      <p>Constats traités le <b>${RAPPORT_SUIVI.texte}</b> (C1, C2, C3, C4, C6). Chaque constat porte son statut et la <b>solution choisie</b> ; le constat, l’effet et le remède restent ceux du jour de la revue. Tout est testé sur signaux et paquets fabriqués ; <b>rien n’a encore été essayé avec le casque réel</b>, et le pont bleak n’a jamais tourné avec un vrai Muse 2.</p>
      <div class="rp-counts" id="rp-statuts"></div>
    </section>

    <h2 class="section">Comparaison point par point</h2>
    <div class="panel"><table class="rp-table" id="rp-cmp"></table></div>

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

    <h2 class="section">Ce qu’il ne faut pas copier du Monitor</h2>
    <div class="panel">
      <ul>
        <li>L’adresse MAC écrite en dur dans main.py et une durée fixe de 5 minutes.</li>
        <li>Les <code>except:</code> nus et <code>except ValueError: pass</code> autour de l’écriture CSV : une erreur disparaît sans trace. Le fichier n’est de plus vidé sur le disque qu’à la fermeture, donc un arrêt brutal perd la séance.</li>
        <li>Le tampon <code>pending_samples</code> de MuseProxy, jamais purgé quand un canal manque : il grossit sans limite.</li>
        <li>Le paramètre <code>overlap</code> de la classe Buffer, accepté et jamais utilisé ; la docstring de MuseProxy annonce un tableau (canaux, échantillons) alors que le rappel reçoit (échantillons, canaux).</li>
        <li>Un état partagé au niveau du module (fichier ouvert à l’import, file, tampon) : le moindre import de main.py ouvre un fichier.</li>
      </ul>
    </div>

    <h2 class="section">Recommandations, par ordre de priorité</h2>
    <p class="hint">Recommandations du 18 octobre. Au ${RAPPORT_SUIVI.texte} : 1 à 4 traitées (la 2 sans relecture par la page Étude), 5 à faire, 6 faite sauf la vérification avec un vrai casque.</p>
    <ol class="rp-reco">
      <li><b>Fermer T4 / C4 d’abord.</b> Événement « resync » écouté par pipeline, détecteur, contact et journal ; stats.lost dans la barre d’état.</li>
      <li><b>Journal de séance continu (C2)</b>, écrit par serveur.py, avec les trous de paquets marqués (S9). C’est ce qui permet d’éprouver S10 sur de vraies durées.</li>
      <li><b>Bandes absolues et historique (C3)</b> : peu de code, grande valeur de lecture.</li>
      <li><b>README, prérequis, avertissement, LICENSE (C6)</b> : une heure de travail.</li>
      <li><b>Recentrer (C5)</b> : le noyau live + filtres + export comme parcours principal ; regard et annotation gelés jusqu’à un essai réel.</li>
      <li><b>Pont bleak facultatif (C1)</b>, seulement après les points précédents : c’est le plus gros chantier et il ne change pas les résultats scientifiques.</li>
    </ol>
    <p class="hint">Ce rapport n’a pas été confronté au casque réel et le Monitor n’a pas été exécuté : les défauts qui lui sont attribués viennent de la lecture de son code. Les constats sont à l’état « non traité » à la date de rédaction ; leur suivi est indiqué plus haut.</p>`,

  mount(root) {
    const $ = (id) => root.querySelector('#' + id);
    const filtre = { axe: '', grav: '' };
    const ordre = { haute: 0, moyenne: 1, faible: 2 };

    const n = (g) => RAPPORT_CONSTATS.filter((c) => c.gravite === g).length;
    $('rp-counts').innerHTML = Object.keys(RAPPORT_GRAVITES).map((g) => `<span class="rp-sev rp-${g}">${n(g)} ${RAPPORT_GRAVITES[g].toLowerCase()}${n(g) > 1 ? 's' : ''}</span>`).join('')
      + `<span class="hint">sur ${RAPPORT_CONSTATS.length} constats</span>`;
    const badge = (st) => `<span class="rp-statut rp-st-${RAPPORT_STATUTS[st].css}">${RAPPORT_STATUTS[st].label}</span>`;
    $('rp-statuts').innerHTML = Object.keys(RAPPORT_STATUTS).map((st) => {
      const ids = RAPPORT_CONSTATS.filter((c) => c.statut === st).map((c) => c.id);
      return `<span class="rp-statut rp-st-${RAPPORT_STATUTS[st].css}">${RAPPORT_STATUTS[st].label} : ${ids.length ? ids.join(', ') : '–'}</span>`;
    }).join('');
    $('rp-cmp').innerHTML = '<tr><th>Critère</th><th>Muse-Realtime-Monitor</th><th>muse2</th><th>Avantage</th></tr>'
      + RAPPORT_COMPARE.map(([crit, mon, mus, av]) => `<tr><td>${crit}</td><td>${mon}</td><td>${mus}</td><td><b>${RAPPORT_AVANTAGE[av]}</b></td></tr>`).join('');

    function render() {
      const list = RAPPORT_CONSTATS.filter((c) => (!filtre.axe || c.axe === filtre.axe) && (!filtre.grav || c.gravite === filtre.grav))
        .sort((a, b) => ordre[a.gravite] - ordre[b.gravite]);
      $('rp-list').innerHTML = list.length ? list.map((c) => `
        <article class="panel rp-item">
          <header><span class="rp-id">${c.id}</span><span class="rp-sev rp-${c.gravite}">${RAPPORT_GRAVITES[c.gravite]}</span><span class="tag">${RAPPORT_AXES[c.axe]}</span>${badge(c.statut)}<h3>${c.titre}</h3></header>
          <p class="rp-ou">${c.ou}</p>
          <dl>
            <dt>Constat</dt><dd>${c.constat}</dd>
            <dt>Effet</dt><dd>${c.effet}</dd>
            <dt>Remède proposé</dt><dd>${c.remede}</dd>
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
    render();
  },
});
})();
