// Melhorias: abas em grupos, gasto real na Projeção, regras de categoria, fatura importada no Check list e
// a lista de avisos do celular. (Cópias no Drive ficam em sync.test.js; compartilhar e avisos do service worker, em sw.test.js.)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { abrirApp, fecharNavegador, definirDados, avaliar } = require('./lib');

let pg;
before(async () => { pg = await abrirApp(); });
after(async () => { await fecharNavegador(); });

test('abas em grupos: o grupo da aba aberta fica marcado e volta para a última aba usada nele', async () => {
  await pg.evaluate(() => ir('importar'));
  assert.equal(await pg.innerText('.grupo.on'), 'Lançar');
  assert.equal(await pg.innerText('.sub-abas .tab.on'), 'Importar fatura');
  assert.deepEqual(await pg.$$eval('.grupo', b => b.map(x => x.textContent)), ['Planejar', 'Lançar', 'Conferir', 'Configurar']);
  await pg.click('.grupo:text-is("Planejar")');
  assert.equal(await avaliar(pg, 'aba'), 'resumo');
  await pg.click('.sub-abas .tab:text-is("Projeção")');
  await pg.click('.grupo:text-is("Lançar")');
  assert.equal(await avaliar(pg, 'aba'), 'importar', 'volta para a última aba do grupo');
  await pg.click('.grupo:text-is("Planejar")');
  assert.equal(await avaliar(pg, 'aba'), 'projecao');
  await pg.click('.grupo:text-is("Configurar")');
  assert.equal(await avaliar(pg, 'aba'), 'config');
  assert.equal(await pg.$('.sub-abas'), null, 'grupo de uma aba só não tem a segunda linha');
  // Todas as abas continuam acessíveis por algum grupo.
  const todas = await avaliar(pg, `GRUPOS_ABAS.flatMap(([, a]) => a.map(([k]) => k)).sort()`);
  assert.deepEqual(todas, await avaliar(pg, `Object.keys(V).filter(k => typeof V[k] === 'function').sort()`));
  assert.deepEqual(pg.erros, []);
});

test('Projeção: compara a média real dos últimos 3 meses com o previsto, sem mudar os cálculos', async () => {
  await pg.evaluate(() => {
    const m0 = mkOf(hoje());
    S = Object.assign(blank(), { orcamento: {}, orcamentoMeses: {},
      recorrentes: [{ id: 'f', descricao: 'Aluguel', grupo: 'Fixo', cartao: '', categoria: 'Moradia', valor: 1000, inicio: '2020-01-01', fim: '' }],
      lancamentos: [1, 2, 3].map(i => ({ id: 'l' + i, data: addM(m0, -i) + '-10', descricao: 'Mercado', categoria: 'Alimentação', forma: 'Cartão', cartao: 'Nubank', valor: 500 })) });
    S.config = Object.assign(blank().config, { cartoes: ['Nubank'], primeiroMes: addM(m0, -3) });
    commit(); ir('projecao');
  });
  // Real: 1.000 + 500 por mês; previsto: só o aluguel → a projeção prevê 500 a menos por mês.
  assert.deepEqual(await avaliar(pg, 'gastoRealVsPrevisto()'), { meses: 3, real: 1500, previsto: 1000, falta: 500 });
  const txt = await pg.innerText('#projGastoReal');
  assert.match(txt, /pode estar otimista/i);
  assert.match(txt, /R\$\s?500,00 por mês/);
  const antes = await avaliar(pg, 'projecao(3).map(r => r.L)');
  await pg.evaluate(() => { S.orcamento = { Alimentação: 600 }; commit(); });
  assert.match(await pg.innerText('#projGastoReal'), /cobre a média/i, 'com orçamento para o dia a dia, a projeção cobre a média');
  assert.notDeepEqual(await avaliar(pg, 'projecao(3).map(r => r.L)'), antes);
  // Sem histórico, o quadro não aparece.
  await definirDados(pg, {});
  await pg.evaluate(() => ir('projecao'));
  assert.equal(await pg.$('#projGastoReal'), null);
  assert.deepEqual(pg.erros, []);
});

