// Importar fatura: lê PDF, CSV, OFX, Excel e texto colado (faturas fictícias), revisa e lança no app.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { RAIZ, abrirApp, fecharNavegador, definirDados, avaliar, c2, soffice } = require('./lib');

// O app baixa os leitores (PDF, imagem e .xls) da internet; no teste, eles vêm das cópias locais em node_modules.
const NM = path.join(RAIZ, 'node_modules');
const LOCAIS = [
  ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/', path.join(NM, 'pdfjs-dist', 'build')],
  ['https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/', path.join(NM, 'xlsx', 'dist')],
  ['https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/', path.join(NM, 'tesseract.js', 'dist')],
  ['https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/', path.join(NM, 'tesseract.js-core')],
  ['https://cdn.jsdelivr.net/npm/@tesseract.js-data/por@1.0.0/4.0.0_best_int/', path.join(NM, '@tesseract.js-data', 'por', '4.0.0_best_int')]];

let pg, navegador;
before(async () => {
  pg = await abrirApp();
  navegador = pg.context().browser();
  for (const [url, dir] of LOCAIS) await pg.context().route(url + '**', rota => {
    const nome = path.basename(new URL(rota.request().url()).pathname), arq = path.join(dir, nome);
    if (!fs.existsSync(arq)) return rota.fulfill({ status: 404, body: '' });
    const tipo = nome.endsWith('.wasm') ? 'application/wasm' : nome.endsWith('.gz') ? 'application/gzip' : 'text/javascript';
    rota.fulfill({ status: 200, contentType: tipo, body: fs.readFileSync(arq), headers: { 'Access-Control-Allow-Origin': '*' } });
  });
});
after(async () => { await fecharNavegador(); });

// Fatura de outubro/2026 do Nubank, que vence em 10/11/2026.
// Compras − créditos: 18,50 + 23,90 + 55,90 + 120 + 1.234,56 + 3,50 + 45 − 30 = 1.471,36.
const ITENS = [
  ['28/09', 'PADARIA PAO BOM', '18,50'], ['03/10', 'UBER *TRIP', '23,90'],
  ['05/10', 'NETFLIX.COM', '55,90'], ['10/10', 'LOJA ROUPAS PARC 02/05', '120,00'],
  ['12/10', 'MERCADO CENTRAL', '1.234,56'], ['15/10', 'ESTORNO LOJA X', '-30,00'],
  ['20/10', 'IOF COMPRA INTERNACIONAL', '3,50'], ['05/10', 'PAGAMENTO RECEBIDO', '-900,00'],
  ['22/10', 'FARMACIA SAO JOAO', '45,00']];
// Já no app: Netflix como recorrente no cartão e a farmácia lançada à mão (com data um dia antes).
const DADOS = { config: { cartoes: ['Nubank', 'Itaú'], primeiroMes: '2026-10' },
  recorrentes: [{ id: 'nf', descricao: 'Netflix', grupo: 'Cartão', cartao: 'Nubank', categoria: 'Assinaturas', valor: 55.9, inicio: '2026-01-01', fim: '' }],
  lancamentos: [
    { id: 'fa', data: '2026-10-21', descricao: 'Farmácia', categoria: 'Saúde', forma: 'Cartão', cartao: 'Nubank', valor: 45 },
    { id: 'pd', data: '2026-08-02', descricao: 'Padaria Pao Bom', categoria: 'Lazer', forma: 'Pix', cartao: '', valor: 10 }] };

