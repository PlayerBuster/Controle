// Telas: todas as abas abrem sem erro, e os formulários de compra no cartão gravam a escolha da fatura.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { abrirApp, fecharNavegador, definirDados, avaliar } = require('./lib');

const ABAS = ['resumo', 'mesatual', 'projecao', 'simulador', 'orcamento', 'lancamentos', 'conta', 'recorrentes', 'parcelas',
  'faturas', 'eventuais', 'patrimonio', 'config'];

let pg;
before(async () => { pg = await abrirApp(); });
after(async () => { await fecharNavegador(); });

const ir = async k => { await pg.evaluate(k => ir(k), k); };
const addMesStr = (m, n) => { const k = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n; return `${Math.floor(k / 12)}-${String(k % 12 + 1).padStart(2, '0')}`; };
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

test('Parcelamentos: ajuste manual reduz a fatura, aparece na lista e pode ser excluído', async () => {
  await definirDados(pg, { config: { cartoes: ['Nubank', 'Mercado Pago'] }, parcelados: [
    { id: 'p', dataCompra: '2026-10-01', cartao: 'Mercado Pago', descricao: 'Celular', categoria: 'Outros', valorTotal: 1200, parcelas: 12, inicio: '2026-10' }] });
  await ir('parcelas');
  const f = 'form[onsubmit="addCredito(event)"]';
  await pg.selectOption(`${f} [name=cartao]`, 'Mercado Pago');
  await pg.fill(`${f} [name=mes]`, '2026-10');
  await pg.fill(`${f} [name=valor]`, '222.72');
  await pg.fill(`${f} [name=descricao]`, 'Pagamento antecipado');
  await pg.click(`${f} button`);
  assert.deepEqual(await avaliar(pg, `S.creditos.map(x => [x.cartao, x.mes, x.valor, x.descricao])`),
    [['Mercado Pago', '2026-10', 222.72, 'Pagamento antecipado']]);
  assert.equal(Math.round(await avaliar(pg, `fatCartao('Mercado Pago', '2026-10')`) * 100) / 100, -122.72);
  assert.deepEqual(await avaliar(pg, `S.parcelados.map(p => [p.parcelas, valorParcela(p)])`), [[12, 100]]);
  assert.match(await pg.innerText('#conteudo'), /Pagamento antecipado/);
  await pg.click('button[onclick^="excluir(\'creditos\'"]');
  assert.deepEqual(await avaliar(pg, `S.creditos`), []);
  assert.deepEqual(pg.erros, []);
});

