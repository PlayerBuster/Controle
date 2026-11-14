// Orçamento 50-30-20 e as melhorias do dia a dia: lançamento rápido, desfazer, repetir, alterar vários, contas variáveis,
// vencimento das contas fixas, valores a receber, quitar parcelas, busca, onde gasta, observação, esconder valores e PIN.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { abrirApp, fecharNavegador, definirDados, avaliar } = require('./lib');

let pg;
before(async () => { pg = await abrirApp(); });
after(async () => { await fecharNavegador(); });
const ir = k => pg.evaluate(k => ir(k), k);
const m0 = () => avaliar(pg, 'mkOf(hoje())');

test('Orçamento 50-30-20: grupos, ideal, sugestão, trocar grupo e método', async () => {
  const m = await m0();
  await definirDados(pg, { config: { cartoes: ['Nubank'], primeiroMes: m, mesRef: m },
    orcamento: { Alimentação: 800, Lazer: 400 },
    recorrentes: [
      { id: 's', descricao: 'Salário', grupo: 'Receita', cartao: '', categoria: 'Outros', valor: 5000, inicio: '2020-01-01', fim: '' },
      { id: 'a', descricao: 'Aluguel', grupo: 'Fixo', cartao: '', categoria: 'Moradia', valor: 1500, inicio: '2020-01-01', fim: '' },
      { id: 'n', descricao: 'Streaming', grupo: 'Cartão', cartao: 'Nubank', categoria: 'Assinaturas', valor: 60, inicio: '2020-01-01', fim: '' }],
    eventuais: [{ id: 'e', mes: m, descricao: 'IPVA', tipo: 'Despesa', valor: 200 }],
    destinos: [{ id: 'r', nome: 'Reserva', meta: 0 }], planoGuardar: [{ id: 'p', destinoId: 'r', forma: 'pct', valor: 10, de: m, ate: '' }] });
  // Necessidades: aluguel 1.500 + mercado 800 + IPVA 200 = 2.500; Desejos: lazer 400 + streaming 60 = 460; Guardar: 10% = 500.
  const o = await avaliar(pg, `orcGrupos(mkOf(hoje()))`);
  assert.deepEqual([o.previsto.nec, o.previsto.des, o.previsto.gua, o.ideal.nec, o.ideal.des, o.ideal.gua, o.livre], [2500, 460, 500, 2500, 1500, 1000, 1540]);
  // Sugestão: Necessidades cabem 2.500 − 1.500 − 200 = 800 (todo no mercado); Desejos 1.500 − 60 = 1.440 (todo no lazer).
  const sug = await avaliar(pg, `sugestaoOrc(mkOf(hoje()))`);
  assert.deepEqual([sug.Alimentação, sug.Lazer, sug.Moradia, sug.Assinaturas], [800, 1440, 0, 0]);
  await ir('orcamento');
  assert.match(await pg.innerText('#orcGrupos'), /NECESSIDADES · 50%[\s\S]*R\$\s?2\.500,00[\s\S]*DESEJOS · 30%[\s\S]*cabem mais R\$\s?1\.040,00[\s\S]*GUARDAR · 20%[\s\S]*faltam R\$\s?500,00/i);
  await pg.click('#orcSugerir');
  assert.equal(await avaliar(pg, `S.orcamentoMeses[mkOf(hoje())].Lazer`), 1440);
  assert.match(await pg.innerText('#toast'), /Sugestão aplicada/);
  await pg.click('#toastDesfazer');
  assert.equal(await avaliar(pg, `S.orcamentoMeses[mkOf(hoje())]`), undefined, 'desfazer volta ao orçamento padrão');
  // Lazer vira Necessidade; método 60-30-10.
  await pg.selectOption('#orcTabela tr[data-cat="Lazer"] select', 'nec');
  await pg.click('#orcMetodos button:text-is("60-30-10")');
  const o2 = await avaliar(pg, `orcGrupos(mkOf(hoje()))`);
  assert.deepEqual([o2.previsto.nec, o2.previsto.des, o2.ideal.nec, o2.ideal.gua], [2900, 60, 3000, 500]);
  // Personalizado que não soma 100 avisa.
  await pg.fill('#orcMetodos input[aria-label="% Guardar"]', '30');
  await pg.dispatchEvent('#orcMetodos input[aria-label="% Guardar"]', 'change');
  assert.match(await pg.innerText('#orcSoma'), /somam 120%/);
  // Planilha mantém grupos e método.
  const lido = await pg.evaluate(async () => { const x = interpretarNova(await XL.ler(await XL.gerar(montarPlanilha()).arrayBuffer())); return [x.config.grupoCat.Lazer, x.config.metodoOrc]; });
  assert.deepEqual(lido, ['nec', { nec: 60, des: 30, gua: 30 }]);
  assert.deepEqual(pg.erros, []);
});

