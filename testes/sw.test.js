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
