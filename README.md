# voo-monitor

Automatização para monitorar preços de passagens aéreas e registrar os valores em um banco de dados no Notion.

## Como funciona

O GitHub Actions roda o script **2x por dia** (09h e 21h no horário de Brasília):

1. Lê os emails **não lidos** da caixa de entrada (alertas de preço do Kayak, Skyscanner e Google Flights).
2. Extrai o menor preço e o trecho do alerta (ida / volta / ida e volta).
3. Atualiza a tabela no Notion **apenas quando o preço muda**.

## Estrutura

- `.github/workflows/monitor-flights.yml` — agendamento do workflow
- `monitor.mjs` — script Node.js (sem dependências) que integra Gmail e Notion via API do Composio

## Execução manual

Na aba **Actions**, rode o workflow "Monitor voos" com o botão *Run workflow*.
