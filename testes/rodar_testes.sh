#!/usr/bin/env bash
# Roda toda a suíte de testes do Controle Financeiro. Sai com código 1 se algum teste falhar.
# Uso: bash testes/rodar_testes.sh
set -uo pipefail
cd "$(dirname "$0")/.."

falta=0
command -v node >/dev/null || { echo 'Falta o Node 18+ (https://nodejs.org).'; falta=1; }
node -e 'require.resolve("playwright")' 2>/dev/null || { echo 'Falta o Playwright: npm install --no-save playwright && npx playwright install chromium'; falta=1; }
if ! command -v soffice >/dev/null && [ ! -e '/c/Program Files/LibreOffice/program/soffice.com' ] && [ -z "${SOFFICE:-}" ]; then
  echo 'Falta o LibreOffice (soffice), usado para recalcular as fórmulas da planilha.'; falta=1
fi
[ "$falta" = 0 ] || exit 1

node --test --test-reporter=spec --test-concurrency=1 \
  testes/calculos.test.js testes/telas.test.js testes/sw.test.js testes/sync.test.js testes/fatura.test.js testes/melhorias.test.js testes/planilha.test.js
status=$?
echo
if [ "$status" = 0 ]; then echo 'TODOS OS TESTES PASSARAM.'; else echo 'HÁ TESTES FALHANDO.'; fi
exit "$status"
