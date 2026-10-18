/* Dossier des échantillons sur le disque (globale `SampleFolder`) : muse2/echantillons/, organisé en jeu de données BIDS.
 * Par défaut (application lancée par `python serveur.py`) : le serveur écrit dans muse2/echantillons, sans rien demander
 * (lib/server-dir.js). Sinon (file://…), secours par l'API « File System Access » de Chrome / Edge : le navigateur ne
 * peut écrire que dans un dossier choisi par l'utilisateur ; on le choisit UNE fois, le lien est mémorisé (IndexedDB)
 * et le navigateur redemande seulement l'autorisation (un clic) lors d'une session suivante.
 *
 *   await SampleFolder.server()              // ServerDir de muse2/echantillons si serveur.py répond, sinon null
 *   SampleFolder.supported()                 // false hors Chrome / Edge (sélecteur de dossier)
 *   await SampleFolder.choose()              // ouvre le sélecteur de dossier (depuis un clic) et mémorise le choix
 *   await SampleFolder.status()              // { server, chosen, name, permission: 'granted' | 'prompt' | 'denied' | null }
 *   await SampleFolder.ensure(ask)           // dossier utilisable ? (serveur, sinon dossier choisi ; ask = true : demande
 *                                            // l'autorisation, depuis un clic)
 *   await SampleFolder.obtain()              // ensure(true), ou choose() si aucun dossier choisi (depuis un clic) ; null si refusé
 * Le dossier choisi est mémorisé PAR ADRESSE (file:// et http://localhost ont chacun le leur).
 *   await SampleFolder.write(rec)            // écrit l'échantillon (voir plus bas) ; retourne la liste des chemins
 *   await SampleFolder.writeExperiment(nom, [{ name, data }])   // écrit experience/<nom>/<fichiers> ; nom déjà pris : -2, -3… ; { name, paths }
 *   await SampleFolder.list()                // [{ file, name }] échantillons complets présents dans sourcedata/
 *   await SampleFolder.read(file)            // Recording relu depuis sourcedata/<file>
 *
 * Contenu du dossier (jeu de données BIDS, lisible par les logiciels EEG) :
 *   dataset_description.json, README, participants.tsv   créés s'ils n'existent pas (jamais écrasés ; un nouveau sujet
 *                                                        est seulement AJOUTÉ à participants.tsv)
 *   sub-<profil>/eeg/…                                    un sujet BIDS par profil
 *   sub-01/eeg/sub-01_task-<tâche>_run-<n>_eeg.edf / _eeg.json / _channels.tsv / _events.tsv
 *   sourcedata/<nom>.muse2.json                           échantillon complet (format interne, sans perte)
 * Supprimer un échantillon dans l'application NE supprime PAS ses fichiers du dossier (par prudence).
 */
