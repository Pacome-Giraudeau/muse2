/* Orientation de la tête à partir de l'accéléromètre et du gyroscope du casque (globale `HeadPose`). Sans interface.
 *
 *   const pose = new HeadPose();
 *   muse.on('accel', (a) => pose.accel(a));          // g
 *   muse.on('gyro',  (g) => pose.gyro(g));           // °/s ; chaque gyro fait avancer l'estimation
 *   pose.angles;       // { pitch, roll, yaw } en degrés, relatifs à la position de référence
 *   pose.recenter();   // la position actuelle devient la référence (0, 0, 0)
 *   pose.reset();      // tout oublier
 *
 * Repère supposé (NON vérifié sur le casque réel) : x vers le nez, y vers l'oreille gauche, z vers le haut, immobile
 * l'accéléromètre lit la gravité « vers le haut » (≈ +1 g sur z, casque droit).
 *   pitch > 0 : tête penchée vers l'avant (le nez descend) ; roll > 0 : tête penchée vers la droite ; yaw > 0 : tête tournée vers la gauche.
 * Méthode : filtre complémentaire. Le gyroscope donne les rotations rapides ; l'accéléromètre (direction de la gravité) corrige
 * lentement le pitch et le roll (constante de temps `tau`, 1 s), seulement quand la norme reste proche de 1 g (pas d'accélération
 * brusque). Le yaw n'a pas de référence absolue sans boussole : il vient du seul gyroscope et dérive lentement ; `recenter()` le remet à 0.
 * Le biais du gyroscope est estimé tant que la tête reste presque immobile.
 */
class HeadPose {
  constructor({ tau = 1 } = {}) {
    this.tau = tau;
    this.reset();
  }

  reset() {
    this._pitch = 0; this._roll = 0; this._yaw = 0;
    this._ref = { pitch: 0, roll: 0, yaw: 0 };
    this._bias = { x: 0, y: 0, z: 0 };
    this._acc = null;       // dernière accélération valide (g)
    this._lastT = null;
    this._fresh = true;     // première accélération : on s'aligne dessus d'un coup
  }

  /** Accélération en g ({x, y, z}). */
  accel(a) {
    const n = Math.hypot(a.x, a.y, a.z);
    this._acc = { x: a.x, y: a.y, z: a.z, still: n > 0.8 && n < 1.2 };
    if (this._fresh && this._acc.still) {
      const t = HeadPose.tilt(a);
      this._pitch = t.pitch; this._roll = t.roll; this._fresh = false;
    }
  }

  /** Vitesse angulaire en °/s ({x, y, z}) ; `t` en ms (par défaut l'horloge du navigateur). */
  gyro(g, t = performance.now()) {
    const dt = this._lastT == null ? 0 : Math.min(0.2, Math.max(0, (t - this._lastT) / 1000));
    this._lastT = t;
    if (!dt) return;
    // Biais : suivi lent tant que la vitesse reste faible.
    const calm = Math.abs(g.x - this._bias.x) < 3 && Math.abs(g.y - this._bias.y) < 3 && Math.abs(g.z - this._bias.z) < 3;
    if (calm) for (const k of ['x', 'y', 'z']) this._bias[k] += (g[k] - this._bias[k]) * Math.min(1, dt / 5);
    const wx = g.x - this._bias.x, wy = g.y - this._bias.y, wz = g.z - this._bias.z;
    this._roll += wx * dt;
    this._pitch += wy * dt;
    this._yaw += wz * dt;
    if (this._acc && this._acc.still) {
      const k = 1 - Math.exp(-dt / this.tau), m = HeadPose.tilt(this._acc);
      this._roll += (m.roll - this._roll) * k;
      this._pitch += (m.pitch - this._pitch) * k;
    }
  }

  /** Inclinaison déduite de la seule gravité : { pitch, roll } en degrés. */
  static tilt(a) {
    const d = 180 / Math.PI;
    return { pitch: Math.atan2(-a.x, Math.hypot(a.y, a.z)) * d, roll: Math.atan2(a.y, a.z) * d };
  }

  get angles() {
    return {
      pitch: this._pitch - this._ref.pitch,
      roll: this._roll - this._ref.roll,
      yaw: this._yaw - this._ref.yaw,
    };
  }

  recenter() { this._ref = { pitch: this._pitch, roll: this._roll, yaw: this._yaw }; }
}