test('lançamento rápido pelo botão +, desfazer, repetir e observação', async () => {
  await definirDados(pg, { config: { cartoes: ['Nubank'] } });
  await ir('resumo');
  await pg.click('#rapidoBtn');
  await pg.fill('#formRapido [name=valor]', '25');
  await pg.fill('#formRapido [name=descricao]', 'Padaria');
  await pg.selectOption('#formRapido [name=forma]', 'Pix');
  assert.equal(await pg.isVisible('#formRapido [name=cartao]'), false, 'sem cartão fora do cartão');
  await pg.fill('#formRapido [name=obs]', 'pão de queijo');
  await pg.click('#formRapido button');
  assert.equal(await pg.isVisible('#rapido'), false);
  assert.deepEqual(await avaliar(pg, `S.lancamentos.map(l => [l.descricao, l.valor, l.forma, l.obs, l.data === hoje()])`), [['Padaria', 25, 'Pix', 'pão de queijo', true]]);
  assert.match(await pg.innerText('#toast'), /Lançado: Padaria/);
  await pg.click('#toastDesfazer');
  assert.equal(await avaliar(pg, 'S.lancamentos.length'), 0);
  // Repetir: copia com a data de hoje e abre a edição.
  await definirDados(pg, { config: { cartoes: ['Nubank'] }, lancamentos: [{ id: 'l', data: '2026-01-05', descricao: 'Posto', categoria: 'Transporte', forma: 'Cartão', cartao: 'Nubank', valor: 200, prox: true, obs: 'gasolina' }] });
  await ir('lancamentos');
  assert.match(await pg.innerText('#lancTabela'), /gasolina/);
  await pg.click('#lancTabela button:text-is("Repetir")');
  const novo = await avaliar(pg, `S.lancamentos[1]`);
  assert.equal(novo.data, await avaliar(pg, 'hoje()'));
  assert.deepEqual([novo.descricao, novo.valor, novo.prox, novo.obs], ['Posto', 200, undefined, 'gasolina']);
  assert.ok(await pg.$('form[onsubmit="salvarLanc(event)"]'), 'abre a edição');
  await pg.fill('form[onsubmit="salvarLanc(event)"] [name=valor]', '180');
  await pg.fill('form[onsubmit="salvarLanc(event)"] [name=obs]', '');
  await pg.click('form[onsubmit="salvarLanc(event)"] button:text-is("Salvar alterações")');
  assert.deepEqual(await avaliar(pg, `[S.lancamentos[1].valor, 'obs' in S.lancamentos[1]]`), [180, false]);
  // A busca da lista também procura na observação.
  await pg.evaluate(() => { filtroLanc.texto = 'gasol'; render(); });
  assert.equal(await avaliar(pg, `document.querySelectorAll('#lancTabela tbody tr').length`), 1);
  await pg.evaluate(() => limparFiltroLanc());
  assert.deepEqual(pg.erros, []);
});

