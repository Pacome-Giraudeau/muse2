/* Scène d'annotation (globale `AnnotationStage`) : grande carte qui montre la consigne en cours (emoji, texte, barre de
 * temps), la suivante, et — en mode spontané — le pavé d'étiquettes à maintenir. La logique est dans lib/annotation.js.
 *
 *   const stage = new AnnotationStage(conteneur, { onPress: (id) => {}, onRelease: (id) => {} });
 *   stage.cue(état)                  état de Annotation.Runner.tick() : affiche la consigne, la pause ou la fin
 *   stage.message('texte')           texte neutre (avant le départ)
 *   stage.pad(étiquettes, actives)   pavé spontané : un bouton par étiquette (maintenu = geste en cours) ; touches 1…n
 *   stage.setActive([ids])           étiquettes actuellement maintenues
 *   stage.destroy()
 */
class AnnotationStage {
  constructor(el, { onPress = () => {}, onRelease = () => {} } = {}) {
    this.el = el; this.onPress = onPress; this.onRelease = onRelease; this.labels = [];
    el.innerHTML = `
      <div class="ann-card" aria-live="polite"><div class="ann-emoji"></div><div class="ann-text"></div><div class="ann-sub"></div>
        <div class="ann-bar"><i></i></div></div>
      <div class="ann-pad" hidden></div>`;
    this.$ = (s) => el.querySelector(s);
    this.card = this.$('.ann-card');
    this.padEl = this.$('.ann-pad');
    this._key = (e, down) => {
      if (!this.labels.length || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target || {}).tagName || '')) return;
      const l = this.labels[Number(e.key) - 1];
      if (!l) return;
      e.preventDefault();
      down ? this.onPress(l.id) : this.onRelease(l.id);
    };
    this._kd = (e) => this._key(e, true);
    this._ku = (e) => this._key(e, false);
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);
  }

  _show(emoji, text, sub, progress, tone) {
    this.$('.ann-emoji').textContent = emoji;
    this.$('.ann-text').textContent = text;
    this.$('.ann-sub').textContent = sub || '';
    this.$('.ann-bar i').style.width = Math.round(Math.max(0, Math.min(1, progress)) * 100) + '%';
    this.card.dataset.tone = tone || '';
  }

  message(text) { this._show('🏷️', text, '', 0, ''); }

  cue(st) {
    const nx = st.next ? Annotation.label(st.next.label) : null;
    if (st.phase === 'done') return this._show('✅', 'Séance terminée', `${st.total} consignes`, 1, 'done');
    if (st.phase === 'cue') {
      const l = Annotation.label(st.trial.label);
      return this._show(l.emoji, l.cue, `${st.index + 1} / ${st.total} · ${Math.ceil(st.remainingS)} s${nx ? ' · ensuite : ' + nx.emoji : ''}`, st.progress, 'cue');
    }
    this._show(nx ? '⏳' : '✅', st.phase === 'lead' ? 'Prépare-toi, installe-toi confortablement' : 'Pause : relâche, respire',
      nx ? `Prochaine consigne dans ${Math.ceil(st.remainingS)} s : ${nx.emoji} ${nx.name}` : '', 0, 'gap');
  }

  pad(labels) {
    this.labels = labels;
    this.padEl.hidden = !labels.length;
    this.padEl.innerHTML = labels.map((l, i) =>
      `<button type="button" class="btn ann-key" data-id="${l.id}"><kbd>${i + 1}</kbd> ${l.emoji} ${l.name}<small>${l.kind === 'instant' ? 'appuyer' : 'maintenir'}</small></button>`).join('');
    this.padEl.querySelectorAll('.ann-key').forEach((b) => {
      b.onpointerdown = (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); this.onPress(b.dataset.id); };
      b.onpointerup = b.onpointercancel = () => this.onRelease(b.dataset.id);
    });
  }

  setActive(ids) {
    this.padEl.querySelectorAll('.ann-key').forEach((b) => b.classList.toggle('on', ids.includes(b.dataset.id)));
  }

  destroy() {
    window.removeEventListener('keydown', this._kd);
    window.removeEventListener('keyup', this._ku);
    this.el.innerHTML = '';
  }
}