const SampleFolder = {
  DB: 'muse2-dossier',
  KEY: 'echantillons',

  // Détecté une seule fois par page (promesse partagée)
  server() { return (SampleFolder._server = SampleFolder._server || ServerDir.detect()); },

  supported() { return typeof window !== 'undefined' && 'showDirectoryPicker' in window; },

  _db() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(SampleFolder.DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('handles');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async _store(mode, fn) {
    const db = await SampleFolder._db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('handles', mode), req = fn(tx.objectStore('handles'));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  },

  async handle() {
    try { return (await SampleFolder._store('readonly', (s) => s.get(SampleFolder.KEY))) || null; } catch (e) { return null; }
  },

  async choose() {
    if (!SampleFolder.supported()) throw new Error('Ce navigateur ne permet pas d’écrire dans un dossier (utilise Chrome ou Edge).');
    const h = await window.showDirectoryPicker({ id: 'muse2-echantillons', mode: 'readwrite', startIn: 'documents' });
    await SampleFolder._store('readwrite', (s) => s.put(h, SampleFolder.KEY));
    return h;
  },

  async forget() { await SampleFolder._store('readwrite', (s) => s.delete(SampleFolder.KEY)); },

  async status() {
    if (await SampleFolder.server()) return { server: true, chosen: true, name: 'echantillons', permission: 'granted' };
    const h = await SampleFolder.handle();
    if (!h) return { server: false, chosen: false, name: null, permission: null };
    let permission = 'prompt';
    try { permission = await h.queryPermission({ mode: 'readwrite' }); } catch (e) { /* ancien navigateur */ }
    return { server: false, chosen: true, name: h.name, permission };
  },

  // Renvoie le dossier s'il est utilisable ; avec ask = true, demande l'autorisation (doit venir d'un clic)
  async ensure(ask = false) {
    const srv = await SampleFolder.server();
    if (srv) return srv;
    const h = await SampleFolder.handle();
    if (!h) return null;
    if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return h;
    if (ask && (await h.requestPermission({ mode: 'readwrite' })) === 'granted') return h;
    return null;
  },

  // Comme ensure(true), mais ouvre le sélecteur si aucun dossier n'a encore été choisi (depuis un clic) ; null si annulé
  async obtain() {
    const srv = await SampleFolder.server();
    if (srv) return srv;
    if (!SampleFolder.supported()) return null;
    if (await SampleFolder.handle()) return SampleFolder.ensure(true);
    try { return await SampleFolder.choose(); } catch (e) { if (e.name === 'AbortError') return null; throw e; }
  },

  // Nom de fichier sûr sur tous les systèmes
  safe(name) { return String(name).replace(/[\\/:*?"<>|]/g, '_').trim() || 'echantillon'; },

  async _dir(root, parts) {
    let d = root;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create: true });
    return d;
  },

  async _exists(dir, name) {
    try { await dir.getFileHandle(name); return true; } catch (e) { return false; }
  },

  async _writeFile(root, path, data) {
    const parts = path.split('/'), name = parts.pop(), dir = await SampleFolder._dir(root, parts);
    const fh = await dir.getFileHandle(name, { create: true }), w = await fh.createWritable();
    await w.write(data);
    await w.close();
  },

  async write(rec, root = null) {
    root = root || (await SampleFolder.ensure(false));
    if (!root) throw new Error('Dossier des échantillons non choisi ou non autorisé.');
    const written = [];
    const subject = 'sub-' + Bids.label(rec.subject || '01');
    for (const f of Bids.datasetFiles({ subject: rec.subject || '01' })) {
      if (!(await SampleFolder._exists(root, f.path))) { await SampleFolder._writeFile(root, f.path, f.data); written.push(f.path); }
      else if (f.path === 'participants.tsv') { // ajoute le sujet s'il n'y figure pas encore (sans rien effacer)
        const text = await (await (await root.getFileHandle('participants.tsv')).getFile()).text();
        if (!text.split(/\r?\n/).includes(subject)) { await SampleFolder._writeFile(root, f.path, text.replace(/\s*$/, '\n') + subject + '\n'); written.push(f.path); }
      }
    }
    for (const f of Bids.recordingFiles(rec)) { await SampleFolder._writeFile(root, f.path, f.data); written.push(f.path); }
    const src = `sourcedata/${SampleFolder.safe(rec.name)}.muse2.json`;
    await SampleFolder._writeFile(root, src, Recording.toJSON(rec));
    written.push(src);
    return written;
  },

  // Enregistre une expérience (théorie contre réalité…) dans experience/<nom>/ : files = [{ name, data }]. Un nom déjà pris
  // reçoit un suffixe -2, -3… (rien n'est écrasé). Retourne { name, paths }.
  async writeExperiment(name, files, root = null) {
    root = root || (await SampleFolder.ensure(false));
    if (!root) throw new Error('Dossier des échantillons non choisi ou non autorisé.');
    const base = SampleFolder.safe(name).replace(/\s+/g, '-'), dir = await SampleFolder._dir(root, ['experience']);
    let unique = base, n = 1;
    for (;;) {
      let taken = false;
      try { await dir.getDirectoryHandle(unique); taken = true; } catch (e) { /* libre */ }
      if (!taken) break;
      unique = `${base}-${++n}`;
    }
    const paths = [];
    for (const f of files) { const path = `experience/${unique}/${f.name}`; await SampleFolder._writeFile(root, path, f.data); paths.push(path); }
    return { name: unique, paths };
  },

  async list(root = null) {
    root = root || (await SampleFolder.ensure(false));
    if (!root) return [];
    let dir;
    try { dir = await root.getDirectoryHandle('sourcedata'); } catch (e) { return []; }
    const out = [];
    for await (const [file, h] of dir.entries()) {
      if (h.kind === 'file' && file.endsWith('.muse2.json')) out.push({ file, name: file.replace(/\.muse2\.json$/, '') });
    }
    return out.sort((a, b) => b.name.localeCompare(a.name, 'fr', { numeric: true }));
  },

  async read(file, root = null) {
    root = root || (await SampleFolder.ensure(false));
    const fh = await (await root.getDirectoryHandle('sourcedata')).getFileHandle(file);
    return Recording.fromJSON(await (await fh.getFile()).text());
  },
};
