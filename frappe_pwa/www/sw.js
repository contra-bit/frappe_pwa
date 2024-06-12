// Service Worker
var CACHE_NAME = 'frappe-cache-v{{ sw_version }}';

var urlsToCache = [
  '/',
  '/manifest.json',
  '{{ (favicon or "/assets/frappe/images/frappe-framework-logo.png") | abs_url }}',
  // // CSS
  '/assets/frappe/css/bootstrap.css',
  '/assets/frappe/css/hljs-night-owl.css',
  '/assets/frappe/css/tree_grid.css',
  '/assets/frappe/css/tree.css',
  '/assets/frappe/css/fonts/fontawesome/font-awesome.min.css',
  '/assets/frappe/css/fonts/fontawesome/fontawesome-webfont.ttf',
  '/assets/frappe/dist/css/desk.bundle.2YGQAYWZ.css',
  '/assets/frappe/dist/css/report.bundle.KAKXUUH6.css',
  '/assets/frappe/dist/css/login.bundle.AFYXGQEA.css',
  '/assets/frappe/dist/css/web_form.bundle.CEROZBXP.css',
  '/assets/frappe/dist/css/website.bundle.L2FKFCOO.css',
  '/assets/erpnext/dist/css/erpnext.bundle.XEMYFPAF.css',
  '/assets/frappe/dist/js/libs.bundle.5QWQF2M7.js',
  '/assets/frappe/dist/js/desk.bundle.W6MT4KYY.js',
  '/assets/frappe/dist/js/list.bundle.RQ4LTVRQ.js',
  '/assets/frappe/dist/js/form.bundle.JIXY2WBP.js',
  '/assets/frappe/dist/js/controls.bundle.MN5TXJ6P.js',
  '/assets/frappe/dist/js/report.bundle.D7VYPX2Y.js',
  '/assets/frappe/dist/js/telemetry.bundle.ESRPVZ24.js',
  '/assets/frappe/dist/js/frappe-web.bundle.FH3YVB6D.js',
  '/assets/erpnext/dist/js/erpnext.bundle.RKWHHN4W.js',
  '/assets/erpnext/dist/js/erpnext-web.bundle.J5D7LDQM.js',
  '/assets/frappe_pwa/css/pwa-alerts.css',
  '/assets/frappe/js/lib/jquery/jquery.min.js',
  '/pwa.js',
  '/sw.js',
];


// Install stage sets up the index page (home page) in the cache and opens a new cache
this.addEventListener('install', function (event) {
  console.log('[SW] Install Event processing');

  // Perform install steps
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) {
        console.log('[SW] Installing cache ' + CACHE_NAME);
        return cache.addAll(urlsToCache)
          .catch(function (err) {
            console.log('[SW] Cache install Failed: ' + err);
          });
      }).catch(function (err) {
        console.error(event.request.url, err);
        console.log('[SW] Install Failed: ' + err);
      })
  );
});

// If any fetch fails, it will look for the request in the cache and serve it from there first
this.addEventListener('fetch', function (event) {
  event.respondWith(
    fetchFromNetworkAndCache(event)
  );
});

// When activating the Service Worker, clear older caches
this.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        clearCache(key);
      }));
    }));
});

// Respond to 'push' events and trigger notifications on the registration
this.addEventListener('push', function (event) {
  let title = (event.data && event.data.text());
  let tag = "push-frappe-notification";
  let icon = '{{ (favicon or "/assets/frappe/images/frappe-framework-logo.png") | abs_url }}';

  event.waitUntil(
    self.registration.showNotification(title, { icon, tag })
  );
});


