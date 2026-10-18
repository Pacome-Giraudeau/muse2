---
description: Crée un nouveau projet (page) dans l'application
argument-hint: <nom et but du projet>
---
Nouveau projet : $ARGUMENTS

1. Lis `projets/CLAUDE.md` (contrat) et, comme modèle court, l'en-tête et le `mount` d'un projet existant proche.
2. Réutilise `lib/` et `ui/` : `python tools/entete.py lib ui` (une ligne par brique), puis `python tools/entete.py <fichier>`
   pour l'API des seules briques utiles (pas le code) ; toute logique réutilisable nouvelle va dans `lib/` avec un test.
   Si le projet demande une calibration : l'inscrire au registre `Calibrations` (`lib/calibrations.js`, voir `lib/CLAUDE.md`) pour qu'elle rejoigne la calibration générale.
3. Crée `projets/NN-nom/nom.js` (NN = numéro suivant), ajoute l'entrée de `app/catalogue.js` (statut, direct, demo).
4. Vérifie : `python tools/check.py`, puis une capture `python tools/shot.py "#/p/<id>" <fichier temporaire>.png` et regarde-la.
5. Documente avec `/maj-docs`.
