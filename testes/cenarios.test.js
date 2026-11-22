// Simulador por cenários: compras, gasto mensal novo, cortes, contas canceladas e mudanças de receita,
// comparados com a situação atual, sem mexer nos dados reais.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { abrirApp, fecharNavegador, avaliar } = require('./lib');

let pg;
before(async () => { pg = await abrirApp(); });
after(async () => { await fecharNavegador(); });

// Salário 5.000; aluguel 2.000; streaming 50 no cartão; orçamento de Lazer 600; saldo inicial 1.000.
// Situação atual: despesa 2.650 e sobra 2.350 por mês → saldo acumulado em 12 meses = 1.000 + 12 × 2.350 = 29.200.
const montar = cenarios => pg.evaluate(cs => {
  const m0 = mkOf(hoje()), M = n => addM(m0, n);
  S = Object.assign(blank(), { orcamento: { Lazer: 600 }, orcamentoMeses: {},
    recorrentes: [
      { id: 's', descricao: 'Salário', grupo: 'Receita', cartao: '', categoria: 'Outros', valor: 5000, inicio: '2020-01-01', fim: '' },
      { id: 'a', descricao: 'Aluguel', grupo: 'Fixo', cartao: '', categoria: 'Moradia', valor: 2000, inicio: '2020-01-01', fim: '' },
      { id: 'st', descricao: 'Streaming', grupo: 'Cartão', cartao: 'Nubank', categoria: 'Assinaturas', valor: 50, inicio: '2020-01-01', fim: '' }],
    cenarios: cs.map(c => ({ ...c, itens: c.itens.map(it => JSON.parse(JSON.stringify(it).replace(/"M(\d+)"/g, (_, n) => `"${M(+n)}"`))) })) });
  S.config = Object.assign(blank().config, { cartoes: ['Nubank'], primeiroMes: m0, saldoConta: 1000 });
  commit();
}, cenarios);

const CENARIOS = [
  { id: 'cel', nome: 'Celular', itens: [{ id: 'i1', tipo: 'compra', descricao: 'Celular', categoria: 'Outros', valor: 3000, mes: 'M0', parcelas: 10 }] },
  { id: 'sem', nome: 'Sem salário', itens: [
    { id: 'i2', tipo: 'orcamento', categoria: 'Lazer', valor: -300, de: 'M0', ate: '' },
    { id: 'i3', tipo: 'receita', modo: 'menos', valor: 5000, de: 'M1', ate: 'M2', descricao: 'Sem salário' }] },
  { id: 'aca', nome: 'Academia e aumento', itens: [
    { id: 'i4', tipo: 'mensal', descricao: 'Academia', categoria: 'Saúde', valor: 100, de: 'M1', ate: '' },
    { id: 'i5', tipo: 'cancelar', recId: 'st', de: 'M1' },
    { id: 'i6', tipo: 'receita', modo: 'pctMais', valor: 10, de: 'M6', ate: '' },
    { id: 'i7', tipo: 'receita', modo: 'extra', valor: 2000, de: 'M3', descricao: 'Freela' }] }];

test('cenários: cada tipo de mudança muda o saldo como esperado, sem tocar nos dados reais', async () => {
  await montar(CENARIOS);
  const real = await avaliar(pg, `JSON.stringify([S.lancamentos, S.eventuais, S.recorrentes, S.orcamentoMeses])`);
  const r = await avaliar(pg, `[null, ...S.cenarios].map(c => { const x = resultadoCenario(c); return [x.acum12, x.vermelho12, x.meses.slice(0, 7).map(y => y.saldo)]; })`);
  assert.deepEqual(r[0], [29200, 0, [2350, 2350, 2350, 2350, 2350, 2350, 2350]]);
  // Celular 3.000 em 10x: 300 a menos por mês durante 10 meses.
  assert.deepEqual(r[1], [26200, 0, [2050, 2050, 2050, 2050, 2050, 2050, 2050]]);
  // Lazer 300 a menos todo mês e 2 meses sem salário: 2 meses no vermelho.
  assert.deepEqual(r[2], [22800, 2, [2650, -2350, -2350, 2650, 2650, 2650, 2650]]);
  // Academia 100 e streaming cancelado (−50) do mês 1, freela de 2.000 no mês 3, receita 10% maior do mês 6.
  assert.deepEqual(r[3], [33650, 0, [2350, 2300, 2300, 4300, 2300, 2300, 2800]]);
  assert.equal(await avaliar(pg, `JSON.stringify([S.lancamentos, S.eventuais, S.recorrentes, S.orcamentoMeses])`), real, 'dados reais intactos');
  const base = await avaliar(pg, `resultadoCenario(null)`);
  const v = await avaliar(pg, `S.cenarios.map(c => avaliarCenario(resultadoCenario(c), resultadoCenario(null)).nivel)`);
  assert.equal(v[1], 'nao');
  assert.equal(v[2], 'ok');
  assert.equal(base.meses.length, 24);
  assert.deepEqual(pg.erros, []);
});

