// Never cache authenticated HTML, artwork, audio or API data across logout.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key.startsWith('wave-shell-')).map(key => caches.delete(key)));
  await self.clients.claim();
})()));
// All requests use the network and server-side authentication.