test('alterar vários lançamentos de uma vez: categoria, fatura e excluir, com desfazer', async () => {
  await definirDados(pg, { config: { cartoes: ['Nubank', 'Itaú'] }, lancamentos: [
    { id: 'a', data: '2026-10-01', descricao: 'A', categoria: 'Outros', forma: 'Cartão', cartao: 'Nubank', valor: 10 },
    { id: 'b', data: '2026-10-02', descricao: 'B', categoria: 'Outros', forma: 'Pix', cartao: '', valor: 20 },
    { id: 'c', data: '2026-10-03', descricao: 'C', categoria: 'Outros', forma: 'Cartão', cartao: 'Nubank', valor: 30 }],
    parcelados: [{ id: 'p', dataCompra: '2026-10-01', cartao: 'Nubank', descricao: 'TV', categoria: 'Outros', valorTotal: 1000, parcelas: 10, inicio: '2026-10' }] });
  await ir('lancamentos');
  assert.equal(await pg.$('#barraMassa'), null);
  await pg.check('#lancTabela thead input[type=checkbox]');
  assert.match(await pg.innerText('#barraMassa'), /4 selecionado/);
  await pg.selectOption('#massaCat', 'Lazer');
  assert.deepEqual(await avaliar(pg, `[...S.lancamentos, ...S.parcelados].map(x => x.categoria)`), ['Lazer', 'Lazer', 'Lazer', 'Lazer']);
  await pg.selectOption('#massaFatura', 'prox');
  assert.deepEqual(await avaliar(pg, `S.lancamentos.map(x => !!x.prox)`), [true, false, true], 'fatura só muda no cartão');
  await pg.selectOption('#massaCartao', 'Itaú');
  assert.deepEqual(await avaliar(pg, `[...S.lancamentos.map(x => x.cartao), S.parcelados[0].cartao]`), ['Itaú', '', 'Itaú', 'Itaú']);
  await pg.click('#massaExcluir');
  assert.equal(await avaliar(pg, `S.lancamentos.length + S.parcelados.length`), 0);
  await pg.click('#toastDesfazer');
  assert.equal(await avaliar(pg, `S.lancamentos.length + S.parcelados.length`), 4);
  assert.deepEqual(pg.erros, []);
});

test('conta variável: o Check list pede o valor e a conta passa a valer a média; vencimento das fixas', async () => {
  await definirDados(pg, { config: { cartoes: [], primeiroMes: '2026-08' },
    recorrentes: [{ id: 'luz', descricao: 'Luz', grupo: 'Fixo', cartao: '', categoria: 'Moradia', valor: 150, inicio: '2026-01-01', fim: '', dia: 10, variavel: true }],
    checklist: { '2026-08': { itens: { 'rec:luz': { pago: true, valor: 120 } } }, '2026-09': { itens: { 'rec:luz': { pago: true, valor: 180 } } } } });
  await pg.evaluate(() => { clMesEsc = '2026-10'; ir('checklist'); });
  assert.match(await pg.innerText('#clTabela'), /Valor varia/);
  const i = await avaliar(pg, `clLinhas.findIndex(x => x.key === 'rec:luz')`);
  await pg.fill(`#clValor${i}`, '210');
  await pg.dispatchEvent(`#clValor${i}`, 'change');
  // Média de 210, 180 e 120 = 170, de novembro em diante; outubro e antes continuam 150.
  assert.deepEqual(await avaliar(pg, `['2026-10', '2026-11', '2027-03'].map(m => mesBase(m).ef)`), [150, 170, 170]);
  assert.deepEqual(await avaliar(pg, `S.recorrentes.map(r => [r.valor, r.inicio, r.fim, r.serie || null])`), [[150, '2026-01-01', '2026-10-31', null], [170, '2026-11-01', '', 'luz']]);
  // Vencimento da conta fixa: aviso 3 dias antes, calendário e avisos do celular; some quando paga.
  const v = await avaliar(pg, `vencimentosFixas('2026-11-08')`);
  assert.deepEqual(v.map(x => [x.rotulo, x.data, x.valor, x.faltam, x.pago]), [['Luz', '2026-11-10', 170, 2, false]]);
  assert.match(await avaliar(pg, `avisoVencimento('2026-11-08')`), /Luz vence em 2 dias: R\$\s?170,00/);
  assert.ok((await avaliar(pg, `agendaAvisos('2026-11-08').map(a => a.id)`)).some(id => id.startsWith('fixa:')));
  const novoId = await avaliar(pg, `S.recorrentes[1].id`);
  await pg.evaluate(id => { S.checklist['2026-11'] = { itens: { ['rec:' + id]: { pago: true, valor: 170 } } }; commit(); }, novoId);
  assert.equal(await avaliar(pg, `avisoVencimento('2026-11-08')`), '');
  await pg.evaluate(() => { clMesEsc = null; ir('calendario'); });
  assert.deepEqual(pg.erros, []);
});

