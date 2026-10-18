# dev/ — section « Développement » de l'accueil

Pages sur la fabrication de l'application, à part des projets. Route `#/dev/<id>`, même contrat qu'un projet
(`Projets.register`, voir `projets/CLAUDE.md`).
- `rapports.js` : page « Rapports critiques », liste construite depuis `CATALOGUE.rapports` (rien à y modifier).
- `rapports/AAAA-MM-JJ.js` : un rapport critique daté.

Ajouter un rapport critique :
1. `dev/rapports/AAAA-MM-JJ.js`, id `rapport-AAAA-MM-JJ`, lien retour `#/dev/rapports`. Tout le fichier dans
   `(function () { … })();` (sinon `const RAPPORT_CONSTATS` entre en collision avec le rapport précédent).
2. Entrée dans `CATALOGUE.rapports` (`app/catalogue.js`) : `id, date ('AAAA-MM-JJ'), titre, description, emoji, script`.
3. Ne pas modifier les constats des anciens rapports (`constat`, `effet`) : ils gardent l'état du code au jour de la revue.
   Seul le SUIVI s'annote : `RAPPORT_SUIVI` (date de prise en compte) et, par constat, `statut`
   ('corrigé' | 'partiel' | 'non corrigé') + `solution` (solution choisie, qui remplace le remède). Modèle : `rapports/2026-10-07.js`.

La documentation technique (`docs/technique.html`) est aussi dans `CATALOGUE.dev`, avec `page` au lieu de `script`.

Ajouter une autre page Développement : `dev/<nom>.js` + entrée dans `CATALOGUE.dev`.
