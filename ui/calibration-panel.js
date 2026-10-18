/* Panneau de calibration guidée (globale `CalibrationPanel`) : affiche les consignes, le compte à rebours et
 * le résultat de chaque étape. Fonctionne pour TOUTE calibration du registre (lib/calibrations.js).
 *
 *   new CalibrationPanel(conteneur, runner, { def, canStart, onState });
 *     runner    Calibrator ou StepCalibrator (contrat « Runner » de lib/calibrations.js)
 *     def       définition du registre (résumé via def.status()) ; défaut : Calibrations.get('artefacts')
 *     canStart  () -> true | message d'empêchement (ex. une autre calibration en cours) ; facultatif
 *     onState   (état) -> appelé à chaque progression, après l'affichage (ex. démonstration) ; facultatif
 *   CalibrationPanel.beep(nombre, fréquence)   // bips courts (partagé avec ui/calibration-stage.js)
 *
 * Cases à cocher : hors enregistrement, on choisit les étapes à calibrer (runner.start(ids) ; toutes cochées au départ,
 * le bouton devient « Calibrer la sélection »). Étape à `target(t)` : point à suivre PLEIN ÉCRAN (ui/gaze-target.js) dès la préparation.
 *
 * Prend la main sur `runner.onProgress`. Bip au début de chaque enregistrement, double bip grave à la fin d'une
 * étape les yeux fermés.
 */
class CalibrationPanel {
  static ICON = { pending: '○', active: '▶', ok: '✓', failed: '✗' };

  constructor(container, calibrator, { def = Calibrations.get('artefacts'), canStart = () => true, onState = null } = {}) {
    this.calibrator = calibrator;
    this.def = def;
    this.onState = onState;
    container.innerHTML = `
      <p class="hint" data-summary></p>
      <div class="calib-now" data-now hidden>
        <div data-title class="calib-title"></div>
        <div data-text></div>
        <div class="progress"><div data-bar></div></div>
      </div>
      <ul class="steps" data-steps></ul>
      <div class="buttons">
        <button class="btn" data-start>Calibrer</button>
        <button class="btn" data-retry hidden>Refaire les étapes échouées</button>
        <button class="btn ghost" data-cancel hidden>Annuler</button>
        <button class="btn ghost" data-reset>Réinitialiser</button>
      </div>
      <p class="hint" data-msg></p>`;
    this.el = container;
    const q = (s) => container.querySelector(s);
    this.gaze = new GazeTarget({ onCancel: () => calibrator.cancel() });
    this._sel = new Set(calibrator.statuses.map((s) => s.id));   // étapes cochées pour le prochain lancement
    const launch = (fn) => {
      const why = canStart();
      if (why !== true) { q('[data-msg]').textContent = why; return; }
      q('[data-msg]').textContent = fn() ? '' : 'Connecte le casque et attends la fin de l’apprentissage du bruit de fond (quelques secondes).';
    };
    q('[data-steps]').onchange = (e) => {
      const id = e.target.dataset && e.target.dataset.pick;
      if (id) { if (e.target.checked) this._sel.add(id); else this._sel.delete(id); this._buttons(false, calibrator.statuses); }
    };
    q('[data-start]').onclick = () => {
      const all = calibrator.statuses.map((s) => s.id), only = all.filter((id) => this._sel.has(id));
      if (!only.length) { q('[data-msg]').textContent = 'Coche au moins une étape à calibrer.'; return; }
      launch(() => calibrator.start(only.length === all.length ? null : only));
    };
    q('[data-retry]').onclick = () => launch(() => calibrator.startFailed());
    q('[data-cancel]').onclick = () => calibrator.cancel();
    q('[data-reset]').onclick = () => {
      calibrator.reset();
      this._summary();
      this._renderSteps(calibrator.statuses);
      this._buttons(false, calibrator.statuses);
      q('[data-msg]').textContent = '';
    };
    calibrator.onProgress = (state) => { this._render(state); if (this.onState) this.onState(state); };
    this._summary();
    this._renderSteps(calibrator.statuses);
    this._buttons(false, calibrator.statuses);
  }

  destroy() {
    this.calibrator.onProgress = null;
    this.gaze.destroy();
  }

