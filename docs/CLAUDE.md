# docs/ — documentation (exigence de l'utilisateur : à jour à chaque fonctionnalité)

**Ne pas lire les pages en entier** (technique ≈ 75 Ko, science ≈ 50 Ko) : `python tools/sections.py docs/<page>.html` donne le
plan avec les numéros de lignes ; lire ou éditer seulement la section utile (`… <id> --brut` : son HTML numéroté, pour l'éditer).

`fonctionnement.html` (section Comprendre) = vue d'ensemble COURTE pour un visiteur (technologies, agencement, trajet des données ;
aucune valeur ni détail d'API) : à ne toucher que si l'architecture change. `technique.html` = référence détaillée, affichée dans la
section Développement (route `#/dev/technique`, entrée `page` de `CATALOGUE.dev`).

À chaque fonctionnalité :
1. `technique.html` : section dans la bonne partie (A ensemble · B briques lib/ dans l'ordre du trajet des données ·
   C projets et simulations · D travailler sur le code), commençant par `<p class="brief"><b>Rôle.</b> …</p>`.
2. `science.html` : explication physique / scientifique dans la bonne étape du chemin du signal (1 d'où vient le signal ·
   2 du casque à l'écran · 3 traiter · 4 artefacts · 5 interpréter) : `<p class="brief"><b>En bref.</b> …</p>` au début,
   `<p class="in-app">` (liens `../index.html#/p/<id>` avec `target="_top"`) à la fin ; simulation dans `sims.js` si utile.
3. `sources.html` : références numérotées à la suite (`id="rN"`), `tag-ok` « ✔ vérifiée » seulement si retrouvée en ligne,
   sinon `tag-todo` « à vérifier ».
4. `python tools/journal.py "…"` ; `README.md` (structure, tableau des projets).

`resultats.html` est organisée par thèmes (`<h2 id="theme-…">` : rappel des conditions de l'étude source, expériences en `<h3>`, conclusion du thème ; puis synthèse inter-thèmes). Après chaque expérience théorie/réalité, ajouter son bloc dans son thème (mesures et observations distinguées, rien d'inventé) ; nouveau sujet = nouveau thème.

Conventions :
- Numéros de section : `<h2 id="x"><span class="num">N</span> Titre</h2>` ; les renvois se font par lien `#id`
  (jamais par numéro en dur). Après insertion d'une section, renuméroter les `num` et le sommaire `toc-parts`.
- `sims.js` : `SIMS.<nom>(div)` pour `<div class="sim" id="sim-<nom>" data-sim="<nom>">` ; réutiliser le vrai code de `lib/`
  (les scripts lib nécessaires sont chargés en bas de `science.html`) ; tableau des simulations dans la section `sims` de la doc technique.
