# Testes do Controle Financeiro

```bash
bash testes/rodar_testes.sh
```

O script roda os cinco arquivos `.test.js` abaixo e termina com "TODOS OS TESTES PASSARAM" ou "HÁ TESTES FALHANDO". O `publicar.sh` roda este script e não publica nada se algum teste falhar.

Para rodar só um arquivo, use `node --test --test-reporter=spec testes/calculos.test.js`.

## Requisitos
- Node 18 ou mais novo.
- Playwright com Chromium, instalado na pasta do projeto: `npm install --no-save playwright pdfjs-dist@3.11.174 tesseract.js@5.1.1 tesseract.js-core@5.1.1 @tesseract.js-data/por@1.0.0 xlsx@0.18.5` (os leitores de PDF, imagem e .xls que o app baixa da internet; no teste eles vêm destas cópias). Instale tudo num comando só: o npm remove o que não estiver na lista e depois `npx playwright install chromium`.
- LibreOffice (`soffice`). Se ele não estiver no lugar padrão, indique o caminho na variável `SOFFICE`.

## O que é testado
O app é aberto num Chromium sem janela. Os testes usam as funções dele diretamente, sem copiar código.

O arquivo testado é escolhido nesta ordem: o caminho em `CF_APP`, se houver; depois `controle-financeiro-v2.html`, se existir; senão, `index.html`.

| Arquivo | Conteúdo |
|---|---|
| `calculos.test.js` | Datas, parcelas, recorrentes (incluindo "Próxima fatura"), fatura prevista e real, estornos e abatimentos, executado por mês e por categoria, orçamento, composição do mês e projeção com férias. Os valores esperados foram calculados à mão. |
| `planilha.test.js` | Gera a planilha .xlsx com dados que usam todos os recursos e manda o LibreOffice recalculá-la. Depois compara **cada fórmula** (cerca de 3.000) com o valor que o app gravou. Também confere que exportar seguido de importar devolve os mesmos dados. |
| `telas.test.js` | Todas as abas abrem sem erro, no computador e no celular (375px, sem rolagem lateral). Testa os formulários de Lançamentos, Recorrentes e Parcelamentos: campo Fatura, edição, "Alterar a partir de" e "Fixar estas opções". Testa também a lista de meses e o modo individual da aba Faturas. |
| `sw.test.js` | Service worker do app instalado. Um servidor local imita o GitHub Pages, inclusive o cache de 10 minutos. O teste confere que uma versão publicada aparece na abertura seguinte e que o app abre sem internet. Com `CF_SW`, dá para testar outro `sw.js`. Também: a fatura compartilhada pelo Android chega à aba Importar fatura, e os avisos com o app fechado aparecem uma vez por dia, só nas datas. |
| `sync.test.js` | Sincronização com dois aparelhos e um Drive falso em memória: arquivo cifrado, todos os tipos de dado chegam ao outro aparelho, alterações diferentes são combinadas, conflito pergunta e senha errada não altera nada. Também: reabrir o app continua conectado, acesso vencido é renovado sozinho (prompt=none) e, se o Google pedir confirmação, aparece "Reconectar"; sem internet, avisa e tenta de novo. Cópias diárias no Drive (uma por dia, 14 mais recentes, restaurar). O login no Google e o Drive real não são testados. |
| `fatura.test.js` | Importar fatura com faturas fictícias: PDF em duas colunas (gerado no próprio teste), PDF com senha (gerado pelo LibreOffice), PDF escaneado e print de app (reconhecimento de texto), CSV do Nubank, C6 e Inter, OFX, Excel .xlsx e .xls, vários arquivos juntos e texto colado. Confere vencimento, total, parcelas, créditos, pagamento ignorado, o que já está no app vir desmarcado e a fatura do app ficar igual ao total do PDF. |
| `melhorias.test.js` | Abas em grupos (todas as abas num grupo, volta à última aba do grupo), quadro de gasto do dia a dia na Projeção, regras de categoria (lançamento, importação, "Sempre assim", renomear, planilha), fatura importada no Check list e a lista de avisos do celular. |
| `guardar.test.js` | Quanto posso gastar (mês, dia, ritmo e médias de 3/6/12 meses, com valores calculados à mão) e a aba Guardar: destinos com meta, plano por valor e por %, guardar o planejado, previsão da meta, a Projeção sem mudar o saldo e a planilha mantendo tudo. |
| `lib.js` | Base comum: abre o app, troca os dados (`definirDados`), avalia expressões na página e prepara o LibreOffice. |

## Detalhes
- Cada execução usa um navegador com armazenamento limpo. Os dados reais, no navegador do celular ou do computador, nunca são lidos nem alterados.
- O LibreOffice roda com um perfil temporário configurado para **sempre recalcular** as fórmulas ao abrir um .xlsx. Sem isso, ele mostraria os valores gravados pelo app, e a comparação não provaria nada.
- Os testes usam só dados fictícios. Não coloque backups nem planilhas reais nesta pasta.
