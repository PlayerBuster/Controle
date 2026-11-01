// Planilha .xlsx: as fórmulas, recalculadas pelo LibreOffice, devem dar os mesmos valores que o app gravou;
// e exportar seguido de importar deve devolver os mesmos dados.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { abrirApp, fecharNavegador, definirDados, avaliar, soffice, perfilLibreOffice } = require('./lib');

// Dados com todos os tipos de item: vários cartões, "Próxima fatura", estornos, abatimentos,
// orçamento por mês, férias e aportes.
const DADOS = {
  config: { cartoes: ['Nubank', 'Itaú', 'Inter'], primeiroMes: '2026-11', mesRef: '2026-11', saldoConta: 3500 },
  recorrentes: [
    { id: 'r1', descricao: 'Salário', grupo: 'Receita', cartao: '', categoria: 'Outros', valor: 7000, inicio: '2026-01-05', fim: '' },
    { id: 'r2', descricao: 'Aluguel', grupo: 'Fixo', cartao: '', categoria: 'Moradia', valor: 2200, inicio: '2026-01-10', fim: '' },
    { id: 'r3', descricao: 'Financiamento', grupo: 'Fixo', cartao: '', categoria: 'Transporte', valor: 900, inicio: '2025-06-01', fim: '2027-05-31' },
    { id: 'r4', descricao: 'Estadao', grupo: 'Cartão', cartao: 'Nubank', categoria: 'Assinaturas', valor: 1.9, inicio: '2026-10-17', fim: '', prox: true },
    { id: 'r5', descricao: 'TotalPass', grupo: 'Cartão', cartao: 'Nubank', categoria: 'Assinaturas', valor: 89.9, inicio: '2026-10-21', fim: '' },
    { id: 'r6', descricao: 'Spotify', grupo: 'Cartão', cartao: 'Itaú', categoria: 'Assinaturas', valor: 21.9, inicio: '2026-11-30', fim: '2027-01-31', prox: true },
    { id: 'r7', descricao: 'Academia', grupo: 'Cartão', cartao: 'Inter', categoria: 'Saúde', valor: 120, inicio: '2027-02-01', fim: '2027-08-15' }],
  parcelados: [
    { id: 'p1', dataCompra: '2026-10-26', cartao: 'Nubank', descricao: 'Celular', categoria: 'Outros', valorTotal: 1017.9, valorParcela: 84.83, parcelas: 12, inicio: '2026-10' },
    { id: 'p2', dataCompra: '2026-10-17', cartao: 'Nubank', descricao: 'Ração', categoria: 'PET', valorTotal: 204.04, parcelas: 2, inicio: '2026-10' },
    { id: 'p3', dataCompra: '2026-11-03', cartao: 'Itaú', descricao: 'Geladeira', categoria: 'Moradia', valorTotal: 3600, parcelas: 10, inicio: '2026-12' },
    { id: 'p4', dataCompra: '2026-09-10', cartao: 'Inter', descricao: 'Curso', categoria: 'Educação', valorTotal: 1500, parcelas: 6, inicio: '2026-10' }],
  estornos: [
    { id: 'e1', parcelaId: 'p3', tipo: 'Estorno', mes: '2027-02', valor: 360, descricao: 'Devolução parcial' },
    { id: 'e2', parcelaId: 'p1', tipo: 'Abatimento', mes: '2027-01', valor: 120, descricao: 'Desconto' }],
  creditos: [
    { id: 'c1', cartao: 'Nubank', mes: '2026-11', valor: 222.72, descricao: 'Pagamento antecipado' },
    { id: 'c2', cartao: 'Itaú', mes: '2027-01', valor: 659.3, descricao: '' }],
  eventuais: [
    { id: 'v1', mes: '2026-12', descricao: '13º', tipo: 'Receita', valor: 3500 },
    { id: 'v2', mes: '2027-01', descricao: 'IPVA', tipo: 'Despesa', valor: 1300 },
    { id: 'v3', mes: '2027-07', descricao: 'Férias', tipo: 'Receita', valor: 2300 },
    // Despesa no mês seguinte às férias, para o ajuste de férias mudar os valores (julho ≠ agosto).
    { id: 'v4', mes: '2027-08', descricao: 'Seguro', tipo: 'Despesa', valor: 700 }],
  lancamentos: [
    { id: 'l1', data: '2026-11-02', descricao: 'Mercado', categoria: 'Alimentação', forma: 'Débito', cartao: '', valor: 412.35 },
    { id: 'l2', data: '2026-11-15', descricao: 'Lanche', categoria: 'Lazer', forma: 'Cartão', cartao: 'Nubank', valor: 42 },
    { id: 'l3', data: '2026-11-30', descricao: 'Jantar', categoria: 'Lazer', forma: 'Cartão', cartao: 'Nubank', valor: 120, prox: true },
    { id: 'l4', data: '2026-11-20', descricao: 'Remédio', categoria: 'Saúde', forma: 'Pix', cartao: '', valor: 20.5 },
    { id: 'l5', data: '2026-12-03', descricao: 'Bolo', categoria: 'Lazer', forma: 'Dinheiro', cartao: '', valor: 35 },
    { id: 'l6', data: '2026-12-10', descricao: 'Plano (Simulador)', categoria: 'Lazer', forma: 'Planejada', cartao: '', valor: 300 },
    { id: 'l7', data: '2026-11-25', descricao: 'Sapato', categoria: 'Vestuário', forma: 'Cartão', cartao: 'Itaú', valor: 250 },
    { id: 'l8', data: '2026-12-31', descricao: 'Ceia', categoria: 'Alimentação', forma: 'Cartão', cartao: 'Inter', valor: 1600, prox: true }],
  checklist: { '2026-11': { fora: 'nao', itens: {
    'fat:Nubank': { pago: true, valor: 300 }, 'rec:r2': { pago: true, valor: 2200 }, 'lanc:l1': { pago: true }, 'ev:v9': { pago: true, valor: 1 } } } },
  movConta: [
    { id: 'm1', data: '2026-11-05', descricao: 'Salário', tipo: 'Entrada', valor: 7000 },
    { id: 'm2', data: '2026-11-10', descricao: 'Pagamento fatura Nubank', tipo: 'Saída', valor: 276.75 }],
  orcamento: { 'Alimentação': 1200, Lazer: 400, 'Saúde': 200, Cartões: 900 },
  orcamentoMeses: { '2026-12': { 'Alimentação': 1500, Lazer: 800, 'Saúde': 200 } },
  ferias: { '2027-07': true },
  patrimonio: { valorInicial: 10000, dataInicio: '2026-01-01', meta: 50000, prazoAnos: 5, taxaAnual: 0.1, aporteMensal: 500,
    aportes: [{ id: 'a1', data: '2026-03-01', descricao: 'Bônus', valor: 2000 }] }
};
DADOS.config.categorias = ['Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Lazer', 'Educação', 'Vestuário', 'Assinaturas', 'PET', 'Outros'];

