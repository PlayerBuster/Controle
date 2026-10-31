// Telas: todas as abas abrem sem erro, e os formulários de compra no cartão gravam a escolha da fatura.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { abrirApp, fecharNavegador, definirDados, avaliar } = require('./lib');

const ABAS = ['resumo', 'mesatual', 'projecao', 'simulador', 'orcamento', 'lancamentos', 'recorrentes', 'parcelas',
  'faturas', 'eventuais', 'patrimonio', 'config'];

let pg;
before(async () => { pg = await abrirApp(); });
after(async () => { await fecharNavegador(); });

const ir = async k => { await pg.evaluate(k => ir(k), k); };
const visivel = sel => pg.evaluate(s => { const el = document.querySelector(s); return !!el && !el.hidden; }, sel);

test('todas as abas abrem sem erro, com os dados de exemplo', async () => {
  await pg.evaluate(() => exemplo());
  for (const k of ABAS) {
    await ir(k);
    const txt = await pg.evaluate(() => document.getElementById('conteudo').innerText.trim().length);
    assert.ok(txt > 20, `aba ${k} vazia`);
  }
  assert.deepEqual(pg.erros, []);
});

test('todas as abas abrem sem erro no celular, sem rolagem lateral da página', async () => {
  const cel = await abrirApp({ largura: 375, altura: 812 });
  await cel.evaluate(() => exemplo());
  for (const k of ABAS) {
    await cel.evaluate(k => ir(k), k);
    // Nos testes o app abre por file:///C:/Users/..., endereço bem mais longo que o do site;
    // a aba Configurações o exibe, então ele é trocado pelo endereço real antes de medir.
    await cel.evaluate(() => document.querySelectorAll('code').forEach(c => {
      if (c.textContent.startsWith('file:')) c.textContent = 'https://playerbuster.github.io/Controle/';
    }));
    const largura = await cel.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(largura <= 380, `aba ${k} mais larga que a tela (${largura}px)`);
  }
  assert.deepEqual(cel.erros, []);
  await cel.fechar();
});

test('Lançamentos: campo Fatura aparece só com cartão ou compra parcelada', async () => {
  await definirDados(pg, { config: { cartoes: ['Nubank'] } });
  await ir('lancamentos');
  const f = '#formLanc';
  await pg.selectOption(`${f} [name=forma]`, 'Pix');
  assert.equal(await visivel('#lbl-fatura'), false);
  await pg.selectOption(`${f} [name=forma]`, 'Cartão');
  assert.equal(await visivel('#lbl-fatura'), true);
  await pg.selectOption(`${f} [name=forma]`, 'Pix');
  await pg.check(`${f} [name=parcelada]`);
  assert.equal(await visivel('#lbl-fatura'), true);
});

test('Lançamentos: gasto no cartão com "Próxima fatura" vai para a fatura seguinte', async () => {
  await definirDados(pg, { config: { cartoes: ['Nubank'] } });
  await ir('lancamentos');
  const f = '#formLanc';
  await pg.fill(`${f} [name=data]`, '2026-10-31');
  await pg.fill(`${f} [name=descricao]`, 'Lanche');
  await pg.selectOption(`${f} [name=forma]`, 'Cartão');
  await pg.selectOption(`${f} [name=cartao]`, 'Nubank');
  await pg.selectOption(`${f} [name=fatura]`, 'prox');
  await pg.fill(`${f} [name=valor]`, '42');
  await pg.click(`${f} button:not([type=button])`);
  const r = await avaliar(pg, `[S.lancamentos.map(l => [l.descricao, l.prox]), linhasFatura('2026-10')[0].itens.length, linhasFatura('2026-11')[0].itens.map(i => i.descricao)]`);
  assert.deepEqual(r, [[['Lanche', true]], 0, ['Lanche']]);
  assert.match(await pg.innerText('#conteudo'), /próxima fatura/);
});

