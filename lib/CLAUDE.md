# lib/ — briques de calcul

- Aucune dépendance au DOM (sauf `recorder.js`/`sample-folder.js` pour IndexedDB / File System Access). Une globale par fichier.
- L'en-tête de chaque fichier documente son API : le tenir à jour à chaque changement (c'est la doc lue en premier).
- Ordre de chargement : `profiles.js`, `calibrations.js` d'abord, puis chaque brique après celles qu'elle utilise ; même ordre
  dans `index.html` et `tests/index.html` (vérifié par `tools/check.py`).
- Chaque nouveau comportement : un test dans `tests/*.test.js` (voir `tests/CLAUDE.md`).

Repères :
- `muse.js` : événements `muse.on('eeg' | 'ppg' | 'accel' | 'gyro' | 'telemetry' | 'state' | 'gap' | 'resync')` ; `muse.link`, `muse.stats` (dont `lost`, `resyncs`) ; paquets EEG testables via `muse._onEegPacket(canal, dataView)`. Toute brique qui apparie les 4 canaux par rang (pipeline, détecteur, GazeMeter, CalibrationContext) DOIT se remettre à zéro sur `'resync'` (`reset()` / `resync()`). Deux sources de paquets, mêmes décodeurs (`_route`) : Web Bluetooth (`connect`) ou pont Python (`connectBridge`).
- `session-log.js` : journal de séance continu (1 ligne/s, bandes absolues par électrode, brut) ; envoi en ajout par `serveur.py` (`seances/`), sinon mémoire.
- `signal.js` : `Signal.onePoleCoef(fc, rate)` / `Signal.smoothCoef(tauS, rate)` pour tout filtre ou lissage d'ordre 1 (ne pas réécrire la formule).
- `filters.js` : `SignalPipeline` (6 étapes, `processOffline` compense le retard du FIR des clignements), réglages partagés `pipe.save()` / `SignalPipeline.loadSaved()` (profil actif).
- `artifacts.js` : seuils personnels via `calibration.js` (jamais de constantes devinées) ; `detectOffline` pour un enregistrement.
- `mental-state.js` : indices PAR ÉLECTRODE, chacune comparée à sa référence ; `measure` = rejet des artefacts par segment de 1 s (même règle `excludedFor` en direct et hors ligne), témoin musculaire sur le BRUT ; calcul d'état toujours sans la piste « eog » (`statePipeline`) ; seuils tirés de la référence (`thresholds`), anciennes références (version 2) toujours acceptées.
- `recording.js` : modèle aligné sur BIDS-EEG (champs `eeg` = `*_eeg.json`, `channels`, `events`) ; tout nouveau champ / flux a son équivalent BIDS. Garder le brut par défaut.
- `edf.js` : EDF+C, enregistrements de 1 s, 16 bits ; `EdfWriter.read` pour relire (tests).
- `calibrations.js` : REGISTRE. Nouvelle calibration = classe (souvent `extends StepCalibrator`, horloge manuelle pour les tests)
  + `Calibrations.register({ id, order, label, emoji, description, project, profileKey, steps, status, create })` en fin de
  fichier + clé dans `Profiles.KEYS` + test. Le test du registre vérifie le contrat. Rien à changer dans `projets/06-calibration`.
- `gaze-model.js` / `gaze-calibration.js` : protocole du regard (point à suivre, 38 s), `GazeMeter` (AF7 − AF8 à 64 Hz), `GazeModel.analyse` (corrélation, gain, retard, affaissement, asymétrie) ; calibration « regard » inscrite au registre (clés `gazeMap`, `gazeSetup`). Distincte de l'étape « Regard guidé » des artefacts (qui règle un seuil). Scène plein écran : `ui/gaze-stage.js`.
- `simulator.js` : `sim.act(geste)` joue un geste (démonstrations et tests des calibrations).
- `profiles.js` : `Profiles.sandbox(true)` pour une démonstration qui ne doit rien mémoriser. Nouvelle clé de réglage → l'ajouter à `Profiles.KEYS` + tableau de la doc technique (section `profils`).
- `recorder.js` : `saveRecording` pose `rec.profile` / `rec.subject` ; `listSamples()` = profil actif.
- `runner-game.js` / `dynamic-calibration.js` : jeu des artefacts (moteur sans horloge propre : `advance(ms)`) et affinage des seuils clignement / regard en jeu. La calibration dynamique AMÉLIORE la calibration « artefacts » déjà au registre (même clé `calibration`) : pas d'entrée de registre propre.