test('regras de categoria: valem no lançamento e na importação, acompanham a troca de nome e vão para a planilha', async () => {
  await definirDados(pg, { config: { cartoes: ['Nubank'], primeiroMes: '2026-10' },
    lancamentos: [{ id: 'u', data: '2026-09-01', descricao: 'Uber Trip', categoria: 'Lazer', forma: 'Cartão', cartao: 'Nubank', valor: 10 }] });
  await pg.evaluate(() => ir('config'));
  await pg.fill('#regrasCategoria [name=texto]', 'úber');
  await pg.selectOption('#regrasCategoria [name=categoria]', 'Transporte');
  await pg.click('#regrasCategoria button:text-is("Adicionar regra")');
  assert.deepEqual(await avaliar(pg, 'S.regrasCategoria.map(r => [r.texto, r.categoria])'), [['úber', 'Transporte']]);
  // A regra vence o histórico (a última compra "Uber Trip" estava em Lazer). Sem acento e sem maiúscula.
  assert.equal(await avaliar(pg, `categoriaSugerida('UBER *TRIP')`), 'Transporte');
  await pg.evaluate(() => ir('lancamentos'));
  await pg.fill('#formLanc [name=descricao]', 'UBER *TRIP');
  await pg.dispatchEvent('#formLanc [name=descricao]', 'change');
  assert.equal(await pg.inputValue('#formLanc [name=categoria]'), 'Transporte');
  // Na importação: trocar a categoria de um item e clicar "Sempre assim" cria a regra e aplica nos iguais.
  await pg.evaluate(() => { impFat = null; ir('importar'); impMontarTexto('03/10/2026 UBER TRIP 23,90\n04/10/2026 PADARIA BOA 10,00\n09/10/2026 PADARIA BOA 7,00', 'teste'); });
  assert.deepEqual(await avaliar(pg, 'impFat.itens.map(i => i.categoria)'), ['Transporte', 'Alimentação', 'Alimentação']);
  const id = await avaliar(pg, 'impFat.itens[1].id');
  await pg.evaluate(i => impItem(i, 'categoria', 'Lazer'), id);
  await pg.click('#impTabela button:text-is("Sempre assim")');
  assert.deepEqual(await avaliar(pg, 'S.regrasCategoria.map(r => [r.texto, r.categoria])'), [['úber', 'Transporte'], ['padaria boa', 'Lazer']]);
  assert.deepEqual(await avaliar(pg, 'impFat.itens.map(i => i.categoria)'), ['Transporte', 'Lazer', 'Lazer']);
  // Renomear a categoria atualiza a regra; excluir a categoria em uso pela regra é bloqueado.
  await pg.evaluate(() => renomearLista({ preventDefault() {}, target: { elements: { antigo: { value: 'Transporte' }, novo: { value: 'Mobilidade' } } } }, 'categorias'));
  assert.equal(await avaliar(pg, `S.regrasCategoria[0].categoria`), 'Mobilidade');
  await pg.evaluate(() => { S.lancamentos = []; impFat = null; delLista('categorias', S.config.categorias.indexOf('Mobilidade')); });
  assert.ok(await avaliar(pg, `S.config.categorias.includes('Mobilidade')`));
  // Planilha: exportar e importar mantém as regras.
  const lidas = await pg.evaluate(async () => {
    const g = await XL.ler(await XL.gerar(montarPlanilha()).arrayBuffer());
    return interpretarNova(g).regrasCategoria.map(r => [r.texto, r.categoria]);
  });
  assert.deepEqual(lidas, [['úber', 'Mobilidade'], ['padaria boa', 'Lazer']]);
  await pg.evaluate(() => { impFat = null; });
  assert.deepEqual(pg.erros, []);
});

test('fatura importada vai para o Check list: mostra o total do banco e marca paga com um toque', async () => {
  await definirDados(pg, { config: { cartoes: ['Nubank'], primeiroMes: '2026-10' } });
  await pg.evaluate(() => { impFat = null; impMontarTexto('Vencimento: 10/11/2026\nTotal da fatura: R$ 33,90\n03/10/2026 UBER 23,90\n05/10/2026 PADARIA 10,00', 'teste'); lancarFatura(); });
  assert.equal(await avaliar(pg, `S.checklist['2026-10'].itens['fat:Nubank'].banco`), 33.9);
  assert.match(await avaliar(pg, 'impMsg'), /Check list de out\/2026/);
  await pg.evaluate(() => { clMesEsc = '2026-10'; ir('checklist'); });
  assert.match(await pg.innerText('.cl-banco'), /Fatura importada do banco: R\$\s?33,90 · bate com o lançado/);
  await pg.click('#clTabela button:has-text("Paga com")');
  assert.deepEqual(await avaliar(pg, `(e => [e.pago, e.valor, e.banco])(S.checklist['2026-10'].itens['fat:Nubank'])`), [true, 33.9, 33.9]);
  assert.match(await pg.innerText('#clTabela'), /✓ Confere/);
  // Desmarcar o pago mantém o total importado.
  await pg.uncheck('#clPago0');
  assert.deepEqual(await avaliar(pg, `S.checklist['2026-10'].itens['fat:Nubank']`), { banco: 33.9 });
  await pg.evaluate(() => { clMesEsc = null; });
  assert.deepEqual(pg.erros, []);
});

test('avisos do celular: lista de vencimentos e check list, sem a fatura já paga', async () => {
  await definirDados(pg, { config: { cartoes: ['Nubank'], primeiroMes: '2026-10', vencimentos: { Nubank: 10 } },
    lancamentos: [{ id: 'l', data: '2026-10-03', descricao: 'Uber', categoria: 'Transporte', forma: 'Cartão', cartao: 'Nubank', valor: 23.9 }] });
  const lista = await avaliar(pg, `agendaAvisos('2026-11-07')`);
  assert.deepEqual(lista.map(a => [a.id, a.de, a.ate]), [['venc:Nubank:2026-11-10', '2026-11-07', '2026-11-10'], ['cl:2026-10', '2026-11-05', '2026-11-10']]);
  assert.match(lista[0].texto, /Vence em 10\/11\/2026: R\$\s?23,90/);
  // Paga no Check list: some o aviso da fatura; concluído: some o do Check list.
  await pg.evaluate(() => { S.checklist = { '2026-10': { itens: { 'fat:Nubank': { pago: true, valor: 23.9 } }, fora: 'nao' } }; commit(); });
  assert.deepEqual(await avaliar(pg, `agendaAvisos('2026-11-07')`), []);
  // Sem service worker (arquivo local), ativar avisa que o navegador não mostra avisos, sem erro.
  await pg.evaluate(() => ir('config'));
  await pg.click('#avisosLigar');
  assert.match(await pg.innerText('#avisoCelEstado'), /não mostra avisos/);
  assert.deepEqual(pg.erros, []);
});
