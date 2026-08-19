/* sw-register.js — register App Shell service worker.
 * Does not alter bootPage, loadData, or business logic.
 * Does not force reload on controllerchange (safe for mid-invoice).
 */
(function () {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  function register() {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then(function (reg) {
        // First install: sw.js calls skipWaiting + clients.claim.
        // Future updates: leave waiting — user gets them after full app close
        // (no mid-invoice reload).
        if (navigator.serviceWorker.controller) {
          console.info('[SW] controlling — offline shell should be active');
        } else {
          console.info('[SW] registered — control after activate/claim');
        }
      })
      .catch(function (err) {
        console.warn('[SW] registration failed', err);
      });
  }

  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register);
  }
})();
