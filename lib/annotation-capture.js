/* Capture longue du signal pour une séance d'annotation (globale `AnnotationCapture`). Sans interface.
 * La mémoire du casque (lib/recorder.js) ne garde que 30 s : une séance d'annotation dure plusieurs minutes. Cette brique
 * garde EEG (256 Hz) et pouls (64 Hz) pendant toute la séance (par défaut 15 min max, les plus anciennes secondes sont
 * perdues au-delà) SANS rien écrire sur le disque ni dans le navigateur : l'enregistrement final se fait à la fin.
 *
 *   const cap = new AnnotationCapture(muse | simulateur, { seconds: 900 });
 *   cap.start();   cap.stop();
 *   cap.seconds        secondes d'EEG gardées     cap.startedAt   Date.now() au démarrage
 *   cap.freeze()       { eeg: [{ t, v }×4], ppg: [{ t, v }×3] } — même forme que recorder.freeze(), pour Recording.fromArrays
 * Horodatage identique à lib/recorder.js : chaque échantillon suit le précédent de 1/fréquence, recalé sur l'heure d'arrivée
 * seulement si elle est plus tardive. Même base de temps (Date.now()) que les annotations et les détections.
 */
class AnnotationCapture {
  static RATES = { eeg: 256, ppg: 64 };

  constructor(bus, { seconds = 900 } = {}) {
    this.bus = bus;
    this.cap = seconds;
    this.startedAt = null;
    this._offs = [];
    this._rings = {
      eeg: [0, 1, 2, 3].map(() => new TimedRing(seconds * AnnotationCapture.RATES.eeg, 1)),
      ppg: [0, 1, 2].map(() => new TimedRing(seconds * AnnotationCapture.RATES.ppg, 1)),
    };
  }

  start() {
    this.stop();
    this.startedAt = Date.now();
    const add = (name) => (ch, samples) => {
      const rate = AnnotationCapture.RATES[name], ring = this._rings[name][ch], now = Date.now();
      samples.forEach((s, i) => {
        const last = ring.length ? ring.t[(ring.start + ring.length - 1) % ring.cap] : -Infinity;
        ring.push(Math.max(last + 1000 / rate, now - ((samples.length - 1 - i) * 1000) / rate), [s]);
      });
    };
    this._offs = [this.bus.on('eeg', add('eeg')), this.bus.on('ppg', add('ppg'))];
  }

  stop() {
    this._offs.forEach((off) => off && off());
    this._offs = [];
  }

  get seconds() { return this._rings.eeg[0].length / AnnotationCapture.RATES.eeg; }

  freeze() {
    return { eeg: this._rings.eeg.map((r) => r.toArrays()), ppg: this._rings.ppg.map((r) => r.toArrays()) };
  }
}
