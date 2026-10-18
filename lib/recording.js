/* Modèle d'enregistrement universel (globale `Recording`), aligné sur la norme BIDS pour l'EEG.
 * Indépendant de l'interface. Sert de format de stockage des échantillons et de base aux exports (lib/edf.js,
 * lib/bids.js). Références : docs/sources.html, réf. 37 (BIDS) et 38 (EDF+).
 *
 * Un enregistrement (objet simple, stockable tel quel dans IndexedDB) :
 *   {
 *     schema: 'muse2lab/recording', version: 2,
 *     n, name, createdAt (ISO), startTime (ISO, heure du 1er échantillon EEG), task, notes,
 *     profile, subject   profil qui a enregistré l'échantillon et son étiquette de sujet BIDS (posés à l'enregistrement)
 *     eeg:      champs de la fiche BIDS *_eeg.json (TaskName, SamplingFrequency, PowerLineFrequency, EEGReference,
 *               SoftwareFilters, Manufacturer, ManufacturersModelName, EEGChannelCount, MiscChannelCount,
 *               RecordingDuration, RecordingType, EEGPlacementScheme…)
 *     channels: lignes du tableau BIDS *_channels.tsv { name, type, units, description, sampling_frequency,
 *               low_cutoff, high_cutoff, notch, status, stream, index }
 *     events:   lignes du tableau BIDS *_events.tsv { onset (s), duration (s), trial_type, sample }
 *     streams:  { eeg: { rate, t: Float64Array (ms), data: [Float32Array × canaux] }, ppg?, accel?, gyro? }
 *     processing: { stored: 'brut' | 'filtré', stages: description des filtres appliqués (ou null) }
 *   }
 *
 * Création :
 *   Recording.fromArrays(recorder.freeze(), { n, name, task, notes, powerLine, include: { ppg, motion }, crop: { start, end },
 *                        pipeline (SignalPipeline à appliquer à l'EEG, ou null), events (ms absolus), detectGaps })
 * Référence : Recording.eegReference(car) -> 'Fpz' (brut, électrode du casque) ou 'average' (EEG stocké après CAR)
 * Découpe : Recording.slice(rec, début_s, fin_s, { n, name })   sous-échantillon (provenance dans rec.source)
 * Relecture : Recording.fromJSON(texte), Recording.fromEdf(octets, { n, name })   (EDF+ écrit par lib/edf.js ou compatible)
 * Export : Recording.toCSV(rec, 'eeg'), Recording.toJSON(rec), Recording.sidecar(rec),
 *          Recording.channelsTsv(rec), Recording.eventsTsv(rec), Recording.meta(rec)
 */
class Recording {
  static SCHEMA = 'muse2lab/recording';
  static VERSION = 2;
  static RATES = { eeg: 256, ppg: 64, accel: 52, gyro: 52 };

  // Canaux, types et unités BIDS. BIDS EEG n'a pas de type pour le mouvement : accéléromètre et gyroscope en MISC.
  static CHANNELS = {
    eeg: [
      { name: 'TP9', type: 'EEG', units: 'uV', description: 'Temporo-pariétal gauche (derrière l’oreille)' },
      { name: 'AF7', type: 'EEG', units: 'uV', description: 'Antéro-frontal gauche' },
      { name: 'AF8', type: 'EEG', units: 'uV', description: 'Antéro-frontal droit' },
      { name: 'TP10', type: 'EEG', units: 'uV', description: 'Temporo-pariétal droit (derrière l’oreille)' },
    ],
    ppg: [
      { name: 'PPG_ambiant', type: 'PPG', units: 'n/a', description: 'Capteur de pouls, lumière ambiante (valeur brute)' },
      { name: 'PPG_infrarouge', type: 'PPG', units: 'n/a', description: 'Capteur de pouls, infrarouge (valeur brute)' },
      { name: 'PPG_rouge', type: 'PPG', units: 'n/a', description: 'Capteur de pouls, rouge (valeur brute)' },
    ],
    accel: ['X', 'Y', 'Z'].map((a) => ({ name: 'ACC_' + a, type: 'MISC', units: 'g', description: 'Accéléromètre, axe ' + a })),
    gyro: ['X', 'Y', 'Z'].map((a) => ({ name: 'GYR_' + a, type: 'MISC', units: 'deg/s', description: 'Gyroscope, axe ' + a })),
  };

