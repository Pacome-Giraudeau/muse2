/* Coquille de l'application : routage par hash, connexion partagée, montage des projets. Globale `Projets`.
 *
 * Toute l'application vit dans UN SEUL document (index.html). Changer de « page » ne recharge rien, ce qui garde la
 * connexion Bluetooth ouverte (une connexion Web Bluetooth meurt avec la page qui l'a ouverte).
 *
 * Routes :
 *   #/            accueil (cartes de CATALOGUE)
 *   #/p/<id>      projet interactif : chargé à la demande, monté dans <main id="view">
 *   #/p/<id>/<x>  idem, avec un paramètre transmis au projet (ex. #/p/etude/3 : échantillon n° 3)
 *   #/d/<id>      page de documentation (HTML statique affiché dans un iframe)
 *   #/dev/<id>    page de la section Développement (CATALOGUE.dev) ou rapport critique (CATALOGUE.rapports) :
 *                 même contrat et même montage qu'un projet ; une entrée avec `page` (documentation technique) s'affiche
 *                 comme une page de documentation
 *
 * Contrat d'un projet (fichier projets/NN-nom/<nom>.js) :
 *   Projets.register({
 *     id: 'live',
 *     template: '<h1>…</h1> …',                 // HTML injecté dans <main>
 *     mount(root, { muse, recorder, params }) { …; return () => { nettoyage : désabonnements, timers, animations }; },
 *   });
 * `muse` est l'instance unique de Muse (lib/muse.js), déjà connectée ou non. `recorder` (lib/recorder.js) garde en
 * permanence les 30 dernières secondes de signal, mémorisées dans le navigateur. Le projet doit TOUT nettoyer au démontage.
 */
const Projets = {
  _defs: {},
  register(def) { this._defs[def.id] = def; },
};

(function startShell() {
  Profiles.init(); // avant tout le reste : les briques lisent les réglages du profil actif
  const muse = new Muse();
  const recorder = new SignalRecorder(muse); // enregistre en continu, quelle que soit la page
  const sessionLog = new SessionLog(muse); // journal continu : en mémoire, puis écrit dans seances/ si le serveur répond
  ServerDir.detect().then((dir) => { if (dir) sessionLog.setSink(SessionLog.serverSink()); });
  new StatusBar(document.getElementById('statusbar'), muse, recorder, sessionLog);
  // Qualité de contact suivie en permanence, pour le bouton « Capteurs » du bandeau
  const contact = new ContactQuality();
  muse.on('eeg', (c, s) => contact.feed(c, s));
  new SensorCheck(document.getElementById('sensor-check'), muse, contact);
  new ProfileMenu(document.getElementById('profile-menu'), recorder);

  const view = document.getElementById('view');
  let unmount = null;   // fonction de nettoyage du projet affiché
  let navToken = 0;     // invalide les chargements asynchrones périmés

  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Impossible de charger ' + src));
    document.head.appendChild(s);
  });

  const card = (href, e, extra) => `
    <a class="card" href="${href}">
      <div class="emoji">${e.emoji}</div>
      <h3>${e.titre}</h3>
      <p>${e.description}</p>
      ${extra}
    </a>`;

  // Étiquettes d'un projet : statut, « casque » (avec le casque), « démo » (sans casque)
  const tags = (p) => `<span class="tags"><span class="tag ${p.statut === 'prêt' ? 'ok' : 'wip'}">${p.statut}</span>`
    + (p.direct ? '<span class="tag live">● casque</span>' : '') + (p.demo ? '<span class="tag demo">démo</span>' : '') + '</span>';

  function home() {
    view.className = 'wrap';
    view.innerHTML = `
      <p class="intro">Tous les projets autour du casque Muse 2. Connecte le casque une fois (en haut à droite) : la connexion reste active quand tu changes de page.</p>
      <h2 class="section">Projets</h2>
      <div class="cards">${CATALOGUE.projets.map((p) => card('#/p/' + p.id, p, tags(p))).join('')}</div>
      <p class="hint tag-legend"><span class="tag ok">prêt</span> utilisable · <span class="tag wip">en travaux</span> en cours de construction · <span class="tag live">● casque</span> fonctionne avec le casque · <span class="tag demo">démo</span> démonstration sans casque</p>
      <h2 class="section">Comprendre</h2>
      <div class="cards">${CATALOGUE.docs.map((d) => card('#/d/' + d.id, d, '<span class="tag">documentation</span>')).join('')}</div>
      <h2 class="section">Développement</h2>
      <div class="cards">${CATALOGUE.dev.map((d) => card('#/dev/' + d.id, d, '<span class="tag">développement</span>')).join('')}</div>`;
  }

  async function project(entry, token, params) {
    if (!Projets._defs[entry.id]) {
      view.className = 'wrap';
      view.innerHTML = '<p class="intro">Chargement…</p>';
      try { await loadScript(entry.script); } catch (e) { view.innerHTML = `<div class="notice">${e.message}</div>`; return; }
      if (token !== navToken) return; // l'utilisateur est déjà parti ailleurs
    }
    const def = Projets._defs[entry.id];
    view.className = 'wrap';
    view.innerHTML = def.template;
    unmount = def.mount(view, { muse, recorder, params }) || null;
  }

  function doc(entry) {
    view.className = 'doc';
    view.innerHTML = `<iframe class="doc-frame" src="${entry.page}" title="${entry.titre}"></iframe>`;
  }

  function route() {
    const token = ++navToken;
    if (unmount) { try { unmount(); } catch (e) { console.error(e); } unmount = null; }
    window.scrollTo(0, 0);

    const [, kind, id, ...params] = location.hash.split('/');
    const entry = kind === 'p' ? CATALOGUE.projets.find((p) => p.id === id)
      : kind === 'd' ? CATALOGUE.docs.find((d) => d.id === id)
      : kind === 'dev' ? [...CATALOGUE.dev, ...CATALOGUE.rapports].find((d) => d.id === id) : null;

    if (entry && entry.page) doc(entry);
    else if (entry && (kind === 'p' || kind === 'dev')) project(entry, token, params.map(decodeURIComponent));
    else home();

    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', location.hash.startsWith(a.getAttribute('href') + '/') || a.getAttribute('href') === location.hash || (a.getAttribute('href') === '#/' && !entry)));
  }

  window.addEventListener('hashchange', route);
  Profiles.onChange(() => route()); // changer de profil recharge la page affichée avec les réglages du nouveau profil
  route();
})();