test('valores a receber: anota, recebe com entrada na Conta e exclui com desfazer', async () => {
  await definirDados(pg, {});
  await ir('receber');
  const f = 'form[onsubmit="addReceber(event)"]';
  await pg.fill(`${f} [name=pessoa]`, 'Ana');
  await pg.fill(`${f} [name=descricao]`, 'metade do jantar');
  await pg.fill(`${f} [name=valor]`, '80');
  await pg.click(`${f} button`);
  assert.match(await pg.innerText('#conteudo'), /TOTAL A RECEBER\s+R\$\s?80,00/i);
  await pg.click('#receberTabela button:text-is("Recebi")');
  await pg.fill('form[onsubmit^="receberBaixa"] [name=valor]', '30');
  await pg.click('form[onsubmit^="receberBaixa"] button:text-is("Confirmar")');
  assert.equal(await avaliar(pg, `faltaReceber(S.receber[0])`), 50);
  assert.deepEqual(await avaliar(pg, `S.movConta.map(m => [m.tipo, m.valor, m.descricao])`), [['Entrada', 30, 'Recebido de Ana: metade do jantar']]);
  // Excluir tira também a entrada da Conta; desfazer volta tudo.
  await pg.click('#receberTabela button:text-is("Excluir")');
  assert.deepEqual(await avaliar(pg, `[S.receber.length, S.movConta.length]`), [0, 0]);
  await pg.click('#toastDesfazer');
  assert.deepEqual(await avaliar(pg, `[S.receber.length, S.movConta.length]`), [1, 1]);
  assert.deepEqual(pg.erros, []);
});

test('quitar parcelas: as restantes entram de uma vez na fatura escolhida, com desconto', async () => {
  const m = await m0();
  const ini = await avaliar(pg, `addM(mkOf(hoje()), -2)`);
  await definirDados(pg, { config: { cartoes: ['Nubank'], primeiroMes: ini },
    parcelados: [{ id: 'tv', dataCompra: ini + '-05', cartao: 'Nubank', descricao: 'TV', categoria: 'Outros', valorTotal: 1000, parcelas: 10, inicio: ini }] });
  await ir('parcelas');
  await pg.click('button:text-is("Quitar")');
  assert.match(await pg.innerText('#quitar'), /vem a parcela 3; depois dela faltam 7/);
  await pg.fill('#quitar [name=desconto]', '50');
  await pg.click('#quitar button:text-is("Quitar")');
  // Parcela 3 (100) + quitação de 7 × 100 − 50 = 750 neste mês; nada depois.
  assert.deepEqual(await avaliar(pg, `[fatCartao('Nubank', mkOf(hoje())), fatCartao('Nubank', addM(mkOf(hoje()), 1))]`), [750, 0]);
  assert.deepEqual(await avaliar(pg, `S.parcelados.map(p => [p.parcelas, p.valorTotal, p.inicio])`), [[3, 300, ini], [1, 650, m]]);
  await pg.click('#toastDesfazer');
  assert.equal(await avaliar(pg, `fatCartao('Nubank', addM(mkOf(hoje()), 1))`), 100);
  assert.deepEqual(pg.erros, []);
});