test('Lançamentos: gasto no Pix nunca grava "Próxima fatura"', async () => {
  await definirDados(pg, { config: { cartoes: ['Nubank'] } });
  await ir('lancamentos');
  const f = '#formLanc';
  await pg.selectOption(`${f} [name=forma]`, 'Cartão');
  await pg.selectOption(`${f} [name=fatura]`, 'prox');
  await pg.selectOption(`${f} [name=forma]`, 'Pix');
  await pg.fill(`${f} [name=descricao]`, 'Feira');
  await pg.fill(`${f} [name=valor]`, '30');
  await pg.click(`${f} button:not([type=button])`);
  assert.deepEqual(await avaliar(pg, `S.lancamentos.map(l => [l.forma, 'prox' in l])`), [['Pix', false]]);
});

test('Lançamentos: compra parcelada sugere a 1ª parcela pela data e pela fatura', async () => {
  await definirDados(pg, { config: { cartoes: ['Nubank'] } });
  await ir('lancamentos');
  const f = '#formLanc';
  await pg.check(`${f} [name=parcelada]`);
  await pg.fill(`${f} [name=data]`, '2026-12-20');
  await pg.dispatchEvent(`${f} [name=data]`, 'change');
  assert.equal(await pg.inputValue(`${f} [name=primeira]`), '2026-12');
  await pg.selectOption(`${f} [name=fatura]`, 'prox');
  assert.equal(await pg.inputValue(`${f} [name=primeira]`), '2027-01');
  await pg.fill(`${f} [name=descricao]`, 'Tênis');
  await pg.selectOption(`${f} [name=cartao]`, 'Nubank');
  await pg.fill(`${f} [name=nParcelas]`, '3');
  await pg.fill(`${f} [name=valorParcela]`, '100');
  await pg.click(`${f} button:not([type=button])`);
  assert.deepEqual(await avaliar(pg, `S.parcelados.map(p => [p.descricao, p.inicio, p.parcelas, p.valorTotal])`), [['Tênis', '2027-01', 3, 300]]);
});

test('Lançamentos: editar troca a fatura e, ao mudar para Pix, remove a marcação', async () => {
  await definirDados(pg, { config: { cartoes: ['Nubank'] }, lancamentos: [
    { id: 'a', data: '2026-10-31', descricao: 'Lanche', categoria: 'Lazer', forma: 'Cartão', cartao: 'Nubank', valor: 42 }] });
  await ir('lancamentos');
  const ed = 'form[onsubmit="salvarLanc(event)"]';
  await pg.evaluate(() => editarLanc('lanc', 'a'));
  await pg.selectOption(`${ed} [name=fatura]`, 'prox');
  await pg.click(`${ed} button:not([type=button])`);
  assert.equal(await avaliar(pg, `S.lancamentos[0].prox`), true);
  await pg.evaluate(() => editarLanc('lanc', 'a'));
  assert.equal(await pg.inputValue(`${ed} [name=fatura]`), 'prox');
  await pg.selectOption(`${ed} [name=forma]`, 'Pix');
  await pg.click(`${ed} button:not([type=button])`);
  assert.equal(await avaliar(pg, `'prox' in S.lancamentos[0]`), false);
});

test('Lançamentos: "Fixar estas opções" guarda a fatura e sobrevive a recarregar a página', async () => {
  await definirDados(pg, { config: { cartoes: ['Nubank'] } });
  await ir('lancamentos');
  const f = '#formLanc';
  await pg.selectOption(`${f} [name=forma]`, 'Cartão');
  await pg.selectOption(`${f} [name=cartao]`, 'Nubank');
  await pg.selectOption(`${f} [name=fatura]`, 'prox');
  await pg.click(`${f} button:has-text("Fixar estas opções")`);
  await pg.reload();
  await ir('lancamentos');
  assert.equal(await pg.inputValue(`${f} [name=fatura]`), 'prox');
  assert.equal(await pg.inputValue(`${f} [name=cartao]`), 'Nubank');
  assert.match(await pg.innerText('#conteudo'), /Opções fixas: Cartão · Nubank · próxima fatura/);
  // Soltar apaga as opções fixas guardadas (o rascunho do formulário continua como está).
  await pg.click(`${f} button:has-text("Soltar opções fixas")`);
  assert.deepEqual(await avaliar(pg, `[lancFixo, localStorage.getItem('cf-lanc-fixo')]`), [null, null]);
  assert.doesNotMatch(await pg.innerText('#conteudo'), /Opções fixas:/);
});

