# Muse 2 Lab

**Muse 2 Lab** est une application web pour explorer, mesurer et comprendre les signaux du casque EEG **Muse 2** (4 électrodes EEG, pouls, mouvement). Tout tourne dans le navigateur (Web Bluetooth), sans installation ni dépendance : la connexion au casque reste ouverte d'un projet à l'autre.

## Fonctionnalités

- **Guide d'installation** : placement du casque, voyants, vérification du contact en direct, dépannage.
- **Capteurs en direct** : EEG, bandes de fréquences, qualité de contact par électrode, détection d'artefacts (clignements, sourcils, mâchoire, bâillements, regards), mouvement, orientation de la tête en 3D, pouls (PPG), qualité de la liaison.
- **Amélioration du signal** : six pistes activables (Hampel, filtres, correction des clignements EOG, référence moyenne commune…), tracé brut / amélioré, spectre, effet mesuré.
- **État mental** *(en travaux)* : détendu / concentré / somnolent / neutre, par rapport à une référence personnelle.
- **Étude d'échantillon** : visualisation, spectre, spectrogramme, statistiques, artefacts et états repérés automatiquement, export.
- **Calibration** : calibrations séparées ou enchaînées dans une calibration générale ludique, défi des gestes.
- **Jeu des artefacts** : course à 3 couloirs pilotée par le regard et les clignements, qui affine les seuils en jouant.
- **Regard** *(en travaux)* : théorie de l'œil-dipôle contre signal réel AF7 − AF8.
- **Annotation** *(en travaux)* : jeu de test annoté pour mesurer le détecteur d'artefacts.
- **Profils** : réglages, calibrations et échantillons par personne, export / import JSON.
- **Mémoire du signal et échantillons** : les 30 dernières secondes toujours conservées, échantillons figés exportables en EDF+, BIDS-EEG, CSV, JSON (lisibles par MNE-Python, EEGLAB, FieldTrip, EDFbrowser).
- **Mode démonstration** : signal simulé réaliste pour tout essayer sans casque.
- **Documentation intégrée** : fonctionnement, référence technique, science, résultats, sources, rapports critiques.
Projets autour du casque EEG Muse 2. Pur HTML/JS, sans build. **Lancement recommandé** (Chrome ou Edge) :

```
python serveur.py
```

Le navigateur s'ouvre sur `http://localhost:8000` et chaque échantillon est écrit automatiquement dans
**`muse2/echantillons/`**, sans rien choisir. Ouvrir directement `index.html` (`file://`) marche aussi, mais il faut alors
choisir le dossier `muse2/echantillons` une fois (et le Bluetooth peut y être bloqué). Les échantillons gardés
dans le navigateur sont propres à chaque adresse (`file://` et `localhost` ne partagent pas les mêmes) ; les profils, eux, sont
stockés avec `serveur.py` dans `profils/profils.json` (indépendants du port ; données personnelles, ne pas partager).

## Données personnelles
Le dépôt ne contient **pas** les profils (`profils/profils.json`) ni les enregistrements EEG (`echantillons/sub-*`, `sourcedata`, `experience`, `participants.tsv`) : ils sont créés localement au premier lancement de `python serveur.py` et exclus par `.gitignore`.

## Structure

