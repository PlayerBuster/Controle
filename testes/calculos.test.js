// Cálculos do app: datas, parcelas, recorrentes, faturas, estornos, executado, orçamento e projeção.
// Os valores esperados foram calculados à mão a partir dos dados de cada cenário.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { abrirApp, fecharNavegador, definirDados, avaliar, c2 } = require('./lib');

let pg;
before(async () => { pg = await abrirApp(); });
after(async () => { assert.deepEqual(pg.erros, [], 'erros de JavaScript na página'); await fecharNavegador(); });

const cenario = async (dados, expr) => { await definirDados(pg, dados); return avaliar(pg, expr); };
const addMesStr = (m, n) => { const k = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n; return `${Math.floor(k / 12)}-${String(k % 12 + 1).padStart(2, '0')}`; };
const itens = (m, cartao) => `linhasFatura('${m}').find(b => b.cartao === '${cartao}')`;

/* ---------- utilitários de data ---------- */
test('addM soma meses, inclusive na virada do ano', async () => {
  assert.deepEqual(await avaliar(pg, `[addM('2026-11', 2), addM('2026-01', -1), addM('2026-12', 1), addM('2026-05', 0)]`),
    ['2027-01', '2025-12', '2027-01', '2026-05']);
});

test('addMesData segue o EDATE da planilha (dia limitado ao fim do mês)', async () => {
  assert.deepEqual(await avaliar(pg, `[addMesData('2027-01-31', 1), addMesData('2028-01-31', 1), addMesData('2026-10-17', 0), addMesData('2026-12-15', 1)]`),
    ['2027-02-28', '2028-02-29', '2026-10-17', '2027-01-15']);
});

test('ehProxima reconhece "Próxima" com ou sem acento e em qualquer caixa', async () => {
  assert.deepEqual(await avaliar(pg, `['Próxima', 'proxima', 'PRÓXIMA ', ' próxima fatura', '', null, 'Atual'].map(ehProxima)`),
    [true, true, true, true, false, false, false]);
});

test('isoData converte número de série, dd/mm/aaaa e ISO', async () => {
  assert.deepEqual(await avaliar(pg, `[isoData(46312), isoData('31/10/2026'), isoData('2026-10-31T10:00'), isoData(''), mkOf('2026-10-31')]`),
    ['2026-10-17', '2026-10-31', '2026-10-31', '', '2026-10']);
});

/* ---------- calculadora ---------- */
test('calculadora: contas com vírgula decimal, ponto de milhar, precedência e parênteses', async () => {
  const contas = ['42+15,5', '10+5*2', '(10+5)*2', '100/4', '1.234,56+0,44', '3.5*2', '-5+10', '2×3−1', '9÷3', '182,69*3'];
  assert.deepEqual(await avaliar(pg, `${JSON.stringify(contas)}.map(calcAvaliar)`), [57.5, 20, 30, 25, 1235, 7, 5, 5, 3, 548.07]);
});

test('calculadora: conta incompleta ou inválida não dá resultado', async () => {
  const contas = ['', '2*(3', '5+', '10/0', 'abc', '1,2,3', ')'];
  assert.deepEqual(await avaliar(pg, `${JSON.stringify(contas)}.map(calcAvaliar)`), [null, null, null, null, null, null, null]);
});

/* ---------- parcelas ---------- */
test('valor da parcela: total ÷ nº de parcelas, ou o valor informado', async () => {
  assert.deepEqual(await avaliar(pg, `[valorParcela({ valorTotal: 1000, parcelas: 3 }), valorParcela({ valorTotal: 1017.9, parcelas: 12, valorParcela: 84.83 })]`),
    [333.33, 84.83]);
});

test('última parcela e meses em que a compra está ativa', async () => {
  const p = `{ inicio: '2026-11', parcelas: 12 }`;
  assert.deepEqual(await avaliar(pg, `[ultimaParcela(${p}), ...['2026-10', '2026-11', '2027-10', '2027-11'].map(m => parcelaAtiva(${p}, m))]`),
    ['2027-10', false, true, true, false]);
});

