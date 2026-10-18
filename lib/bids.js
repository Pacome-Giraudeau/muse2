/* Export d'un enregistrement au format BIDS-EEG (globale `Bids`) : un dossier prêt pour MNE-BIDS, EEGLAB, FieldTrip…
 * Norme : bids-specification.readthedocs.io (docs/sources.html, réf. 37).
 *
 *   Bids.files(rec, { subject: '01' })   // [{ path, data }] : arborescence BIDS complète pour un enregistrement
 *   Bids.datasetFiles(), Bids.recordingFiles(rec)   // racine du jeu de données / fichiers d'un enregistrement
 *   Bids.zip(rec, options)               // Uint8Array : la même arborescence dans un .zip
 *
 * Arborescence produite (exemple : tâche « repos », échantillon n° 3) :
 *   dataset_description.json  README  participants.tsv
 *   sub-01/eeg/sub-01_task-repos_run-3_eeg.edf       signaux (EDF+, lib/edf.js)
 *   sub-01/eeg/sub-01_task-repos_run-3_eeg.json      fiche d'enregistrement (champs BIDS obligatoires et recommandés)
 *   sub-01/eeg/sub-01_task-repos_run-3_channels.tsv  canaux : nom, type, unités, fréquence, filtres
 *   sub-01/eeg/sub-01_task-repos_run-3_events.tsv    événements (artefacts détectés, interruptions)
 * Le numéro d'échantillon sert d'index de « run » ; le sujet est l'étiquette du profil qui a enregistré (rec.subject).
 */
const Bids = {
  VERSION: '1.10.0',

  // Étiquette BIDS : lettres et chiffres uniquement
  label(s) { return EdfWriter.ascii(s).replace(/[^A-Za-z0-9]/g, '') || 'na'; },

  // Fichiers communs à tout le jeu de données (racine BIDS)
  datasetFiles({ subject = '01' } = {}) {
    const json = (o) => JSON.stringify(o, null, 2) + '\n';
    return [
      { path: 'dataset_description.json', data: json({
        Name: 'Muse 2 Lab - échantillons', BIDSVersion: Bids.VERSION, DatasetType: 'raw',
        GeneratedBy: [{ Name: 'Muse 2 Lab', Description: 'Application web de projets autour du casque Muse 2' }],
      }) },
      { path: 'README', data: 'Échantillons enregistrés avec un casque Muse 2 (InteraXon) par Muse 2 Lab.\n\n'
        + 'Organisation BIDS-EEG : sub-01/eeg/ contient, pour chaque échantillon, le signal (.edf, EDF+), sa fiche (_eeg.json), '
        + 'ses canaux (_channels.tsv) et ses événements (_events.tsv). Le numéro d\u2019échantillon sert d\u2019index de « run ».\n'
        + 'sourcedata/ contient chaque échantillon complet au format interne (.muse2.json : horodatages exacts, notes, réglages).\n' },
      { path: 'participants.tsv', data: `participant_id\nsub-${Bids.label(subject)}\n` },
    ];
  },

  // Fichiers propres à un enregistrement
  recordingFiles(rec, { subject = rec.subject || '01' } = {}) {
    const sub = 'sub-' + Bids.label(subject), base = `${sub}/eeg/${sub}_task-${Bids.label(rec.task)}_run-${rec.n}`;
    return [
      { path: base + '_eeg.edf', data: EdfWriter.write(rec) },
      { path: base + '_eeg.json', data: JSON.stringify(Recording.sidecar(rec), null, 2) + '\n' },
      { path: base + '_channels.tsv', data: Recording.channelsTsv(rec) },
      { path: base + '_events.tsv', data: Recording.eventsTsv(rec) },
    ];
  },

  files(rec, options = {}) {
    const o = { subject: rec.subject || '01', ...options };
    return [...Bids.datasetFiles(o), ...Bids.recordingFiles(rec, o)];
  },

  zip(rec, options) { return ZipWriter.create(Bids.files(rec, options)); },
};
