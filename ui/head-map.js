/* Schéma de la tête vue de dessus avec les 4 capteurs colorés selon la qualité du contact (globale `HeadMap`).
 *
 *   const map = new HeadMap(document.getElementById('headmap'));
 *   map.update(contact.levels);   // tableau { rms, score, label } dans l'ordre Muse.EEG_NAMES (voir lib/contact.js)
 *
 * Couleurs : bon = vert, moyen = orange, mauvais et suspect (signal trop faible) = rouge, absent = gris (classes .hm-* dans assets/style.css).
 */
class HeadMap {
  // Coordonnées dans le viewBox 200 x 215 ; nez vers le haut. Même ordre que Muse.EEG_NAMES.
  static POSITIONS = [
    { name: 'TP9', x: 34, y: 152 },
    { name: 'AF7', x: 72, y: 62 },
    { name: 'AF8', x: 128, y: 62 },
    { name: 'TP10', x: 166, y: 152 },
  ];

  constructor(container) {
    const electrodes = HeadMap.POSITIONS.map((p, i) => `
      <g id="hm-${i}" class="hm-el hm-none">
        <circle cx="${p.x}" cy="${p.y}" r="15"/>
        <text class="hm-name" x="${p.x}" y="${p.y + 3.5}">${p.name}</text>
        <text class="hm-info" x="${p.x}" y="${p.y + 29}">–</text>
      </g>`).join('');
    container.innerHTML = `
      <svg viewBox="0 0 200 215" class="headmap" role="img" aria-label="Position et qualité des capteurs">
        <path class="hm-head" d="M90 31 L100 12 L110 31"/>
        <ellipse class="hm-head" cx="27" cy="124" rx="8" ry="19"/>
        <ellipse class="hm-head" cx="173" cy="124" rx="8" ry="19"/>
        <ellipse class="hm-head" cx="100" cy="120" rx="70" ry="88"/>
        <circle class="hm-ref" cx="100" cy="48" r="4"><title>Référence (Fpz)</title></circle>
        <text class="hm-info" x="100" y="40">réf.</text>
        ${electrodes}
      </svg>`;
    this._els = HeadMap.POSITIONS.map((_, i) => container.querySelector('#hm-' + i));
  }

  update(levels) {
    levels.forEach((lv, i) => {
      const g = this._els[i];
      const cls = { bon: 'good', moyen: 'mid', mauvais: 'bad', suspect: 'bad' }[lv.label] || 'none';
      g.setAttribute('class', 'hm-el hm-' + cls);
      g.querySelector('.hm-info').textContent = lv.rms == null ? '–' : `${lv.label} · ${lv.rms.toFixed(0)} µV`;
    });
  }
}
