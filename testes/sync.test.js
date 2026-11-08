// Sincronização: dois aparelhos e um "Drive" falso em memória. Testa a cifragem e a mesclagem de verdade do app,
// com todos os tipos de dado. O login no Google e o Drive real não entram aqui; isso só dá para testar com a conta do usuário.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { abrirApp, fecharNavegador, definirDados, avaliar } = require('./lib');

after(async () => { await fecharNavegador(); });

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
function driveFalso() {
  const d = { conteudo: null, escritas: 0 };
  d.ligar = pg => pg.route('https://www.googleapis.com/**', async route => {
    const req = route.request(), url = req.url(), metodo = req.method();
    if (metodo === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (metodo === 'GET' && url.includes('alt=media')) return route.fulfill({ status: 200, headers: CORS, body: d.conteudo });
    if (metodo === 'GET') return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ files: d.conteudo ? [{ id: 'arq' }] : [] }) });
    const corpo = req.postData();
    if (metodo === 'PATCH') d.conteudo = corpo;
    else d.conteudo = corpo.split('application/octet-stream\r\n\r\n')[1].split('\r\n--')[0];
    d.escritas++;
    return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ id: 'arq' }) });
  });
  return d;
}
const conectar = (pg, senha = 'senha-de-teste') => pg.evaluate(s => {
  syncCfg.clientId = 'teste';
  ssSet('cf-token', 't'); ssSet('cf-exp', String(Date.now() + 3600000)); ssSet('cf-senha', s);
}, senha);
const sincronizarJa = async pg => { await pg.evaluate(() => sincronizar()); return avaliar(pg, `syncEstado`); };

const DADOS = {
  config: { cartoes: ['Nubank'], primeiroMes: '2026-11', vencimentos: { Nubank: 10 } },
  recorrentes: [{ id: 'r', descricao: 'Salário secreto', grupo: 'Receita', cartao: '', categoria: 'Outros', valor: 3000, inicio: '2020-01-01', fim: '' }],
  lancamentos: [{ id: 'l', data: '2026-11-05', descricao: 'Lanche', categoria: 'Lazer', forma: 'Cartão', cartao: 'Nubank', valor: 42, prox: true }],
  parcelados: [{ id: 'p', dataCompra: '2026-11-01', cartao: 'Nubank', descricao: 'TV', categoria: 'Outros', valorTotal: 1200, parcelas: 12, inicio: '2026-11' }],
  estornos: [{ id: 'e', parcelaId: 'p', tipo: 'Estorno', mes: '2026-12', valor: 10, descricao: '' }],
  creditos: [{ id: 'c', cartao: 'Nubank', mes: '2026-11', valor: 5, descricao: 'Ajuste' }],
  movConta: [{ id: 'm', data: '2026-11-05', descricao: 'Depósito', tipo: 'Entrada', valor: 100 }],
  planoFerias: [{ id: 'f', descricao: 'Férias', valor: 4000, de: '2027-01', ate: '2027-02' }],
  checklist: { '2026-10': { fora: 'nao', itens: { 'fat:Nubank': { pago: true, valor: 100 } } } }
};
const CAMPOS = `['recorrentes', 'lancamentos', 'parcelados', 'estornos', 'creditos', 'movConta', 'planoFerias', 'checklist'].map(k => S[k]).concat([S.config.vencimentos])`;

test('sincronização: o que vai para o Drive é cifrado e o outro aparelho recebe todos os dados', { timeout: 60000 }, async () => {
  const drive = driveFalso();
  const a = await abrirApp(), b = await abrirApp();
  await drive.ligar(a); await drive.ligar(b);
  await definirDados(a, DADOS);
  await conectar(a); await conectar(b);
  assert.match(await sincronizarJa(a), /Sincronizado/);
  // No arquivo do Drive não há nada legível.
  assert.ok(drive.conteudo);
  assert.doesNotMatch(drive.conteudo, /Salário|Lanche|Nubank|Férias/);
  assert.deepEqual(Object.keys(JSON.parse(drive.conteudo)).sort(), ['data', 'iv', 'salt', 'v']);
  assert.match(await sincronizarJa(b), /Sincronizado/);
  assert.deepEqual(await avaliar(b, CAMPOS), await avaliar(a, CAMPOS));
  assert.deepEqual(a.erros, []); assert.deepEqual(b.erros, []);
  await a.fechar(); await b.fechar();
});

