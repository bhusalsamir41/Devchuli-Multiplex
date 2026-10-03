const CACHE='devchuli-v1';
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/','/static/style.css','/static/manifest.webmanifest','/static/icon.svg']))));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;event.respondWith(fetch(event.request).catch(()=>caches.match(event.request).then(r=>r||caches.match('/'))));});
