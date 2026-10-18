/* Projet « Guide d'installation du casque » : étapes illustrées, schémas des voyants et des capteurs,
 * vérification du contact en direct et dépannage. Chargé à la demande par app/shell.js.
 * Réutilise ContactQuality (lib/contact.js) et HeadMap (ui/head-map.js).
 * Sources des consignes : guide officiel de démarrage du Muse 2 (docs/sources.html, réf. 28). */

/* Schémas simplifiés, pas à l'échelle. Positions indicatives : à comparer avec ton casque. */
const GUIDE_SCHEMA_POD = `
<svg viewBox="0 0 240 170" class="guide-svg" role="img" aria-label="Boîtier du Muse 2 : voyants, bouton, port de charge">
  <rect class="g-body" x="20" y="40" width="200" height="80" rx="22"/>
  <g class="g-led"><circle cx="64" cy="70" r="6"/><circle cx="92" cy="70" r="6"/><circle cx="120" cy="70" r="6"/></g>
  <circle class="g-btn" cx="178" cy="80" r="12"/>
  <rect class="g-port" x="82" y="112" width="44" height="8" rx="3"/>
  <text class="g-lbl" x="92" y="30" text-anchor="middle">voyants (LED)</text>
  <line class="g-lead" x1="92" y1="34" x2="92" y2="62"/>
  <text class="g-lbl" x="178" y="30" text-anchor="middle">bouton</text>
  <line class="g-lead" x1="178" y1="34" x2="178" y2="66"/>
  <text class="g-lbl" x="104" y="146" text-anchor="middle">port de charge</text>
  <line class="g-lead" x1="104" y1="132" x2="104" y2="122"/>
  <text class="g-note" x="120" y="164" text-anchor="middle">nombre de voyants et position : à vérifier sur ton casque</text>
</svg>`;

const GUIDE_SCHEMA_BAND = `
<svg viewBox="0 0 400 220" class="guide-svg" role="img" aria-label="Face intérieure du Muse 2 : électrodes et capteur de pouls">
  <rect class="g-body" x="30" y="40" width="340" height="62" rx="31"/>
  <path class="g-arm" d="M44 96 C 20 130, 24 170, 50 190"/>
  <path class="g-arm" d="M356 96 C 380 130, 376 170, 350 190"/>
  <g class="g-el"><circle cx="100" cy="71" r="15"/><circle cx="240" cy="71" r="15"/><circle cx="52" cy="190" r="15"/><circle cx="348" cy="190" r="15"/></g>
  <circle class="g-ref" cx="170" cy="71" r="8"/>
  <g><circle cx="288" cy="71" r="6" fill="#7a1010"/><circle cx="308" cy="71" r="6" fill="#c0392b"/><circle cx="328" cy="71" r="6" fill="#ff3b30"/></g>
  <text class="g-name" x="100" y="75">AF7</text><text class="g-name" x="240" y="75">AF8</text>
  <text class="g-name" x="52" y="194">TP9</text><text class="g-name" x="348" y="194">TP10</text>
  <text class="g-lbl" x="170" y="30" text-anchor="middle">référence (Fpz)</text>
  <line class="g-lead" x1="170" y1="34" x2="170" y2="60"/>
  <text class="g-lbl" x="308" y="30" text-anchor="middle">capteur de pouls (3 diodes)</text>
  <line class="g-lead" x1="308" y1="34" x2="308" y2="60"/>
  <text class="g-lbl" x="200" y="132" text-anchor="middle">front : AF7, AF8</text>
  <text class="g-lbl" x="200" y="200" text-anchor="middle">derrière les oreilles : TP9, TP10</text>
  <text class="g-note" x="200" y="216" text-anchor="middle">diodes de pouls : 730 nm (proche IR), 660 nm (rouge), 850 nm (IR) ; ordre exact non confirmé</text>
</svg>`;

/* Conseils par électrode quand le contact n'est pas bon (consignes officielles + bon sens). */
const GUIDE_TIPS = {
  TP9: 'Écarte les cheveux derrière l\'oreille gauche, vérifie que l\'embout caoutchouc touche la peau.',
  AF7: 'Pose la bande au milieu du front (ni trop haut vers les cheveux, ni trop bas), sans mèche dessous.',
  AF8: 'Pose la bande au milieu du front (ni trop haut vers les cheveux, ni trop bas), sans mèche dessous.',
  TP10: 'Écarte les cheveux derrière l\'oreille droite, vérifie que l\'embout caoutchouc touche la peau.',
};
// Signal anormalement faible (lib/contact.js, « suspect ») : souvent un pont électrique avec la référence.
const GUIDE_TIP_SUSPECT = 'Signal anormalement faible : essuie la peau et le capteur (sueur, crème), vérifie qu\'il ne touche pas la référence au milieu du front, puis repositionne la bande.';

