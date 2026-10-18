/* Profils (globale `Profiles`) : plusieurs personnes (ou configurations) sur la même application, chacune avec ses
 * réglages, ses critères et ses échantillons. Persistants d'une session à l'autre (localStorage). Sans interface :
 * voir ui/profile-menu.js. À charger AVANT les autres briques qui lisent des réglages.
 *
 *   Profiles.init()                       // au démarrage (app/shell.js) ; crée « Profil 1 » au premier lancement
 *   Profiles.active()                     // { id, name, createdAt } du profil actif
 *   Profiles.list()  Profiles.create(nom)  Profiles.rename(id, nom)  Profiles.remove(id)  Profiles.switchTo(id)
 *   Profiles.get(clé, défaut)  Profiles.set(clé, valeur)  Profiles.unset(clé)     // réglages du profil ACTIF
 *   Profiles.label(profil?)               // étiquette BIDS du sujet (lettres et chiffres), ex. « annelise »
 *   Profiles.onChange(fn)                 // appelé après un changement de profil actif
 *   Profiles.exportProfile(id) / importProfile(objet)   // sauvegarde / restauration des réglages (JSON)
 *   Profiles.sandbox(true|false)          // bac à sable : get/set/unset en mémoire seulement, oubliés à la sortie
 *                                         //   (démonstrations qui ne doivent pas toucher aux vrais réglages)
 *
 * Clés de réglages utilisées par l'application (une valeur JSON par profil) :
 *   calibration          seuils d'artefacts (lib/calibration.js)
 *   artifactSensitivity  sensibilité de la détection (ui/artifact-panel.js)
 *   pipeline             réglages d'amélioration du signal (lib/filters.js)
 *   liveEnhance          interrupteur « Amélioration numérique » de Capteurs en direct
 *   mentalBaseline       référence de l'état mental (lib/mental-baseline.js, projets/03-etat)
 *   alphaProfile         profil alpha : réactivité yeux fermés, pic alpha (lib/alpha-calibration.js)
 *   calibrationChoice    choix de la calibration générale { off: [ids décochés], challenge, voice } (projets/06-calibration)
 * Les échantillons portent le profil qui les a créés (rec.profile) et son étiquette de sujet BIDS (rec.subject) ;
 * la mémoire des 30 dernières secondes, elle, est commune (c'est celle du casque).
 *
 * Stockage : « <préfixe>.profiles » = { active, list } et « <préfixe>.p.<id>.<clé> » pour chaque réglage.
 * Où : EN DUR dans profils/profils.json quand l'app est servie par serveur.py (GET/PUT /api/profils ; lecture synchrone au
 * démarrage, écriture différée de 150 ms). Sans serveur (file://, autre hébergement) : localStorage. Au premier lancement
 * avec le disque, les profils déjà dans le navigateur sont recopiés dans le fichier (le navigateur n'est pas vidé).
 * init({ disk: false }) force localStorage (les tests).
 * Préfixe « muse2 » par défaut ; les tests utilisent un autre préfixe pour ne jamais toucher aux vrais réglages.
 * Premier lancement : les réglages d'avant les profils (muse2.calibration, muse2.pipeline…) sont repris dans « Profil 1 ».
 */