  // Noms d'événements (colonne trial_type), en ASCII pour rester lisibles par tous les logiciels
  static EVENT_TYPES = {
    blink: 'clignement', frown: 'sourcils', jaw: 'machoire', yawn: 'baillement',
    'gaze-left': 'regard_gauche', 'gaze-right': 'regard_droite', gap: 'interruption_flux',
    closed: 'yeux_fermes', rest: 'repos',
    'mental-relax': 'etat_detendu', 'mental-focus': 'etat_concentre', 'mental-drowsy': 'etat_somnolent', 'mental-neutral': 'etat_neutre', // étiquettes posées à la main (lib/annotation.js)
  };
  // Colonnes facultatives de *_events.tsv (annotations, lib/annotation.js) : écrites seulement si un événement les porte
  static EVENT_EXTRA = ['source', 'quality', 'precision', 'delay_ms'];

  // Valeur BIDS « EEGReference » : le casque mesure contre Fpz ; après la référence moyenne commune (piste 'car' de
  // SignalPipeline), les données stockées sont en référence moyenne, notée 'average' (valeur usuelle des exemples BIDS).
  static eegReference(car) {
    return car ? 'average' : 'Fpz';
  }

  /* ---------- Construction ---------- */

  static fromArrays(arrays, opts = {}) {
    const {
      n = 1, name = 'échantillon-' + n, task = 'libre', notes = '', powerLine = 50,
      include = { ppg: true, motion: true }, crop = null, pipeline = null, events = [], detectGaps = true,
      createdAt = new Date(),
    } = opts;
    const R = Recording.RATES;

    // EEG : base de temps du 1er canal, longueur commune aux 4 canaux
    const eegLen = Math.min(...arrays.eeg.map((c) => c.t.length));
    if (!eegLen) throw new Error('Aucun signal EEG en mémoire.');
    const t0 = arrays.eeg[0].t[0];
    const lastT = arrays.eeg[0].t[eegLen - 1] + 1000 / R.eeg;
    const startT = crop ? t0 + crop.start * 1000 : t0;
    const endT = crop ? Math.min(lastT, t0 + crop.end * 1000) : lastT;

    const cut = (t, channels, len) => {
      let a = 0, b = len;
      while (a < len && t[a] < startT) a++;
      while (b > a && t[b - 1] >= endT) b--;
      return { t: Float64Array.from(t.subarray(a, b)), data: channels.map((v) => Float32Array.from(v.subarray(a, b))) };
    };

    const streams = { eeg: { rate: R.eeg, ...cut(arrays.eeg[0].t, arrays.eeg.map((c) => c.v), eegLen) } };
    if (pipeline) streams.eeg.data = pipeline.processOffline(streams.eeg.data).map((v) => Float32Array.from(v));
    if (include.ppg && arrays.ppg) {
      const len = Math.min(...arrays.ppg.map((c) => c.t.length));
      if (len) streams.ppg = { rate: R.ppg, ...cut(arrays.ppg[0].t, arrays.ppg.map((c) => c.v), len) };
    }
    if (include.motion) {
      for (const k of ['accel', 'gyro']) {
        const a = arrays[k] && arrays[k][0];
        if (!a || !a.t.length) continue;
        const axes = [0, 1, 2].map((j) => Float32Array.from({ length: a.t.length }, (_, i) => a.v[i * 3 + j]));
        streams[k] = { rate: R[k], ...cut(a.t, axes, a.t.length) };
      }
    }

    const eeg = streams.eeg, start = eeg.t[0] || startT;
    const sampleAt = (ms) => { let i = 0; while (i < eeg.t.length - 1 && eeg.t[i] < ms) i++; return i; };
    const evs = events
      .filter((e) => e.start + e.duration > startT && e.start < endT)
      .map((e) => ({ onset: Math.max(0, (e.start - start) / 1000), duration: e.duration / 1000, trial_type: Recording.EVENT_TYPES[e.type] || e.type, sample: sampleAt(e.start) }));
    if (detectGaps) { // trous dans le flux EEG (coupure Bluetooth) : plus de 2 périodes entre deux échantillons
      for (let i = 1; i < eeg.t.length; i++) {
        const dt = eeg.t[i] - eeg.t[i - 1];
        if (dt > 2000 / R.eeg) evs.push({ onset: (eeg.t[i - 1] - start) / 1000, duration: dt / 1000, trial_type: Recording.EVENT_TYPES.gap, sample: i - 1 });
      }
    }
    evs.sort((a, b) => a.onset - b.onset);

    const channels = [];
    const filt = pipeline ? pipeline.cutoffs() : null;
    for (const k of Object.keys(streams)) {
      Recording.CHANNELS[k].forEach((c, index) => channels.push({
        ...c, sampling_frequency: R[k],
        low_cutoff: k === 'eeg' && filt && filt.low != null ? filt.low : 'n/a',
        high_cutoff: k === 'eeg' && filt && filt.high != null ? filt.high : 'n/a',
        notch: k === 'eeg' && filt && filt.notch ? filt.notch : 'n/a',
        status: 'good', stream: k, index,
      }));
    }
    const duration = eeg.t.length / R.eeg;

    return {
      schema: Recording.SCHEMA, version: Recording.VERSION,
      n, name, createdAt: createdAt.toISOString(), startTime: new Date(start).toISOString(), task, notes,
      eeg: {
        TaskName: task,
        TaskDescription: notes || undefined,
        Manufacturer: 'InteraXon',
        ManufacturersModelName: 'Muse 2',
        SamplingFrequency: R.eeg,
        PowerLineFrequency: powerLine,
        EEGReference: Recording.eegReference(!!pipeline && pipeline.isEnabled('car')),
        EEGPlacementScheme: 'Système 10-20 étendu : TP9, AF7, AF8, TP10',
        SoftwareFilters: pipeline ? pipeline.describe() : 'n/a',
        EEGChannelCount: 4,
        MiscChannelCount: (streams.accel ? 3 : 0) + (streams.gyro ? 3 : 0),
        RecordingDuration: +duration.toFixed(3),
        RecordingType: 'continuous',
      },
      channels,
      events: evs,
      streams,
      processing: { stored: pipeline ? 'filtré' : 'brut', stages: pipeline ? pipeline.describe() : null },
    };
  }

