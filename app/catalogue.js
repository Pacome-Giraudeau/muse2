/* Catalogue de l'application : tout ce qui apparaît sur la page d'accueil. Globale `CATALOGUE`.
 *
 * Ajouter un projet : créer projets/NN-nom/<nom>.js (qui appelle Projets.register, voir app/shell.js), puis
 * ajouter une entrée dans `projets` ci-dessous.
 * Étiquettes d'un projet : `statut` = 'prêt' | 'en travaux' ; `direct` = true s'il fonctionne avec le casque (étiquette « casque ») ;
 * `demo` = true s'il propose une démonstration utilisable sans casque. Les descriptions ne parlent pas de ces modes :
 * les étiquettes s'en chargent.
 * Ajouter une page de documentation : créer docs/<nom>.html puis une entrée dans `docs` (vue d'ensemble) ou dans `dev`
 * avec `page` au lieu de `script` (documentation de référence, route #/dev/<id>).
 * Section « Développement » (`dev`) : pages sur la fabrication de l'application (dossier dev/, route #/dev/<id>, même
 * contrat qu'un projet). `rapports` : rapports critiques datés, listés par la page dev/rapports.js et ouverts en
 * #/dev/<id> ; ajouter un rapport = créer dev/rapports/AAAA-MM-JJ.js + une entrée ici (date au format AAAA-MM-JJ).
 */
