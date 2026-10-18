# projets/ — une page par projet

Contrat (`projets/NN-nom/<nom>.js`, chargé à la demande par `app/shell.js`) :
```js
Projets.register({
  id: 'nom',
  template: `…HTML…`,
  mount(root, { muse, recorder, params }) { …; return () => { /* TOUT nettoyer : off(), clearInterval, cancelAnimationFrame, destroy() */ }; },
});
```
- `muse`, `recorder` : instances uniques (ne jamais en créer). `params` : segments après `#/p/<id>/`.
- Sélecteurs limités à `root` (`root.querySelector`). Pas de navigation vers un autre fichier HTML.
- Réutiliser `lib/` et `ui/` ; une logique réutilisable va dans `lib/`, pas ici.
- Démonstration sans casque : `SignalSimulator` (gains theta/alpha/bêta réglables en marche, `act(geste)`) ; si elle écrit des réglages : `Profiles.sandbox(true)`.
- Un projet qui a besoin d'une calibration l'écrit dans `lib/` et l'inscrit au registre `Calibrations` (voir `lib/CLAUDE.md`) : pas de calibration propre à une page.

Ajouter un projet (ou utiliser la commande `/nouveau-projet`) :
1. `projets/NN-nom/nom.js`.
2. Entrée dans `app/catalogue.js` : `id, titre, description, emoji, statut ('prêt' | 'en travaux'), direct, demo, script`.
   Les descriptions ne mentionnent pas les modes (les étiquettes s'en chargent).
3. Tableau « Projets » de `README.md` ; docs (voir `docs/CLAUDE.md`).