/* ---------- recorrentes ---------- */
test('recorrente ativo do mês de início até o mês do fim', async () => {
  const r1 = `{ inicio: '2026-10-17', fim: '' }`, r2 = `{ inicio: '2026-12-21', fim: '2027-03-31' }`;
  assert.deepEqual(await avaliar(pg, `[ativo(${r1}, '2026-09'), ativo(${r1}, '2026-10'), ativo(${r1}, '2099-12'),
    ativo(${r2}, '2026-11'), ativo(${r2}, '2027-03'), ativo(${r2}, '2027-04')]`),
    [false, true, true, false, true, false]);
});

test('recorrente com "Próxima fatura" entra na fatura um mês depois, do início ao fim', async () => {
  const r1 = `{ inicio: '2026-10-17', fim: '', prox: true }`, r2 = `{ inicio: '2026-12-21', fim: '2027-03-31', prox: true }`;
  assert.deepEqual(await avaliar(pg, `[recNaFatura(${r1}, '2026-10'), recNaFatura(${r1}, '2026-11'),
    recNaFatura(${r2}, '2026-12'), recNaFatura(${r2}, '2027-01'), recNaFatura(${r2}, '2027-04'), recNaFatura(${r2}, '2027-05')]`),
    [false, true, false, true, true, false]);
});

/* ---------- faturas ---------- */
const DADOS_FATURA = {
  config: { cartoes: ['Nubank', 'Itaú'], primeiroMes: '2026-11' },
  parcelados: [
    { id: 'p1', dataCompra: '2026-10-05', cartao: 'Nubank', descricao: 'Celular', categoria: 'Outros', valorTotal: 1200, parcelas: 12, inicio: '2026-10' },
    { id: 'p2', dataCompra: '2026-11-02', cartao: 'Itaú', descricao: 'Fone', categoria: 'Outros', valorTotal: 300, parcelas: 3, inicio: '2026-11' }],
  recorrentes: [
    { id: 'r1', descricao: 'Estadao', grupo: 'Cartão', cartao: 'Nubank', categoria: 'Assinaturas', valor: 1.9, inicio: '2026-10-17', fim: '', prox: true },
    { id: 'r2', descricao: 'TotalPass', grupo: 'Cartão', cartao: 'Nubank', categoria: 'Assinaturas', valor: 89.9, inicio: '2026-10-21', fim: '' },
    { id: 'r3', descricao: 'Aluguel', grupo: 'Fixo', cartao: '', categoria: 'Moradia', valor: 2000, inicio: '2026-01-01', fim: '' }],
  lancamentos: [
    { id: 'l1', data: '2026-10-31', descricao: 'Lanche sexta', categoria: 'Lazer', forma: 'Cartão', cartao: 'Nubank', valor: 42, prox: true },
    { id: 'l2', data: '2026-10-20', descricao: 'Lanche', categoria: 'Lazer', forma: 'Cartão', cartao: 'Nubank', valor: 42 },
    { id: 'l3', data: '2026-10-25', descricao: 'Feira', categoria: 'Alimentação', forma: 'Pix', cartao: '', valor: 30 },
    { id: 'l4', data: '2026-12-15', descricao: 'Presente', categoria: 'Outros', forma: 'Cartão', cartao: 'Itaú', valor: 50, prox: true },
    { id: 'l5', data: '2026-11-05', descricao: 'Uber', categoria: 'Transporte', forma: 'Cartão', cartao: 'Itaú', valor: 10 }]
};

test('fatura (fatCartao): parcelas, recorrentes e gastos lançados no cartão (valor a pagar)', async () => {
  const r = await cenario(DADOS_FATURA, `[fatCartao('Nubank', '2026-10'), fatCartao('Nubank', '2026-11'), fatCartao('Itaú', '2026-11'),
    fatCartao('Itaú', '2027-01'), fatCartao('Itaú', '2027-02'), faturaTotal('2026-11')]`);
  // Nubank out: Celular 100 + TotalPass 89,90 + Lanche 42. Nov: Celular + Estadao 1,90 + TotalPass + Lanche sexta 42 (próxima fatura).
  // Itaú nov: Fone 100 + Uber 10. Jan: Fone 100 + Presente 50 (próxima fatura de dez).
  assert.deepEqual(r.map(c2), [231.9, 233.8, 110, 150, 0, 343.8]);
});

