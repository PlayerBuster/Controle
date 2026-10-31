// Service worker: guarda o app para abrir sem internet.
// Usa a rede primeiro, para receber sempre a versão mais nova quando há conexão.
const CACHE = 'controle-financeiro-v3';
const ARQUIVOS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(chaves => Promise.all(chaves.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // Só o próprio site: nunca guarda respostas do Google (login e Drive).
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then(resp => {
        const copia = resp.clone();
        caches.open(CACHE).then(c => c.put(req, copia));
        return resp;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