test('Editar: o formulário mostra os dados do item escolhido, não de uma edição anterior', async () => {
  await definirDados(pg, { config: { cartoes: ['Nubank'] },
    lancamentos: [
      { id: 'a', data: '2026-10-31', descricao: 'Lanche', categoria: 'Lazer', forma: 'Cartão', cartao: 'Nubank', valor: 42 },
      { id: 'b', data: '2026-10-20', descricao: 'Mercado', categoria: 'Alimentação', forma: 'Pix', cartao: '', valor: 100 }],
    recorrentes: [
      { id: 'r1', descricao: 'Netflix', grupo: 'Cartão', cartao: 'Nubank', categoria: 'Assinaturas', valor: 40, inicio: '2026-01-10', fim: '' },
      { id: 'r2', descricao: 'Aluguel', grupo: 'Fixo', cartao: '', categoria: 'Moradia', valor: 2000, inicio: '2026-01-05', fim: '' }],
    parcelados: [{ id: 'p', dataCompra: '2026-10-26', cartao: 'Nubank', descricao: 'Celular', categoria: 'Outros', valorTotal: 1200, parcelas: 12, inicio: '2026-10' }] });
  // Rascunho de uma versão anterior do app, que antes sobrescrevia qualquer edição.
  await pg.evaluate(() => localStorage.setItem('cf-rascunhos', JSON.stringify({ 'salvarLanc(event)': { descricao: 'Sobra antiga', valor: '1' } })));
  await ir('lancamentos');
  const ed = 'form[onsubmit="salvarLanc(event)"]';
  // Começa a editar "Lanche", digita e cancela.
  await pg.evaluate(() => editarLanc('lanc', 'a'));
  assert.equal(await pg.inputValue(`${ed} [name=descricao]`), 'Lanche');
  await pg.fill(`${ed} [name=descricao]`, 'Digitado e cancelado');
  await pg.fill(`${ed} [name=valor]`, '999');
  await pg.click(`${ed} button:has-text("Cancelar")`);
  // Abre "Mercado": precisa mostrar os dados dele.
  await pg.evaluate(() => editarLanc('lanc', 'b'));
  assert.deepEqual([await pg.inputValue(`${ed} [name=descricao]`), await pg.inputValue(`${ed} [name=valor]`),
    await pg.inputValue(`${ed} [name=forma]`), await pg.inputValue(`${ed} [name=data]`)], ['Mercado', '100', 'Pix', '2026-10-20']);
  // Salva "Mercado" alterado; depois abre a compra parcelada (mesmo formulário de edição).
  await pg.fill(`${ed} [name=descricao]`, 'Mercado do mês');
  await pg.click(`${ed} button:not([type=button])`);
  await pg.evaluate(() => editarLanc('parc', 'p'));
  assert.deepEqual([await pg.inputValue(`${ed} [name=descricao]`), await pg.inputValue(`${ed} [name=valorTotal]`)], ['Celular', '1200']);
  await pg.click(`${ed} button:has-text("Cancelar")`);
  // Recorrentes: mesma situação.
  await ir('recorrentes');
  const er = 'form[onsubmit="salvarRec(event)"]';
  await pg.evaluate(() => editarRec('r1'));
  await pg.fill(`${er} [name=descricao]`, 'Digitado');
  await pg.click(`${er} button:has-text("Cancelar")`);
  await pg.evaluate(() => editarRec('r2'));
  assert.deepEqual([await pg.inputValue(`${er} [name=descricao]`), await pg.inputValue(`${er} [name=valor]`)], ['Aluguel', '2000']);
  assert.deepEqual(await avaliar(pg, `S.lancamentos.map(l => l.descricao)`), ['Lanche', 'Mercado do mês']);
  assert.equal(await avaliar(pg, `'salvarLanc(event)' in JSON.parse(localStorage.getItem('cf-rascunhos') || '{}')`), false);
});

test('Parcelamentos: botão Editar abre a compra certa no formulário de edição', async () => {
  await definirDados(pg, { config: { cartoes: ['Nubank'] }, parcelados: [
    { id: 'p1', dataCompra: '2026-10-26', cartao: 'Nubank', descricao: 'Celular', categoria: 'Outros', valorTotal: 1200, parcelas: 12, inicio: '2026-10' },
    { id: 'p2', dataCompra: '2026-10-17', cartao: 'Nubank', descricao: 'Ração', categoria: 'Outros', valorTotal: 204.04, parcelas: 2, inicio: '2026-10' }] });
  await ir('parcelas');
  await pg.click(`button[onclick*="editarLanc('parc','p2')"]`);
  const ed = 'form[onsubmit="salvarLanc(event)"]';
  assert.deepEqual([await pg.inputValue(`${ed} [name=descricao]`), await pg.inputValue(`${ed} [name=parcelas]`), await pg.inputValue(`${ed} [name=valorTotal]`)],
    ['Ração', '2', '204.04']);
});

test('Calculadora: o resultado vai para o campo de valor tocado por último', async () => {
  await definirDados(pg, { config: { cartoes: ['Nubank'] } });
  await ir('lancamentos');
  await pg.focus('#formLanc [name=valor]');
  await pg.click('#calcBtn');
  for (const t of ['4', '2', '+', '1', '5', ',', '5']) await pg.click(`#calc .teclas button:text-is("${t}")`);
  assert.equal(await pg.innerText('#calcRes'), '= 57,5');
  assert.match(await pg.innerText('#calcUsar'), /Usar em "Valor \(R\$\)"/);
  await pg.click('#calcUsar');
  assert.equal(await pg.inputValue('#formLanc [name=valor]'), '57.50');
  assert.equal(await visivel('#calc'), false);
  // Também aceita a conta digitada, e "=" deixa o resultado no visor para continuar.
  await pg.check('#formLanc [name=parcelada]');
  await pg.focus('#formLanc [name=valorParcela]');
  await pg.click('#calcBtn');
  await pg.click('#calc .teclas button:text-is("C")');
  await pg.fill('#calcVisor', '1017,90/12');
  await pg.press('#calcVisor', 'Enter');
  assert.equal(await pg.inputValue('#calcVisor'), '84,83');
  await pg.click('#calcUsar');
  assert.equal(await pg.inputValue('#formLanc [name=valorParcela]'), '84.83');
});

