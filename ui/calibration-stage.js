/* Scène ludique de la calibration générale (globale `CalibrationStage`) : anneau de compte à rebours avec l'emoji du
 * geste, consigne en grand, jauge « force du geste », barre d'expérience et constellation d'étoiles (une par étape).
 * Étape à `target(t)` (regard guidé) : point à suivre plein écran (ui/gaze-target.js) ; `{ onCancel }` = Échap / « Annuler ».
 * Consignes parlées (synthèse vocale du navigateur) si activées, bips au début des enregistrements.
 *
 *   const stage = new CalibrationStage(conteneur, { voice: () => true });
 *   stage.mission({ def, state, overall: { done, total }, trail, meter, wait })
 *     def      définition du registre (lib/calibrations.js) ; state = état d'un runner (onProgress)
 *     trail    [{ emoji, statuses }] : une entrée par calibration du programme
 *     meter    niveau / seuil du geste en cours (1 = seuil atteint) ou null ; wait : message d'attente ou null
 *   stage.challenge(p, overall)   // état du défi des gestes (lib/gesture-challenge.js)
 *   stage.say(texte)              // phrase parlée (si la voix est activée)
 *   stage.destroy()               // coupe la voix, masque le point à suivre
 *   stage.dispose()               // idem + retire le point à suivre de la page (démontage du projet)
 */
class CalibrationStage {
  static STAR = { pending: '☆', active: '✨', ok: '⭐', failed: '💥' };
  static RING = 2 * Math.PI * 52;

  constructor(container, { voice = () => false, onCancel = null } = {}) {
    this.voice = voice;
    container.innerHTML = `
      <div class="cal-stage panel">
        <div class="stage-top"><b data-mission></b><span data-score></span></div>
        <div class="xp"><div data-xp></div></div>
        <div class="stage-main">
          <div class="ring-wrap" data-ringwrap>
            <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="ring-bg" cx="60" cy="60" r="52"/>
              <circle class="ring" data-ring cx="60" cy="60" r="52" stroke-dasharray="${CalibrationStage.RING}" stroke-dashoffset="${CalibrationStage.RING}"/></svg>
            <div class="ring-emoji" data-emoji>🧠</div>
            <div class="ring-count" data-count></div>
          </div>
          <div class="stage-text">
            <div class="stage-phase" data-phase></div>
            <div class="stage-title" data-title></div>
            <p class="stage-instr" data-instr></p>
            <div data-meterwrap hidden>
              <div class="meter"><div class="meter-fill" data-meter></div><i class="meter-mark"></i></div>
              <small class="hint" data-meterlabel></small>
            </div>
          </div>
        </div>
        <div class="trail" data-trail></div>
      </div>`;
    this.el = container;
    this._key = null;
    this._gaze = new GazeTarget({ onCancel });
  }

  // Coupe la voix et masque le point à suivre ; la scène reste utilisable. dispose() : fin définitive (démontage).
  destroy() {
    this._gaze.hide();
    try { speechSynthesis.cancel(); } catch (e) { /* pas de synthèse vocale */ }
  }

  dispose() {
    this.destroy();
    this._gaze.destroy();
  }

