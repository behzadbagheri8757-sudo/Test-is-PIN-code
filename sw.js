/* sw.js — App Shell only. Never touches IndexedDB or CRM business data.
 *
 * Goal: one successful online visit → full shell in Cache Storage →
 * entire CRM usable offline, including customer.html?id=… never opened before.
 *
 * CACHE_NAME: bump on every deploy that changes static assets.
 */
'use strict';

const CACHE_NAME = 'baqeri-shell-v7';

/** App Shell — paths relative to this SW (same directory as index.html). */
const PRECACHE_URLS = [
  './index.html',
  './customers.html',
  './customer.html',
  './products.html',
  './inventory.html',
  './suppliers.html',
  './supplier.html',
  './invoices.html',
  './invoice.html',
  './payments.html',
  './checks.html',
  './visits.html',
  './reports.html',
  './settings.html',
  './prospects.html',
  './prospect.html',
  './evaluation.html',
  './prospect-routes.html',
  './css/app.css',
  './js/models.js',
  './js/ui.js',
  './js/db.js',
  './js/calc.js',
  './js/stock.js',
  './js/payments.js',
  './js/backup.js',
  './js/pin-lock.js',
  './js/nav.js',
  './js/app.js',
  './js/prospect-scoring.js',
  './js/prospect-db.js',
  './js/prospect-core.js',
  './js/sw-register.js',
  './vendor/xlsx.full.min.js',
  './vendor/html2canvas.min.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './logo-export.png'
];

/** HTML shells that must exist for install to be considered successful. */
const CRITICAL_SHELLS = [
  './index.html',
  './customers.html',
  './customer.html',
  './invoices.html',
  './invoice.html',
  './css/app.css',
  './js/db.js',
  './js/nav.js',
  './js/app.js',
  './js/models.js',
  './js/ui.js'
];

/**
 * Precache each URL individually.
 * One 404 must NOT wipe the whole install (unlike cache.addAll all-or-nothing).
 * Install fails only if a critical shell is missing.
 */
function precacheShell() {
  return caches.open(CACHE_NAME).then(function (cache) {
    return Promise.all(
      PRECACHE_URLS.map(function (url) {
        return fetch(url, { cache: 'reload' })
          .then(function (response) {
            if (!response || !response.ok) {
              throw new Error('HTTP ' + (response && response.status));
            }
            return cache.put(url, response);
          })
          .then(function () {
            return { url: url, ok: true };
          })
          .catch(function (err) {
            console.error('[SW] precache failed:', url, err && err.message);
            return { url: url, ok: false, err: String(err && err.message || err) };
          });
      })
    ).then(function (results) {
      var failed = results.filter(function (r) { return !r.ok; });
      var criticalFailed = failed.filter(function (r) {
        return CRITICAL_SHELLS.indexOf(r.url) !== -1;
      });
      if (failed.length) {
        console.warn('[SW] precache non-critical failures:', failed.length);
      }
      if (criticalFailed.length) {
        console.error('[SW] CRITICAL precache failures:', criticalFailed);
        return Promise.reject(new Error(
          'Critical shell missing: ' + criticalFailed.map(function (r) { return r.url; }).join(', ')
        ));
      }
      return results;
    });
  });
}

self.addEventListener('install', function (event) {
  // Activate as soon as install succeeds so the SAME day offline session
  // can use the precache (first-install readiness).
  // clients.claim is in activate — does not reload an open page by itself.
  event.waitUntil(
    precacheShell().then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (key) {
          if (key !== CACHE_NAME && key.indexOf('baqeri-shell-') === 0) {
            return caches.delete(key);
          }
        })
      );
    }).then(function () {
      // Take control of open pages so the next navigation is offline-capable
      // without requiring a second visit. Does not force reload mid-form.
      return self.clients.claim();
    })
  );
});

/** Last path segment, e.g. /repo/customer.html → customer.html */
function fileNameFromUrl(url) {
  var path = url.pathname || '';
  if (!path || path.charAt(path.length - 1) === '/') {
    return 'index.html';
  }
  var parts = path.split('/');
  var last = parts[parts.length - 1] || '';
  if (!last || last.indexOf('.') === -1) {
    return 'index.html';
  }
  return last;
}

/** Find a cached response whose URL ends with /filename or equals filename. */
function matchByFileName(cache, filename) {
  return cache.keys().then(function (keys) {
    for (var i = 0; i < keys.length; i++) {
      try {
        var u = new URL(keys[i].url);
        var name = u.pathname.split('/').pop();
        if (name === filename) {
          return cache.match(keys[i]);
        }
      } catch (e) { /* continue */ }
    }
    return undefined;
  });
}

/**
 * Resolve HTML shell for a navigation request.
 * Query string is ignored: customer.html?id=1 and ?id=999 → customer.html
 */
function respondNavigate(request) {
  var url = new URL(request.url);
  var shellName = fileNameFromUrl(url);

  return caches.open(CACHE_NAME).then(function (cache) {
    // 1) Standard match ignoring ?id= / ?shopId=
    return cache.match(request, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;

      // 2) Match by filename (handles base-path / relative key differences)
      return matchByFileName(cache, shellName).then(function (byName) {
        if (byName) return byName;

        // 3) Online: fetch shell, put in cache, return (helps first nav after claim)
        return fetch(request)
          .then(function (networkResponse) {
            if (networkResponse && networkResponse.ok) {
              try {
                cache.put('./' + shellName, networkResponse.clone());
              } catch (e2) { /* ignore */ }
            }
            return networkResponse;
          })
          .catch(function () {
            // 4) Offline miss: prefer index shell over blank
            return matchByFileName(cache, 'index.html').then(function (idx) {
              if (idx) return idx;
              return new Response(
                'آفلاین — App Shell هنوز روی این دستگاه آماده نشده. یک‌بار با اینترنت برنامه را باز کنید، چند ثانیه صبر کنید، ببندید و دوباره آفلاین باز کنید.',
                {
                  status: 503,
                  statusText: 'Offline',
                  headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                }
              );
            });
          });
      });
    });
  });
}

/** Cache-first for static assets (JS/CSS/vendor/icons/logo). */
function respondStatic(request) {
  var url = new URL(request.url);
  var name = fileNameFromUrl(url);

  return caches.open(CACHE_NAME).then(function (cache) {
    return cache.match(request, { ignoreSearch: true }).then(function (cached) {
      if (cached) return cached;

      return matchByFileName(cache, name).then(function (byName) {
        if (byName) return byName;

        return fetch(request)
          .then(function (response) {
            if (response && response.ok) {
              try {
                cache.put(request, response.clone());
              } catch (e) { /* ignore */ }
            }
            return response;
          })
          .catch(function () {
            return new Response('', { status: 503, statusText: 'Offline' });
          });
      });
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') {
    return;
  }

  var url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }

  // Same-origin only
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(respondNavigate(request));
    return;
  }

  event.respondWith(respondStatic(request));
});

// Optional: page can postMessage({type:'SKIP_WAITING'}) for controlled updates later
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