test('sincronização: alterações diferentes nos dois aparelhos são combinadas', { timeout: 60000 }, async () => {
  const drive = driveFalso();
  const a = await abrirApp(), b = await abrirApp();
  await drive.ligar(a); await drive.ligar(b);
  await definirDados(a, DADOS);
  await conectar(a); await conectar(b);
  await sincronizarJa(a); await sincronizarJa(b);
  // Cada aparelho muda uma coisa diferente, sem sincronizar no meio.
  await a.evaluate(() => {
    S.planoFerias.push({ id: 'f2', descricao: 'Saldo', valor: 500, de: '2027-02', ate: '2027-02' });
    S.checklist['2026-11'] = { itens: { 'fat:Nubank': { pago: true, valor: 200 } } };
    S.config.vencimentos.Outro = 5;
  });
  await b.evaluate(() => {
    S.movConta.push({ id: 'm2', data: '2026-11-06', descricao: 'Pix recebido', tipo: 'Entrada', valor: 50 });
    S.checklist['2026-10'].itens['rec:r'] = { pago: true, valor: 3000 };
    S.lancamentos = S.lancamentos.filter(l => l.id !== 'l');
  });
  await sincronizarJa(a); await sincronizarJa(b); await sincronizarJa(a);
  const final = await avaliar(a, CAMPOS);
  assert.deepEqual(await avaliar(b, CAMPOS), final);
  assert.deepEqual(await avaliar(a, `[S.planoFerias.map(x => x.id).sort(), S.movConta.map(x => x.id).sort(), S.lancamentos.length,
    Object.keys(S.checklist).sort(), Object.keys(S.checklist['2026-10'].itens).sort(), S.config.vencimentos]`),
    [['f', 'f2'], ['m', 'm2'], 0, ['2026-10', '2026-11'], ['fat:Nubank', 'rec:r'], { Nubank: 10, Outro: 5 }]);
  await a.fechar(); await b.fechar();
});

test('sincronização: o mesmo ponto alterado nos dois aparelhos pergunta qual versão usar', { timeout: 60000 }, async () => {
  const drive = driveFalso();
  const a = await abrirApp(), b = await abrirApp();
  await drive.ligar(a); await drive.ligar(b);
  await definirDados(a, DADOS);
  await conectar(a); await conectar(b);
  await sincronizarJa(a); await sincronizarJa(b);
  await a.evaluate(() => { S.checklist['2026-10'].itens['fat:Nubank'].valor = 111; });
  await b.evaluate(() => { S.checklist['2026-10'].itens['fat:Nubank'].valor = 222; });
  await sincronizarJa(a);
  await sincronizarJa(b); // o teste aceita a pergunta: fica a versão do Drive
  assert.ok(b.alertas.some(t => /alterado\(s\) nos dois aparelhos/.test(t)));
  assert.equal(await avaliar(b, `S.checklist['2026-10'].itens['fat:Nubank'].valor`), 111);
  await a.fechar(); await b.fechar();
});

test('sincronização: senha errada não apaga nem altera os dados do aparelho', { timeout: 60000 }, async () => {
  const drive = driveFalso();
  const a = await abrirApp(), b = await abrirApp();
  await drive.ligar(a); await drive.ligar(b);
  await definirDados(a, DADOS);
  await definirDados(b, { config: { cartoes: ['Itaú'], primeiroMes: '2026-11' } });
  await conectar(a); await conectar(b, 'senha-errada');
  await sincronizarJa(a);
  const antes = drive.conteudo, antesB = await avaliar(b, `JSON.stringify(S.config.cartoes)`);
  assert.match(await sincronizarJa(b), /senha de sincronização incorreta/);
  assert.equal(await avaliar(b, `JSON.stringify(S.config.cartoes)`), antesB);
  assert.equal(drive.conteudo, antes);
  await a.fechar(); await b.fechar();
});

/* ---------- continuar conectado ---------- */
// Configura a sincronização como o usuário faz (Client ID salvo, senha e acesso do Google guardados).
const configurar = (pg, exp) => pg.evaluate(e => {
  syncCfg.clientId = 'teste'; lsSet(SYNC_KEY, syncCfg);
  ssSet('cf-token', 't'); ssSet('cf-exp', String(e)); ssSet('cf-senha', 'senha-de-teste');
}, exp);