let pg, dir;
before(async () => {
  pg = await abrirApp();
  await definirDados(pg, DADOS);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-planilha-'));
});
after(async () => {
  assert.deepEqual(pg.erros, [], 'erros de JavaScript na página');
  await fecharNavegador();
  fs.rmSync(dir, { recursive: true, force: true });
});

// Gera a planilha na página. Devolve o arquivo em base64 e a lista de células com fórmula (aba, linha, coluna, valor do app).
const gerar = () => pg.evaluate(async () => {
  const abas = montarPlanilha();
  const formulas = [];
  abas.forEach(a => a.linhas.forEach((l, r) => (l || []).forEach((c, k) => {
    if (c && typeof c === 'object' && c.f) formulas.push({ aba: a.nome, r, k, f: c.f, v: c.v });
  })));
  const g = XL.gerar(abas);
  const buf = new Uint8Array(g instanceof Blob ? await g.arrayBuffer() : g);
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return { b64: btoa(s), formulas };
});

// Lê um .xlsx com o leitor do próprio app: { aba: linhas }.
const ler = b64 => pg.evaluate(async b => {
  const s = atob(b), u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return XL.ler(u.buffer);
}, b64);

const vazio = v => v === '' || v === null || v === undefined;
const iguais = (a, b) => {
  if (vazio(a) && vazio(b)) return true;
  const na = typeof a === 'number' ? a : (typeof a === 'string' && a.trim() !== '' && !isNaN(Number(a)) ? Number(a) : null);
  const nb = typeof b === 'number' ? b : (typeof b === 'string' && b.trim() !== '' && !isNaN(Number(b)) ? Number(b) : null);
  if (na !== null && nb !== null) return Math.abs(na - nb) < 0.005;
  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(a) === Number(b);
  return String(a) === String(b);
};

test('fórmulas da planilha: valores do LibreOffice iguais aos do app', { timeout: 180000 }, async () => {
  const { b64, formulas } = await gerar();
  const origem = path.join(dir, 'app.xlsx');
  fs.writeFileSync(origem, Buffer.from(b64, 'base64'));
  const saida = path.join(dir, 'lo');
  const r = spawnSync(soffice(), [`-env:UserInstallation=${perfilLibreOffice()}`, '--headless', '--convert-to', 'xlsx', '--outdir', saida, origem],
    { encoding: 'utf8', timeout: 150000 });
  const recalculado = path.join(saida, 'app.xlsx');
  assert.ok(fs.existsSync(recalculado), `LibreOffice não gerou a planilha: ${r.error || r.stderr || r.stdout}`);
  const lo = await ler(fs.readFileSync(recalculado).toString('base64'));

  const divergencias = formulas.filter(c => !iguais(c.v, ((lo[c.aba] || [])[c.r] || [])[c.k]));
  const exemplo = divergencias.slice(0, 15).map(c =>
    `${c.aba}!${String.fromCharCode(65 + (c.k % 26))}${c.r + 1}: app=${JSON.stringify(c.v)} LibreOffice=${JSON.stringify(((lo[c.aba] || [])[c.r] || [])[c.k])} (${c.f})`);
  console.log(`  ${formulas.length} fórmulas comparadas, ${divergencias.length} divergência(s)`);
  assert.ok(formulas.length > 1000, `poucas fórmulas na planilha (${formulas.length})`);
  assert.equal(divergencias.length, 0, 'divergências:\n' + exemplo.join('\n'));
});