test('Calculadora: sem campo tocado, usa o primeiro campo de valor da aba; sem campo, não deixa usar', async () => {
  await definirDados(pg, { config: { cartoes: ['Nubank'] } });
  await pg.evaluate(() => { calcAlvo = null; calcFechar(); });
  await ir('parcelas');
  await pg.click('#calcBtn');
  await pg.fill('#calcVisor', '100*3');
  await pg.dispatchEvent('#calcVisor', 'input');
  assert.match(await pg.innerText('#calcUsar'), /Valor total/);
  await pg.click('#calcUsar');
  assert.equal(await pg.inputValue('form[onsubmit="addParc(event)"] [name=valorTotal]'), '300.00');
  await ir('resumo');
  await pg.click('#calcBtn');
  assert.equal(await pg.isDisabled('#calcUsar'), true);
  await pg.click('#calc button:has-text("Fechar")');
});

test('Configurações: renomear cartão atualiza compras, recorrentes, lançamentos, ajustes e opções fixas', async () => {
  await definirDados(pg, { config: { cartoes: ['Nubank', 'MP'] },
    parcelados: [{ id: 'p', dataCompra: '2026-10-01', cartao: 'MP', descricao: 'Celular', categoria: 'Outros', valorTotal: 1200, parcelas: 12, inicio: '2026-10' }],
    recorrentes: [{ id: 'r', descricao: 'Spotify', grupo: 'Cartão', cartao: 'MP', categoria: 'Assinaturas', valor: 20, inicio: '2026-01-01', fim: '' }],
    lancamentos: [{ id: 'l', data: '2026-10-05', descricao: 'Lanche', categoria: 'Lazer', forma: 'Cartão', cartao: 'MP', valor: 30 }],
    creditos: [{ id: 'c', cartao: 'MP', mes: '2026-10', valor: 10, descricao: '' }] });
  await pg.evaluate(() => { lancFixo = { forma: 'Cartão', cartao: 'MP', categoria: 'Lazer', fatura: '' }; localStorage.setItem('cf-lanc-fixo', JSON.stringify(lancFixo)); });
  const antes = await avaliar(pg, `linhasFatura('2026-10').find(b => b.cartao === 'MP').total`);
  await ir('config');
  const f = 'form[onsubmit="renomearLista(event,\'cartoes\')"]';
  await pg.selectOption(`${f} [name=antigo]`, 'MP');
  await pg.fill(`${f} [name=novo]`, 'Mercado Pago');
  await pg.click(`${f} button`);
  const r = await avaliar(pg, `[S.config.cartoes, S.parcelados[0].cartao, S.recorrentes[0].cartao, S.lancamentos[0].cartao, S.creditos[0].cartao,
    JSON.parse(localStorage.getItem('cf-lanc-fixo')).cartao, linhasFatura('2026-10').find(b => b.cartao === 'Mercado Pago').total]`);
  assert.deepEqual(r, [['Nubank', 'Mercado Pago'], 'Mercado Pago', 'Mercado Pago', 'Mercado Pago', 'Mercado Pago', 'Mercado Pago', antes]);
  // Nome repetido (sem diferenciar maiúsculas) é recusado.
  await pg.selectOption(`${f} [name=antigo]`, 'Mercado Pago');
  await pg.fill(`${f} [name=novo]`, 'nubank');
  await pg.click(`${f} button`);
  assert.deepEqual(await avaliar(pg, `S.config.cartoes`), ['Nubank', 'Mercado Pago']);
  assert.match(pg.alertas[pg.alertas.length - 1], /Já existe/);
  await pg.evaluate(() => { lancFixo = null; localStorage.removeItem('cf-lanc-fixo'); });
});

