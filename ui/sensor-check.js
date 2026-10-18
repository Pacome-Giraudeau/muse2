/* Vérification rapide des capteurs depuis le bandeau (globale `SensorCheck`).
 *
 *   new SensorCheck(conteneur, muse, contact);   // contact : ContactQuality alimenté en permanence (app/shell.js)
 *
 * Bouton « Capteurs » avec 4 pastilles (TP9, AF7, AF8, TP10) colorées selon le contact, visible sur toutes les pages ;
 * un clic ouvre une fenêtre : schéma de la tête (ui/head-map.js), valeurs par électrode, liaison Bluetooth, batterie,
 * conseils et liens vers le guide d'installation et Capteurs en direct.
 */
class SensorCheck {
  static TONE = { bon: 'good', moyen: 'mid', mauvais: 'bad', suspect: 'bad' }; // suspect : signal trop faible (lib/contact.js)

  constructor(container, muse, contact) {
    this.muse = muse;
    this.contact = contact;
    container.innerHTML = `
      <details class="sensor-check">
        <summary title="Vérifier les capteurs"><span>Capteurs</span><span class="sc-dots">${Muse.EEG_NAMES.map(() => '<i></i>').join('')}</span></summary>
        <div class="sc-panel">
          <div class="sc-head"></div>
          <div>
            <table class="kv sc-table"></table>
            <p class="hint sc-advice"></p>
            <div class="buttons">
              <a class="btn ghost" href="#/p/guide">Guide d'installation</a>
              <a class="btn ghost" href="#/p/live">Capteurs en direct</a>
            </div>
          </div>
        </div>
      </details>`;
    this.el = container.querySelector('.sensor-check');
    this.map = new HeadMap(container.querySelector('.sc-head'));
    this.el.querySelectorAll('a').forEach((a) => (a.onclick = () => (this.el.open = false)));
    document.addEventListener('click', (e) => { if (this.el.open && !this.el.contains(e.target)) this.el.open = false; });
    this.el.addEventListener('toggle', () => this.refresh());
    muse.on('state', (st) => { if (st === 'connected') contact.reset(); this.refresh(); });
    setInterval(() => this.refresh(), 1000);
    this.refresh();
  }

  refresh() {
    const levels = this.contact.levels, connected = this.muse.connected;
    this.el.querySelectorAll('.sc-dots i').forEach((dot, i) => {
      dot.className = connected ? 'sc-' + (SensorCheck.TONE[levels[i].label] || 'none') : 'sc-none';
      dot.title = `${Muse.EEG_NAMES[i]} : ${connected ? levels[i].label : 'non connecté'}`;
    });
    if (!this.el.open) return;
    this.map.update(connected ? levels : levels.map(() => ({ rms: null, label: 'absent' })));
    const good = levels.filter((l) => l.label === 'bon').length, link = this.muse.link, tel = this.muse.telemetry;
    const rows = Muse.EEG_NAMES.map((n, i) => `<tr><td>${n}</td><td>${connected && levels[i].rms != null ? `${levels[i].label} · ${levels[i].rms.toFixed(0)} µV` : '–'}</td></tr>`).join('');
    this.el.querySelector('.sc-table').innerHTML = rows
      + `<tr><td>Liaison Bluetooth</td><td>${connected ? `${link.rate} paquets/s (${(link.ratio * 100).toFixed(0)} %)` : this.muse.state === 'reconnecting' ? 'reconnexion…' : 'non connecté'}</td></tr>`
      + `<tr><td>Batterie</td><td>${tel ? tel.battery.toFixed(0) + ' %' : '–'}</td></tr>`;
    this.el.querySelector('.sc-advice').textContent = !connected ? 'Connecte le casque (bouton en haut à droite) pour vérifier les capteurs.'
      : levels.every((l) => l.rms == null) ? 'Mesure en cours… (quelques secondes)'
      : good === 4 ? 'Les quatre capteurs sont bons.'
      : `${4 - good} capteur(s) à améliorer : dégage les cheveux, ajuste la bande, attends 30 à 60 s. Détails dans le guide.`;
  }
}
