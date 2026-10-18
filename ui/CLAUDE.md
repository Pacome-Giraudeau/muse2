# ui/ — composants d'interface réutilisables

- Contrat : `new Composant(conteneur, objetDeLib, options)` ; le composant écrit son HTML dans le conteneur.
- S'il crée des minuteries ou prend un rappel d'un objet (`detector.onEvent`, `calibrator.onProgress`…), il expose `destroy()`.
- Styles dans `assets/style.css` (section commentée au nom du composant), couleurs via les variables CSS (`--accent`, `--muted`…).
- Composants du bandeau (vivent toute la session, créés par `app/shell.js`) : `StatusBar`, `SensorCheck`, `ProfileMenu`.
- Autres : `HeadMap`, `ArtifactPanel`, `CalibrationPanel`, `PipelinePanel`, `SampleDialog`, `SignalViewer`, `RunnerStage` (scène du jeu des artefacts).
- Nouveau composant : balise `<script>` dans `index.html` (après lib/, avant app/) + ligne dans le tableau de la section `ui` de `docs/technique.html`.