test('Resumo, Projeção e aba Faturas mostram o mesmo valor de fatura', async () => {
  const r = await cenario(DADOS_FATURA, `['2026-10', '2026-11', '2026-12', '2027-01'].map(m =>
    S.config.cartoes.map(c => Math.abs(fatCartao(c, m) - linhasFatura(m).find(b => b.cartao === c).total) < 0.005))`);
  assert.deepEqual(r.flat(), Array(8).fill(true));
});

test('fatura real: avulso no cartão entra no mês da compra', async () => {
  const b = await cenario(DADOS_FATURA, itens('2026-10', 'Nubank'));
  assert.deepEqual(b.itens.map(i => i.descricao), ['Celular', 'TotalPass', 'Lanche']);
  assert.equal(c2(b.total), 231.9);
});

test('fatura real: avulso e recorrente com "Próxima fatura" entram no mês seguinte', async () => {
  const b = await cenario(DADOS_FATURA, itens('2026-11', 'Nubank'));
  assert.deepEqual(b.itens.map(i => [i.descricao, i.tipo, i.parcela]),
    [['Celular', 'Parcelado', '2/12'], ['Estadao', 'Recorrente', ''], ['TotalPass', 'Recorrente', ''], ['Lanche sexta', 'Lançamento', '']]);
  assert.equal(c2(b.total), 233.8);
});

test('fatura real: "Próxima fatura" atravessa a virada do ano', async () => {
  const r = await cenario(DADOS_FATURA, `[${itens('2026-11', 'Itaú')}, ${itens('2026-12', 'Itaú')}, ${itens('2027-01', 'Itaú')}]`);
  assert.deepEqual(r.map(b => b.itens.map(i => i.descricao)), [['Fone', 'Uber'], ['Fone'], ['Fone', 'Presente']]);
  assert.deepEqual(r.map(b => c2(b.total)), [110, 100, 150]);
  assert.equal(r[2].itens[0].parcela, '3/3');
});

test('gasto pago no Pix não entra em nenhuma fatura', async () => {
  const r = await cenario(DADOS_FATURA, `linhasFatura('2026-10').flatMap(b => b.itens.map(i => i.descricao))`);
  assert.ok(!r.includes('Feira'));
});

/* ---------- estornos e abatimentos ---------- */
const compra = { id: 'nb', dataCompra: '2026-10-20', cartao: 'Nubank', descricao: 'Notebook', categoria: 'Outros', valorTotal: 1200, parcelas: 12, inicio: '2026-11' };
const comAjuste = ajuste => ({ config: { cartoes: ['Nubank'] }, parcelados: [compra], estornos: [{ id: 'e1', parcelaId: 'nb', descricao: '', ...ajuste }] });
const fatMeses = meses => `[${meses.map(m => `fatCartao('Nubank', '${m}')`).join(',')}]`;

test('estorno: crédito único no mês escolhido', async () => {
  const r = await cenario(comAjuste({ tipo: 'Estorno', mes: '2027-01', valor: 300 }), fatMeses(['2026-12', '2027-01', '2027-02']));
  assert.deepEqual(r.map(c2), [100, -200, 100]);
  const b = await avaliar(pg, itens('2027-01', 'Nubank'));
  assert.deepEqual(b.itens.find(i => i.tipo === 'Estorno').valor, -300);
});

test('abatimento: dividido pelas parcelas restantes a partir do mês escolhido', async () => {
  const r = await cenario(comAjuste({ tipo: 'Abatimento', mes: '2027-01', valor: 300 }), fatMeses(['2026-12', '2027-01', '2027-10', '2027-11']));
  assert.deepEqual(r.map(c2), [100, 70, 70, 0]);
});

