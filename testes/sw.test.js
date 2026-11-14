// Service worker (app instalado): uma versão publicada aparece na próxima abertura, mesmo com o cache de
// 10 minutos do GitHub Pages; e o app continua abrindo sem internet.
// Um servidor local imita o GitHub Pages (Cache-Control: max-age=600 e ETag).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');
const { RAIZ, APP } = require('./lib');

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
// CF_SW permite testar outro sw.js (ex.: uma versão antiga, para conferir que o teste a reprova).
const ARQ = { '/': APP, '/index.html': APP, '/sw.js': process.env.CF_SW || path.join(RAIZ, 'sw.js'),
  '/manifest.json': path.join(RAIZ, 'manifest.json'), '/icon-192.png': path.join(RAIZ, 'icon-192.png'), '/icon-512.png': path.join(RAIZ, 'icon-512.png') };

let versao = 1, servidor, base, navegador;
before(async () => {
  servidor = http.createServer((req, res) => {
    const caminho = req.url.split('?')[0];
    const arq = ARQ[caminho];
    if (!arq) { res.writeHead(404); return res.end(); }
    let corpo = fs.readFileSync(arq);
    // A "publicação" de uma versão nova muda só o index.html.
    if (arq === APP) corpo = Buffer.from(corpo.toString('utf8').replace('</body>', `<!-- versao-${versao} --></body>`));
    const etag = '"' + crypto.createHash('md5').update(corpo).digest('hex') + '"';
    const cab = { 'Content-Type': TIPOS[path.extname(arq)] || 'application/octet-stream', 'Cache-Control': 'max-age=600', ETag: etag };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, cab); return res.end(); }
    res.writeHead(200, cab);
    res.end(corpo);
  });
  await new Promise(ok => servidor.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${servidor.address().port}/`;
  navegador = await chromium.launch();
});
after(async () => {
  if (navegador) await navegador.close();
  servidor.close();
});

const versaoNaPagina = pg => pg.evaluate(() => (document.body.innerHTML.match(/versao-(\d+)/) || [])[1] || null);

test('app instalado: versão publicada aparece na próxima abertura e o app abre sem internet', async () => {
  const ctx = await navegador.newContext();
  const pg = await ctx.newPage();
  const erros = [];
  pg.on('pageerror', e => erros.push(e.message));
  versao = 1;

  // 1ª abertura: instala o service worker; 2ª abertura: a página já é controlada por ele.
  await pg.goto(base);
  await pg.evaluate(() => navigator.serviceWorker.ready);
  await pg.goto(base);
  assert.equal(await pg.evaluate(() => !!navigator.serviceWorker.controller), true, 'service worker não assumiu a página');
  assert.equal(await versaoNaPagina(pg), '1');

  // Publica uma versão nova. Uma abertura normal (não um "recarregar") precisa mostrá-la,
  // mesmo dentro dos 10 minutos de cache.
  versao = 2;
  await pg.goto(base);
  assert.equal(await versaoNaPagina(pg), '2', 'a versão nova não apareceu: o app usou a cópia do cache do navegador');

  // Sem internet, abre a última versão guardada.
  await ctx.setOffline(true);
  await pg.goto(base);
  assert.equal(await versaoNaPagina(pg), '2');
  assert.match(await pg.title(), /Controle Financeiro/);
  await ctx.setOffline(false);

  assert.deepEqual(erros, []);
  await ctx.close();
});

// Abre o app já controlado pelo service worker.
async function appControlado() {
  const ctx = await navegador.newContext();
  const pg = await ctx.newPage();
  pg.erros = [];
  pg.on('pageerror', e => pg.erros.push(e.message));
  await pg.goto(base);
  await pg.evaluate(() => navigator.serviceWorker.ready);
  await pg.goto(base);
  return { ctx, pg };
}

test('compartilhar a fatura pelo Android: o service worker recebe o arquivo e abre a aba Importar fatura com ele', async () => {
  const { ctx, pg } = await appControlado();
  const destino = await pg.evaluate(async () => {
    const fd = new FormData();
    fd.append('fatura', new File(['date,title,amount\n2026-10-03,Uber Trip,23.90\n2026-10-05,Padaria,8.50\n'], 'nubank.csv', { type: 'text/csv' }));
    return (await fetch('./?compartilhar=1', { method: 'POST', body: fd })).url;
  });
  assert.match(destino, /\?compartilhado=1$/);
  await pg.goto(base + '?compartilhado=1');
  await pg.waitForFunction(() => window.impFat || (typeof impFat !== 'undefined' && impFat), null, { timeout: 15000 });
  assert.deepEqual(await pg.evaluate(() => [aba, impFat.origem, impFat.itens.map(i => [i.descricao, i.valor])]), ['importar', 'nubank.csv', [['Uber Trip', 23.9], ['Padaria', 8.5]]]);
  assert.equal(await pg.evaluate(() => location.search), '', 'o endereço volta ao normal');
  // O arquivo não fica guardado depois de lido.
  assert.equal(await pg.evaluate(async () => (await (await caches.open('cf-compartilhado')).keys()).length), 0);
  // O manifest declara o compartilhamento.
  const m = await pg.evaluate(async () => (await fetch('./manifest.json')).json());
  assert.equal(m.share_target.action, './?compartilhar=1');
  assert.equal(m.share_target.params.files[0].name, 'fatura');
  assert.deepEqual(pg.erros, []);
  await ctx.close();
});

test('avisos com o app fechado: o service worker mostra cada aviso uma vez por dia, só dentro das datas', async () => {
  const { ctx, pg } = await appControlado();
  await pg.evaluate(async () => {
    const lista = [{ id: 'venc:Nubank:2026-11-10', de: '2026-11-07', ate: '2026-11-10', titulo: 'Fatura Nubank', texto: 'Vence em 10/11/2026: R$ 23,90.' },
      { id: 'cl:2026-11', de: '2026-12-05', ate: '2026-12-10', titulo: 'Check list de nov/2026', texto: 'Confira.' }];
    await (await caches.open('cf-avisos')).put(new URL('./avisos.json', location.href).href, new Response(JSON.stringify(lista)));
  });
  const [sw] = ctx.serviceWorkers();
  const r = await sw.evaluate(async () => {
    const vistos = [];
    self.registration.showNotification = async (titulo, o) => { vistos.push([titulo, o.body, o.tag]); };
    const dia1 = await mostrarAvisos('2026-11-06'), dia2 = await mostrarAvisos('2026-11-07'), dia2b = await mostrarAvisos('2026-11-07'), dia3 = await mostrarAvisos('2026-11-08');
    return { dia1, dia2, dia2b, dia3, vistos };
  });
  assert.deepEqual([r.dia1, r.dia2, r.dia2b, r.dia3], [[], ['venc:Nubank:2026-11-10'], [], ['venc:Nubank:2026-11-10']]);
  assert.deepEqual(r.vistos[0], ['Fatura Nubank', 'Vence em 10/11/2026: R$ 23,90.', 'venc:Nubank:2026-11-10']);
  // Uma versão nova do service worker não apaga os dados dos avisos (só as versões antigas do app).
  assert.ok(await pg.evaluate(async () => (await caches.keys()).includes('cf-avisos')));
  // O app grava a lista quando os avisos estão ligados.
  await pg.evaluate(async () => {
    S = Object.assign(blank(), { lancamentos: [{ id: 'l', data: mkOf(hoje()) + '-01', descricao: 'Uber', categoria: 'Transporte', forma: 'Cartão', cartao: 'Nubank', valor: 10 }] });
    S.config = Object.assign(blank().config, { cartoes: ['Nubank'], vencimentos: { Nubank: 28 } });
    lsSet('cf-avisos-on', true);
    await gravarAgendaAvisos();
  });
  const gravada = await pg.evaluate(async () => (await (await caches.open('cf-avisos')).match(new URL('./avisos.json', location.href).href)).json());
  assert.deepEqual(gravada, await pg.evaluate(() => agendaAvisos()));
  assert.deepEqual(pg.erros, []);
  await ctx.close();
});