test('tela de cenários: criar, adicionar mudanças, comparar, analisar a compra, gráfico, mês a mês e excluir com desfazer', async () => {
  await montar([]);
  await pg.evaluate(() => { simAba = 'cenarios'; cenSel = null; ir('simulador'); });
  await pg.fill('form[onsubmit="novoCenario(event)"] [name=nome]', 'Viagem');
  await pg.click('form[onsubmit="novoCenario(event)"] button');
  assert.equal(await avaliar(pg, 'S.cenarios.length'), 1);
  // Compra: viagem de 4.000 em 4x.
  await pg.fill('#formCenItem [name=descricao]', 'Passagens');
  await pg.selectOption('#formCenItem [name=categoria]', 'Lazer');
  await pg.fill('#formCenItem [name=valor]', '4000');
  await pg.fill('#formCenItem [name=parcelas]', '4');
  await pg.click('#formCenItem button');
  // Corte: Lazer 200 a menos.
  await pg.click('#cenTipos button:text-is("Cortar ou aumentar gasto")');
  await pg.selectOption('#formCenItem [name=categoria]', 'Lazer');
  await pg.fill('#formCenItem [name=valor]', '200');
  await pg.click('#formCenItem button');
  assert.match(await pg.innerText('#cenItens'), /Compra: Passagens · R\$\s?4\.000,00 em 4x de R\$\s?1\.000,00[\s\S]*Cortar Lazer em R\$\s?200,00 por mês/);
  // 12 meses: −4.000 da viagem + 12 × 200 do corte = −1.600 em relação aos 29.200.
  const t = await pg.innerText('#cenComparar');
  assert.match(t, /Saldo acumulado em 12 meses\s+R\$\s?29\.200,00\s+R\$\s?27\.600,00/);
  assert.match(t, /Veredito/);
  assert.equal(await avaliar(pg, `document.querySelectorAll('#cenMeses tbody tr').length`), 24);
  assert.ok(await pg.$('svg[aria-label="Saldo acumulado por cenário"] polyline'));
  await pg.click('#conteudo button:text-is("Saldo do mês")');
  assert.match(await pg.innerText('#cenMeses tbody tr:first-child'), /R\$\s?2\.350,00\s+R\$\s?1\.550,00/);
  // Analisar a compra leva ao "Analisar uma compra" com os mesmos valores.
  await pg.click('#cenItens button:text-is("Analisar")');
  assert.equal(await avaliar(pg, 'simAba'), 'compra');
  assert.deepEqual(await avaliar(pg, `[simEntrada.valor, simEntrada.parcelas, simEntrada.categoria]`), [4000, 4, 'Lazer']);
  assert.ok(await pg.$('form[onsubmit="simRodar(event)"]'));
  // Duplicar, comparar só um e excluir com desfazer.
  await pg.evaluate(() => { simAba = 'cenarios'; render(); });
  await pg.click('#cenEditor button:text-is("Duplicar")');
  assert.deepEqual(await avaliar(pg, 'S.cenarios.map(c => [c.nome, c.itens.length])'), [['Viagem', 2], ['Viagem (cópia)', 2]]);
  await pg.uncheck('#conteudo label:has-text("Viagem (cópia)") input');
  assert.equal(await avaliar(pg, `document.querySelectorAll('#cenComparar thead th').length`), 3, 'atual + 1 cenário');
  await pg.click('#cenEditor button:text-is("Excluir cenário")');
  assert.equal(await avaliar(pg, 'S.cenarios.length'), 1);
  await pg.click('#toastDesfazer');
  assert.equal(await avaliar(pg, 'S.cenarios.length'), 2);
  // As abas "Analisar uma compra" e "Meta de compra" continuam.
  await pg.click('#simAbas button:text-is("Meta de compra")');
  assert.match(await pg.innerText('#conteudo'), /Meta de compra/);
  assert.deepEqual(pg.erros, []);
});

test('cenários cabem no celular', async () => {
  const cel = await abrirApp({ largura: 375, altura: 812 });
  await cel.evaluate(cs => { exemplo(); S.cenarios = cs.map(c => ({ ...c, itens: c.itens.map(it => JSON.parse(JSON.stringify(it).replace(/"M(\d+)"/g, (_, n) => `"${addM(mkOf(hoje()), +n)}"`))) })); commit(); simAba = 'cenarios'; ir('simulador'); }, CENARIOS);
  assert.equal(await cel.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
  assert.deepEqual(cel.erros, []);
  await cel.fechar();
});