test('abatimento com mês anterior à compra: dividido por todas as parcelas', async () => {
  const r = await cenario(comAjuste({ tipo: 'Abatimento', mes: '2026-09', valor: 300 }), fatMeses(['2026-11', '2027-10']));
  assert.deepEqual(r.map(c2), [75, 75]);
});

test('abatimento depois da última parcela: crédito único naquele mês', async () => {
  const r = await cenario(comAjuste({ tipo: 'Abatimento', mes: '2028-01', valor: 300 }), fatMeses(['2027-10', '2028-01']));
  assert.deepEqual(r.map(c2), [100, -300]);
});

/* ---------- ajuste manual na fatura ---------- */
test('ajuste manual reduz só a fatura do cartão e do mês escolhidos, sem mexer nas parcelas', async () => {
  const dados = {
    config: { cartoes: ['Nubank', 'Itaú'] }, parcelados: [compra],
    creditos: [
      { id: 'c1', cartao: 'Nubank', mes: '2026-12', valor: 222.72, descricao: 'Pagamento antecipado' },
      { id: 'c2', cartao: 'Nubank', mes: '2026-12', valor: 50, descricao: '' }]
  };
  const r = await cenario(dados, `[fatCartao('Nubank', '2026-11'), fatCartao('Nubank', '2026-12'), fatCartao('Nubank', '2027-01'),
    fatCartao('Itaú', '2026-12'), execMes('2026-12'), valorParcela(S.parcelados[0])]`);
  assert.deepEqual(r.map(c2), [100, -172.72, 100, 0, 100, 100]);
  const b = await avaliar(pg, itens('2026-12', 'Nubank'));
  assert.deepEqual(b.itens.map(i => [i.tipo, i.descricao, c2(i.valor)]),
    [['Parcelado', 'Notebook', 100], ['Ajuste', 'Pagamento antecipado', -222.72], ['Ajuste', 'Ajuste manual', -50]]);
  assert.equal(c2(b.total), -172.72);
});

/* ---------- executado ---------- */
test('executado do mês e por categoria (pela data da compra, mesmo com "Próxima fatura")', async () => {
  const dados = {
    config: { cartoes: ['Nubank'] }, parcelados: [compra],
    estornos: [{ id: 'e1', parcelaId: 'nb', tipo: 'Estorno', mes: '2026-11', valor: 300, descricao: '' }],
    lancamentos: [
      { id: 'a', data: '2026-11-03', descricao: 'Cinema', categoria: 'Lazer', forma: 'Pix', cartao: '', valor: 50 },
      { id: 'b', data: '2026-11-30', descricao: 'Bar', categoria: 'Lazer', forma: 'Cartão', cartao: 'Nubank', valor: 20, prox: true },
      { id: 'c', data: '2026-12-01', descricao: 'Farmácia', categoria: 'Saúde', forma: 'Pix', cartao: '', valor: 15 }]
  };
  const r = await cenario(dados, `[execMes('2026-11'), execCat('Lazer', '2026-11'), execCat('Outros', '2026-11'), execCat('Saúde', '2026-12'), execMes('2026-12')]`);
  assert.deepEqual(r.map(c2), [-130, 70, -200, 15, 115]);
});

/* ---------- orçamento, mês e projeção ---------- */
const DADOS_MES = {
  config: { cartoes: ['Nubank'], primeiroMes: '2026-11', saldoConta: 1000 },
  recorrentes: [
    { id: 'r1', descricao: 'Salário', grupo: 'Receita', cartao: '', categoria: 'Outros', valor: 5000, inicio: '2026-01-01', fim: '' },
    { id: 'r2', descricao: 'Aluguel', grupo: 'Fixo', cartao: '', categoria: 'Moradia', valor: 2000, inicio: '2026-01-01', fim: '' },
    { id: 'r3', descricao: 'Netflix', grupo: 'Cartão', cartao: 'Nubank', categoria: 'Assinaturas', valor: 40, inicio: '2026-01-01', fim: '' }],
  parcelados: [compra],
  eventuais: [
    { id: 'v1', mes: '2026-11', descricao: '13º', tipo: 'Receita', valor: 1000 },
    { id: 'v2', mes: '2026-11', descricao: 'IPVA', tipo: 'Despesa', valor: 300 }],
  orcamento: { Lazer: 200, 'Saúde': 100 },
  orcamentoMeses: { '2026-12': { Lazer: 500 } }
};