test('Recorrentes: "Próxima fatura" só vale para o grupo Cartão', async () => {
  await definirDados(pg, { config: { cartoes: ['Nubank'] } });
  await ir('recorrentes');
  const add = async (descricao, grupo) => {
    const f = 'form[onsubmit="addRec(event)"]';
    await pg.fill(`${f} [name=descricao]`, descricao);
    await pg.selectOption(`${f} [name=grupo]`, grupo);
    if (grupo === 'Cartão') await pg.selectOption(`${f} [name=cartao]`, 'Nubank');
    await pg.selectOption(`${f} [name=fatura]`, 'prox');
    await pg.fill(`${f} [name=valor]`, '10');
    await pg.fill(`${f} [name=inicio]`, '2026-10-17');
    await pg.click(`${f} button:not([type=button])`);
  };
  await add('Netflix', 'Cartão');
  await add('Internet', 'Fixo');
  assert.deepEqual(await avaliar(pg, `S.recorrentes.map(r => [r.descricao, r.prox])`), [['Netflix', true], ['Internet', false]]);
  assert.deepEqual(await avaliar(pg, `[fatCartao('Nubank', '2026-10'), fatCartao('Nubank', '2026-11')]`), [0, 10]);
});

test('Recorrentes: editar e "Alterar a partir de" mantêm a escolha da fatura', async () => {
  await definirDados(pg, { config: { cartoes: ['Nubank'] }, recorrentes: [
    { id: 'r', descricao: 'Netflix', grupo: 'Cartão', cartao: 'Nubank', categoria: 'Assinaturas', valor: 40, inicio: '2026-01-10', fim: '' }] });
  await ir('recorrentes');
  const ed = 'form[onsubmit="salvarRec(event)"]';
  await pg.evaluate(() => editarRec('r'));
  await pg.selectOption(`${ed} [name=fatura]`, 'prox');
  await pg.fill(`${ed} [name=valor]`, '55');
  await pg.fill(`${ed} [name=aPartir]`, '2026-11-10');
  await pg.click(`${ed} button:not([type=button])`);
  const r = await avaliar(pg, `S.recorrentes.map(r => [r.valor, r.inicio, r.fim, !!r.prox])`);
  assert.deepEqual(r, [[40, '2026-01-10', '2026-11-09', false], [55, '2026-11-10', '', true]]);
  // Novembro: o item antigo (até 09/11) ainda cobra 40; o novo só entra na fatura de dezembro.
  assert.deepEqual(await avaliar(pg, `[fatCartao('Nubank', '2026-11'), fatCartao('Nubank', '2026-12')]`), [40, 55]);
});

test('Recorrentes: "Fixar estas opções" preenche grupo, cartão, fatura e categoria', async () => {
  await definirDados(pg, { config: { cartoes: ['Nubank', 'Itaú'] } });
  await ir('recorrentes');
  const f = 'form[onsubmit="addRec(event)"]';
  await pg.selectOption(`${f} [name=grupo]`, 'Cartão');
  await pg.selectOption(`${f} [name=cartao]`, 'Itaú');
  await pg.selectOption(`${f} [name=fatura]`, 'prox');
  await pg.selectOption(`${f} [name=categoria]`, 'Assinaturas');
  await pg.click(`${f} button:has-text("Fixar estas opções")`);
  await pg.fill(`${f} [name=descricao]`, 'Spotify');
  await pg.fill(`${f} [name=valor]`, '21.9');
  await pg.click(`${f} button:not([type=button])`);
  assert.deepEqual(await avaliar(pg, `S.recorrentes.map(r => [r.descricao, r.grupo, r.cartao, r.prox, r.categoria])`),
    [['Spotify', 'Cartão', 'Itaú', true, 'Assinaturas']]);
  assert.equal(await pg.inputValue(`${f} [name=fatura]`), 'prox');
  await pg.click(`${f} button:has-text("Soltar opções fixas")`);
});