// PDF em duas colunas, como o de muitos bancos.
async function pdfFicticio() {
  const metade = Math.ceil(ITENS.length / 2);
  const cel = i => (ITENS[i] ? `<td>${ITENS[i][0]}</td><td>${ITENS[i][1]}</td><td style="text-align:right">${ITENS[i][2]}</td>` : '<td></td><td></td><td></td>');
  const linhas = Array.from({ length: metade }, (_, i) => `<tr>${cel(i)}<td style="width:40px"></td>${cel(i + metade)}</tr>`).join('');
  const p = await navegador.newPage();
  await p.setContent(`<html><body style="font-family:Arial;font-size:11px">
    <h1>Banco Exemplo · Fatura do cartão</h1><p>Data de vencimento: 10/11/2026</p><p>Total da fatura: R$ 1.471,36</p>
    <table style="border-collapse:collapse;width:100%">${linhas}</table></body></html>`);
  const buf = await p.pdf({ format: 'A4' });
  await p.close();
  return buf;
}
const enviar = async (name, buffer, mimeType = 'application/octet-stream') => {
  await pg.evaluate(() => { impFat = null; impMsg = ''; ir('importar'); });
  await pg.setInputFiles('#impArq', { name, mimeType, buffer: Buffer.from(buffer) });
  await pg.waitForFunction(() => impFat || impMsg, null, { timeout: 30000 });
  return avaliar(pg, `impFat && { cartao: impFat.cartao, mes: impFat.mes, venc: impFat.venc, total: impFat.total,
    itens: impFat.itens.map(i => [i.descricao, i.valor, i.tipo, i.situacao, i.marcado, i.parcela ? i.parcela.k + '/' + i.parcela.n : '', i.categoria]) }`);
};

test('PDF em duas colunas: lê as compras, acha vencimento e total, e marca o que já está no app', { timeout: 60000 }, async () => {
  await definirDados(pg, DADOS);
  const r = await enviar('fatura.pdf', await pdfFicticio(), 'application/pdf');
  assert.equal(r.mes, '2026-10', 'fatura de outubro, pelo vencimento em novembro');
  assert.equal(r.venc, '2026-11-10');
  assert.equal(r.total, 1471.36);
  const por = Object.fromEntries(r.itens.map(i => [i[0], i.slice(1)]));
  assert.equal(r.itens.length, 9);
  assert.deepEqual(por['PADARIA PAO BOM'], [18.5, 'compra', 'nova', true, '', 'Lazer'], 'categoria da última compra com o mesmo nome');
  assert.deepEqual(por['UBER *TRIP'], [23.9, 'compra', 'nova', true, '', 'Transporte']);
  assert.deepEqual(por['NETFLIX.COM'].slice(0, 4), [55.9, 'compra', 'recorrente', false]);
  assert.deepEqual(por['LOJA ROUPAS'].slice(0, 5), [120, 'compra', 'parcela', true, '2/5']);
  assert.deepEqual(por['MERCADO CENTRAL'], [1234.56, 'compra', 'nova', true, '', 'Alimentação']);
  assert.deepEqual(por['ESTORNO LOJA X'].slice(0, 4), [30, 'credito', 'credito', true]);
  assert.deepEqual(por['PAGAMENTO RECEBIDO'].slice(0, 4), [900, 'pagamento', 'pagamento', false]);
  assert.deepEqual(por['FARMACIA SAO JOAO'].slice(0, 4), [45, 'compra', 'lancado', false]);
  const txt = await pg.innerText('#impRevisao');
  assert.match(txt, /Bate com a soma dos itens/);
  assert.match(txt, /Lançar 6 item\(ns\) marcado\(s\)/);

  await pg.click('#impLancar');
  // Fatura de outubro do Nubank igual ao total do PDF.
  assert.equal(await avaliar(pg, `Math.round(fatCartao('Nubank', '2026-10') * 100) / 100`), 1471.36);
  const s = await avaliar(pg, `({
    lanc: S.lancamentos.filter(l => l.id !== 'fa' && l.id !== 'pd').map(l => [l.data, l.descricao, l.valor, !!l.prox, l.categoria]),
    parc: S.parcelados.map(p => [p.descricao, p.parcelas, p.valorParcela, p.inicio, p.valorTotal]),
    cred: S.creditos.map(c => [c.cartao, c.mes, c.valor]) })`);
  assert.deepEqual(s.lanc.find(l => l[1] === 'PADARIA PAO BOM'), ['2026-09-28', 'PADARIA PAO BOM', 18.5, true, 'Lazer'], 'setembro: próxima fatura');
  assert.equal(s.lanc.length, 4);
  // Parcela 2 de 5 em outubro: a 1ª foi em setembro; as próximas 3 entram até janeiro.
  assert.deepEqual(s.parc, [['LOJA ROUPAS', 5, 120, '2026-09', 600]]);
  assert.equal(await avaliar(pg, `fatCartao('Nubank', '2027-01')`), 120 + 55.9);
  assert.deepEqual(s.cred, [['Nubank', '2026-10', 30]]);
  assert.match(await pg.innerText('#impMsg'), /4 compra\(s\), 1 parcelamento\(s\) e 1 crédito\(s\)/);

  // A mesma fatura de novo: tudo já está no app, nada vem marcado.
  const r2 = await enviar('fatura.pdf', await pdfFicticio(), 'application/pdf');
  assert.deepEqual(r2.itens.filter(i => i[4]).map(i => i[0]), []);
  assert.deepEqual(pg.erros, []);
});

