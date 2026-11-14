// Service worker: guarda o app para abrir sem internet.
// Usa a rede primeiro e sempre confere com o servidor (cache: 'no-cache'), para que uma versão nova
// apareça na próxima abertura, sem esperar os 10 minutos de cache do GitHub Pages.
// Também recebe a fatura pelo "Compartilhar" do Android e mostra os avisos de vencimento com o app fechado.
const CACHE = 'controle-financeiro-v4';
const ARQUIVOS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS.map(u => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});

// Apaga só versões antigas do app; "cf-avisos" e "cf-compartilhado" são dados do app e ficam.
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(chaves => Promise.all(chaves.filter(k => k.startsWith('controle-financeiro-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Busca no servidor ignorando o cache do navegador (ele responde 304 rapidamente se nada mudou).
// Se o servidor redirecionar, usa a requisição original, porque uma navegação não aceita resposta redirecionada.
const daRede = req => fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
  .then(resp => (resp.redirected ? fetch(req) : resp));

// Fatura compartilhada (manifest.json, share_target): guarda os arquivos e abre o app, que os lê na aba Importar fatura.
async function receberCompartilhado(req) {
  const dados = await req.formData();
  const arquivos = dados.getAll('fatura').filter(f => f && typeof f === 'object' && 'name' in f);
  const c = await caches.open('cf-compartilhado');
  for (const k of await c.keys()) await c.delete(k);
  await Promise.all(arquivos.map((f, i) => c.put(new URL(`./compartilhado/${i}`, self.registration.scope).href,
    new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-Nome': encodeURIComponent(f.name || 'fatura') } }))));
  return Response.redirect(new URL('./?compartilhado=1', self.registration.scope).href, 303);
}

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method === 'POST' && url.origin === self.location.origin && url.searchParams.has('compartilhar')) {
    e.respondWith(receberCompartilhado(req));
    return;
  }
  if (req.method !== 'GET') return;
  // Só o próprio site: nunca guarda respostas do Google (login e Drive).
  if (url.origin !== self.location.origin) return;
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

// Avisos: o app grava em "cf-avisos" a lista do que avisar ({ id, de, ate, titulo, texto }). Cada aviso aparece
// no máximo uma vez por dia, entre as datas "de" e "ate".
const diaLocal = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
async function mostrarAvisos(dia = diaLocal()) {
  const c = await caches.open('cf-avisos');
  const url = n => new URL(`./${n}`, self.registration.scope).href;
  const r = await c.match(url('avisos.json'));
  if (!r) return [];
  const lista = await r.json();
  const mr = await c.match(url('mostrados.json')), mostrados = mr ? await mr.json() : {};
  const hojeAvisos = lista.filter(a => a.de <= dia && dia <= a.ate && mostrados[a.id] !== dia);
  for (const a of hojeAvisos) {
    await self.registration.showNotification(a.titulo, { body: a.texto, tag: a.id, icon: 'icon-192.png', data: { url: self.registration.scope } });
    mostrados[a.id] = dia;
  }
  await c.put(url('mostrados.json'), new Response(JSON.stringify(mostrados), { headers: { 'Content-Type': 'application/json' } }));
  return hojeAvisos.map(a => a.id);
}
self.addEventListener('periodicsync', e => {
  if (e.tag === 'cf-avisos') e.waitUntil(mostrarAvisos());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(janelas => (janelas.length ? janelas[0].focus() : self.clients.openWindow(self.registration.scope))));
});
