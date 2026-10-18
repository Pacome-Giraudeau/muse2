---
description: Met à jour la documentation après un changement (technique, science, sources, journal, README)
argument-hint: [description du changement]
---
Changement à documenter : $ARGUMENTS (s'il est vide : les modifications faites dans cette conversation).

Délègue la rédaction à l'agent `redacteur-docs` (Sonnet, ne voit pas la conversation). Ne lis pas les pages de doc toi-même.
1. Écris-lui un brief autonome et court :
   - fichiers créés / modifiés et leur rôle ; nouvelle API (noms exacts) ; projet et route `#/p/<id>` concernés ;
   - ce qui change pour l'utilisateur ; principe scientifique ou physique en jeu ;
   - références à citer (auteurs, année, titre) ; ce qui n'a PAS été testé sur le casque réel ;
   - sections de doc probablement concernées si tu les connais.
2. Lance l'agent (premier plan : tu as besoin de son compte rendu).
3. Relaie à l'utilisateur la liste des sections modifiées et les points non documentés ; corrige si check échoue.