test('CSV do Nubank, CSV com ponto e vírgula (C6/Inter), OFX e Excel', { timeout: 60000 }, async () => {
  await definirDados(pg, { config: { cartoes: ['Nubank'], primeiroMes: '2026-10' } });
  const nu = await enviar('nubank.csv', 'date,title,amount\n2026-10-03,Uber *Trip,23.90\n2026-10-10,Loja Roupas - Parcela 2/5,120.00\n2026-10-15,Pagamento recebido,-900.00\n2026-10-16,Estorno de compra,-30.00\n');
  assert.deepEqual(nu.itens.map(i => i.slice(0, 3).concat(i[5])), [
    ['Uber *Trip', 23.9, 'compra', ''], ['Loja Roupas', 120, 'compra', '2/5'], ['Pagamento recebido', 900, 'pagamento', ''], ['Estorno de compra', 30, 'credito', '']]);
  assert.equal(nu.mes, '2026-10');

  const c6 = await enviar('c6.csv', 'Data de Compra;Nome no Cartão;Final do Cartão;Categoria;Descrição;Parcela;Valor (em US$);Cotação (em R$);Valor (em R$)\n' +
    '03/10/2026;FULANO;1234;Transporte;UBER TRIP;Única;0;0;23,90\n10/10/2026;FULANO;1234;Vestuário;LOJA ROUPAS;2/5;0;0;1.120,00\n');
  assert.deepEqual(c6.itens.map(i => [i[0], i[1], i[5]]), [['UBER TRIP', 23.9, ''], ['LOJA ROUPAS', 1120, '2/5']]);

  // Inter, com acentos em windows-1252 e valores com "R$".
  const inter = Buffer.from('Data;Lançamento;Categoria;Tipo;Valor\n"03/10/2026";"PADARIA SÃO JOSÉ";"ALIMENTAÇÃO";"Compra à vista";"R$ 1.023,90"\n', 'latin1');
  const ri = await enviar('inter.csv', inter);
  assert.deepEqual(ri.itens.map(i => [i[0], i[1]]), [['PADARIA SÃO JOSÉ', 1023.9]]);

  const ofx = 'OFXHEADER:100\n<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><BANKTRANLIST>\n' +
    '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261003120000[-3:BRT]<TRNAMT>-23.90<FITID>1<MEMO>UBER TRIP</STMTTRN>\n' +
    '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261012<TRNAMT>-1234.56<FITID>2<MEMO>MERCADO CENTRAL</STMTTRN>\n' +
    '<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261015<TRNAMT>30.00<FITID>3<MEMO>ESTORNO LOJA X</STMTTRN>\n</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>';
  const o = await enviar('extrato.ofx', ofx);
  assert.deepEqual(o.itens.map(i => [i[0], i[1], i[2]]), [['UBER TRIP', 23.9, 'compra'], ['MERCADO CENTRAL', 1234.56, 'compra'], ['ESTORNO LOJA X', 30, 'credito']]);

  const xlsx = await pg.evaluate(async () => {
    const g = XL.gerar([{ nome: 'Fatura', linhas: [['Extrato do cartão'], ['Data', 'Descrição', 'Valor'], ['03/10/2026', 'UBER TRIP', 23.9], ['12/10/2026', 'MERCADO', 1234.56]] }]);
    return Array.from(new Uint8Array(await g.arrayBuffer()));
  });
  const x = await enviar('fatura.xlsx', Buffer.from(xlsx));
  assert.deepEqual(x.itens.map(i => [i[0], i[1]]), [['UBER TRIP', 23.9], ['MERCADO', 1234.56]]);
  assert.deepEqual(pg.erros, []);
});