test('Parcelamentos: o mês desta parcela segue a data da compra, a fatura e o nº da parcela', async () => {
  await definirDados(pg, { config: { cartoes: ['Nubank'] } });
  await ir('parcelas');
  const f = 'form[onsubmit="addParc(event)"]';
  await pg.fill(`${f} [name=dataCompra]`, '2026-08-15');
  await pg.dispatchEvent(`${f} [name=dataCompra]`, 'change');
  assert.equal(await pg.inputValue(`${f} [name=inicio]`), '2026-08');
  await pg.fill(`${f} [name=atual]`, '3');
  await pg.dispatchEvent(`${f} [name=atual]`, 'change');
  assert.equal(await pg.inputValue(`${f} [name=inicio]`), '2026-10');
  await pg.selectOption(`${f} [name=fatura]`, 'prox');
  assert.equal(await pg.inputValue(`${f} [name=inicio]`), '2026-11');
  await pg.fill(`${f} [name=descricao]`, 'Notebook');
  await pg.fill(`${f} [name=valorTotal]`, '1200');
  await pg.fill(`${f} [name=parcelas]`, '12');
  await pg.click(`${f} button:not([type=button])`);
  // Parcela 3 em nov/2026, então a 1ª foi em set/2026.
  assert.deepEqual(await avaliar(pg, `S.parcelados.map(p => [p.inicio, p.parcelas])`), [['2026-09', 12]]);
});

test('Faturas: lista inclui meses antes da projeção com compras (até 12 meses) e abre no mês atual', async () => {
  await definirDados(pg, {
    config: { cartoes: ['Nubank'], primeiroMes: '2026-11' },
    lancamentos: [
      { id: 'a', data: '2026-10-20', descricao: 'Lanche', categoria: 'Lazer', forma: 'Cartão', cartao: 'Nubank', valor: 42 },
      { id: 'b', data: '2024-01-10', descricao: 'Antigo', categoria: 'Lazer', forma: 'Cartão', cartao: 'Nubank', valor: 5 }]
  });
  await pg.evaluate(() => { faturaMes = null; });
  await ir('faturas');
  const meses = await pg.$$eval('select[name=mes] option', os => os.map(o => o.value));
  assert.equal(meses[0], '2026-10');
  assert.equal(meses[meses.length - 1], '2029-10');
  const atual = await avaliar(pg, `mkOf(hoje())`);
  const esperado = meses.includes(atual) ? atual : '2026-11';
  assert.equal(await pg.inputValue('select[name=mes]'), esperado);
});

test('Faturas: modo "Gastos individuais por banco" mostra os itens do mês escolhido', async () => {
  await definirDados(pg, { config: { cartoes: ['Nubank'], primeiroMes: '2026-11' }, lancamentos: [
    { id: 'a', data: '2026-11-30', descricao: 'Jantar', categoria: 'Lazer', forma: 'Cartão', cartao: 'Nubank', valor: 120, prox: true }] });
  await ir('faturas');
  await pg.selectOption('select[name=mes]', '2026-12');
  await pg.click('button:has-text("Ver fatura")');
  await pg.click('button:has-text("Gastos individuais por banco")');
  const txt = await pg.innerText('#conteudo');
  assert.match(txt, /Jantar/);
  assert.match(txt, /Total das faturas em dez\/2026: R\$\s*120,00/);
  assert.deepEqual(pg.erros, []);
});
