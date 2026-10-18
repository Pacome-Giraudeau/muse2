/* Tests de l'orientation de la tête (lib/head-pose.js) : gravité seule, gyroscope seul, fusion, biais, recentrage. */
(function () {
  const P = HeadPose;
  const feed = (pose, a, g, seconds, rate = 52) => {
    for (let i = 0; i < seconds * rate; i++) { pose.accel(a); pose.gyro(g, (feed.t += 1000 / rate)); }
  };
  feed.t = 0;
  const rad = (d) => (d * Math.PI) / 180;
  // Gravité lue par un capteur incliné : pitch (nez vers le bas) → ax = −sin, roll (tête à droite) → ay = cos(pitch)·sin.
  const grav = (pitch, roll) => ({ x: -Math.sin(rad(pitch)), y: Math.cos(rad(pitch)) * Math.sin(rad(roll)), z: Math.cos(rad(pitch)) * Math.cos(rad(roll)) });
  const still = { x: 0, y: 0, z: 0 };

  const t = P.tilt(grav(20, -30));
  check('tête : inclinaison tirée de la gravité', Math.abs(t.pitch - 20) < 0.5 && Math.abs(t.roll + 30) < 0.5, JSON.stringify(t));

  const a = new HeadPose();
  feed(a, grav(0, 0), still, 3);
  check('tête : immobile et droite = 0, 0, 0', Math.abs(a.angles.pitch) < 0.5 && Math.abs(a.angles.roll) < 0.5 && Math.abs(a.angles.yaw) < 0.5, JSON.stringify(a.angles));

  const b = new HeadPose();
  feed(b, grav(25, 10), still, 6);
  check('tête : l’accéléromètre seul donne pitch et roll', Math.abs(b.angles.pitch - 25) < 1 && Math.abs(b.angles.roll - 10) < 1, JSON.stringify(b.angles));

  const c = new HeadPose();
  feed(c, grav(0, 0), still, 1);
  feed(c, grav(0, 0), { x: 0, y: 0, z: 30 }, 2);   // 30 °/s pendant 2 s
  check('tête : le gyroscope intègre le lacet (≈ 60°)', Math.abs(c.angles.yaw - 60) < 4, JSON.stringify(c.angles));

  const d = new HeadPose();
  feed(d, grav(0, 0), still, 1);
  feed(d, grav(0, 0), { x: 0, y: 40, z: 0 }, 0.5);  // le nez descend vite
  check('tête : le gyroscope bouge vite le pitch avant que la gravité ne corrige', d.angles.pitch > 10, JSON.stringify(d.angles));
  feed(d, grav(0, 0), still, 6);
  check('tête : puis la gravité ramène le pitch à la réalité', Math.abs(d.angles.pitch) < 1.5, JSON.stringify(d.angles));

  const e = new HeadPose();
  feed(e, grav(0, 0), { x: 0, y: 0, z: 1.5 }, 40);  // biais de 1,5 °/s, tête immobile
  const yawBefore = e.angles.yaw;
  feed(e, grav(0, 0), { x: 0, y: 0, z: 1.5 }, 10);
  check('tête : le biais du gyroscope est absorbé (dérive du lacet freinée)', Math.abs(e.angles.yaw - yawBefore) < 2, `${yawBefore} → ${e.angles.yaw}`);

  const f = new HeadPose();
  feed(f, grav(15, 5), still, 6);
  f.recenter();
  check('tête : « recentrer » remet tout à zéro', Math.abs(f.angles.pitch) < 1e-9 && Math.abs(f.angles.roll) < 1e-9 && Math.abs(f.angles.yaw) < 1e-9);

  const g = new HeadPose();
  feed(g, grav(0, 0), still, 1);
  g.accel({ x: 1.5, y: 0, z: 1.5 });                // secousse : norme ≠ 1 g, ignorée pour la correction
  g.gyro(still, (feed.t += 20));
  check('tête : une secousse (norme ≠ 1 g) ne fausse pas l’inclinaison', Math.abs(g.angles.pitch) < 1, JSON.stringify(g.angles));
})();