test('texto colado do app do banco, sem ano nas datas, e trocar o mês da fatura', async () => {
  await definirDados(pg, { config: { cartoes: ['Nubank', 'Itaú'], primeiroMes: '2026-10' } });
  await pg.evaluate(() => { impFat = null; impMsg = ''; ir('importar'); });
  await pg.evaluate(() => { document.querySelector('#impRevisao, details').open = true; });
  await pg.fill('#impTexto', '09 OUT Uber *Trip R$ 23,90\n10 OUT Loja Roupas - Parcela 2/5 R$ 120,00\n15 OUT Estorno de compra −R$ 30,00\nTotal R$ 113,90');
  await pg.click('#impLerTexto');
  const r = await avaliar(pg, `({ mes: impFat.mes, itens: impFat.itens.map(i => [i.descricao, i.valor, i.tipo, i.parcela && i.parcela.n]) })`);
  assert.match(r.mes, /-10$/);
  assert.deepEqual(r.itens, [['Uber *Trip', 23.9, 'compra', null], ['Loja Roupas', 120, 'compra', 5], ['Estorno de compra', 30, 'credito', null]]);
  // Outro cartão e outro mês: as datas sem ano acompanham a fatura escolhida.
  await pg.selectOption('#impCartao', 'Itaú');
  await pg.fill('#impMes', '2027-10');
  await pg.dispatchEvent('#impMes', 'change');
  await pg.click('#impLancar');
  assert.deepEqual(await avaliar(pg, `S.lancamentos.map(l => [l.data, l.cartao, !!l.prox])`), [['2027-10-09', 'Itaú', false]]);
  assert.deepEqual(await avaliar(pg, `S.parcelados.map(p => [p.inicio, p.dataCompra])`), [['2027-09', '2027-10-10']]);
  // Arquivo sem compras: avisa, sem quebrar.
  const nada = await enviar('vazio.csv', 'nada aqui\n');
  assert.equal(nada, null);
  assert.match(await pg.innerText('#impMsg'), /Não encontrei compras/);
  assert.deepEqual(pg.erros, []);
});