test('reabrir o app continua conectado e sincroniza sozinho (senha e acesso não se perdem ao fechar)', { timeout: 60000 }, async () => {
  const drive = driveFalso();
  const a = await abrirApp();
  await drive.ligar(a);
  await definirDados(a, DADOS);
  await configurar(a, Date.now() + 3600000);
  await a.reload();
  await a.waitForFunction(() => /^Sincronizado/.test(syncEstado), null, { timeout: 20000 });
  assert.equal(drive.escritas, 1);
  // Versão antiga guardava só na sessão: a senha é trazida para o aparelho.
  await a.evaluate(() => { localStorage.removeItem('cf-senha'); sessionStorage.setItem('cf-senha', 'antiga'); });
  assert.equal(await avaliar(a, `ssGet('cf-senha')`), 'antiga');
  assert.equal(await avaliar(a, `localStorage.getItem('cf-senha')`), 'antiga');
  // Desconectar apaga tudo.
  await a.evaluate(() => desconectarDrive());
  assert.deepEqual(await avaliar(a, `['cf-senha', 'cf-token', 'cf-exp'].map(k => localStorage.getItem(k) || sessionStorage.getItem(k))`), [null, null, null]);
  assert.deepEqual(a.erros, []);
  await a.fechar();
});

test('acesso do Google vencido: renova sozinho sem pedir nada; se o Google pedir confirmação, mostra Reconectar', { timeout: 60000 }, async () => {
  const drive = driveFalso();
  const a = await abrirApp();
  const inicio = a.url().split('#')[0];
  await drive.ligar(a);
  const idas = [];
  await a.route('https://accounts.google.com/**', r => { idas.push(r.request().url()); r.fulfill({ status: 200, contentType: 'text/html', body: 'Google' }); });
  await definirDados(a, DADOS);
  await configurar(a, Date.now() - 1000);
  await a.reload();
  await a.waitForFunction(() => location.href.startsWith('https://accounts.google.com'), null, { timeout: 10000 });
  const u = new URL(idas[0]);
  assert.equal(u.searchParams.get('prompt'), 'none');
  assert.equal(u.searchParams.get('client_id'), 'teste');
  assert.equal(u.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.appdata');
  // O Google devolve um acesso novo: o app guarda e sincroniza.
  await a.goto(inicio + '#access_token=novo&expires_in=3600');
  await a.waitForFunction(() => /^Sincronizado/.test(syncEstado), null, { timeout: 20000 });
  assert.equal(await avaliar(a, `ssGet('cf-token')`), 'novo');
  assert.equal(await avaliar(a, `location.hash`), '');
  // Venceu de novo e o Google pediu confirmação: não fica indo e voltando; mostra o aviso com Reconectar.
  await a.evaluate(() => { ssSet('cf-exp', String(Date.now() - 1000)); lsSet('cf-renovacao', 0); });
  await a.goto('about:blank'); // o Google volta com a página carregando de novo
  await a.goto(inicio + '#error=interaction_required');
  await a.waitForTimeout(500);
  assert.equal(idas.length, 1);
  assert.equal(await avaliar(a, `renovarSePreciso()`), false);
  const aviso = await a.innerText('#avisoSync');
  assert.match(aviso, /Sincronização com o Drive pausada/);
  assert.match(aviso, /Reconectar/);
  // Reconectar leva ao Google pedindo a confirmação (sem prompt=none).
  await a.click('#avisoSync button');
  await a.waitForFunction(() => location.href.startsWith('https://accounts.google.com'), null, { timeout: 10000 });
  assert.equal(new URL(idas[1]).searchParams.get('prompt'), null);
  assert.deepEqual(a.erros, []);
  await a.fechar();
});

test('sem internet: avisa, tenta de novo sozinho e sincroniza quando a conexão volta', { timeout: 60000 }, async () => {
  const drive = driveFalso();
  const a = await abrirApp();
  await drive.ligar(a);
  let falhar = true;
  await a.route('https://www.googleapis.com/**', r => (falhar ? r.abort() : r.fallback()));
  await definirDados(a, DADOS);
  await conectar(a);
  assert.match(await sincronizarJa(a), /Não sincronizou: sem conexão com o Drive/);
  assert.match(await a.innerText('#avisoSync'), /tenta de novo sozinho/);
  assert.ok(await avaliar(a, `novaTentativa !== null`));
  falhar = false;
  await a.evaluate(() => window.dispatchEvent(new Event('online')));
  await a.waitForFunction(() => /^Sincronizado/.test(syncEstado), null, { timeout: 20000 });
  assert.equal(await avaliar(a, `document.getElementById('avisoSync')`), null);
  assert.equal(drive.escritas, 1);
  // A requisição bloqueada de propósito aparece como erro de rede no console.
  assert.deepEqual(a.erros.filter(e => !/ERR_FAILED/.test(e)), []);
  await a.fechar();
});
