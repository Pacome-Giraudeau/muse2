/* Résumé : attend les tests asynchrones (window.ASYNC_TESTS) puis affiche TOUT PASSE ou le nombre d'échecs.
 * Avec ?report=<url>, envoie aussi le texte du rapport à cette adresse (POST) : sert à lancer les tests en ligne de
 * commande en temps réel, car le mode « temps virtuel » de Chrome sans interface bloque IndexedDB. */
Promise.all(window.ASYNC_TESTS || []).then(() => {
  // Un fichier de test qui ne se charge pas (erreur de syntaxe…) serait ignoré en silence : on le compte comme échec
  (window.SCRIPT_ERRORS || []).forEach((e) => { failures++; out.innerHTML += `<span class="fail">FAIL</span> script non chargé : ${e}\n`; });
  out.innerHTML += failures ? '<span class="fail">' + failures + ' ÉCHEC(S)</span>' : '<span class="pass">TOUT PASSE</span>';
  const report = new URLSearchParams(location.search).get('report');
  if (report) navigator.sendBeacon(report, out.textContent);
});