test('orçamento do mês: o específico, se houver; senão, o padrão', async () => {
  assert.deepEqual(await cenario(DADOS_MES, `[totalOrc('2026-11'), totalOrc('2026-12')]`), [300, 500]);
});

test('composição do mês (mesBase)', async () => {
  const r = await cenario(DADOS_MES, `[mesBase('2026-11'), mesBase('2026-12')]`);
  assert.deepEqual(r.map(b => [b.rf, b.re, b.rt, b.ef, c2(b.fat), b.ed, b.ov, c2(b.I)]),
    [[5000, 1000, 6000, 2000, 140, 300, 300, 2740], [5000, 0, 5000, 2000, 140, 0, 500, 2640]]);
});

test('projeção: saldo do mês e acumulado a partir do saldo em conta', async () => {
  const r = await cenario(DADOS_MES, `projecao(2).map(x => [x.m, x.L, x.saldo, x.acum])`);
  assert.deepEqual(r.map(x => x.map(v => (typeof v === 'number' ? c2(v) : v))),
    [['2026-11', 2740, 3260, 4260], ['2026-12', 2640, 2360, 6620]]);
});

/* ---------- lançamentos: cartão (a pagar) x à vista (executado) ---------- */
const DADOS_LANC = {
  ...DADOS_MES,
  orcamento: { 'Alimentação': 1000, Lazer: 200 },
  orcamentoMeses: {},
  lancamentos: [
    { id: 'a', data: '2026-11-05', descricao: 'Mercado', categoria: 'Alimentação', forma: 'Cartão', cartao: 'Nubank', valor: 300 },
    { id: 'b', data: '2026-11-28', descricao: 'Feira', categoria: 'Alimentação', forma: 'Pix', cartao: '', valor: 100 },
    { id: 'c', data: '2026-11-30', descricao: 'Show', categoria: 'Lazer', forma: 'Cartão', cartao: 'Nubank', valor: 250, prox: true },
    { id: 'd', data: '2026-11-10', descricao: 'Padaria', categoria: 'Alimentação', forma: 'Dinheiro', cartao: '', valor: 20 },
    { id: 'e', data: '2026-11-12', descricao: 'Conta de luz', categoria: 'Moradia', forma: 'Boleto', cartao: '', valor: 150 },
    { id: 'f', data: '2026-11-15', descricao: 'Plano (Simulador)', categoria: 'Lazer', forma: 'Planejada', cartao: '', valor: 80 }]
};

test('gasto no cartão entra na fatura; à vista entra no mês; o do Simulador não entra de novo', async () => {
  const r = await cenario(DADOS_LANC, `[fatCartao('Nubank', '2026-11'), fatCartao('Nubank', '2026-12'), aVistaMes('2026-11'), pagoMes('2026-11')]`);
  // Nov: Netflix 40 + Notebook 100 + Mercado 300. Dez: Netflix + Notebook + Show 250 (próxima fatura).
  // À vista: Feira 100 + Padaria 20 + Luz 150 (Boleto). Pago na conta: só Débito/Pix/Dinheiro = 120.
  assert.deepEqual(r.map(c2), [440, 390, 270, 120]);
});

test('orçamento restante: orçado menos o já lançado na categoria, sem ficar negativo', async () => {
  const r = await cenario(DADOS_LANC, `[avulsosCat('Alimentação', '2026-11'), avulsosCat('Lazer', '2026-11'), orcRestante('2026-11'), orcRestante('2026-12')]`);
  // Alimentação: 1000 − (300 + 100 + 20) = 580. Lazer: 200 − 250 = −50 → 0 (o Simulador não conta). Dez: nada lançado = 1200.
  assert.deepEqual(r.map(c2), [420, 250, 580, 1200]);
});

