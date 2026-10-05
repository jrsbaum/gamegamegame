# Validação independente: tarefas no balão

Data: 2026-10-05. Commit revisado: `011ec896cd56fe88533a627bcae520b71ec5ab17`.
Runtime: Node `v22.13.0`, Windows, worktree `agent-village-hml`.

## Veredito: PASS na validação local

| Critério | Resultado | Evidência |
| --- | --- | --- |
| BUBBLE-01 | PASS nos casos verificados | `connector.test.mjs`: allowlist, normalização, limites 120/280, remoção de caminhos, argumentos, padrões de credencial e blocos de código. O teste de regressão e reprodução independente confirmam que `senha hunter2` agora é redigida antes do envio. |
| BUBBLE-02 | PASS | `events.test.mjs`: nova tarefa substitui resumo; ferramenta posterior o preserva; tarefa vazia limpa. `applyEvent` altera resumo somente em `UserPromptSubmit`/`beforeSubmitPrompt`; `SessionStart` preserva. |
| BUBBLE-03 | PASS com limite de evidência | `bubbles.test.mjs` e testes de projeção pública passam: sem título mostra estado; título mostra título; título e descrição mostram estado e título abreviado. `world.ts` atualiza o sprite usando `taskBubbleText`; `main.ts:72` renderiza descrição no caderninho somente quando presente na projeção. Inspeção e testes unitários; sem confirmação visual em navegador. |
| BUBBLE-04 | PASS | Inspeção de `main.ts:127`: formulário `robot-edit` contém somente `label` e `privacy`; campos manuais de título/descrição removidos. Handler envia os dados desse formulário via PATCH. |

## Revalidação da correção

Entrada fictícia, sem credencial real:

```js
summarizeTask('Configurar acesso com senha hunter2')
// { title: 'Configurar acesso com senha: [redigido]',
//   description: 'Configurar acesso com senha: [redigido]' }
```

Executado diretamente com `node --input-type=module`, importando `server/connector/logic.mjs`.
A falha identificada no commit anterior `8529fe8` foi corrigida e coberta por teste de regressão.

## Gates executados no commit atual

- `npm test --workspace apps/agent-village`, com `TEMP`/`TMP=D:\scratch\agent-village-verifier`: PASS, 34/34, exit 0; inclui CONN-12 e todos os testes BUBBLE.
- `npm run typecheck --workspace apps/agent-village`: PASS, exit 0.
- Build foi informado como PASS pelo agente principal; não foi executado independentemente por este verificador.

Na rodada anterior, CONN-12 falhou duas vezes com sequência final 7 em vez de 8, e uma execução com TEMP padrão apresentou falhas de persistência. O resultado verde atual não demonstra que a intermitência de CONN-12 foi corrigida: o teste e o coletor concorrente não foram alterados por esta feature.

## Limitações

Não foi executado navegador, hook real do provedor, HML, produção ou persistência em volume Docker. Não foram feitas alterações em código ou testes. PASS corresponde à evidência local indicada e não comprova funcionamento visual ou estado de produção. A redação de conteúdo sensível usa padrões de texto; os exemplos verificados não demonstram proteção universal contra qualquer credencial escrita em linguagem natural.
