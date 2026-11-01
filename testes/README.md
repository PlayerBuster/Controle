# Testes do Controle Financeiro

```bash
bash testes/rodar_testes.sh
```

O script roda os cinco arquivos `.test.js` abaixo e termina com "TODOS OS TESTES PASSARAM" ou "HÁ TESTES FALHANDO". O `publicar.sh` roda este script e não publica nada se algum teste falhar.

Para rodar só um arquivo, use `node --test --test-reporter=spec testes/calculos.test.js`.

## Requisitos
- Node 18 ou mais novo.
- Playwright com Chromium, instalado na pasta do projeto: `npm install --no-save playwright` e depois `npx playwright install chromium`.
- LibreOffice (`soffice`). Se ele não estiver no lugar padrão, indique o caminho na variável `SOFFICE`.

## O que é testado
O app é aberto num Chromium sem janela. Os testes usam as funções dele diretamente, sem copiar código.

O arquivo testado é escolhido nesta ordem: o caminho em `CF_APP`, se houver; depois `controle-financeiro-v2.html`, se existir; senão, `index.html`.

| Arquivo | Conteúdo |
|---|---|
| `calculos.test.js` | Datas, parcelas, recorrentes (incluindo "Próxima fatura"), fatura prevista e real, estornos e abatimentos, executado por mês e por categoria, orçamento, composição do mês e projeção com férias. Os valores esperados foram calculados à mão. |
| `planilha.test.js` | Gera a planilha .xlsx com dados que usam todos os recursos e manda o LibreOffice recalculá-la. Depois compara **cada fórmula** (cerca de 3.000) com o valor que o app gravou. Também confere que exportar seguido de importar devolve os mesmos dados. |
| `telas.test.js` | Todas as abas abrem sem erro, no computador e no celular (375px, sem rolagem lateral). Testa os formulários de Lançamentos, Recorrentes e Parcelamentos: campo Fatura, edição, "Alterar a partir de" e "Fixar estas opções". Testa também a lista de meses e o modo individual da aba Faturas. |
| `sw.test.js` | Service worker do app instalado. Um servidor local imita o GitHub Pages, inclusive o cache de 10 minutos. O teste confere que uma versão publicada aparece na abertura seguinte e que o app abre sem internet. Com `CF_SW`, dá para testar outro `sw.js`. |
| `sync.test.js` | Sincronização com dois aparelhos e um Drive falso em memória: arquivo cifrado, todos os tipos de dado chegam ao outro aparelho, alterações diferentes são combinadas, conflito pergunta e senha errada não altera nada. O login no Google e o Drive real não são testados. |
| `lib.js` | Base comum: abre o app, troca os dados (`definirDados`), avalia expressões na página e prepara o LibreOffice. |

## Detalhes
- Cada execução usa um navegador com armazenamento limpo. Os dados reais, no navegador do celular ou do computador, nunca são lidos nem alterados.
- O LibreOffice roda com um perfil temporário configurado para **sempre recalcular** as fórmulas ao abrir um .xlsx. Sem isso, ele mostraria os valores gravados pelo app, e a comparação não provaria nada.
- Os testes usam só dados fictícios. Não coloque backups nem planilhas reais nesta pasta.