  // Ancien format d'échantillon (v1 : anneaux bruts) -> enregistrement v2
  static fromLegacy(old) {
    return Recording.fromArrays(old.streams, { n: old.n, name: old.name, createdAt: new Date(old.createdAt), task: 'inconnue', detectGaps: true });
  }

  /* ---------- Découpe et relecture ---------- */

  // Sous-échantillon entre deux instants (s, depuis le début de l'enregistrement)
  static slice(rec, start, end, { n = rec.n, name = rec.name + '-extrait', createdAt = new Date(), notes } = {}) {
    const t0 = rec.streams.eeg.t[0], a = t0 + start * 1000, b = t0 + end * 1000;
    const streams = {};
    for (const [k, s] of Object.entries(rec.streams)) {
      let i = 0, j = s.t.length;
      while (i < j && s.t[i] < a) i++;
      while (j > i && s.t[j - 1] >= b) j--;
      streams[k] = { rate: s.rate, t: s.t.slice(i, j), data: s.data.map((v) => v.slice(i, j)) };
    }
    const newStart = streams.eeg.t[0];
    const shift = (newStart - t0) / 1000;
    const events = rec.events
      .filter((e) => e.onset + e.duration > start && e.onset < end)
      .map((e) => {
        const on = Math.max(e.onset, start), off = Math.min(e.onset + e.duration, end);
        return { ...e, onset: +(on - shift).toFixed(4), duration: +(off - on).toFixed(4), sample: Math.max(0, e.sample - Math.round(shift * Recording.RATES.eeg)) };
      });
    const duration = streams.eeg.t.length / Recording.RATES.eeg;
    const why = notes || `Extrait de ${rec.name} (${start.toFixed(2)} → ${end.toFixed(2)} s)`;
    return {
      ...rec, n, name, createdAt: createdAt.toISOString(), startTime: new Date(newStart).toISOString(),
      notes: [rec.notes, why].filter(Boolean).join(' — '),
      eeg: { ...rec.eeg, RecordingDuration: +duration.toFixed(3), TaskDescription: [rec.notes, why].filter(Boolean).join(' — ') },
      channels: rec.channels.filter((c) => streams[c.stream]),
      events, streams,
      source: { name: rec.name, n: rec.n, start, end },
    };
  }

  // Relit le JSON produit par Recording.toJSON (listes -> tableaux typés)
  static fromJSON(input) {
    const rec = typeof input === 'string' ? JSON.parse(input) : input;
    if (rec.schema !== Recording.SCHEMA) throw new Error('Ce fichier n\u2019est pas un échantillon Muse 2 Lab.');
    for (const s of Object.values(rec.streams)) {
      s.t = Float64Array.from(s.t);
      s.data = s.data.map((v) => Float32Array.from(v));
    }
    return rec;
  }

