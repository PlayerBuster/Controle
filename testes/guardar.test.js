// Quanto posso gastar (mês e dia, com médias) e aba Guardar (destinos, plano por valor ou %, valores guardados).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { abrirApp, fecharNavegador, avaliar } = require('./lib');

let pg;
before(async () => { pg = await abrirApp(); });
after(async () => { await fecharNavegador(); });

// Salário 5.000, aluguel 1.500, orçamento de Alimentação 1.000; no mês atual, 300 de mercado no cartão;
// no mês passado, 600 de mercado. Plano: guardar 10% da receita na Reserva.
const montar = () => pg.evaluate(() => {
  const m0 = mkOf(hoje());
  S = Object.assign(blank(), {
    orcamento: { Alimentação: 1000 }, orcamentoMeses: {},
    recorrentes: [
      { id: 's', descricao: 'Salário', grupo: 'Receita', cartao: '', categoria: 'Outros', valor: 5000, inicio: '2020-01-01', fim: '' },
      { id: 'a', descricao: 'Aluguel', grupo: 'Fixo', cartao: '', categoria: 'Moradia', valor: 1500, inicio: '2020-01-01', fim: '' }],
    lancamentos: [
      { id: 'l1', data: m0 + '-01', descricao: 'Mercado', categoria: 'Alimentação', forma: 'Cartão', cartao: 'Nubank', valor: 300 },
      { id: 'l0', data: addM(m0, -1) + '-15', descricao: 'Mercado', categoria: 'Alimentação', forma: 'Pix', cartao: '', valor: 600 }],
    destinos: [{ id: 'res', nome: 'Reserva', meta: 2000 }],
    planoGuardar: [{ id: 'p1', destinoId: 'res', forma: 'pct', valor: 10, de: m0, ate: '' }]
  });
  S.config = Object.assign(blank().config, { cartoes: ['Nubank'], primeiroMes: addM(m0, -1) });
  commit();
  return m0;
});

test('quanto posso gastar: no mês, por dia e as médias, com o orçamento contando como disponível', async () => {
  const m0 = await montar();
  // Mês atual: 5.000 − (aluguel 1.500 + fatura 300) − guardar 500 = 2.700; para gastar no mês = 2.700 + 300 já gastos.
  const p = await avaliar(pg, `podeGastar(mkOf(hoje()))`);
  assert.deepEqual([p.rt, p.guardar, p.gasto, p.restante, p.limite], [5000, 500, 300, 2700, 3000]);
  // Meses seguintes: 5.000 − 1.500 − 500 = 3.000 (o orçamento de 1.000 é parte do que se pode gastar).
  const md = await avaliar(pg, `mediasGasto()`);
  assert.deepEqual(md.futuro.map(x => [x.n, x.mes]), [[3, 3000], [6, 3000], [12, 3000]]);
  const diasPassado = await avaliar(pg, `diasNoMes(addM(mkOf(hoje()), -1))`);
  assert.deepEqual([md.passado.n, md.passado.mes], [1, 600]);
  assert.ok(Math.abs(md.passado.dia - 600 / diasPassado) < 1e-9);
  // Tela: por dia = 2.700 ÷ dias que faltam, contando hoje.
  await pg.evaluate(() => { mesVisto = null; ir('mesatual'); });
  const txt = await pg.innerText('#podeGastar');
  const [dia, dias] = await avaliar(pg, `[Number(hoje().slice(8, 10)), diasNoMes(mkOf(hoje()))]`);
  const porDia = await avaliar(pg, `brl(2700 / ${dias - dia + 1})`);
  assert.match(txt, /AINDA PODE GASTAR\s+R\$\s?2\.700,00/i);
  assert.ok(txt.replace(/\s/g, ' ').includes(porDia.replace(/\s/g, ' ')), `por dia ${porDia}`);
  assert.match(txt, /próximos 3 meses\s+R\$\s?3\.000,00/);
  assert.match(txt, /últimos 1 mês\s+R\$\s?600,00/);
  // A Projeção não muda: só ganha "para guardar" e "livre".
  const proj = await avaliar(pg, `projecao(3).map(r => [r.saldo, r.guardar, r.livre])`);
  await pg.evaluate(() => { S.planoGuardar = []; commit(); });
  const sem = await avaliar(pg, `projecao(3).map(r => [r.saldo, r.guardar, r.livre])`);
  assert.deepEqual(proj.map(r => r[0]), sem.map(r => r[0]));
  assert.deepEqual(proj.map(r => r[1]), [0, 500, 500], 'o mês passado não tinha plano');
  assert.deepEqual(proj.map(r => Math.round((r[0] - r[2]) * 100) / 100), [0, 500, 500]);
  assert.equal(m0.length, 7);
  assert.deepEqual(pg.erros, []);
});

