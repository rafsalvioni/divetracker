const CACHE_NAME = 'V1';
const root = '/divetracker/';
const STATIC_CACHE_URLS = [
    root,
    root + 'app.css',
    root + 'bin/app.js',
    root + 'bin/config.js',
    root + 'lib/dist.js',
    root + 'lib/geo.js',
    root + 'lib/trigo.js',
    root + 'lib/gpx.js',
    root + 'lib/magvar.js',
    root + 'lib/map.js',
    root + 'lib/position.js',
    root + 'lib/proto.js',
    root + 'lib/sensor.js',
    root + 'lib/wake.js'
];

self.addEventListener('install', event => {
    console.log('Service Worker installing.');
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_CACHE_URLS))  
    )
});

self.addEventListener('fetch', event => {
    console.log(`Request of ${event.request.url}`);
    // default behaviour: request the network
    event.respondWith(
        caches.match(event.request) // check if the request has already been cached
        .then(cached => cached || fetch(event.request)) // otherwise request network
    );
});

self.addEventListener('activate', event => {
    // delete any unexpected caches
    event.waitUntil(
        caches.keys()
            .then(keys => keys.filter(key => key !== CACHE_NAME))
            .then(keys => Promise.all(keys.map(key => {
                console.log(`Deleting cache ${key}`);
                return caches.delete(key)
                }))
            )
    );
});