function fetchFromNetworkAndCache(event) {
  // DevTools opening will trigger these o-i-c requests, which this SW can't handle.
  // There's probably more going on here, but I'd rather just ignore this problem. :)
  // https://github.com/paulirish/caltrainschedule.io/issues/49
  if (event.request.cache === 'only-if-cached' && event.request.mode !== 'same-origin') {
    return;
  }

  // Check if the request is a database call (you might need to adjust this condition based on your Frappe instance URLs)
  // if (event.request.url.includes('/api/method/frappe.desk.form.load.getdoc?doctype') || event.request.url.includes('/api/resource/')) {
  if (event.request.url.includes('/api/method/frappe.desk.form.load.getdoc?doctype') || event.request.url.includes('api/method/frappe.desk.form.load.getdoctype?doctype')) {
    // Extract the original request URL
    let originalUrl = event.request.url;

    // Find the index of "&cached_timestamp="
    let index = originalUrl.indexOf("&cached_timestamp=");

    // Extract the part of the string before "&cached_timestamp="
    let modifiedUrl = originalUrl.substring(0, index);

    // Create a new Request object with the modified URL
    let modifiedRequest = new Request(modifiedUrl, {
      method: event.request.method,
      headers: event.request.headers,
      mode: event.request.mode,
      credentials: event.request.credentials,
      redirect: event.request.redirect,
      referrer: event.request.referrer,
      referrerPolicy: event.request.referrerPolicy,
      integrity: event.request.integrity,
      cache: event.request.cache,
      body: event.request.body, // Include the body if it's a POST request
    });

    // Handle database calls by caching the response
    if (event.request.method === 'GET') {
      return fetch(event.request).then(function (res) {
        // Only cache successful responses
        if (res.ok) {
          // Clone the response before caching to avoid consuming it
          const responseToCache = res.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(modifiedRequest, responseToCache);
          });
        }
        return res;
      }).catch(function (err) {
        console.error(modifiedUrl, err);
        console.log('[SW] Network request Failed. Serving content from cache: ' + err);
        return fromCache(modifiedRequest);
      });
    } else {
      // Don't cache non-GET requests
      return fetch(event.request);
    }
  }


  // For non-database calls, fetch from the network and cache the response
  return fetch(event.request).then(function (res) {
    // foreign requests may be res.type === 'opaque' and missing a url
    if (!res.url) {
      return res;
    }
    // Only cache GET requests
    if (event.request.method !== 'GET') {
      return res;
    }
    // Regardless, we don't want to cache other origin's assets
    if (new URL(res.url).origin !== location.origin) {
      return res;
    }

    // If request was successful, add or update it in the cache
    updateCache(event.request, res.clone());
    // TODO: figure out if the content is new and therefore the page needs a reload.

    return res;
  }).catch(function (err) {
    console.log('[SW] Network request Failed. Serving content from cache: ' + err);
    return fromCache(event.request);
  });
}

function handleNoCacheMatch(event) {
  return fetchFromNetworkAndCache(event);
}

async function fromCache(request) {
  // Check to see if you have it in the cache
  // Return response
  // If not in the cache, then return error page
  caches.open(CACHE_NAME).then(async function (cache) {

    if (request.url.includes('/api/method/frappe.desk.form.load.getdoc?doctype') || request.url.includes('api/method/frappe.desk.form.load.getdoctype?doctype')) {
      let originalUrl = request.url;

      // Find the index of "&cached_timestamp="
      let index = originalUrl.indexOf("&cached_timestamp=");

      // Extract the part of the string before "&cached_timestamp="
      let modifiedUrl = originalUrl.substring(0, index);

      // Create a new Request object with the modified URL
      let modifiedRequest = new Request(modifiedUrl, {
        method: request.method,
        headers: request.headers,
        mode: request.mode,
        credentials: request.credentials,
        redirect: request.redirect,
        referrer: request.referrer,
        referrerPolicy: request.referrerPolicy,
        integrity: request.integrity,
        cache: request.cache,
        body: request.body, // Include the body if it's a POST request
      });

      return cache.match(modifiedRequest.url).then(function (matching) {
        if (matching) {
          // If a match is found, log the response data
          matching.text().then(function (responseData) {
            return responseData;
          });
          // return matching;
        } else {
          return null;
        }
      });
    }

    else {
      return cache.match(request.url).then(function (matching) {
        console.log('Matching request:', request.url);
        if (matching) {
          // If a match is found, log the response data
          matching.text().then(function (responseData) {
            console.log('Response data:', responseData);
          });
          return matching;
        } else {
          console.log('No match found in cache for', request.url);
          return null;
        }
      });
    }
  });
}

function updateCache(request, response) {
  if (response.status === 200) {
    return caches.open(CACHE_NAME).then(function (cache) {
      return cache.put(request, response);
    });
  }
}

function clearCache(key) {
  if (key !== CACHE_NAME) {
    console.log('[SW] Cleaning cache ' + key);
    return caches.delete(key);
  }
}
