// Base comum dos testes: abre o app (index.html) num Chromium do Playwright e roda código dentro da página.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const RAIZ = path.resolve(__dirname, '..');
// Testa o arquivo indicado em CF_APP; senão, o fonte, se existir; senão, o index.html publicado.
const APP = [process.env.CF_APP, ...['controle-financeiro-v2.html', 'index.html'].map(f => path.join(RAIZ, f))]
  .find(f => f && fs.existsSync(f));
const URL_APP = 'file:///' + APP.replace(/\\/g, '/');

let navegador = null;
async function abrirNavegador() {
  if (!navegador) navegador = await chromium.launch();
  return navegador;
}
async function fecharNavegador() {
  if (navegador) await navegador.close();
  navegador = null;
}

// Página nova com armazenamento limpo. Aceita confirm/alert e guarda erros de JS em pagina.erros.
async function abrirApp({ largura = 1280, altura = 900 } = {}) {
  const b = await abrirNavegador();
  const ctx = await b.newContext({ viewport: { width: largura, height: altura } });
  const pagina = await ctx.newPage();
  pagina.erros = [];
  pagina.alertas = [];
  pagina.on('pageerror', e => pagina.erros.push(e.message));
  pagina.on('console', m => { if (m.type() === 'error') pagina.erros.push(m.text()); });
  pagina.on('dialog', d => { pagina.alertas.push(d.message()); d.accept(); });
  await pagina.goto(URL_APP);
  pagina.fechar = () => ctx.close();
  return pagina;
}

// Substitui os dados do app (S) por blank() + dados e redesenha.
async function definirDados(pagina, dados) {
  await pagina.evaluate(d => {
    S = Object.assign(blank(), JSON.parse(d));
    S.config = Object.assign(blank().config, S.config);
    commit();
  }, JSON.stringify(dados));
}

// Avalia uma expressão JS na página (com acesso às funções do app) e devolve o resultado.
const avaliar = (pagina, expr) => pagina.evaluate(`(() => (${expr}))()`);

// Arredonda para centavos, para comparar valores em reais.
const c2 = v => Math.round(v * 100) / 100;

// LibreOffice: executável e um perfil temporário configurado para sempre recalcular as fórmulas ao abrir .xlsx.
function soffice() {
  const candidatos = [process.env.SOFFICE, 'C:/Program Files/LibreOffice/program/soffice.com',
    'C:/Program Files (x86)/LibreOffice/program/soffice.com', '/usr/bin/soffice', '/usr/local/bin/soffice',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice'].filter(Boolean);
  return candidatos.find(c => fs.existsSync(c)) || 'soffice';
}
function perfilLibreOffice() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-lo-'));
  fs.mkdirSync(path.join(dir, 'user'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'user', 'registrymodifications.xcu'), `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>
</oor:items>`);
  return 'file:///' + dir.replace(/\\/g, '/').replace(/^\//, '');
}

module.exports = { RAIZ, APP, abrirApp, fecharNavegador, definirDados, avaliar, c2, soffice, perfilLibreOffice };
