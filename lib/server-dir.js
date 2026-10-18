/* Dossier muse2/echantillons servi par `python serveur.py` (globale `ServerDir`), sans choix ni autorisation.
 * Imite la partie de l'API « File System Access » qu'utilise lib/sample-folder.js (FileSystemDirectoryHandle), de sorte
 * que SampleFolder.write / list / read marchent à l'identique avec ce dossier ou un dossier choisi dans le navigateur.
 *
 *   const root = await ServerDir.detect()    // ServerDir de echantillons/ si le serveur répond, sinon null (file://…)
 *   await root.getDirectoryHandle(nom, { create })   // create = false : erreur si absent
 *   await root.getFileHandle(nom, { create })        // → { kind: 'file', name, getFile(), createWritable() }
 *   for await (const [nom, h] of root.entries()) …   // h.kind = 'file' | 'directory'
 * Échange avec le serveur : voir l'en-tête de serveur.py (GET / PUT sur /api/echantillons/…).
 */
class ServerDir {
  static API = 'api/echantillons';

  // fetchFn : pour les tests (faux serveur) ; sans lui, seulement si la page est servie en http(s)
  static async detect(fetchFn = null) {
    if (!fetchFn) {
      if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return null;
      fetchFn = (u, o) => fetch(u, o);
    }
    try {
      const r = await fetchFn(ServerDir.API, { cache: 'no-store' });
      if (!r.ok || !('dossier' in (await r.json()))) return null;
      return new ServerDir('', fetchFn);
    } catch (e) { return null; }
  }

  constructor(path, fetchFn) {
    this.kind = 'directory';
    this.path = path; // '' ou 'sourcedata/' (toujours terminé par '/')
    this.name = path ? path.slice(0, -1).split('/').pop() : 'echantillons';
    this._fetch = fetchFn;
  }

  _url(rel) { return ServerDir.API + '/' + (this.path + rel).split('/').map(encodeURIComponent).join('/'); }

  async _list() {
    const r = await this._fetch(this._url(''), { cache: 'no-store' });
    return r.ok ? r.json() : null;
  }

  async getDirectoryHandle(name, { create = false } = {}) {
    const d = new ServerDir(this.path + name + '/', this._fetch);
    if (!create && !(await d._list())) throw new DOMException(`${name} absent`, 'NotFoundError');
    return d; // avec create, le serveur crée le dossier à la première écriture
  }

  async getFileHandle(name, { create = false } = {}) {
    const url = this._url(name), fetchFn = this._fetch;
    if (!create && !(await fetchFn(url, { cache: 'no-store' })).ok) throw new DOMException(`${name} absent`, 'NotFoundError');
    return {
      kind: 'file', name,
      async getFile() {
        const r = await fetchFn(url, { cache: 'no-store' });
        if (!r.ok) throw new Error(`Lecture impossible : ${name}`);
        return r; // offre text() et arrayBuffer(), comme un File
      },
      async createWritable() {
        const parts = [];
        return {
          async write(data) { parts.push(data); },
          async close() {
            const r = await fetchFn(url, { method: 'PUT', body: new Blob(parts) });
            if (!r.ok) throw new Error(`Écriture refusée par le serveur : ${name}`);
          },
        };
      },
    };
  }

  async *entries() {
    for (const e of (await this._list()) || []) {
      yield [e.name, e.kind === 'directory' ? new ServerDir(this.path + e.name + '/', this._fetch) : await this.getFileHandle(e.name, { create: true })];
    }
  }
}