```
muse2/
├── index.html          Coquille : en-tête (navigation + barre d'état du casque), zone <main id="view">, ordre des scripts
├── app/
│   ├── catalogue.js    CATALOGUE : projets, pages de doc, section Développement et rapports affichés sur l'accueil
│   └── shell.js        Routage par hash (#/, #/p/<id>, #/d/<id>, #/dev/<id>), registre Projets, montage/démontage
├── lib/                Logique réutilisable, SANS interface (ni DOM) — une globale par fichier
│   ├── profiles.js     Profils : réglages et échantillons par personne, persistants         → Profiles
│   ├── calibrations.js Registre de TOUTES les calibrations (lu par le projet Calibration)  → Calibrations
│   ├── muse.js         Bluetooth, décodage, paquets perdus, événements, reconnexion        → Muse
│   ├── signal.js       FFT, bandes EEG, utilitaires                                        → Signal
│   ├── artifacts.js    Clignements, sourcils, mâchoire, bâillements, regards               → ArtifactDetector
│   ├── calibration.js  Calibration guidée des seuils d'artefacts (mémorisée)               → Calibrator
│   ├── contact.js      Qualité de contact par électrode (dont « suspect »)                 → ContactQuality
│   ├── head-pose.js    Orientation de la tête (filtre complémentaire gyroscope + accéléromètre) → HeadPose
│   ├── filters.js      Amélioration du signal : étapes activables (Hampel, filtres, EOG, CAR) → SignalPipeline
│   ├── simulator.js    Signal de démonstration réaliste, sans casque                       → SignalSimulator
│   ├── recorder.js     Mémoire persistante des 30 dernières secondes (IndexedDB)           → SignalRecorder
│   ├── recording.js    Modèle d'enregistrement aligné sur BIDS (échantillons)              → Recording
│   ├── edf.js          Écriture / relecture EDF+                                           → EdfWriter
│   ├── bids.js         Dossier BIDS-EEG (EDF + JSON + TSV)                                 → Bids
│   ├── zip.js          Archive .zip sans compression                                       → ZipWriter
│   ├── mental-state.js Indices par électrode, rejet par segment, seuil perso, chronologie  → MentalState
│   ├── calibration-context.js Mesure partagée d'une séance de calibration                  → CalibrationContext
│   ├── step-calibrator.js     Base des calibrations par étapes (compte à rebours, états)    → StepCalibrator
│   ├── alpha-calibration.js   Profil alpha : réactivité yeux fermés, pic alpha individuel   → AlphaCalibrator
│   ├── mental-baseline.js     Référence personnelle de l'état mental                       → BaselineCalibrator
│   ├── gesture-challenge.js   Défi des gestes : vérifie la calibration en jeu              → GestureChallenge
│   ├── runner-game.js         Moteur du jeu de course aux artefacts (sans DOM)                    → RunnerGame
│   ├── dynamic-calibration.js Calibration dynamique des seuils pendant le jeu                    → DynamicCalibration
│   ├── gaze-model.js          Modèle du regard (attendu), mesure AF7 − AF8, analyse et verdict → GazeModel, GazeMeter
│   ├── gaze-calibration.js    Calibration « Regard étalonné » (registre)                    → GazeCalibrator
│   ├── server-dir.js   muse2/echantillons via serveur.py (imite un dossier choisi)        → ServerDir
│   └── sample-folder.js Écriture / lecture des échantillons dans muse2/echantillons        → SampleFolder
├── ui/                 Composants d'interface réutilisables (conteneur DOM + objet de lib/)
│   ├── status-bar.js         État, indice Bluetooth, batterie, boutons de connexion        → StatusBar
│   ├── head-map.js           Schéma de la tête, capteurs colorés par qualité               → HeadMap
│   ├── head-3d.js            Tête 3D en fil de fer suivant l'orientation du casque          → Head3D
│   ├── artifact-panel.js     Voyants, compteurs, niveaux, journal des artefacts            → ArtifactPanel
│   ├── calibration-panel.js  Consignes et résultats d'une calibration (toute calibration)  → CalibrationPanel
│   ├── calibration-stage.js  Scène ludique de la calibration générale                      → CalibrationStage
│   ├── gaze-target.js        Point sauteur des regards secs (calibration des artefacts)    → GazeTarget
│   ├── gaze-stage.js         Scène plein écran du test du regard (attendu / réel en direct) → GazeStage
│   ├── runner-stage.js       Canvas en perspective du jeu de course                              → RunnerStage
│   ├── pipeline-panel.js     Interrupteurs des pistes d'amélioration du signal             → PipelinePanel
│   ├── sample-dialog.js      Aperçu, durée gardée et réglages avant création d'un échantillon → SampleDialog
│   ├── signal-viewer.js      Visionneuse multi-voies : zoom, sélection, artefacts, états   → SignalViewer
│   ├── sensor-check.js       Bouton « Capteurs » du bandeau (vérification rapide)          → SensorCheck
│   └── profile-menu.js       Menu « 👤 » des profils                                       → ProfileMenu
├── projets/NN-nom/     Un dossier par projet interactif : <nom>.js (template + mount)
│   ├── 00-guide/       Guide d'installation du casque (premier du catalogue)
│   ├── 01-live/        Capteurs en direct
│   ├── 02-filtres/     Amélioration numérique du signal
│   ├── 03-etat/        État mental
│   ├── 04-etude/       Étude d'échantillon
│   ├── 06-calibration/ Calibration : séparées ou générale (ludique) + défi des gestes
│   ├── 07-jeu-artefacts/ Jeu des artefacts : course à 3 couloirs au regard et au clignement
│   ├── 08-regard/      Regard : théorie et réalité (attendu contre réel)
│   └── 09-annotation/  Annotation : jeu de test annoté (gestes étiquetés) pour mesurer le détecteur
├── dev/                Section « Développement » de l'accueil
│   ├── rapports.js     Rapports critiques : liste de tous les rapports établis
│   └── rapports/       Un fichier par rapport critique daté (AAAA-MM-JJ.js) : 2026-10-07, 2026-10-08
├── serveur.py          Lanceur : sert l'application et écrit les échantillons dans echantillons/
├── echantillons/       Échantillons enregistrés sur le disque (jeu de données BIDS) ; experience/<nom>/ = données brutes des expériences du projet Regard (signal.csv, meta.json)
├── docs/               Pages de documentation (HTML statique) : fonctionnement (vue d'ensemble), technique (référence détaillée, section Développement), science, resultats (expériences théorie vs réalité), sources ; sims.js = simulations
├── assets/             style.css (thème clair/sombre), docs.css (pages de doc)
├── tests/              index.html + *.test.js (sans casque) ; run_tests.py = lanceur en ligne de commande
├── tools/              Outils de développement : check.py, shot.py, sections.py, entete.py, journal.py
├── .claude/            Réglages et commandes de Claude Code (/verifier, /maj-docs, /nouveau-projet)
└── CLAUDE.md           Consignes pour Claude (+ un CLAUDE.md par dossier : lib, ui, projets, dev, docs, tests)
```

