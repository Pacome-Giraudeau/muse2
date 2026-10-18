# tests/ — tests navigateur, sans casque

- Lancer : `python tools/check.py` (tout) ou `python tests/run_tests.py` (rapport détaillé). Ouvrir `tests/index.html` marche aussi.
- Un fichier `<sujet>.test.js` par brique ; l'ajouter à `tests/index.html` (avant `summary.js`, avec les `<script>` lib nécessaires).
- `check(nom, condition, détail)` ; tests asynchrones : `window.ASYNC_TESTS.push((async () => { … })().catch(…))`.
- Un test qui change le profil actif doit attendre les autres (voir `profiles.test.js`) et restaurer `Profiles.init({ prefix: 'muse2test' })`.
- Jamais les vrais réglages ni la vraie base : préfixe de profils `muse2test`, bases IndexedDB `muse2-test-*`.
- Signaux synthétiques : `SignalSimulator` (graine fixe → reproductible) ou `synth()` de `artifacts.test.js`.
