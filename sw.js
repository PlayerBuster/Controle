// Service worker: guarda o app para abrir sem internet.
// Usa a rede primeiro e sempre confere com o servidor (cache: 'no-cache'), para que uma versão nova
// apareça na próxima abertura, sem esperar os 10 minutos de cache do GitHub Pages.
const CACHE = 'controle-financeiro-v4';
const ARQUIVOS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS.map(u => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(chaves => Promise.all(chaves.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Busca no servidor ignorando o cache do navegador (ele responde 304 rapidamente se nada mudou).
// Se o servidor redirecionar, usa a requisição original, porque uma navegação não aceita resposta redirecionada.
const daRede = req => fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
  .then(resp => (resp.redirected ? fetch(req) : resp));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // Só o próprio site: nunca guarda respostas do Google (login e Drive).
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    daRede(req)
      .then(resp => {
        if (resp.ok) {
          const copia = resp.clone();
          caches.open(CACHE).then(c => c.put(req, copia));
        }
        return resp;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