test('mês com lançamentos: cada gasto é contado uma única vez nas despesas', async () => {
  const r = await cenario(DADOS_LANC, `[mesBase('2026-11'), mesBase('2026-12')]`);
  assert.deepEqual(r.map(b => [c2(b.fat), c2(b.av), b.ed, c2(b.ov), c2(b.I)]),
    // Nov: fixas 2000 + fatura 440 + à vista 270 + eventual 300 + restante 580 = 3590.
    // Dez: fixas 2000 + fatura 390 + restante 1200 = 3590 (o Show entra na fatura de dez).
    [[440, 270, 300, 580, 3590], [390, 0, 0, 1200, 3590]]);
});

test('conta: Débito, Pix e Dinheiro saem sozinhos; entradas e saídas manuais; saldo por data', async () => {
  const dados = { ...DADOS_LANC, config: { ...DADOS_LANC.config, saldoConta: 1000 },
    movConta: [
      { id: 'm1', data: '2026-11-05', descricao: 'Salário', tipo: 'Entrada', valor: 5000 },
      { id: 'm2', data: '2026-11-20', descricao: 'Pagamento fatura', tipo: 'Saída', valor: 440 }] };
  const r = await cenario(dados, `[extratoConta().map(i => [i.data, i.descricao, i.valor, i.saldo]),
    saldoContaEm('2026-11-09'), saldoContaEm('2026-11-30'), saldoContaEm('2026-10-31')]`);
  assert.deepEqual(r[0], [
    ['2026-11-05', 'Salário', 5000, 6000],
    ['2026-11-10', 'Padaria', -20, 5980],
    ['2026-11-20', 'Pagamento fatura', -440, 5540],
    ['2026-11-28', 'Feira', -100, 5440]]);
  assert.deepEqual(r.slice(1), [6000, 5440, 1000]);
});

/* ---------- saúde financeira ---------- */
// Cenários a partir do mês atual: a projeção começa nele.
const saude = async extra => {
  const m = await avaliar(pg, `mkOf(hoje())`);
  const dados = {
    config: { cartoes: ['Nubank'], primeiroMes: m, saldoConta: 0 },
    recorrentes: [
      { id: 'r1', descricao: 'Salário', grupo: 'Receita', cartao: '', categoria: 'Outros', valor: 2700, inicio: '2020-01-01', fim: '' },
      { id: 'r2', descricao: 'Internet', grupo: 'Fixo', cartao: '', categoria: 'Moradia', valor: 100, inicio: '2020-01-01', fim: '' }],
    orcamento: { 'Alimentação': 800 },
    ...extra(m)
  };
  return cenario(dados, `scoreSaude()`);
};

const tv = (m, porMes, n = 3) => ({ id: 'p', dataCompra: m + '-01', cartao: 'Nubank', descricao: 'TV', categoria: 'Outros', valorTotal: porMes * n, parcelas: n, inicio: m });

test('saúde: finanças folgadas, sem alertas nem penalidade', async () => {
  // Sobra 1.800 por mês (2.700 − 100 − 800) e há 10.000 em conta.
  const s = await saude(m => ({ config: { cartoes: ['Nubank'], primeiroMes: m, saldoConta: 10000 } }));
  assert.deepEqual(s.alertas, []);
  assert.equal(s.piora, 0);
  assert.deepEqual([s.score, s.bruto, s.ponderado], [100, 100, 100]);
  assert.deepEqual(s.horizontes.map(x => [x.h, x.peso]), [[3, 0.5], [6, 0.3], [12, 0.2]]);
});