test('funções de leitura: valores, datas, parcelas e compras antigas', async () => {
  const r = await avaliar(pg, `({
    nums: ['1.234,56', '-R$ 12,00', 'R$ -12,00', '12,00-', '1234.56', '−R$ 3,00', '(5,00)'].map(numFatura),
    datas: ['28/09', '28/09/26', '2026-09-28', '09 OUT', '9 de outubro de 2025', '20261009120000[-3:BRT]'].map(dataFatura),
    parc: ['LOJA PARC 02/10', 'Loja - Parcela 2/10', 'LOJA 02/10', 'Loja Parcela 3 de 12', 'LOJA 2026', 'LOJA 12/10'].map(separarParcela),
    ano: [resolverDataFat({ d: 28, m: 12, y: null }, '2027-01'), resolverDataFat({ d: 5, m: 1, y: null }, '2026-12')] })`);
  assert.deepEqual(r.nums, [1234.56, -12, -12, -12, 1234.56, -3, -5]);
  assert.deepEqual(r.datas, [{ d: 28, m: 9, y: null }, { d: 28, m: 9, y: 2026 }, { d: 28, m: 9, y: 2026 }, { d: 9, m: 10, y: null }, { d: 9, m: 10, y: 2025 }, { d: 9, m: 10, y: 2026 }]);
  assert.deepEqual(r.parc.map(p => [p.descricao, p.parcela && `${p.parcela.k}/${p.parcela.n}`]),
    [['LOJA', '2/10'], ['Loja', '2/10'], ['LOJA', '2/10'], ['Loja', '3/12'], ['LOJA 2026', null], ['LOJA 12/10', null]]);
  assert.deepEqual(r.ano, ['2026-12-28', '2027-01-05']);
  // Compra de agosto numa fatura de outubro: entra no 1º dia de setembro como próxima fatura, com a data na descrição.
  await definirDados(pg, { config: { cartoes: ['Nubank'], primeiroMes: '2026-10' } });
  await pg.evaluate(() => { impFat = null; impMontar([{ dt: { d: 20, m: 8, y: 2026 }, descricao: 'LOJA ATRASADA', valor: 10 }], 'teste', 'Vencimento 10/11/2026'); lancarFatura(); });
  assert.deepEqual(await avaliar(pg, `S.lancamentos.map(l => [l.data, l.descricao, !!l.prox, mesFatLanc(l)])`), [['2026-09-01', 'LOJA ATRASADA (compra de 20/08/2026)', true, '2026-10']]);
  assert.equal(c2(await avaliar(pg, `fatCartao('Nubank', '2026-10')`)), 10);
  assert.deepEqual(pg.erros, []);
});

// Print do app do banco: a data vem sozinha numa linha e as compras abaixo, só com nome e valor.
const PRINT = `<html><body style="font-family:Arial;font-size:28px;width:700px;padding:20px;background:#fff">
  <p>Vencimento: 10/11/2026</p><p><b>09 OUT</b></p><p>Uber Trip R$ 23,90</p><p>Mercado Central R$ 1.234,56</p>
  <p><b>22 OUT</b></p><p>Farmacia Sao Joao R$ 45,00</p></body></html>`;
async function imagem(html) {
  const p = await navegador.newPage({ viewport: { width: 760, height: 520 } });
  await p.setContent(html);
  const png = await p.screenshot();
  await p.close();
  return png;
}
const lidos = r => r.itens.map(i => [i[0].toLowerCase(), i[1]]);

test('print do app do banco (imagem) e PDF escaneado: lê pelo reconhecimento de texto', { timeout: 240000 }, async () => {
  await definirDados(pg, { config: { cartoes: ['Nubank'], primeiroMes: '2026-10' } });
  const png = await imagem(PRINT);
  const r = await enviar('print.png', png, 'image/png');
  assert.equal(r.mes, '2026-10');
  assert.deepEqual(lidos(r), [['uber trip', 23.9], ['mercado central', 1234.56], ['farmacia sao joao', 45]]);
  assert.deepEqual(await avaliar(pg, `impFat.itens.map(i => resolverDataFat(i.dt, impFat.mes))`), ['2026-10-09', '2026-10-09', '2026-10-22']);
  // PDF que é só a imagem (sem texto selecionável).
  const p = await navegador.newPage();
  await p.setContent(`<img src="data:image/png;base64,${png.toString('base64')}" style="width:700px">`);
  const pdf = await p.pdf({ format: 'A4' });
  await p.close();
  const r2 = await enviar('escaneado.pdf', pdf, 'application/pdf');
  assert.deepEqual(lidos(r2), lidos(r));
  assert.deepEqual(pg.erros, []);
});

