/* Menu des profils dans le bandeau (globale `ProfileMenu`) : changer de profil, en créer, renommer, supprimer,
 * exporter / importer ; résumé de ce que le profil actif a mémorisé. La logique est dans lib/profiles.js.
 *
 *   new ProfileMenu(conteneur, recorder);
 *
 * Supprimer un profil : ses réglages sont effacés ; ses échantillons du navigateur sont, au choix, supprimés ou
 * rattachés au profil restant (les fichiers déjà écrits dans muse2/echantillons ne sont jamais touchés).
 */
class ProfileMenu {
  constructor(container, recorder) {
    this.recorder = recorder;
    container.innerHTML = `
      <details class="profile-menu">
        <summary title="Profils"><span>👤</span> <b data-name></b></summary>
        <div class="pm-panel">
          <div class="pm-title">Profils</div>
          <ul class="pm-list" data-list></ul>
          <div class="pm-details" data-details></div>
          <div class="buttons">
            <button class="btn ghost" data-act="new">Nouveau</button>
            <button class="btn ghost" data-act="rename">Renommer</button>
            <button class="btn ghost" data-act="delete">Supprimer</button>
            <button class="btn ghost" data-act="export">Exporter</button>
            <label class="btn ghost">Importer<input type="file" accept=".json" data-import hidden></label>
          </div>
          <p class="hint">Chaque profil garde ses propres réglages (calibration, sensibilité, filtres, référence d'état mental) et ses échantillons, d'une session à l'autre.</p>
        </div>
      </details>`;
    this.el = container.querySelector('.profile-menu');
    const q = (s) => this.el.querySelector(s);
    this.el.addEventListener('toggle', () => { if (this.el.open) this.render(); });
    document.addEventListener('click', (e) => { if (this.el.open && !this.el.contains(e.target)) this.el.open = false; });
    q('[data-list]').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) Profiles.switchTo(b.dataset.id); };
    this.el.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => this[b.dataset.act]()));
    q('[data-import]').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try { Profiles.switchTo(Profiles.importProfile(JSON.parse(await f.text()))); } catch (err) { alert(err.message); }
      e.target.value = '';
    };
    Profiles.onChange(() => this.render());
    this.render();
  }

  async render() {
    const q = (s) => this.el.querySelector(s), active = Profiles.active();
    q('[data-name]').textContent = active.name;
    q('[data-list]').innerHTML = Profiles.list().map((p) =>
      `<li><button type="button" data-id="${p.id}" class="${p.id === active.id ? 'active' : ''}">${p.id === active.id ? '●' : '○'} ${p.name.replace(/</g, '&lt;')}</button></li>`).join('');
    q('[data-act="delete"]').disabled = Profiles.list().length <= 1;
    if (!this.el.open) return;
    const sens = Profiles.get('artifactSensitivity', 1);
    const samples = await this.recorder.listSamples();
    const date = (d) => new Date(d).toLocaleDateString();
    q('[data-details]').innerHTML = `<table class="kv">
      ${Calibrations.list().map((d) => { const st = d.status(); return `<tr><td>${d.label}</td><td>${st.done ? 'faite le ' + date(st.date) + (st.failed ? ` (${st.failed} à refaire)` : '') : 'non faite'}</td></tr>`; }).join('')}
      <tr><td>Sensibilité</td><td>${{ 0.6: 'haute', 1: 'normale', 1.6: 'basse' }[sens] || sens}</td></tr>
      <tr><td>Filtres</td><td>${SignalPipeline.loadSaved().summary()}</td></tr>
      <tr><td>Amélioration en direct</td><td>${Profiles.get('liveEnhance', false) ? 'activée' : 'désactivée'}</td></tr>
      <tr><td>Échantillons</td><td>${samples.length}</td></tr>
      <tr><td>Sujet (fichiers BIDS)</td><td>sub-${Profiles.label()}</td></tr>
    </table>`;
  }

  new() {
    const name = prompt('Nom du nouveau profil :', 'Profil ' + (Profiles.list().length + 1));
    if (name && name.trim()) Profiles.switchTo(Profiles.create(name));
  }

  rename() {
    const p = Profiles.active(), name = prompt('Nouveau nom du profil :', p.name);
    if (name && name.trim()) Profiles.rename(p.id, name);
  }

  async delete() {
    const p = Profiles.active();
    if (!confirm(`Supprimer le profil « ${p.name} » et tous ses réglages ?`)) return;
    const samples = await this.recorder.listSamples();
    const target = Profiles.list().find((x) => x.id !== p.id);
    if (samples.length) {
      const drop = confirm(`Ce profil a ${samples.length} échantillon(s) dans le navigateur.\n\nOK : les supprimer aussi.\nAnnuler : les rattacher au profil « ${target.name} ».\n\n(Les fichiers déjà écrits dans le dossier muse2/echantillons ne sont jamais supprimés.)`);
      if (drop) for (const s of samples) await this.recorder.deleteSample(s.n);
      else await this.recorder.reassignSamples(p.id, target.id);
    }
    Profiles.remove(p.id);
  }

  export() {
    const data = Profiles.exportProfile(), a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `profil-${Profiles.label()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
