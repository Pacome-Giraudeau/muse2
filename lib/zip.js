/* Archive ZIP minimale, sans compression (méthode « stored »), noms de fichiers en UTF-8 (globale `ZipWriter`).
 * Sert à télécharger un dossier BIDS en un seul fichier. Lisible par tous les outils ZIP.
 *
 *   const bytes = ZipWriter.create([{ path: 'dossier/fichier.txt', data: 'texte' | Uint8Array }, …]);
 */
class ZipWriter {
  static _crcTable = null;

  static crc32(bytes) {
    if (!ZipWriter._crcTable) {
      ZipWriter._crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        ZipWriter._crcTable[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = ZipWriter._crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  static create(files, date = new Date()) {
    const enc = new TextEncoder();
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    const entries = files.map((f) => {
      const name = enc.encode(f.path), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      return { name, data, crc: ZipWriter.crc32(data) };
    });
    const localSize = entries.reduce((a, e) => a + 30 + e.name.length + e.data.length, 0);
    const centralSize = entries.reduce((a, e) => a + 46 + e.name.length, 0);
    const out = new Uint8Array(localSize + centralSize + 22), v = new DataView(out.buffer);
    let o = 0;
    const offsets = [];
    for (const e of entries) {
      offsets.push(o);
      v.setUint32(o, 0x04034b50, true); v.setUint16(o + 4, 20, true); v.setUint16(o + 6, 0x0800, true); // UTF-8
      v.setUint16(o + 8, 0, true); v.setUint16(o + 10, dosTime, true); v.setUint16(o + 12, dosDate, true);
      v.setUint32(o + 14, e.crc, true); v.setUint32(o + 18, e.data.length, true); v.setUint32(o + 22, e.data.length, true);
      v.setUint16(o + 26, e.name.length, true); v.setUint16(o + 28, 0, true);
      out.set(e.name, o + 30); out.set(e.data, o + 30 + e.name.length);
      o += 30 + e.name.length + e.data.length;
    }
    const cdStart = o;
    entries.forEach((e, i) => {
      v.setUint32(o, 0x02014b50, true); v.setUint16(o + 4, 20, true); v.setUint16(o + 6, 20, true); v.setUint16(o + 8, 0x0800, true);
      v.setUint16(o + 10, 0, true); v.setUint16(o + 12, dosTime, true); v.setUint16(o + 14, dosDate, true);
      v.setUint32(o + 16, e.crc, true); v.setUint32(o + 20, e.data.length, true); v.setUint32(o + 24, e.data.length, true);
      v.setUint16(o + 28, e.name.length, true); v.setUint16(o + 30, 0, true); v.setUint16(o + 32, 0, true);
      v.setUint16(o + 34, 0, true); v.setUint16(o + 36, 0, true); v.setUint32(o + 38, 0, true); v.setUint32(o + 42, offsets[i], true);
      out.set(e.name, o + 46);
      o += 46 + e.name.length;
    });
    v.setUint32(o, 0x06054b50, true); v.setUint16(o + 8, entries.length, true); v.setUint16(o + 10, entries.length, true);
    v.setUint32(o + 12, o - cdStart, true); v.setUint32(o + 16, cdStart, true);
    return out;
  }
}
