/* Page « Rapports critiques » (section Développement de l'accueil) : liste de tous les rapports critiques établis,
 * du plus récent au plus ancien, avec un lien vers chacun (#/dev/<id>). La liste vient de CATALOGUE.rapports.
 * Chargée à la demande par app/shell.js (même contrat qu'un projet : Projets.register).
 * Ajouter un rapport : créer dev/rapports/AAAA-MM-JJ.js (id 'rapport-AAAA-MM-JJ'), puis une entrée dans CATALOGUE.rapports. */
Projets.register({
  id: 'rapports',

  template: `
    <header class="proj-head">
      <a class="back" href="#/">← Accueil</a>
      <h1>Rapports critiques</h1>
    </header>
    <p class="intro">Revues de l’application : architecture, cohérence scientifique et technique, constats classés par gravité et recommandations. Chaque rapport est daté et garde l’état du code au jour de la revue.</p>
    <div class="cards" id="rapports-liste"></div>`,

  mount(root) {
    const dateFr = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    const liste = [...CATALOGUE.rapports].sort((a, b) => b.date.localeCompare(a.date));
    root.querySelector('#rapports-liste').innerHTML = liste.length ? liste.map((r) => `
      <a class="card" href="#/dev/${r.id}">
        <div class="emoji">${r.emoji}</div>
        <h3>${r.titre}</h3>
        <p>${r.description}</p>
        <span class="tag">${dateFr(r.date)}</span>
      </a>`).join('') : '<p class="hint">Aucun rapport pour l’instant.</p>';
    return () => {};
  },
});