  say(text) {
    if (!this.voice()) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'fr-FR';
      u.rate = 1.05;
      speechSynthesis.speak(u);
    } catch (e) { /* pas de synthèse vocale */ }
  }

  _q(s) { return this.el.querySelector(s); }

  _common({ mission, score, overall, emoji, count, ring, phase, title, instr, recording }) {
    this._q('[data-mission]').textContent = mission;
    this._q('[data-score]').textContent = score || '';
    this._q('[data-xp]').style.width = (100 * (overall.total ? overall.done / overall.total : 0)).toFixed(1) + '%';
    this._q('[data-emoji]').textContent = emoji;
    this._q('[data-count]').textContent = count;
    this._q('[data-ring]').setAttribute('stroke-dashoffset', (CalibrationStage.RING * (1 - Math.max(0, Math.min(1, ring)))).toFixed(1));
    this._q('[data-ringwrap]').classList.toggle('recording', !!recording);
    this._q('[data-phase]').textContent = phase;
    this._q('[data-title]').textContent = title;
    this._q('[data-instr]').textContent = instr;
  }

  // Annonce une seule fois chaque changement (étape / phase) : voix et bips
  _announce(key, fn) {
    if (key === this._key) return;
    this._key = key;
    fn();
  }

  mission({ def, state, overall, trail = [], meter = null, wait = null }) {
    const step = state.step, rec = state.phase === 'record';
    const stars = trail.reduce((n, t) => n + t.statuses.filter((s) => s.status === 'ok').length, 0);
    if (wait || !step || state.phase === 'done' || state.phase === 'idle') {
      const done = state.phase === 'done';
      this._common({ mission: def.emoji + ' ' + def.label, score: `⭐ ${stars}`, overall, emoji: done ? '✅' : def.emoji, count: '',
        ring: done ? 1 : 0, phase: done ? 'Mission accomplie' : 'Un instant…', title: def.label,
        instr: wait || (done ? 'Résultat enregistré. On passe à la suite…' : ''), recording: false });
      if (this._eyes) { this._eyes = false; CalibrationPanel.beep(2, 660); this.say('Tu peux rouvrir les yeux.'); }
    } else {
      const total = rec ? step.seconds : state.prepareS;
      const ring = rec && state.progress != null ? state.progress : 1 - state.remainingS / total;
      this._common({
        mission: `Mission ${state.position}/${state.total} · ${def.emoji} ${def.label}`, score: `⭐ ${stars}`, overall,
        emoji: step.emoji || def.emoji, count: Math.ceil(state.remainingS) || '', ring,
        phase: !rec ? 'Prépare-toi…' : step.eyesClosed ? 'Yeux fermés — écoute les bips' : 'À toi !',
        title: step.label, instr: step.instruction, recording: rec,
      });
      this._announce(def.id + step.id + state.phase, () => {
        if (state.phase === 'prepare') this.say(`${step.label}. ${step.instruction}`);
        if (rec) CalibrationPanel.beep();
      });
      if (rec && step.eyesClosed) this._eyes = true;
      else if (this._eyes) { this._eyes = false; CalibrationPanel.beep(2, 660); this.say('Tu peux rouvrir les yeux.'); }
    }
    const show = rec && meter != null;
    if (step && !wait && state.phase !== 'done' && state.phase !== 'idle') {
      this._gaze.update(step, rec ? step.seconds - state.remainingS : 0, rec ? `${step.label} — ${Math.ceil(state.remainingS)} s` : `Prépare-toi… ${Math.ceil(state.remainingS)} s`);
    } else this._gaze.hide();
    this._q('[data-meterwrap]').hidden = !show;
    if (show) {
      this._q('[data-meter]').style.width = Math.min(100, meter * 50).toFixed(0) + '%';
      this._q('[data-meter]').classList.toggle('over', meter >= 1);
      this._q('[data-meterlabel]').textContent = meter >= 1 ? 'Geste reconnu : au-dessus du seuil ✓' : 'Force du geste (le trait marque le seuil actuel)';
    }
    this._trail(trail);
  }

  challenge(p, overall) {
    const g = p.gesture || { emoji: '🎯', label: 'Défi des gestes' };
    const phase = { ready: 'Attention…', go: 'Maintenant !', hit: `Bravo ! ${p.last && p.last.reactionMs != null ? (p.last.reactionMs / 1000).toFixed(1) + ' s' : ''}`,
      miss: p.last && p.last.got ? 'Raté : un autre geste a été reconnu' : 'Raté : pas reconnu à temps', done: 'Défi terminé' }[p.phase] || '';
    this._common({ mission: `🎯 Défi des gestes · manche ${Math.min(p.round, p.total)}/${p.total}`, score: `🏆 ${p.score} pts`, overall,
      emoji: p.phase === 'hit' ? '🎉' : p.phase === 'miss' ? '😅' : g.emoji, count: p.phase === 'go' ? Math.ceil(p.remainingS) : '',
      ring: p.phase === 'go' ? 1 - p.remainingS / GestureChallenge.TIMEOUT_S : 0, phase, title: g.label,
      instr: 'Fais le geste demandé dès que « Maintenant ! » s’affiche : plus tu es rapide, plus tu gagnes de points.', recording: p.phase === 'go' });
    this._q('[data-meterwrap]').hidden = true;
    this._gaze.hide();
    this._announce('defi' + p.round + p.phase, () => {
      if (p.phase === 'go') { CalibrationPanel.beep(); this.say(g.label.replace(' !', '')); }
      if (p.phase === 'hit') CalibrationPanel.beep(1, 1320);
    });
    const marks = p.results.map((r) => (r.ok ? '⭐' : '💥')).join('') + '☆'.repeat(Math.max(0, p.total - p.results.length));
    this._q('[data-trail]').innerHTML = `<span class="trail-group"><b>🎯</b> ${marks}</span>`;
  }

  _trail(trail) {
    this._q('[data-trail]').innerHTML = trail.map((t) =>
      `<span class="trail-group"><b>${t.emoji}</b> ${t.statuses.map((s) => `<span title="${s.label}${s.message ? ' — ' + s.message : ''}">${CalibrationStage.STAR[s.status]}</span>`).join('')}</span>`).join('');
  }
}