test('PDF com senha: pede a senha, tenta de novo se errar, e cancelar não quebra', { timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-senha-'));
  const perfil = 'file:///' + fs.mkdtempSync(path.join(os.tmpdir(), 'cf-lo-')).replace(/\\/g, '/').replace(/^\//, '');
  fs.writeFileSync(path.join(dir, 'f.txt'), 'Vencimento: 10/11/2026\n03/10 UBER TRIP 23,90\n12/10 MERCADO CENTRAL 1.234,56\n');
  spawnSync(soffice(), [`-env:UserInstallation=${perfil}`, '--headless', '--convert-to',
    'pdf:writer_pdf_Export:{"EncryptFile":{"type":"boolean","value":"true"},"DocumentOpenPassword":{"type":"string","value":"12345"}}',
    '--outdir', dir, path.join(dir, 'f.txt')], { timeout: 100000 });
  const pdf = fs.readFileSync(path.join(dir, 'f.pdf'));
  await definirDados(pg, { config: { cartoes: ['Nubank'], primeiroMes: '2026-10' } });
  await pg.evaluate(() => { window._senhas = ['errada', '12345']; window._pedidos = []; window.prompt = m => { window._pedidos.push(m); return window._senhas.shift(); }; });
  const r = await enviar('protegida.pdf', pdf, 'application/pdf');
  assert.deepEqual(r.itens.map(i => [i[0], i[1]]), [['UBER TRIP', 23.9], ['MERCADO CENTRAL', 1234.56]]);
  const pedidos = await avaliar(pg, 'window._pedidos');
  assert.equal(pedidos.length, 2);
  assert.match(pedidos[0], /tem senha/);
  assert.match(pedidos[1], /Senha incorreta/);
  // Cancelar a senha: nada acontece, sem erro.
  await pg.evaluate(() => { window.prompt = () => null; impFat = null; impMsg = ''; ir('importar'); });
  const antes = pg.alertas.length;
  await pg.setInputFiles('#impArq', { name: 'protegida.pdf', mimeType: 'application/pdf', buffer: pdf });
  await pg.waitForTimeout(1500);
  assert.equal(await avaliar(pg, 'impFat'), null);
  assert.equal(pg.alertas.length, antes);
  assert.deepEqual(pg.erros, []);
});

test('Excel antigo (.xls), vários arquivos juntos e linhas com D/C no fim', { timeout: 60000 }, async () => {
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Fatura'], ['Data', 'Histórico', 'Valor (R$)'], ['03/10/2026', 'UBER TRIP', 23.9], ['12/10/2026', 'MERCADO', 1234.56]]), 'Plan1');
  const xls = XLSX.write(wb, { bookType: 'biff8', type: 'buffer' });
  await definirDados(pg, { config: { cartoes: ['Nubank'], primeiroMes: '2026-10' } });
  const r = await enviar('fatura.xls', xls, 'application/vnd.ms-excel');
  assert.deepEqual(r.itens.map(i => [i[0], i[1]]), [['UBER TRIP', 23.9], ['MERCADO', 1234.56]]);
  // Dois arquivos de uma vez: os itens se somam.
  await pg.evaluate(() => { impFat = null; impMsg = ''; ir('importar'); });
  await pg.setInputFiles('#impArq', [
    { name: 'a.csv', mimeType: 'text/csv', buffer: Buffer.from('date,title,amount\n2026-10-03,Uber,23.90\n') },
    { name: 'b.csv', mimeType: 'text/csv', buffer: Buffer.from('date,title,amount\n2026-10-05,Padaria,8.50\n') }]);
  await pg.waitForFunction(() => impFat, null, { timeout: 30000 });
  assert.deepEqual(await avaliar(pg, 'impFat.itens.map(i => i.descricao)'), ['Uber', 'Padaria']);
  // Valores com D (débito) e C (crédito) no fim, e data sozinha na linha, com o dia da semana.
  const texto = '03/10/2026 UBER TRIP 23,90 D\n15/10/2026 ESTORNO LOJA 30,00 C\nSex, 17 de outubro\nPadaria 8,50';
  const itens = await pg.evaluate(t => itensDoTexto(t).map(i => [i.descricao, i.valor, i.dt.d]), texto);
  assert.deepEqual(itens, [['UBER TRIP', 23.9, 3], ['ESTORNO LOJA', -30, 15], ['Padaria', 8.5, 17]]);
  assert.deepEqual(pg.erros, []);
});