test('buscar em tudo, onde mais gasta, esconder valores e planilha com os dados novos', async () => {
  const m = await m0();
  await definirDados(pg, { config: { cartoes: ['Nubank'] },
    lancamentos: [
      { id: 'u1', data: m + '-01', descricao: 'Uber Trip', categoria: 'Transporte', forma: 'Cartão', cartao: 'Nubank', valor: 20 },
      { id: 'u2', data: m + '-02', descricao: 'UBER *TRIP', categoria: 'Transporte', forma: 'Cartão', cartao: 'Nubank', valor: 30 },
      { id: 'u3', data: m + '-03', descricao: 'Uber Trip', categoria: 'Transporte', forma: 'Cartão', cartao: 'Nubank', valor: 10 },
      { id: 'i', data: m + '-03', descricao: 'iFood', categoria: 'Alimentação', forma: 'Cartão', cartao: 'Nubank', valor: 50 },
      { id: 'd', data: m + '-04', descricao: 'Drogasil', categoria: 'Saúde', forma: 'Pix', cartao: '', valor: 40, obs: 'farmácia do bairro' }],
    recorrentes: [{ id: 'r', descricao: 'Farmácia do mês', grupo: 'Fixo', cartao: '', categoria: 'Saúde', valor: 90, inicio: '2026-01-01', fim: '', dia: 12, variavel: true }],
    receber: [{ id: 'x', data: m + '-02', pessoa: 'Ana', descricao: 'farmácia', valor: 15, recebidos: [] }] });
  await ir('busca');
  await pg.fill('#buscaTudo', 'farmac');
  assert.deepEqual(await avaliar(pg, `resultadosBusca('farmac').map(r => r.onde).sort()`), ['A receber', 'Lançamento', 'Recorrente']);
  assert.match(await pg.innerText('#conteudo'), /3 resultado\(s\) · lançamentos e parcelamentos somam R\$\s?40,00/);
  await pg.click('#buscaTabela tr:has-text("Drogasil") button');
  assert.equal(await avaliar(pg, 'aba'), 'lancamentos');
  assert.ok(await pg.$('form[onsubmit="salvarLanc(event)"]'));
  await pg.evaluate(() => cancelarLanc());
  // Onde gasta: as três do Uber juntas, mesmo com nomes diferentes.
  const r = await avaliar(pg, `rankingGastos('mes')`);
  assert.deepEqual(r.itens.map(x => [x.nome, x.n, x.total]), [['Uber Trip', 3, 60], ['iFood', 1, 50], ['Drogasil', 1, 40]]);
  await ir('ranking');
  assert.match(await pg.innerText('#rankTabela'), /Uber Trip\s+3\s+R\$\s?60,00/);
  // Esconder valores.
  await pg.click('#olhoBtn');
  const txt = await pg.innerText('#conteudo');
  assert.ok(txt.includes('R$ •••') && !/60,00/.test(txt));
  assert.equal(await pg.innerText('#olhoBtn'), '👁 Mostrar valores');
  await pg.click('#olhoBtn');
  assert.match(await pg.innerText('#conteudo'), /60,00/);
  // Planilha: observação, dia e conta variável, valores a receber.
  const lido = await pg.evaluate(async () => {
    const x = interpretarNova(await XL.ler(await XL.gerar(montarPlanilha()).arrayBuffer()));
    return [x.lancamentos.find(l => l.descricao === 'Drogasil').obs, [x.recorrentes[0].dia, x.recorrentes[0].variavel], x.receber.map(y => [y.pessoa, y.valor])];
  });
  assert.deepEqual(lido, ['farmácia do bairro', [12, true], [['Ana', 15]]]);
  assert.deepEqual(pg.erros, []);
});

test('PIN: pede ao abrir, recusa o errado, abre com o certo e "Esqueci" sem sincronização remove', async () => {
  await definirDados(pg, {});
  await ir('config');
  await pg.fill('#blocoPin [name=novo]', '1234');
  await pg.fill('#blocoPin [name=conf]', '1234');
  await pg.click('#blocoPin button:text-is("Criar PIN")');
  assert.match(await pg.innerText('#pinEstado'), /PIN criado/);
  // Na mesma sessão não pede; ao abrir de novo, pede.
  await pg.reload();
  assert.equal(await pg.isVisible('#pin'), false);
  await pg.evaluate(() => sessionStorage.removeItem('cf-livre'));
  await pg.reload();
  assert.equal(await pg.isVisible('#pin'), true);
  await pg.fill('#pinEntrada', '0000');
  await pg.click('#pin button:text-is("Abrir")');
  await pg.waitForFunction(() => document.getElementById('pinErro').textContent !== '');
  assert.equal(await pg.innerText('#pinErro'), 'PIN incorreto.');
  await pg.fill('#pinEntrada', '1234');
  await pg.click('#pin button:text-is("Abrir")');
  await pg.waitForFunction(() => document.getElementById('pin').hidden);
  // Esqueci: sem sincronização, digitar REMOVER tira o PIN.
  await pg.evaluate(() => { sessionStorage.removeItem('cf-livre'); bloquear(); window.prompt = () => 'REMOVER'; });
  await pg.click('#pin button:text-is("Esqueci o PIN")');
  assert.equal(await avaliar(pg, `localStorage.getItem('cf-pin')`), null);
  assert.equal(await pg.isVisible('#pin'), false);
  assert.deepEqual(pg.erros, []);
});