Projets.register({
  id: 'guide',

  template: `
    <header class="proj-head">
      <a class="back" href="#/">← Accueil</a>
      <h1>Guide d'installation du casque</h1>
    </header>
    <p class="intro">Six étapes pour passer d'un casque dans sa boîte à un signal propre. Les pastilles se mettent à jour toutes seules quand le casque est connecté.</p>

    <ol class="guide-steps">
      <li class="guide-step" id="s-charge">
        <h2><span class="n">1</span> Charger et vérifier la batterie <span class="badge" id="b-charge">–</span></h2>
        <p>Charge le casque avec son câble avant la première utilisation. Pour connaître le niveau, allume-le puis <strong>appuie une seconde fois sur le bouton</strong> :
        le nombre de voyants allumés indique la charge (<strong>3 voyants = pleine charge</strong>, 1 ou 2 = à recharger). Une fois connecté, le niveau s'affiche aussi dans l'en-tête.</p>
      </li>
      <li class="guide-step" id="s-power">
        <h2><span class="n">2</span> Allumer</h2>
        <p>Clique sur le <strong>petit bouton à côté du port de charge</strong> du boîtier. Des <strong>lumières bleues qui défilent</strong> d'un côté à l'autre signalent que le casque cherche un appareil Bluetooth auquel se connecter.</p>
        <div class="guide-fig">${GUIDE_SCHEMA_POD}</div>
        <table class="kv guide-leds">
          <tr><td>Lumières bleues qui défilent</td><td>allumé, cherche une connexion Bluetooth <span class="src">(guide officiel)</span></td></tr>
          <tr><td>Un clic de plus : 3 voyants allumés</td><td>batterie pleine <span class="src">(guide officiel)</span></td></tr>
          <tr><td>Un clic de plus : 1 ou 2 voyants</td><td>batterie faible, à recharger <span class="src">(guide officiel)</span></td></tr>
          <tr><td>Autres motifs (charge en cours, erreur…)</td><td>non confirmés ici : voir la notice fournie avec le casque</td></tr>
        </table>
      </li>
      <li class="guide-step" id="s-wear">
        <h2><span class="n">3</span> Mettre le casque</h2>
        <div class="guide-fig">${GUIDE_SCHEMA_BAND}</div>
        <ul>
          <li>Pose la bande <strong>au milieu du front</strong> : ni trop haut (cheveux), ni trop bas (sourcils).</li>
          <li>Les embouts caoutchouc se placent <strong>derrière les oreilles</strong>, comme les branches de lunettes.</li>
          <li>Écarte doucement les branches, ajuste des <strong>deux côtés à la fois</strong> pour un serrage ferme mais confortable. Les deux côtés doivent être étendus pareil.</li>
          <li><strong>Aucun cheveu</strong> entre un capteur et la peau (attache les cheveux longs). Le capteur de pouls est du côté droit du front.</li>
          <li>Si le contact est mauvais, essuie le front et l'arrière des oreilles avec un mouchoir humide.</li>
        </ul>
      </li>
      <li class="guide-step" id="s-connect">
        <h2><span class="n">4</span> Connecter <span class="badge" id="b-connect">–</span></h2>
        <p>Casque allumé (lumières bleues) et posé : clique sur le bouton ci-dessous (ou « Connecter le Muse 2 » dans l'en-tête) et choisis ton Muse dans la liste du navigateur. La connexion reste active quand tu changes de page.</p>
        <p><button class="btn" id="connect-btn">Connecter le Muse 2</button> <span class="hint" id="connect-msg"></span></p>
        <p class="hint">Le casque n'apparaît pas ? Voir le dépannage plus bas (appli Muse ouverte sur un téléphone, casque éteint ou vide…).</p>
      </li>
      <li class="guide-step" id="s-contact">
        <h2><span class="n">5</span> Vérifier le contact <span class="badge" id="b-contact">–</span></h2>
        <p>Attends <strong>30 à 60 secondes après chaque ajustement</strong> pour que le signal se stabilise. Vise quatre capteurs verts.</p>
        <div class="guide-contact">
          <div id="headmap"></div>
          <ul class="guide-tips" id="tips"><li class="hint">Connecte le casque pour voir la qualité de chaque capteur.</li></ul>
        </div>
      </li>
      <li class="guide-step" id="s-ready">
        <h2><span class="n">6</span> C'est prêt</h2>
        <p>Quand les quatre capteurs sont verts, ouvre <a href="#/p/calibration">Calibration</a> et lance la calibration générale : seuils des clignements, sourcils, mâchoire et regards, profil alpha et référence d'état mental, réglés sur toi.</p>
      </li>
    </ol>

    <h2 class="section">Dépannage</h2>
    <table class="guide-trouble">
      <tr><th>Symptôme</th><th>À essayer</th></tr>
      <tr><td>Le casque n'apparaît pas dans la liste</td><td>Vérifie qu'il est allumé (lumières bleues). Ferme l'appli Muse sur ton téléphone ou ta tablette : un casque déjà connecté ailleurs n'est en général plus visible. Rapproche-toi de l'ordinateur ; recharge si la batterie est basse.</td></tr>
      <tr><td>Un capteur est rouge ou gris</td><td>Écarte les cheveux, essuie la peau avec un mouchoir humide, resserre, puis attends 30 à 60 secondes.</td></tr>
      <tr><td>Seuls TP9 / TP10 sont mauvais</td><td>Cheveux derrière les oreilles, ou branches trop courtes ou inégales : ajuste les deux côtés.</td></tr>
      <tr><td>Seuls AF7 / AF8 sont mauvais</td><td>Bande trop haute ou trop basse, cheveux ou frange sous la bande, peau grasse ou crème : essuie le front.</td></tr>
      <tr><td>Les capteurs se dégradent quand tu parles ou mâches</td><td>Normal : les muscles ajoutent du bruit. Reste immobile et mâchoire détendue pendant la vérification.</td></tr>
      <tr><td>La connexion se coupe souvent</td><td>Évite que ton corps soit entre le casque et l'ordinateur, éloigne les sources Wi-Fi 2,4 GHz proches, recharge le casque. Regarde l'indice Bluetooth dans l'en-tête et le panneau « Qualité de la liaison » de Capteurs en direct. Explications : <a href="#/d/science">Comprendre la science</a> (§ Bluetooth).</td></tr>
    </table>`,

  mount(root, { muse }) {
    const $ = (id) => root.querySelector('#' + id);
    const contact = new ContactQuality();
    const headMap = new HeadMap($('headmap'));

    const badge = (id, text, tone) => { const el = $(id); el.textContent = text; el.className = 'badge' + (tone ? ' ' + tone : ''); };

    function refresh() {
      const t = muse.telemetry;
      if (t) badge('b-charge', `🔋 ${t.battery.toFixed(0)} %`, t.battery < 20 ? 'bad' : 'ok');
      else badge('b-charge', 'à vérifier avec le bouton');

      const labels = { disconnected: ['non connecté', ''], connecting: ['connexion…', 'mid'], connected: ['connecté', 'ok'], reconnecting: ['reconnexion…', 'mid'] };
      badge('b-connect', ...labels[muse.state]);
      $('connect-btn').disabled = muse.state !== 'disconnected' || !Muse.supported();

      headMap.update(contact.levels);
      const good = contact.levels.filter((l) => l.label === 'bon').length;
      if (!muse.connected) {
        badge('b-contact', 'connecte le casque');
        $('tips').innerHTML = '<li class="hint">Connecte le casque pour voir la qualité de chaque capteur.</li>';
      } else {
        badge('b-contact', `${good}/4 capteurs bons`, good === 4 ? 'ok' : good >= 2 ? 'mid' : 'bad');
        const tips = contact.levels
          .map((l, i) => ({ l, name: Muse.EEG_NAMES[i] }))
          .filter(({ l }) => l.label !== 'bon')
          .map(({ l, name }) => `<li><b>${name}</b> (${l.label}) : ${l.label === 'suspect' ? GUIDE_TIP_SUSPECT : GUIDE_TIPS[name]}</li>`);
        $('tips').innerHTML = tips.length ? tips.join('') : '<li class="ok-msg">Les quatre capteurs sont bons. Tu peux passer à la calibration.</li>';
      }
    }

    $('connect-btn').onclick = async () => {
      $('connect-msg').textContent = '';
      try { await muse.connect(); } catch (e) {
        $('connect-msg').textContent = e.name === 'NotFoundError' ? 'Aucun casque choisi.' : 'Échec : ' + (e.message || e);
      }
    };
    if (!Muse.supported()) $('connect-msg').textContent = 'Web Bluetooth indisponible : utilise Chrome ou Edge.';

    const unsubscribe = [
      muse.on('eeg', (c, s) => contact.feed(c, s)),
      muse.on('state', (state) => { if (state === 'connected') contact.reset(); refresh(); }),
      muse.on('telemetry', refresh),
    ];
    const timer = setInterval(refresh, 1000);
    refresh();

    return () => { clearInterval(timer); unsubscribe.forEach((off) => off()); };
  },
});