test('saúde: gastar mais do que recebe nos próximos 3 meses limita a nota a 25, mesmo com saldo', async () => {
  // Fatura de 2.500 nos 3 primeiros meses: despesa 3.400 > receita 2.700. Saldo alto mantém o acumulado positivo.
  const s = await saude(m => ({ config: { cartoes: ['Nubank'], primeiroMes: m, saldoConta: 20000 }, parcelados: [tv(m, 2500)] }));
  assert.ok(s.score <= 25, `nota ${s.score}`);
  assert.match(s.alertas.find(a => /passam das receitas/.test(a)), /em R\$\s*700,00; 3 dos próximos 12 meses gastam mais do que recebem/);
  // Com déficit, não há poupança nos 3 meses, por mais que sobre depois.
  assert.match(s.partes.find(p => p.nome === 'Poupança').desc, /déficit.*poupança zero.*3m 0/);
});

test('saúde: déficit só no 2º semestre limita a nota a 39', async () => {
  const s = await saude(m => ({ config: { cartoes: ['Nubank'], primeiroMes: m, saldoConta: 20000 },
    eventuais: [{ id: 'v', mes: addMesStr(m, 8), descricao: 'IPVA', tipo: 'Despesa', valor: 3000 }] }));
  assert.equal(s.score, 39);
  assert.equal(s.alertas.length, 1);
});

test('saúde: saldo acumulado negativo zera a reserva e limita a nota', async () => {
  const s = await saude(m => ({ parcelados: [tv(m, 2500)] }));
  assert.ok(s.score <= 25, `nota ${s.score}`);
  assert.ok(s.alertas.some(a => /saldo acumulado fica negativo/.test(a)));
  assert.equal(s.partes.find(p => p.nome === 'Reserva').valor, 0);
  // O comprometimento olha o mês mais apertado: 100 + 2.500 sobre 2.700 = 96,3%.
  assert.match(s.partes.find(p => p.nome === 'Comprometimento').desc, /96,3%/);
});

test('saúde: próximos 3 meses piores que os 6 tiram a diferença da nota e avisam', async () => {
  // Fatura de 1.600 nos 3 primeiros meses: sobra só 200/mês agora e 1.800/mês depois. Sem déficit.
  const s = await saude(m => ({ config: { cartoes: ['Nubank'], primeiroMes: m, saldoConta: 0 }, parcelados: [tv(m, 1600)] }));
  const [h3, h6] = s.horizontes;
  assert.ok(h3.score < h6.score, `3m ${h3.score} · 6m ${h6.score}`);
  assert.equal(s.piora, h6.score - h3.score);
  assert.equal(s.bruto, s.ponderado - s.piora);
  assert.equal(s.score, s.bruto);
  assert.ok(s.alertas.some(a => new RegExp(`3 meses \\(nota ${h3.score}\\) estão piores que os próximos 6 \\(nota ${h6.score}\\)`).test(a)));
});

test('saúde: o mês atual entra mesmo antes do 1º mês da projeção', async () => {
  // A projeção começa no mês que vem; o déficit deste mês continua pesando.
  const s = await saude(m => ({ config: { cartoes: ['Nubank'], primeiroMes: addMesStr(m, 1), saldoConta: 20000 },
    parcelados: [tv(m, 2500, 1)] }));
  assert.equal(s.score, 25);
  assert.ok(s.alertas.some(a => a.startsWith('Em ') && /passam das receitas/.test(a)));
});

test('saúde: sem orçamento variável a nota fica em no máximo 79', async () => {
  const s = await saude(() => ({ orcamento: {} }));
  assert.ok(s.bruto > 79, `nota sem limite ${s.bruto}`);
  assert.equal(s.score, 79);
  assert.ok(s.alertas.some(a => /Nenhum orçamento variável/.test(a)));
});

test('projeção com férias: despesas do mês seguinte são antecipadas', async () => {
  const r = await cenario({ ...DADOS_MES, ferias: { '2026-11': true } }, `projecao(2).map(x => [x.adj, x.L, x.saldo, x.acum])`);
  assert.deepEqual(r.map(x => x.map(c2)), [[2640, 5380, 620, 1620], [-2640, 0, 5000, 6620]]);
});