test('Configurações: renomear categoria atualiza itens e orçamentos (padrão e por mês)', async () => {
  await definirDados(pg, { config: { cartoes: ['Nubank'], categorias: ['Lazer', 'PET', 'Outros'] },
    parcelados: [{ id: 'p', dataCompra: '2026-10-01', cartao: 'Nubank', descricao: 'Ração', categoria: 'PET', valorTotal: 200, parcelas: 2, inicio: '2026-10' }],
    recorrentes: [{ id: 'r', descricao: 'Plano', grupo: 'Fixo', cartao: '', categoria: 'PET', valor: 50, inicio: '2026-01-01', fim: '' }],
    lancamentos: [{ id: 'l', data: '2026-10-05', descricao: 'Remédio', categoria: 'PET', forma: 'Pix', cartao: '', valor: 30 }],
    orcamento: { PET: 300, Lazer: 100 }, orcamentoMeses: { '2026-10': { PET: 400 } } });
  const antes = await avaliar(pg, `[execCat('PET', '2026-10'), totalOrc('2026-10')]`);
  await ir('config');
  const f = 'form[onsubmit="renomearLista(event,\'categorias\')"]';
  await pg.selectOption(`${f} [name=antigo]`, 'PET');
  await pg.fill(`${f} [name=novo]`, 'Pets');
  await pg.click(`${f} button`);
  const r = await avaliar(pg, `[S.config.categorias, S.parcelados[0].categoria, S.recorrentes[0].categoria, S.lancamentos[0].categoria,
    S.orcamento, S.orcamentoMeses['2026-10'], execCat('Pets', '2026-10'), totalOrc('2026-10')]`);
  assert.deepEqual(r, [['Lazer', 'Pets', 'Outros'], 'Pets', 'Pets', 'Pets', { Lazer: 100, Pets: 300 }, { Pets: 400 }, antes[0], antes[1]]);
});

test('Faturas: faixa mostra o mês escolhido e as setas trocam de mês', async () => {
  await definirDados(pg, { config: { cartoes: ['Nubank'], primeiroMes: '2026-11' } });
  await pg.evaluate(() => { faturaMes = null; });
  await ir('faturas');
  const atual = await avaliar(pg, `faturaMes`);
  const txt = await pg.innerText('#mesFatura');
  assert.match(txt, new RegExp(await avaliar(pg, `mNome(faturaMes).replace('/', '\\\\/')`)));
  assert.match(txt, await avaliar(pg, `mIdx(faturaMes) === mIdx(mkOf(hoje()))`) ? /mês atual/ : /meses|próximo|passado/);
  await pg.click('#mesFatura button[aria-label="Próximo mês"]');
  assert.equal(await avaliar(pg, `faturaMes`), await avaliar(pg, `addM('${atual}', 1)`));
  assert.equal(await pg.inputValue('select[name=mes]'), await avaliar(pg, `faturaMes`));
  await pg.click('#mesFatura button[aria-label="Mês anterior"]');
  assert.equal(await avaliar(pg, `faturaMes`), atual);
  // No primeiro mês da lista, a seta de voltar fica desativada.
  await pg.evaluate(() => { faturaMes = mesesFatura()[0]; render(); });
  assert.equal(await pg.isDisabled('#mesFatura button[aria-label="Mês anterior"]'), true);
  assert.deepEqual(await avaliar(pg, `[mesRelativo(mkOf(hoje())), mesRelativo(addM(mkOf(hoje()), 1)), mesRelativo(addM(mkOf(hoje()), -1)), mesRelativo(addM(mkOf(hoje()), 3)), mesRelativo(addM(mkOf(hoje()), -2))]`),
    ['mês atual', 'próximo mês', 'mês passado', 'daqui a 3 meses', 'há 2 meses']);
});

