# Muse 2 Lab

Application web (HTML/JS pur, sans build ni dépendance) de projets autour du casque EEG Muse 2, en français.
Un seul document (`index.html`) : la connexion Web Bluetooth survit aux changements de page (routes `#/…`).

## Commandes
- `python serveur.py [--port N] [--sans-navigateur] [--pont [ADRESSE|simule]]` — lance l'app sur localhost ; écrit les échantillons dans `echantillons/` et le journal de séance dans `seances/` (API dans son en-tête). `--pont` : casque piloté par Python/bleak (`tools/pont_ble.py`, `pip install bleak`) ; `--pont simule` = faux casque pour tester sans matériel.
- `python tools/check.py` — tests + chargement de toutes les pages (erreurs console). **À lancer avant de conclure.**
- `python tools/shot.py "#/p/<id>" <fichier.png> [--js "…"] [--wait 4]` — capture + évaluation JS (temps réel). Écrire la capture hors du dépôt.
- `python tools/sections.py docs/<page>.html [id] [--brut]` — plan d'une page de doc, ou une section (`--brut` : HTML numéroté, pour éditer).
- `python tools/entete.py lib ui` — une ligne par brique ; `python tools/entete.py <fichier.js>` — son API (en-tête).
- `python tools/journal.py "texte"` — ajoute une ligne datée au journal (doc technique).
- Commandes Claude : `/verifier`, `/maj-docs` (délègue à l'agent `redacteur-docs`, Sonnet), `/nouveau-projet <nom>`.

## Carte (une globale par fichier, API dans l'en-tête : `tools/entete.py`, pas le fichier entier)
- `app/` coquille : `shell.js` (routes, montage des projets), `catalogue.js` (cartes de l'accueil).
- `lib/` calcul sans DOM (signal, filtres, artefacts, état mental, enregistrement/BIDS, profils, registre des calibrations…).
- `ui/` composants d'interface réutilisables. `projets/NN-nom/` une page par projet. `dev/` section Développement (rapports critiques). `docs/` documentation (+ `sims.js`).
- `tests/` tests navigateur (`run_tests.py`). `tools/` outils de dev. `echantillons/` données BIDS sur le disque (ne pas lire).
- Règles détaillées par dossier (chargées en y travaillant) : `lib/`, `ui/`, `projets/`, `dev/`, `docs/`, `tests/` → `CLAUDE.md`.

## Règles essentielles
- Garder le dépôt **propre et lisible par un humain comme par une IA** : une responsabilité par fichier, noms explicites.
- Logique réutilisable → `lib/` (sans DOM) ; affichage réutilisable → `ui/` ; colle d'une page → `projets/`.
- **IMPORTANT : chaque fonctionnalité met à jour `docs/technique.html`, `docs/science.html`, `docs/sources.html`, le journal et `README.md`** (règles : `docs/CLAUDE.md`).
- Tout comportement nouveau de `lib/` a son test ; `python tools/check.py` doit passer.
- Réglages propres à une personne : `Profiles.get/set` (jamais `localStorage` directement).
- **Toute calibration s'inscrit au registre `Calibrations.register`** (`lib/calibrations.js`) : elle rejoint d'office le projet Calibration et la calibration générale.
- Scripts classiques (pas de modules ES, compat `file://`) ; nouvelles briques → balises `<script>` de `index.html` (ordre : lib, ui, app) et de `tests/index.html`.
- Honnêteté scientifique : ne marquer « vérifiée » qu'une source retrouvée en ligne ; dire ce qui n'a pas été testé sur le casque réel.

## Économie de contexte
- Lire le moins possible : `entete.py` / `sections.py`, puis `Read` avec offset/limit ou `Grep -n` sur la zone utile.
- Documentation : toujours via `/maj-docs` (agent Sonnet) plutôt qu'à la main dans la conversation principale.
- Recherche transversale (« où est utilisé X ? » sur beaucoup de fichiers) : agent `Explore`. Une recherche ciblée : `Grep` directement.
- Ne pas lancer d'agent pour une tâche de quelques appels (son démarrage coûte plus que la tâche) ni pour du code qui demande le contexte de la conversation.

## Pièges connus
- Chrome sans interface : `--virtual-time-budget` bloque IndexedDB → utiliser `tests/run_tests.py` / `tools/shot.py` (temps réel).
- Web Bluetooth et `showDirectoryPicker` / `requestPermission` exigent un clic : les appeler au tout début du gestionnaire de clic.
- Éditer du JS via un script Python ou `sed` : apostrophes et `\` déjà cassés plusieurs fois → préférer l'outil Edit, puis `tools/check.py`.
- `Muse.EEG_NAMES` = TP9, AF7, AF8, TP10 (front = indices 1, 2 ; tempes = 0, 3).