test('exportar e importar a planilha devolve os mesmos dados', async () => {
  const { b64 } = await gerar();
  const g = await ler(b64);
  const r = await pg.evaluate(gg => {
    const n = interpretarNova(gg);
    const sem = o => { const { id, parcelaId, ...x } = o; return x; };
    return {
      cartoes: n.config.cartoes, primeiroMes: n.config.primeiroMes, saldo: n.config.saldoConta,
      recorrentes: n.recorrentes.map(sem), parcelados: n.parcelados.map(sem), eventuais: n.eventuais.map(sem),
      lancamentos: n.lancamentos.map(sem), estornos: n.estornos.map(e => [n.parcelados.find(p => p.id === e.parcelaId).descricao, e.tipo, e.mes, e.valor]),
      ferias: n.ferias, orcDez: n.orcamentoMeses['2026-12'], creditos: n.creditos.map(sem), movConta: n.movConta.map(sem),
      // Check list com os ids novos da importação trocados pelos nomes, para comparar.
      checklist: Object.fromEntries(Object.entries(n.checklist).map(([m, c]) => [m, { fora: c.fora, itens: Object.fromEntries(Object.entries(c.itens).map(([k, e]) => {
        const id = k.slice(k.indexOf(':') + 1);
        const nome = k.startsWith('rec:') ? n.recorrentes.find(x => x.id === id).descricao : k.startsWith('lanc:') ? n.lancamentos.find(x => x.id === id).descricao : id;
        return [k.slice(0, k.indexOf(':') + 1) + nome, e];
      })) }]))
    };
  }, g);
  const semId = ({ id, ...x }) => x;
  assert.deepEqual(r.cartoes, DADOS.config.cartoes);
  assert.equal(r.primeiroMes, '2026-11');
  assert.equal(r.saldo, 3500);
  // "prox: false" não é gravado; só a marcação de próxima fatura importa.
  assert.deepEqual(r.recorrentes, DADOS.recorrentes.map(semId));
  assert.deepEqual(r.lancamentos, DADOS.lancamentos.map(semId));
  assert.deepEqual(r.eventuais, DADOS.eventuais.map(semId));
  assert.deepEqual(r.parcelados.map(p => [p.descricao, p.cartao, p.valorTotal, p.parcelas, p.inicio, p.categoria]),
    DADOS.parcelados.map(p => [p.descricao, p.cartao, p.valorTotal, p.parcelas, p.inicio, p.categoria]));
  assert.deepEqual(r.estornos, [['Geladeira', 'Estorno', '2027-02', 360], ['Celular', 'Abatimento', '2027-01', 120]]);
  assert.deepEqual(r.ferias, { '2027-07': true });
  assert.equal(r.orcDez.Lazer, 800);
  assert.deepEqual(r.creditos, DADOS.creditos.map(semId));
  assert.deepEqual(r.movConta, DADOS.movConta.map(semId));
  // O item 'ev:v9' aponta para um evento que não existe mais: fica de fora da planilha.
  assert.deepEqual(r.checklist, { '2026-11': { fora: 'nao', itens: {
    'fat:Nubank': { pago: true, valor: 300 }, 'rec:Aluguel': { pago: true, valor: 2200 }, 'lanc:Mercado': { pago: true } } } });
});

test('faturas da planilha exportada respeitam "Próxima fatura" e os ajustes manuais', async () => {
  const v = await avaliar(pg, `[fatCartao('Nubank', '2026-10'), fatCartao('Nubank', '2026-11'), fatCartao('Itaú', '2026-12'),
    fatCartao('Itaú', '2027-01'), fatCartao('Itaú', '2027-02'), fatCartao('Itaú', '2027-03')]`);
  // Nubank out: Celular 84,83 + Ração 102,02 + TotalPass 89,90 (Estadao só a partir de nov).
  // Nubank nov: Celular 84,83 + Ração 102,02 + Estadao 1,90 + TotalPass 89,90 + Lanche 42 − ajuste 222,72
  // (o Jantar de 30/11 é "Próxima fatura": vai para dez).
  // Itaú: Geladeira 360 + Spotify 21,90 de dez a fev; em jan, ajuste de 659,30; em fev, estorno de 360.
  assert.deepEqual(v.map(x => Math.round(x * 100) / 100), [276.75, 97.93, 381.9, -277.4, 21.9, 360]);
});