test('Lançamentos: filtros por texto, mês, categoria, cartão/forma e tipo', async () => {
  await definirDados(pg, { config: { cartoes: ['Nubank', 'Mercado Pago'] },
    lancamentos: [
      { id: 'a', data: '2026-10-31', descricao: 'Lanche', categoria: 'Lazer', forma: 'Cartão', cartao: 'Nubank', valor: 42 },
      { id: 'b', data: '2026-10-20', descricao: 'Mercado São João', categoria: 'Alimentação', forma: 'Pix', cartao: '', valor: 100 },
      { id: 'c', data: '2026-09-10', descricao: 'Lanche', categoria: 'Lazer', forma: 'Cartão', cartao: 'Mercado Pago', valor: 20 }],
    parcelados: [{ id: 'p', dataCompra: '2026-10-26', cartao: 'Mercado Pago', descricao: 'Celular', categoria: 'Outros', valorTotal: 1200, parcelas: 12, inicio: '2026-10' }] });
  await pg.evaluate(() => limparFiltroLanc());
  await ir('lancamentos');
  const linhas = () => pg.$$eval('#conteudo table tbody tr td:nth-child(2)', tds => tds.map(t => t.innerText.replace(/\s*\(.*\)$/, '')));
  assert.deepEqual(await linhas(), ['Lanche', 'Celular', 'Mercado São João', 'Lanche']);
  // Busca ignora acentos e maiúsculas.
  await pg.fill('#fBusca', 'sao joao');
  assert.deepEqual(await linhas(), ['Mercado São João']);
  assert.equal(await pg.evaluate(() => document.activeElement.id), 'fBusca', 'o cursor deve continuar na busca');
  await pg.fill('#fBusca', 'lanche');
  assert.deepEqual(await linhas(), ['Lanche', 'Lanche']);
  await pg.selectOption('#fPag', 'Cartão:Mercado Pago');
  assert.deepEqual(await linhas(), ['Lanche']);
  assert.match(await pg.innerText('#conteudo h2:has-text("Lançamentos")'), /R\$\s*20,00.*\(1 de 4\)/);
  await pg.click('button:has-text("Limpar filtros")');
  assert.equal((await linhas()).length, 4);
  await pg.selectOption('#fTipo', 'parc');
  assert.deepEqual(await linhas(), ['Celular']);
  await pg.selectOption('#fTipo', 'avulso');
  await pg.selectOption('#fCat', 'Lazer');
  await pg.fill('#fMes', '2026-10');
  await pg.dispatchEvent('#fMes', 'change');
  assert.deepEqual(await linhas(), ['Lanche']);
  await pg.selectOption('#fPag', 'Pix');
  assert.match(await pg.innerText('#conteudo table tbody'), /Nenhum lançamento/);
  await pg.click('button:has-text("Limpar filtros")');
  assert.deepEqual(pg.erros, []);
});

test('Conta: gasto em Pix sai da conta sozinho; no cartão, não; entradas manuais e extrato', async () => {
  await definirDados(pg, { config: { cartoes: ['Nubank'], saldoConta: 1000 } });
  await ir('lancamentos');
  const f = '#formLanc';
  const lancar = async (descricao, forma, valor) => {
    await pg.fill(`${f} [name=data]`, '2020-01-10');
    await pg.fill(`${f} [name=descricao]`, descricao);
    await pg.selectOption(`${f} [name=forma]`, forma);
    if (forma === 'Cartão') await pg.selectOption(`${f} [name=cartao]`, 'Nubank');
    await pg.fill(`${f} [name=valor]`, valor);
    await pg.click(`${f} button:not([type=button])`);
  };
  await lancar('Feira', 'Pix', '80');
  await lancar('Lanche', 'Cartão', '42');
  await ir('conta');
  assert.equal(await avaliar(pg, `saldoContaEm(hoje())`), 920);
  let txt = await pg.innerText('#conteudo');
  assert.match(txt, /Feira/);
  assert.doesNotMatch(txt, /Lanche/);
  const fm = 'form[onsubmit="addMov(event)"]';
  await pg.fill(`${fm} [name=data]`, '2020-01-05');
  await pg.fill(`${fm} [name=descricao]`, 'Salário');
  await pg.selectOption(`${fm} [name=tipo]`, 'Entrada');
  await pg.fill(`${fm} [name=valor]`, '3000');
  await pg.click(`${fm} button`);
  assert.equal(await avaliar(pg, `saldoContaEm(hoje())`), 3920);
  txt = await pg.innerText('#conteudo');
  assert.match(txt, /Saldo em conta hoje\s*R\$\s*3\.920,00/i);
  // Extrato do mais novo para o mais antigo, com o saldo depois de cada movimentação.
  const linhas = await pg.$$eval('#conteudo table tbody tr', trs => trs.map(t => [t.cells[1].innerText, t.cells[4].innerText.replace(/\s/g, ' ')]));
  assert.deepEqual(linhas, [['Feira', 'R$ 3.920,00'], ['Salário', 'R$ 4.000,00']]);
  // Saldo inicial editável na própria aba.
  await pg.fill('form[onsubmit="salvarSaldoInicial(event)"] [name=saldo]', '500');
  await pg.click('form[onsubmit="salvarSaldoInicial(event)"] button');
  assert.equal(await avaliar(pg, `[S.config.saldoConta, saldoContaEm(hoje())]`).then(JSON.stringify), JSON.stringify([500, 3420]));
  await pg.click(`button[onclick^="excluir('movConta'"]`);
  assert.equal(await avaliar(pg, `saldoContaEm(hoje())`), 420);
  assert.deepEqual(pg.erros, []);
});

