---
description: Vérifie tout le projet (tests + pages) et résume le résultat
---
Lance `python tools/check.py` depuis la racine de muse2.
- Si tout passe : réponds en une ligne (nombre de tests, pages sans erreur).
- Sinon : pour chaque échec, ouvre seulement la zone concernée (`Read` avec offset/limit, `Grep -n`, pas le fichier entier), explique la cause probable et propose
  (ou applique si c'est sûr) la correction, puis relance `python tools/check.py`.