  static beep(count = 1, freq = 880) {
    try {
      const ctx = CalibrationPanel._audio = CalibrationPanel._audio || new (window.AudioContext || window.webkitAudioContext)();
      for (let i = 0; i < count; i++) {
        const osc = ctx.createOscillator(), t = ctx.currentTime + i * 0.25;
        osc.frequency.value = freq;
        osc.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.15);
      }
    } catch (e) { /* audio indisponible */ }
  }

  _summary() {
    const st = this.def.status(), el = this.el.querySelector('[data-summary]');
    el.textContent = st.done ? `Fait le ${new Date(st.date).toLocaleString()} — ${st.summary}.` : `Pas encore fait : ${st.summary}.`;
  }

  // Boutons selon l'état : « Refaire les échouées » n'apparaît que s'il y en a, avec leur nombre.
  _buttons(running, statuses) {
    const q = (s) => this.el.querySelector(s);
    const failed = statuses.filter((s) => s.status === 'failed').length;
    q('[data-start]').hidden = running;
    const n = statuses.length, picked = statuses.filter((s) => this._sel.has(s.id)).length;
    q('[data-start]').textContent = n > 1 && picked < n ? `Calibrer la sélection (${picked}/${n})` : 'Calibrer';
    q('[data-cancel]').hidden = !running;
    q('[data-reset]').hidden = running;
    q('[data-retry]').hidden = running || failed === 0;
    q('[data-retry]').textContent = `Refaire les étapes échouées (${failed})`;
  }

  // Hors enregistrement, une case par étape (si la calibration en a plusieurs) : on choisit ce qu'on calibre.
  _renderSteps(statuses, running = false) {
    const pick = !running && statuses.length > 1;
    this.el.querySelector('[data-steps]').innerHTML = statuses.map((s) =>
      `<li class="step-${s.status}">${pick ? `<input type="checkbox" class="calib-pick" data-pick="${s.id}" ${this._sel.has(s.id) ? 'checked' : ''} aria-label="Calibrer : ${s.label}">` : ''}<span>${CalibrationPanel.ICON[s.status]}</span> <b>${s.label}</b> ${s.message ? '<small>' + s.message + '</small>' : ''}</li>`).join('');
  }

  // Sons : bip au début d'un enregistrement ; double bip grave quand une étape les yeux fermés se termine.
  _sounds(state) {
    if (state.phase === this._lastPhase && state.stepIndex === this._lastIndex) return;
    if (this._lastPhase === 'record' && this._lastStep && this._lastStep.eyesClosed) CalibrationPanel.beep(2, 660);
    else if (state.phase === 'record') CalibrationPanel.beep();
    this._lastPhase = state.phase;
    this._lastIndex = state.stepIndex;
    this._lastStep = state.step;
  }

  _render(state) {
    const q = (s) => this.el.querySelector(s);
    const running = state.phase === 'prepare' || state.phase === 'record';
    q('[data-now]').hidden = !running;
    this._buttons(running, state.statuses);
    this._renderSteps(state.statuses, running);
    this._sounds(state);

    if (running) {
      const total = state.phase === 'prepare' ? state.prepareS : state.step.seconds;
      q('[data-title]').textContent = `Étape ${state.position}/${state.total} — ${state.step.label}`;
      q('[data-text]').textContent = state.phase === 'prepare'
        ? `Préparez-vous… ${Math.ceil(state.remainingS)} s`
        : `${state.step.instruction} (${Math.ceil(state.remainingS)} s)`;
      const done = state.phase === 'record' && state.progress != null ? state.progress : 1 - state.remainingS / total;
      q('[data-bar]').style.width = (100 * done).toFixed(0) + '%';
      q('[data-now]').classList.toggle('recording', state.phase === 'record');
      if (state.phase === 'record') this.gaze.update(state.step, state.step.seconds - state.remainingS, `${state.step.label} — ${Math.ceil(state.remainingS)} s`);
      else this.gaze.update(state.step, 0, `Prépare-toi… ${Math.ceil(state.remainingS)} s`); // avant l'enregistrement : point immobile au centre
    } else this.gaze.hide();
    if (state.phase === 'done') {
      this._summary();
      const failed = state.statuses.filter((s) => s.status === 'failed').length;
      q('[data-msg]').textContent = failed
        ? `${failed} étape(s) à refaire : utilise « Refaire les étapes échouées » (les réglages précédents sont conservés pour celles-ci).`
        : 'Calibration terminée et enregistrée dans ton profil.';
    }
  }
}
