/* Panneau d'artefacts (globale `ArtifactPanel`) : voyants, compteurs, niveaux en direct, sensibilité, journal.
 *
 *   new ArtifactPanel(document.getElementById('artifacts'), detector);
 *
 * Prend la main sur `detector.onEvent`. Les barres « Niveaux » montrent chaque signal rapporté à son seuil :
 * le trait au milieu est le seuil de détection. Utile pour comprendre pourquoi un geste n'est pas détecté.
 */
class ArtifactPanel {
  static LAMPS = [
    { type: 'blink', label: 'Clignement' },
    { type: 'frown', label: 'Sourcils' },
    { type: 'jaw', label: 'Mâchoire' },
    { type: 'yawn', label: 'Bâillement' },
    { type: 'gaze-left', label: 'Regard ←' },
    { type: 'gaze-right', label: 'Regard →' },
  ];
  static LEVELS = [
    { key: 'blink', label: 'Clignement' },
    { key: 'frown', label: 'Sourcils' },
    { key: 'jaw', label: 'Mâchoire' },
    { key: 'gaze', label: 'Regard' },
  ];

  constructor(container, detector) {
    this.detector = detector;
    this.log = [];
    const lamps = ArtifactPanel.LAMPS.map((l) =>
      `<div class="lamp" data-lamp="${l.type}"><b data-count="${l.type}">0</b>${l.label}</div>`).join('');
    const levels = ArtifactPanel.LEVELS.map((l) => `
      <div class="bar"><span>${l.label}</span>
        <div class="track"><div class="fill" data-level="${l.key}"></div><div class="mark"></div></div>
        <span class="val" data-thr="${l.key}">–</span></div>`).join('');
    container.innerHTML = `
      <div class="lamps">${lamps}</div>
      <div class="controls" style="margin:10px 0 6px">
        Sensibilité
        <select data-sens>
          <option value="0.6">haute</option><option value="1" selected>normale</option><option value="1.6">basse</option>
        </select>
        <span data-state></span>
      </div>
      <h3 class="sub">Niveaux (trait = seuil)</h3>
      ${levels}
      <ul class="log" data-log></ul>`;
    this.el = container;
    // Sensibilité mémorisée dans le profil actif
    const sens = container.querySelector('[data-sens]'), saved = Profiles.get('artifactSensitivity', 1);
    if ([...sens.options].some((o) => +o.value === saved)) { sens.value = String(saved); detector.setSensitivity(saved); }
    sens.onchange = (e) => { detector.setSensitivity(+e.target.value); Profiles.set('artifactSensitivity', +e.target.value); };
    detector.onEvent = (e) => this._onEvent(e);
    this._timer = setInterval(() => this._refresh(), 100);
  }

  destroy() {
    clearInterval(this._timer);
    this.detector.onEvent = null;
  }

  _lamp(type) { return this.el.querySelector(`[data-lamp="${type}"]`); }

  _flash(type, ms) {
    const el = this._lamp(type);
    el.classList.add('on');
    setTimeout(() => el.classList.remove('on'), ms);
  }

  _onEvent(e) {
    const label = ArtifactPanel.LAMPS.find((l) => l.type === e.type).label;
    const secs = e.durationMs != null ? (e.durationMs / 1000).toFixed(1) + ' s' : '';
    if (e.type === 'blink') {
      this._flash('blink', 300);
      this._log(`${label} (${e.amplitude.toFixed(0)} µV)`);
    } else if (e.phase === 'start') {
      this._lamp(e.type).classList.add('on');
    } else if (e.type === 'yawn') {
      this._lamp('jaw').classList.remove('on');
      this._flash('yawn', 1500);
      this._log(`${label} (${secs})`);
    } else {
      this._lamp(e.type).classList.remove('on');
      this._log(`${label} (${secs})`);
    }
    ArtifactPanel.LAMPS.forEach((l) => { this.el.querySelector(`[data-count="${l.type}"]`).textContent = this.detector.counts[l.type]; });
  }

  _log(text) {
    this.log.unshift(new Date().toLocaleTimeString() + ' – ' + text);
    this.log.length = Math.min(this.log.length, 6);
    this.el.querySelector('[data-log]').innerHTML = this.log.map((t) => `<li>${t}</li>`).join('');
  }

  _refresh() {
    const d = this.detector, thr = d.thresholds;
    ArtifactPanel.LEVELS.forEach((l) => {
      this.el.querySelector(`[data-level="${l.key}"]`).style.width = Math.min(100, (d.levels[l.key] / 2) * 100) + '%';
      this.el.querySelector(`[data-thr="${l.key}"]`).textContent = thr[l.key].toFixed(0) + ' µV';
    });
    const state = this.el.querySelector('[data-state]');
    state.textContent = !d.ready ? 'apprentissage du bruit de fond…' : d.calibrated ? 'calibré' : 'seuils automatiques';
  }
}
