# Dossier des échantillons

Ce dossier reçoit les échantillons créés dans Muse 2 Lab (menu « ⏺ » → « 📌 Créer un échantillon »).

Pour que tout arrive ici sans rien demander, lancer l'application avec **`python serveur.py`** (dans `muse2/`) :
le serveur local écrit lui-même dans ce dossier.

Sans serveur (`index.html` ouvert directement), le navigateur ne peut écrire que dans un dossier choisi par
l'utilisateur : il faut alors **choisir ce dossier** une fois (le sélecteur s'ouvre au premier enregistrement). Si le
sélecteur est annulé, l'échantillon reste seulement dans le navigateur (visible dans l'application, absent d'ici).

Organisation (jeu de données BIDS-EEG, lisible par MNE-Python, EEGLAB, FieldTrip, EDFbrowser…) :

```
echantillons/
├── dataset_description.json, README, participants.tsv     description du jeu de données
├── sub-01/eeg/sub-01_task-<tâche>_run-<n>_eeg.edf          signaux (EDF+)
│                                    _eeg.json              fiche d'enregistrement
│                                    _channels.tsv          canaux
│                                    _events.tsv            événements (artefacts, interruptions)
└── sourcedata/<nom>.muse2.json                             échantillon complet, format interne (sans perte)
```

Supprimer un échantillon dans l'application ne supprime pas ses fichiers ici.