const Profiles = {
  prefix: 'muse2',
  _state: null,
  _listeners: [],
  // Réglages d'avant les profils : « <préfixe>.calibration », « <préfixe>.pipeline », etc.
  LEGACY: { calibration: 'calibration', pipeline: 'pipeline', mentalBaseline: 'mental.baseline', liveEnhance: 'live.enhance' },
  KEYS: ['calibration', 'artifactSensitivity', 'pipeline', 'liveEnhance', 'mentalBaseline', 'alphaProfile', 'calibrationChoice', 'gazeMap', 'gazeSetup'],

  URL: '/api/profils',
  _disk: false,           // vrai : tout est lu/écrit dans profils/profils.json via serveur.py (copie en mémoire _mem)
  _mem: new Map(),
  _timer: null,

  _ls: {
    get(k) {
      if (Profiles._disk) return Profiles._mem.has(k) ? Profiles._mem.get(k) : null;
      try { return localStorage.getItem(k); } catch (e) { return null; }
    },
    set(k, v) {
      if (Profiles._disk) { Profiles._mem.set(k, v); Profiles._flushSoon(); return; }
      try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ }
    },
    del(k) {
      if (Profiles._disk) { Profiles._mem.delete(k); Profiles._flushSoon(); return; }
      try { localStorage.removeItem(k); } catch (e) { /* ignoré */ }
    },
  },

  // Lecture synchrone au démarrage (le serveur est local : quelques ms). Faux si pas de serveur → localStorage.
  _loadDisk(prefix) {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', Profiles.URL, false);
      xhr.send();
      if (xhr.status !== 200) return false;
      const data = JSON.parse(xhr.responseText);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
      Profiles._mem = new Map(Object.entries(data));
      Profiles._disk = true;
      if (!Profiles._mem.size) { // premier lancement avec le disque : reprise des profils déjà dans le navigateur
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k.startsWith(prefix + '.')) Profiles._mem.set(k, localStorage.getItem(k));
          }
        } catch (e) { /* stockage indisponible */ }
        if (Profiles._mem.size) Profiles._flush();
      }
      return true;
    } catch (e) { return false; }
  },
  _flushSoon() { clearTimeout(Profiles._timer); Profiles._timer = setTimeout(Profiles._flush, 150); },
  _flush() {
    clearTimeout(Profiles._timer); Profiles._timer = null;
    try { fetch(Profiles.URL, { method: 'PUT', body: JSON.stringify(Object.fromEntries(Profiles._mem)), keepalive: true }).catch(() => {}); } catch (e) { /* ignoré */ }
  },

  // Écriture en attente au moment de quitter la page : on l'envoie tout de suite
  _onHide() { if (Profiles._timer) Profiles._flush(); },

  // disk : profils sur le disque si le serveur est là (par défaut pour le vrai préfixe ; les tests restent dans localStorage)
  init({ prefix = 'muse2', disk = prefix === 'muse2' } = {}) {
    Profiles.prefix = prefix;
    Profiles._disk = false; Profiles._mem = new Map();
    if (disk && Profiles._loadDisk(prefix) && typeof addEventListener === 'function') addEventListener('pagehide', Profiles._onHide);
    let st = null;
    try { st = JSON.parse(Profiles._ls.get(prefix + '.profiles')); } catch (e) { st = null; }
    if (!st || !Array.isArray(st.list) || !st.list.length) {
      st = { active: 'p1', next: 2, list: [{ id: 'p1', name: 'Profil 1', createdAt: new Date().toISOString() }] };
      Profiles._state = st;
      { // reprise des réglages d'avant les profils
        for (const [k, suffix] of Object.entries(Profiles.LEGACY)) {
          const old = prefix + '.' + suffix, v = Profiles._ls.get(old);
          if (v != null) { Profiles._ls.set(Profiles._key(k, 'p1'), k === 'liveEnhance' ? JSON.stringify(v === '1') : v); Profiles._ls.del(old); }
        }
      }
      Profiles._save();
    }
    if (!st.list.some((p) => p.id === st.active)) st.active = st.list[0].id;
    Profiles._state = st;
    return Profiles.active();
  },

  _ensure() { if (!Profiles._state) Profiles.init({ prefix: Profiles.prefix }); },
  _save() { Profiles._ls.set(Profiles.prefix + '.profiles', JSON.stringify(Profiles._state)); },
  _key(name, id) { return `${Profiles.prefix}.p.${id}.${name}`; },

  list() { Profiles._ensure(); return Profiles._state.list.map((p) => ({ ...p })); },
  active() { Profiles._ensure(); return { ...Profiles._state.list.find((p) => p.id === Profiles._state.active) }; },
  activeId() { Profiles._ensure(); return Profiles._state.active; },
  // Profil auquel appartiennent les échantillons créés avant les profils : le premier de la liste
  defaultId() { Profiles._ensure(); return Profiles._state.list[0].id; },

  create(name) {
    Profiles._ensure();
    const st = Profiles._state, id = 'p' + (st.next || st.list.length + 1);
    st.next = (st.next || st.list.length + 1) + 1;
    st.list.push({ id, name: Profiles._cleanName(name) || 'Profil ' + id.slice(1), createdAt: new Date().toISOString() });
    Profiles._save();
    return id;
  },

  rename(id, name) {
    Profiles._ensure();
    const p = Profiles._state.list.find((x) => x.id === id);
    if (p && Profiles._cleanName(name)) { p.name = Profiles._cleanName(name); Profiles._save(); Profiles._emit(); }
  },

  // Supprime un profil et ses réglages (pas ses échantillons : voir ui/profile-menu.js). Impossible sur le dernier.
  remove(id) {
    Profiles._ensure();
    const st = Profiles._state;
    if (st.list.length <= 1) throw new Error('Impossible de supprimer le dernier profil.');
    st.list = st.list.filter((p) => p.id !== id);
    Profiles.KEYS.forEach((k) => Profiles._ls.del(Profiles._key(k, id)));
    const changed = st.active === id;
    if (changed) st.active = st.list[0].id;
    Profiles._save();
    if (changed) Profiles._emit();
  },

  switchTo(id) {
    Profiles._ensure();
    if (id === Profiles._state.active || !Profiles._state.list.some((p) => p.id === id)) return;
    Profiles._state.active = id;
    Profiles._save();
    Profiles._emit();
  },

  get(name, fallback = null, id = null) {
    Profiles._ensure();
    const key = Profiles._key(name, id || Profiles._state.active), sb = Profiles._sandbox;
    const v = sb && sb.has(key) ? sb.get(key) : Profiles._ls.get(key);
    if (v == null) return fallback;
    try { return JSON.parse(v); } catch (e) { return fallback; }
  },
  set(name, value, id = null) {
    Profiles._ensure();
    const key = Profiles._key(name, id || Profiles._state.active);
    if (Profiles._sandbox) Profiles._sandbox.set(key, JSON.stringify(value)); else Profiles._ls.set(key, JSON.stringify(value));
  },
  unset(name, id = null) {
    Profiles._ensure();
    const key = Profiles._key(name, id || Profiles._state.active);
    if (Profiles._sandbox) Profiles._sandbox.set(key, null); else Profiles._ls.del(key);
  },

  // Bac à sable : tant qu'il est actif, les réglages modifiés restent en mémoire ; le quitter les oublie.
  _sandbox: null,
  sandbox(on) { Profiles._sandbox = on ? Profiles._sandbox || new Map() : null; },
  get sandboxed() { return !!Profiles._sandbox; },

  _cleanName(s) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 40); },

  label(profile = null) {
    const p = profile || Profiles.active();
    const l = String(p.name).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    return l || p.id;
  },

  onChange(fn) { Profiles._listeners.push(fn); return () => { Profiles._listeners = Profiles._listeners.filter((f) => f !== fn); }; },
  _emit() { Profiles._listeners.forEach((fn) => fn(Profiles.active())); },

  exportProfile(id = null) {
    Profiles._ensure();
    const p = Profiles._state.list.find((x) => x.id === (id || Profiles._state.active)), settings = {};
    Profiles.KEYS.forEach((k) => { const v = Profiles.get(k, null, p.id); if (v != null) settings[k] = v; });
    return { schema: 'muse2lab/profile', version: 1, name: p.name, exportedAt: new Date().toISOString(), settings };
  },

  importProfile(obj) {
    if (!obj || obj.schema !== 'muse2lab/profile') throw new Error('Ce fichier n’est pas un profil Muse 2 Lab.');
    const id = Profiles.create(obj.name + (Profiles.list().some((p) => p.name === obj.name) ? ' (importé)' : ''));
    Object.entries(obj.settings || {}).forEach(([k, v]) => { if (Profiles.KEYS.includes(k)) Profiles.set(k, v, id); });
    return id;
  },
};