test('aba Guardar: destinos com meta, plano por valor ou %, guardar o planejado e previsão da meta', async () => {
  const m0 = await montar();
  await pg.evaluate(() => ir('guardar'));
  // Novo destino e um valor só para o mês que vem (ex.: 13º).
  await pg.fill('form[onsubmit="addDestino(event)"] [name=nome]', 'Viagem');
  await pg.fill('form[onsubmit="addDestino(event)"] [name=meta]', '1000');
  await pg.click('form[onsubmit="addDestino(event)"] button');
  const viagem = await avaliar(pg, `S.destinos.find(d => d.nome === 'Viagem').id`);
  const f = 'form[onsubmit="addPlanoGuardar(event)"]';
  await pg.selectOption(`${f} [name=destino]`, viagem);
  await pg.selectOption(`${f} [name=forma]`, 'valor');
  await pg.fill(`${f} [name=valor]`, '250');
  const m1 = await avaliar(pg, `addM(mkOf(hoje()), 1)`);
  await pg.fill(`${f} [name=de]`, m1);
  await pg.fill(`${f} [name=ate]`, m1);
  await pg.click(`${f} button`);
  assert.deepEqual(await avaliar(pg, `[guardarMes(mkOf(hoje())), guardarMes(addM(mkOf(hoje()), 1)), guardarMes(addM(mkOf(hoje()), 2))]`), [500, 750, 500]);
  // Guardar o planejado do mês: vira aporte do Patrimônio na Reserva.
  await pg.click('#guardarMesBtn');
  assert.deepEqual(await avaliar(pg, `S.patrimonio.aportes.map(a => [a.valor, a.destinoId])`), [[500, 'res']]);
  assert.equal(await pg.$('#guardarMesBtn'), null, 'nada mais a guardar no mês');
  // Reserva: 500 guardados, meta 2.000 com 500 por mês → chega em 3 meses depois deste.
  assert.deepEqual(await avaliar(pg, `previsaoMeta(S.destinos[0])`), { mes: await avaliar(pg, `addM(mkOf(hoje()), 3)`), meses: 4 });
  const card = await pg.innerText('.destino[data-id="res"]');
  assert.match(card, /R\$\s?500,00/);
  assert.match(card, /25% de R\$\s?2\.000,00 · faltam R\$\s?1\.500,00/);
  // Viagem: só 250 planejados para sempre → não chega aos 1.000.
  assert.deepEqual(await avaliar(pg, `previsaoMeta(S.destinos[1])`), { nunca: true });
  // Próximos 12 meses: sobra, para guardar e livre.
  const linha1 = await pg.innerText('#guardarMeses tbody tr:nth-child(2)');
  assert.match(linha1, /R\$\s?750,00/);
  // Patrimônio soma o que foi guardado.
  assert.equal(await avaliar(pg, `projPatr().P`), await avaliar(pg, `S.patrimonio.valorInicial + 500`));
  // Destino com plano não pode ser excluído.
  await pg.evaluate(id => delDestino(id), viagem);
  assert.match(pg.alertas[pg.alertas.length - 1], /tem valores guardados ou planejados/);
  // Planilha: exportar e importar mantém destinos, plano e o destino dos aportes.
  const lido = await pg.evaluate(async () => {
    const x = interpretarNova(await XL.ler(await XL.gerar(montarPlanilha()).arrayBuffer()));
    const nome = id => x.destinos.find(d => d.id === id).nome;
    return { destinos: x.destinos.map(d => [d.nome, d.meta]), plano: x.planoGuardar.map(p => [nome(p.destinoId), p.forma, p.valor, p.de, p.ate]),
      aportes: x.patrimonio.aportes.map(a => [a.valor, nome(a.destinoId)]) };
  });
  assert.deepEqual(lido, { destinos: [['Reserva', 2000], ['Viagem', 1000]],
    plano: [['Reserva', 'pct', 10, m0, ''], ['Viagem', 'valor', 250, m1, m1]], aportes: [[500, 'Reserva']] });
  assert.deepEqual(pg.erros, []);
});

test('quanto posso gastar e Guardar cabem no celular', async () => {
  const cel = await abrirApp({ largura: 375, altura: 812 });
  await cel.evaluate(() => { exemplo(); S.destinos = [{ id: 'r', nome: 'Reserva de emergência', meta: 20000 }]; S.planoGuardar = [{ id: 'p', destinoId: 'r', forma: 'valor', valor: 300, de: mkOf(hoje()), ate: '' }]; commit(); });
  for (const k of ['mesatual', 'guardar']) {
    await cel.evaluate(k => ir(k), k);
    assert.equal(await cel.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, `aba ${k} com rolagem lateral`);
  }
  assert.deepEqual(cel.erros, []);
  await cel.fechar();
});