  // Relit un fichier EDF/EDF+ : signaux reconnus par leur nom (TP9, AF7, AF8, TP10, PPG_*, ACC_*, GYR_*),
  // annotations -> événements. Les signaux inconnus sont ignorés.
  static fromEdf(bytes, { n = 1, name = 'import-edf' } = {}) {
    const edf = EdfWriter.read(bytes), h = edf.header;
    const [dd, mm, yy] = h.startdate.split('.').map(Number), [HH, MI, SS] = h.starttime.split('.').map(Number);
    const start = new Date(yy < 85 ? 2000 + yy : 1900 + yy, mm - 1, dd, HH, MI, SS).getTime();
    const streams = {}, channels = [];
    for (const [k, list] of Object.entries(Recording.CHANNELS)) {
      const found = list.map((c) => edf.signals.find((s) => s.label === c.name || s.label === 'EEG ' + c.name));
      if (found.some((s) => !s)) continue;
      const rate = found[0].perRecord / h.recordDuration, len = found[0].values.length;
      streams[k] = { rate, t: Float64Array.from({ length: len }, (_, i) => start + (i * 1000) / rate), data: found.map((s) => Float32Array.from(s.values)) };
      list.forEach((c, index) => channels.push({ ...c, sampling_frequency: rate, low_cutoff: 'n/a', high_cutoff: 'n/a', notch: 'n/a', status: 'good', stream: k, index }));
    }
    if (!streams.eeg) throw new Error('Aucun signal EEG reconnu (TP9, AF7, AF8, TP10) dans ce fichier EDF.');
    const events = edf.annotations.filter((a) => a.text).map((a) => ({ onset: a.onset, duration: a.duration, trial_type: a.text, sample: Math.round(a.onset * streams.eeg.rate) }));
    const prefilter = edf.signals.find((s) => s.label === 'TP9' || s.label === 'EEG TP9').prefilter;
    const filtered = prefilter && !/aucun|^$/i.test(prefilter);
    const duration = streams.eeg.t.length / streams.eeg.rate;
    return {
      schema: Recording.SCHEMA, version: Recording.VERSION, n, name, createdAt: new Date().toISOString(),
      startTime: new Date(start).toISOString(), task: 'import', notes: 'Importé depuis un fichier EDF',
      eeg: { TaskName: 'import', Manufacturer: 'InteraXon', ManufacturersModelName: 'Muse 2', SamplingFrequency: streams.eeg.rate,
        PowerLineFrequency: 'n/a', EEGReference: Recording.eegReference(filtered && /\bCAR\b/.test(prefilter)), SoftwareFilters: filtered ? { 'Prefiltrage EDF': { description: prefilter } } : 'n/a',
        EEGChannelCount: 4, MiscChannelCount: (streams.accel ? 3 : 0) + (streams.gyro ? 3 : 0), RecordingDuration: +duration.toFixed(3), RecordingType: 'continuous' },
      channels, events, streams,
      processing: { stored: filtered ? 'filtré' : 'brut', stages: filtered ? { 'Prefiltrage EDF': prefilter } : null },
    };
  }

  static meta(rec) {
    return { n: rec.n, name: rec.name, createdAt: Date.parse(rec.createdAt), seconds: rec.eeg.RecordingDuration, task: rec.task, stored: rec.processing.stored, events: rec.events.length, profile: rec.profile || null, subject: rec.subject || null };
  }

  /* ---------- Exports texte ---------- */

  // Fiche BIDS *_eeg.json (sans les champs vides)
  static sidecar(rec) {
    return JSON.parse(JSON.stringify(rec.eeg));
  }

  static _tsv(rows, cols) {
    const cell = (v) => (v == null || v === '' ? 'n/a' : Array.isArray(v) ? v.join(',') : String(v).replace(/[\t\n]/g, ' '));
    return [cols.join('\t'), ...rows.map((r) => cols.map((c) => cell(r[c])).join('\t'))].join('\n') + '\n';
  }

  static channelsTsv(rec) {
    return Recording._tsv(rec.channels, ['name', 'type', 'units', 'description', 'sampling_frequency', 'low_cutoff', 'high_cutoff', 'notch', 'status']);
  }

  static eventsTsv(rec) {
    const extra = Recording.EVENT_EXTRA.filter((k) => rec.events.some((e) => e[k] != null));
    return Recording._tsv(rec.events.map((e) => ({ ...e, onset: e.onset.toFixed(4), duration: e.duration.toFixed(4) })), ['onset', 'duration', 'trial_type', 'sample', ...extra]);
  }

  // CSV d'un flux : temps_ms, heure ISO, une colonne par canal
  static toCSV(rec, stream = 'eeg') {
    const s = rec.streams[stream];
    if (!s) return '';
    const chans = rec.channels.filter((c) => c.stream === stream);
    const lines = [['temps_ms', 'heure', ...chans.map((c) => `${c.name} (${c.units})`)].join(',')];
    for (let i = 0; i < s.t.length; i++) {
      lines.push([s.t[i].toFixed(1), new Date(s.t[i]).toISOString(), ...s.data.map((v) => +v[i].toFixed(4))].join(','));
    }
    return lines.join('\n');
  }

  // JSON complet (tableaux typés convertis en listes)
  static toJSON(rec) {
    return JSON.stringify(rec, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v));
  }
}