const CATALOGUE = {
  projets: [
    {
      id: 'guide',
      titre: "Guide d'installation du casque",
      description: 'Charger, allumer, poser et connecter le Muse 2 : schémas des voyants et des capteurs, vérification du contact en direct, dépannage.',
      emoji: '🎧',
      statut: 'prêt', direct: true, demo: false,
      script: 'projets/00-guide/guide.js',
    },
    {
      id: 'live',
      titre: 'Capteurs en direct',
      description: 'EEG, bandes de fréquences, schéma des capteurs et du contact, artefacts (clignements, sourcils, mâchoire, bâillements, regards) avec calibration, mouvement, pouls.',
      emoji: '🧠',
      statut: 'prêt', direct: true, demo: false,
      script: 'projets/01-live/live.js',
    },
    {
      id: 'filtres',
      titre: 'Amélioration numérique du signal',
      description: 'Six pistes activables (anti-pics, dérive, secteur 50 Hz, passe-bas, clignements, référence moyenne) : tracé brut / amélioré, spectres, bandes et mesures de l’effet de chaque piste.',
      emoji: '🎛️',
      statut: 'prêt', direct: true, demo: true,
      script: 'projets/02-filtres/filtres.js',
    },
    {
      id: 'etat',
      titre: 'État mental',
      description: 'Détendu, concentré, somnolent ou neutre : un indicateur simple tiré des bandes theta, alpha et bêta, comparées à ta propre référence.',
      emoji: '🧘',
      statut: 'en travaux', direct: true, demo: true,
      script: 'projets/03-etat/etat.js',
    },
    {
      id: 'etude',
      titre: "Étude d'échantillon",
      description: 'Visualiser un échantillon enregistré, repérer automatiquement artefacts et états mentaux, sélectionner un sous-échantillon : spectre, spectrogramme, bandes, statistiques, export.',
      emoji: '🔍',
      statut: 'prêt', direct: false, demo: true,
      script: 'projets/04-etude/etude.js',
    },
    {
      id: 'calibration',
      titre: 'Calibration',
      description: 'Toutes les calibrations au même endroit : une par une, ou enchaînées dans une calibration générale ludique (gestes, profil alpha, référence d’état mental) avec un défi final.',
      emoji: '🎯',
      statut: 'prêt', direct: true, demo: true,
      script: 'projets/06-calibration/calibration.js',
    },
    {
      id: 'jeu-artefacts',
      titre: 'Jeu des artefacts',
      description: 'Une course façon Temple Run : regarde à gauche ou à droite pour changer de couloir, cligne des yeux pour sauter. Trois niveaux, et une calibration dynamique qui affine tes seuils de clignement et de regard pendant que tu joues.',
      emoji: '🏃',
      statut: 'prêt', direct: true, demo: true,
      script: 'projets/07-jeu-artefacts/jeu-artefacts.js',
    },
    {
      id: 'regard',
      titre: 'Regard : théorie et réalité',
      description: 'L’écart AF7 − AF8 suit-il vraiment l’angle du regard ? Explication, calibration avec un point à suivre, puis test en direct qui compare ce que la théorie attend à ce que le casque mesure.',
      emoji: '👀',
      statut: 'en travaux', direct: true, demo: true,
      script: 'projets/08-regard/regard.js',
    },
    {
      id: 'annotation',
      titre: 'Annotation',
      description: 'Construire un jeu de test annoté : l’application demande des gestes (clignement, sourcils, regard…) ou un état mental (détendu, concentré, somnolent), ou tu marques toi-même ce que tu fais ou ressens, puis revue, comparaison avec le détecteur et enregistrement au format BIDS.',
      emoji: '🏷️',
      statut: 'en travaux', direct: true, demo: true,
      script: 'projets/09-annotation/annotation.js',
    },
  ],
  docs: [
    {
      id: 'fonctionnement',
      titre: 'Fonctionnement de l\'app',
      description: 'Vue d\'ensemble technique, sans les détails : technologies utilisées, organisation du code, trajet des données du casque à l\'écran.',
      emoji: '⚙️',
      page: 'docs/fonctionnement.html',
    },
    {
      id: 'science',
      titre: 'Comprendre la science',
      description: 'Ce qui se passe physiquement : EEG, électrodes, filtres, spectre, artefacts, pouls, Bluetooth.',
      emoji: '🔬',
      page: 'docs/science.html',
    },
    {
      id: 'resultats',
      titre: 'Résultats : théorie vs réalité',
      description: 'Les expériences menées avec le casque pour vérifier la théorie : modalités, résultats obtenus et conclusion de chacune.',
      emoji: '🧪',
      page: 'docs/resultats.html',
    },
    {
      id: 'sources',
      titre: 'Sources et littérature',
      description: 'Références scientifiques et techniques utilisées, avec leur état de vérification.',
      emoji: '📚',
      page: 'docs/sources.html',
    },
  ],
  dev: [
    {
      id: 'technique',
      titre: 'Documentation technique & specs',
      description: 'La documentation de référence du code : dossiers, fichiers, API, valeurs et seuils, formats, tests, pièges, journal des évolutions.',
      emoji: '🛠️',
      page: 'docs/technique.html',
    },
    {
      id: 'rapports',
      titre: 'Rapports critiques',
      description: 'Tous les rapports critiques établis sur l’application : architecture, cohérence scientifique et technique, constats et recommandations.',
      emoji: '📝',
      script: 'dev/rapports.js',
    },
  ],
  rapports: [
    {
      id: 'rapport-2026-10-07',
      date: '2026-10-07',
      titre: 'Rapport critique du 7 octobre 2026',
      description: 'Revue de l’architecture et de la cohérence scientifique et technique : points forts, 15 constats classés par gravité, mesure en direct, recommandations. Pris en compte le 8 octobre 2026 : 12 corrigés, 2 partiellement, 1 non corrigé.',
      emoji: '📝',
      script: 'dev/rapports/2026-10-07.js',
    },
    {
      id: 'rapport-2026-10-08',
      date: '2026-10-08',
      titre: 'Rapport critique n° 2 du 8 octobre 2026',
      description: 'Deuxième revue de l’ensemble de l’application, après les corrections du premier rapport : vérification de ces corrections, 10 nouveaux constats (trous de paquets non traités, seuil d’état jamais éprouvé, serveur local, colle non testée), mesure en direct.',
      emoji: '🔎',
      script: 'dev/rapports/2026-10-08.js',
    },
  ],
};