/* ---------- Simulador ---------- */
// Receita 2.700, fixo 100, orçamento 800 em Alimentação (sobra 1.800/mês); começa no mês atual.
// As compras simuladas vão em Lazer, que não tem orçamento: só as regras de saldo decidem.
const dadosSim = async extra => {
  const m = await avaliar(pg, `mkOf(hoje())`);
  return { m, dados: { config: { cartoes: ['Nubank'], primeiroMes: m, saldoConta: 0 },
    recorrentes: [
      { id: 'r1', descricao: 'Salário', grupo: 'Receita', cartao: '', categoria: 'Outros', valor: 2700, inicio: '2020-01-01', fim: '' },
      { id: 'r2', descricao: 'Internet', grupo: 'Fixo', cartao: '', categoria: 'Moradia', valor: 100, inicio: '2020-01-01', fim: '' }],
    orcamento: { 'Alimentação': 800 }, ...extra(m) } };
};
const simular = async (m, valor, parcelas, categoria = 'Lazer') => {
  await pg.evaluate(([mm, v, p, c]) => { Object.assign(simEntrada, { valor: v, parcelas: p, mes: mm, categoria: c }); ir('simulador'); }, [m, valor, parcelas, categoria]);
  return pg.evaluate(() => {
    const g = { ...simEntrada };
    const a = foto(g.mes, g.categoria, g.parcelas), d = comGasto(g, () => foto(g.mes, g.categoria, g.parcelas));
    return veredito(a, d, g);
  });
};

test('Simulador: com o saldo já negativo nos próximos meses, nenhuma compra extra é "possível"', async () => {
  // Parcelado de 2.500 por mês nos 3 primeiros meses: o acumulado já fica negativo antes de simular.
  const { m, dados } = await dadosSim(m => ({ parcelados: [
    { id: 'p', dataCompra: m + '-01', cartao: 'Nubank', descricao: 'TV', categoria: 'Outros', valorTotal: 7500, parcelas: 3, inicio: m }] }));
  await definirDados(pg, dados);
  const v = await simular(m, 50, 1);
  assert.equal(v.nivel, 'nao');
  assert.ok(v.motivos.some(t => /já fica no vermelho|já fica negativo/.test(t)), v.motivos.join(' | '));
});

test('Simulador: parcela que cai num mês apertado reprova, mesmo com o 1º mês folgado', async () => {
  // Sobra 1.800/mês, com saldo inicial de 5.000. No 3º mês há uma despesa eventual de 1.700 (sobra só 100).
  const { m, dados } = await dadosSim(m => ({ config: { cartoes: ['Nubank'], primeiroMes: m, saldoConta: 5000 },
    eventuais: [{ id: 'v', mes: addMesStr(m, 2), descricao: 'IPVA', tipo: 'Despesa', valor: 1700 }] }));
  await definirDados(pg, dados);
  // 3x de 300: o 1º mês fica com sobra, mas o 3º vai a −200.
  const v = await simular(m, 900, 3);
  assert.equal(v.nivel, 'nao');
  assert.ok(v.motivos.some(t => /no vermelho/.test(t)), v.motivos.join(' | '));
  // À vista no 1º mês, o mesmo valor cabe.
  const v1 = await simular(m, 900, 1);
  assert.notEqual(v1.nivel, 'nao', v1.motivos.join(' | '));
});