## Une seule page, une connexion partagée

Toute l'application vit dans `index.html` : changer de page (projet ou doc) ne recharge rien, donc **la connexion Bluetooth reste ouverte**
(une connexion Web Bluetooth meurt avec le document qui l'a créée). Le casque se connecte depuis la barre d'état de l'en-tête (`ui/status-bar.js`).
Un projet reçoit l'instance unique `muse` dans `mount(root, { muse })` et doit tout nettoyer dans la fonction qu'il retourne.
**Ne jamais lier vers un autre fichier .html** : utiliser les routes `#/…`.

## Tests

Ouvrir `tests/index.html` dans un navigateur, ou en ligne de commande :

| Commande | Rôle |
|---|---|
| `python tools/check.py` | tests + chargement de chaque page (erreurs JavaScript) — à lancer après toute modification |
| `python tests/run_tests.py` | rapport détaillé des tests |
| `python tools/shot.py "#/p/<id>" capture.png` | capture d'écran d'une page (option `--js` pour l'interroger) |
| `python tools/sections.py docs/technique.html [id] [--brut]` | plan d'une page de documentation, ou une section (HTML numéroté avec `--brut`) |
| `python tools/entete.py lib ui` | une ligne par brique ; avec un fichier `.js` : son API (en-tête) |
| `python tools/journal.py "texte"` | ajoute une ligne au journal des évolutions |

## Profils

Menu « 👤 » du bandeau : plusieurs profils (une personne, une configuration…), chacun avec ses calibrations (artefacts,
profil alpha, référence d'état mental), sa sensibilité, ses filtres et ses échantillons ; persistants d'une session à l'autre (avec `serveur.py` : fichier `profils/profils.json` ; sinon `localStorage`).
Export / import d'un profil en JSON. Dans les fichiers BIDS, chaque profil est un sujet (`sub-<profil>`).

## Mémoire du signal

Les 30 dernières secondes de signal brut (EEG, pouls, mouvement) sont enregistrées en permanence et conservées dans le
navigateur (IndexedDB), même après fermeture. Indicateur « ⏺ N s » dans l'en-tête ; clic = téléchargement CSV / JSON,
et « 📌 Créer un échantillon » : aperçu (brut / filtré, recadrage, événements détectés, métadonnées) puis copie figée
nommée `échantillon-N-AAAA-MM-JJ_HHhMM` (durée gardée au choix), conservée jusqu'à suppression — dans le navigateur et,
avec `python serveur.py` (ou une fois le dossier choisi en `file://`), dans **`muse2/echantillons/`** sur le disque (voir `echantillons/LISEZMOI.md`). Format aligné sur la norme **BIDS-EEG** ;
exports **EDF+**, dossier **BIDS** (.zip), CSV et JSON — lisibles par EDFbrowser, MNE-Python, EEGLAB, FieldTrip…

## Règles

- **Un projet = un dossier** `projets/NN-nom/`, référencé dans `app/catalogue.js` et chargé à la demande par `app/shell.js`.
- **Toute logique réutilisable va dans `lib/`** (sans DOM), **tout composant d'interface réutilisable dans `ui/`**. Un projet ne contient que la colle propre à sa page.
- Scripts classiques (pas de modules ES) pour que `file://` fonctionne. Chaque fichier de `lib/` expose une seule globale et documente son API dans son en-tête.
- Pas de dépendance externe, pas de build.
- Commentaires et interface en français.
- **À chaque ajout ou changement de fonctionnalité, mettre à jour `docs/technique.html`, `docs/science.html` et `docs/sources.html`** (et le journal des évolutions de la doc technique), ainsi que ce README.
- Consignes pour Claude : `CLAUDE.md` (court, chargé à chaque conversation) et un `CLAUDE.md` par dossier (chargé seulement quand on y travaille).

## Projets

| Dossier | Contenu |
|---|---|
| `projets/00-guide` | Guide d'installation : étapes, schémas des voyants et des capteurs, vérification du contact en direct, dépannage |
| `projets/02-filtres` | Amélioration numérique du signal : 6 pistes activables, tracé brut / amélioré, spectre, effet mesuré, mode démonstration |
| `projets/07-jeu-artefacts` | Jeu des artefacts (prêt) : course à 3 couloirs, regard = changer de couloir, clignement = sauter ; 3 niveaux ; mode « calibration dynamique » sans vies (on arrête quand on veut) qui affine les seuils en jouant ; démonstration ; non testé avec le casque réel |
| `projets/08-regard` | Regard : théorie et réalité (en travaux) : test de 38 s (point à suivre plein écran), attendu (théorie de l'œil-dipôle, calibration) contre réel AF7 − AF8 ; corrélation, gain, retard, affaissement, asymétrie, verdict ; calibration « Regard étalonné » ; démonstration ; non testé avec le casque réel |
| `projets/09-annotation` | Annotation (en travaux) : outil Gestes ou État mental (Détendu / Concentré / Somnolent / Neutre, fenêtres de 45 s, vérité approximative, comparaison automatique avec l'estimateur non faite) ; séance forcée (consigne) ou spontanée (touche maintenue), revue éditable, comparaison avec le détecteur d'artefacts (rappel, confusions, fausses alarmes), enregistrement en échantillon + dossier BIDS (`*_events.tsv`) ; démonstration (n'écrit pas sur le disque) ; le détecteur juge la forme des événements (durée, retour du regard, pouls), évalué sur 2 séances d'une personne (rappel 23/32 → 26/32 avec seuil de pouls simulé) ; une seule personne, pas de jeu de validation indépendant |
| `projets/04-etude` | Étude d'échantillon : visualisation, artefacts et états repérés automatiquement, sous-échantillons, spectre, spectrogramme, bandes, statistiques, export |
| `projets/03-etat` | État mental (en travaux) : détendu / concentré / somnolent / neutre, par rapport à une référence personnelle (seuil personnel, témoin musculaire, écarts θ/α/β) ; mode démonstration |
| `projets/01-live` | Connexion, EEG en direct (interrupteur « Amélioration numérique » reprenant les réglages de `02-filtres`), bandes de fréquences, schéma des capteurs et contact, artefacts + calibration, mouvement, position de la tête en 3D (bouton « Recentrer »), PPG, qualité de liaison |
| `projets/06-calibration` | Calibration : toutes les calibrations du registre, séparées ou enchaînées dans une calibration générale ludique (liste à cocher, vérification de la pose, consignes parlées, étoiles), défi des gestes, bilan et reprise des seules étapes ratées ; démonstration sans toucher au profil |

## Développement

Troisième section de l'accueil (route `#/dev/<id>`), à part des projets.

| Fichier | Contenu |
|---|---|
| `dev/rapports.js` | Rapports critiques : liste de tous les rapports établis, du plus récent au plus ancien, avec un lien vers chacun |
| `dev/rapports/2026-10-07.js` | Rapport critique du 7 octobre 2026 : architecture, cohérence scientifique et technique, constats par gravité, mesure en direct de l'effet de la piste clignements, recommandations ; suivi (statut et solution choisie de chaque constat, pris en compte le 8 octobre 2026) |
| `dev/rapports/2026-10-08.js` | Rapport critique n°2 du 8 octobre 2026 : revue par lecture du code (sans casque), vérification des corrections du 1er rapport, 10 constats nouveaux non traités (T4, S10 hautes), mesure en direct de l'écart d'instant causé par un trou de paquets |