test('Simulador: pouco saldo nos próximos 12 meses dá "com cuidado"', async () => {
  // Sem saldo inicial, sobra 1.800/mês; uma compra de 1.700 no 1º mês deixa o pior saldo bem abaixo de um mês de despesas.
  const { m, dados } = await dadosSim(() => ({}));
  await definirDados(pg, dados);
  const v = await simular(m, 1700, 1);
  assert.equal(v.nivel, 'cuidado', v.motivos.join(' | '));
  assert.ok(v.motivos.some(t => /menos de um mês de despesas/.test(t)));
});

test('Simulador: a compra simulada entra uma vez só na projeção', async () => {
  const { m, dados } = await dadosSim(() => ({}));
  await definirDados(pg, dados);
  const r = await pg.evaluate(mm => {
    const antes = mesBase(mm).I;
    // Em Lazer (sem orçamento) a contagem dupla não é compensada pelo orçamento restante.
    const depois = comGasto({ valor: 500, categoria: 'Lazer', mes: mm, parcelas: 1 }, () => mesBase(mm).I);
    return depois - antes;
  }, m);
  assert.equal(Math.round(r * 100) / 100, 500);
});

test('Simulador: "Lançar esta compra" fica junto do Simular e grava como na aba Lançamentos', async () => {
  const { m, dados } = await dadosSim(() => ({}));
  await definirDados(pg, dados);
  await simular(m, 120, 1, 'Alimentação');
  const f = '#formSimLanc';
  assert.equal(await pg.evaluate(() => !!document.querySelector('form[onsubmit="simRodar(event)"]').closest('section').querySelector('#formSimLanc')), true);
  await pg.fill(`${f} [name=descricao]`, 'Mercado grande');
  await pg.selectOption(`${f} [name=forma]`, 'Cartão');
  await pg.selectOption(`${f} [name=cartao]`, 'Nubank');
  await pg.selectOption(`${f} [name=fatura]`, 'prox');
  await pg.click(`${f} button`);
  assert.deepEqual(await avaliar(pg, `S.lancamentos.map(l => [l.descricao, l.categoria, l.forma, l.cartao, l.valor, !!l.prox])`),
    [['Mercado grande', 'Alimentação', 'Cartão', 'Nubank', 120, true]]);
  // Parcelado: só no cartão, com a 1ª parcela pela data e pela fatura.
  await simular(m, 900, 3, 'Lazer');
  assert.deepEqual(await pg.$$eval(`${f} [name=forma] option`, os => os.map(o => o.value)), ['Cartão']);
  await pg.fill(`${f} [name=descricao]`, 'Viagem');
  await pg.selectOption(`${f} [name=cartao]`, 'Nubank');
  await pg.click(`${f} button`);
  const p = await avaliar(pg, `S.parcelados.map(p => [p.descricao, p.parcelas, p.valorParcela, p.inicio, p.categoria])`);
  assert.deepEqual(p, [['Viagem', 3, 300, m, 'Lazer']]);
  assert.deepEqual(pg.erros, []);
});

test('Simulador: meta de compra usa o mês mais apertado, não a média', async () => {
  const { m, dados } = await dadosSim(m => ({ config: { cartoes: ['Nubank'], primeiroMes: m, saldoConta: 0 },
    eventuais: [{ id: 'v', mes: addMesStr(m, 1), descricao: 'IPVA', tipo: 'Despesa', valor: 1700 }] }));
  await definirDados(pg, dados);
  // 6 meses: sobra 1.800 em quase todos, mas só 100 no 2º. Guardar 600/mês não é viável.
  const r = await pg.evaluate(mm => metaCompra(3600, addM(mm, 6)), m);
  assert.equal(r.saldoMin, 100);
  assert.ok(r.saldoMedio > 600);
  assert.equal(r.viavel, false);
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
