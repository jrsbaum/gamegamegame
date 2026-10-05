# Vila dos Agentes: auto-spawn de robôs — validação independente

**Data**: 2026-10-05
**Spec**: `.specs/features/agent-village-auto-spawn/spec.md`
**Diff range**: `60e8a0a..9e55751`
**Verifier**: sub-agent independente (autor ≠ verifier)

## Veredito

**PASS local ✅**. O `HEAD` atual passa os gates do workspace e as verificações
adversariais abaixo. O smoke test de HML não foi executado: ele exige acesso a
um ambiente externo e não havia autorização atual para deploy ou alteração de
serviço. Isso permanece como validação operacional pendente antes da promoção.

## Conclusão das tarefas

| Tarefa | Resultado | Evidência |
| --- | --- | --- |
| T1 — store de conexão/sessão | ✅ PASS | Pairing cria `connection` sem robô em `server/village.mjs:178-192`; testes de pairing e zero robôs em `tests/http.test.mjs:150-163` e `tests/village.test.mjs:110-129`. |
| T2 — reducer/lifecycle | ✅ PASS | Normalização de parent e estados terminais em `server/events.mjs:11-75,85-116`; isolamento de parent/child e evento tardio em `tests/auto-spawn.test.mjs:46-59`. |
| T3 — coletor multi-sessão | ✅ PASS | Allowlist, parent opcional, resumo sanitizado e retry/sequence em `tests/connector.test.mjs:11-22,24-62,64-95,111-156`. |
| T4 — API de conexões | ✅ PASS | Rotas autenticadas de pairing, connections, revogação e token em `server/http.mjs:86-108`; testes HTTP em `tests/http.test.mjs:150-176`. |
| T5 — UI de conexões | ✅ PASS local | Wizard, agrupamento por conexão e parent visual em `web/main.ts:76-94,127-159`; o formulário usa conexão e privacidade padrão, sem criação de robô/título/descrição manual, em `web/main.ts:137-145`. |
| T6 — migração/documentação | ✅ PASS | Migração de robôs legados em `server/village.mjs:53-72` e fixture em `tests/auto-spawn.test.mjs:85-94`; protocolo em `apps/agent-village/README.md:17-33`. |
| T7 — gates finais | ✅ PASS local / HML pendente | Gates locais abaixo passaram; smoke HML não executado por falta de autorização externa. |

## Critérios de aceitação ancorados na spec

| Critério | Resultado esperado | Evidência `file:line` e assert | Resultado |
| --- | --- | --- | --- |
| CONN-01 | Pairing provisiona conexão/token revogável sem robô | `tests/http.test.mjs:154-163` verifica 201, ausência de `robot`, conexão e token; `server/village.mjs:178-192` persiste somente conexão/pairing. | ✅ PASS |
| SPAWN-01 | Primeiro evento cria exatamente um robô por conexão + sessão | `tests/auto-spawn.test.mjs:22-31` verifica zero antes, `spawned=true` e um robô; criação serial em `server/village.mjs:313-325`. | ✅ PASS |
| SPAWN-02 | Evento posterior da mesma sessão atualiza sem duplicar | `tests/auto-spawn.test.mjs:32-36` verifica `spawned=false` e contagem estável; lookup composto em `server/village.mjs:315-316`. | ✅ PASS |
| SPAWN-03 | Parent fica na visão do dono e é omitido do público | `tests/auto-spawn.test.mjs:34-43` verifica `parentSessionId`/`parentRobotId` do dono e ausência na projeção pública; `server/village.mjs:322-329` resolve a relação. | ✅ PASS |
| LIFE-01 | Sessão terminal encerra e evento tardio não reabre; outras sessões seguem | `tests/auto-spawn.test.mjs:50-59` verifica parent `offline`, child `working` e late event rejeitado; terminal/guardas em `server/events.mjs:91-116`. | ✅ PASS |
| CONN-02 | N sessões intercaladas na mesma conexão são independentes | `tests/http.test.mjs:164-169` cria `chat-a` e `chat-b` na mesma conexão; `server/village.mjs:315-324` usa `connectionId + provider + sessionId`. | ✅ PASS |
| CONN-03 | Token/provider/session inválidos, sequência repetida e revogação não criam/alteram estado | `tests/auto-spawn.test.mjs:71-82` verifica rotação, tokens antigos e revogação; `server/village.mjs:289-311` valida token, provider/evento e deduplica sequence. | ✅ PASS |
| PRIV-01 | Novos robôs herdam default; existentes mantêm privacidade própria | `tests/auto-spawn.test.mjs:73-77` altera default e verifica o robô; `server/village.mjs:247-255,322-324` separa default da privacidade da instância. | ✅ PASS |
| PRIV-02 | Público recebe apenas none/title/description, sem IDs ou segredos | `tests/events.test.mjs:8-15` e `tests/village.test.mjs:61-77` verificam allowlist e projeções; `publicRobot` em `server/events.mjs:122-128` não inclui session/parent/connection/token. | ✅ PASS |
| UI-01 | UI cria/edita/revoga conexão e não oferece cadastro manual de robô/título/descrição | `web/main.ts:137-159` contém apenas `connection-create`, `connection-edit`, privacidade, rotação e revogação; `apps/agent-village/README.md:21,29` documenta auto-spawn e ausência de cadastro manual. | ✅ PASS |
| UI-02 | Robôs agrupam por conexão/provider e indicam parent sem expor ID | `web/main.ts:76-94,169-175` agrupa por `connectionId`, mostra label/provider e converte parent para marcador; IDs privados só são mesclados em campos do dono. | ✅ PASS |
| MIG-01 | Fixture antiga reabre, sintetiza conexão e continua legível | `tests/auto-spawn.test.mjs:85-94` verifica `connections.length=1` e `connectionId`; migração em `server/village.mjs:53-72`. | ✅ PASS |
| MIG-02 | Payload antigo mantém status/resumo/sequence sem duplicar | `tests/connector.test.mjs:11-22,64-95` verifica payload legado sanitizado, resumo bounded/redacted e lifecycle; `server/village.mjs:294-341` mantém fallback de token/robô legado e sequence. | ✅ PASS |
| OPS-01 | Testes/typecheck/build/healthz e documentação permanecem verdes | `tests/foundation.test.mjs:5-8` verifica Node 22/script; healthz e pairing em `tests/http.test.mjs:32-42,150-176`; gates registrados abaixo; README em `apps/agent-village/README.md:15-39`. | ✅ PASS local; HML pendente |

**Cobertura local**: 14/14 critérios com evidência de implementação/assert; o
critério operacional inclui a ressalva explícita de HML não executado.

## Revalidação do canal WebSocket

O commit `9e55751` adiciona o canal `/ws` e o teste `websocket.test.mjs`. Os
casos abaixo foram verificados no HEAD atual; quando a evidência é inspeção de
fonte, isso fica indicado porque o teste existente não cobre esse ramo
explicitamente.

| Caso | Resultado esperado | Evidência `file:line` | Resultado |
| --- | --- | --- | --- |
| WS-01 — handshake same-origin por cookie | O upgrade usa o cookie HttpOnly da sessão e não aceita token na URL | `apps/agent-village/tests/websocket.test.mjs:17-29` abre `/ws` com `Cookie`; `apps/agent-village/server/realtime.mjs:30-36` lê/autentica o cookie antes do upgrade. | ✅ PASS |
| WS-02 — `hello` inicial e broadcast após ingest | Cada viewer recebe `hello`; um evento aceito publica `snapshot` aos viewers | `apps/agent-village/tests/websocket.test.mjs:31-53` verifica `hello`, dois snapshots, uma sessão e ausência de `sessionId`; `apps/agent-village/server/realtime.mjs:16-23,40-48` e `apps/agent-village/server/village.mjs:347-349` ligam `subscribe` ao `ingest`. | ✅ PASS |
| WS-03 — credencial ausente/inválida | O servidor rejeita antes do upgrade com HTTP 401 | `apps/agent-village/tests/websocket.test.mjs:56-64` espera `unexpected 401`; `apps/agent-village/server/realtime.mjs:25-36` escreve 401 e destrói o socket. | ✅ PASS |
| WS-04 — `snapshot.get` | Mensagem válida retorna um snapshot autenticado | `apps/agent-village/server/realtime.mjs:44-48` trata exatamente `snapshot.get`; o cliente envia a mensagem em `apps/agent-village/web/main.ts:80-88`. | ✅ PASS (inspeção de fonte; sem assert dedicado no teste) |
| WS-05 — fechamento e reconexão | Fechamento limpa o cliente; a UI agenda nova conexão e repete o handshake | `apps/agent-village/server/realtime.mjs:50-63` remove clientes/fecha o gateway; `apps/agent-village/web/main.ts:62-97` encerra, agenda retry de 1,5 s e reconecta. | ✅ PASS (inspeção de fonte; sem assert dedicado no teste) |
| WS-06 — fallback de polling | Polling HTTP continua ativo quando o socket não está aberto | `apps/agent-village/web/main.ts:261-264` chama `loadReal()` a cada 3 s quando `realtimeSocket` não está OPEN. | ✅ PASS (inspeção de fonte) |
| WS-07 — projeção pública | `sessionId`, `connectionId`, `parentSessionId` e segredos não atravessam o snapshot | `apps/agent-village/tests/websocket.test.mjs:49-53` verifica ausência de `sessionId`; `apps/agent-village/server/events.mjs:122-127` constrói allowlist sem IDs privados. | ✅ PASS |
| WS-08 — compatibilidade HTTP/legada | Rotas HTTP e ingest legado permanecem disponíveis | `apps/agent-village/server/http.mjs:87-109` mantém `/api/events`, pairings, robots e connections; `apps/agent-village/server/village.mjs:299-345` preserva lookup por token de robô legado; `apps/agent-village/tests/http.test.mjs:150-176` cobre pairing/eventos e isolamento. | ✅ PASS |

O smoke adicional de `snapshot.get`/reconexão foi iniciado, mas não produziu
saída antes do timeout do runner e não foi contado como gate. O resultado
determinístico permanece o `websocket.test.mjs` (2/2), complementado pela
inspeção dos caminhos de código acima.

## Edge cases

| Caso | Evidência | Resultado |
| --- | --- | --- |
| EDGE-01 — dois primeiros eventos simultâneos | `tests/auto-spawn.test.mjs:62-68` verifica uma única instância e um único `spawned`; serialização em `server/village.mjs:81-100`. | ✅ PASS |
| EDGE-02 — dois filhos do mesmo parent | `tests/auto-spawn.test.mjs:34-43` verifica child distinto, parent e ausência de IDs na projeção pública; lookup em `server/village.mjs:320-329`. | ✅ PASS |
| EDGE-03 — sem SessionStart/parent | `tests/auto-spawn.test.mjs:28-31` cria pelo primeiro `turn/started`; `normalizeEvent` aceita parent ausente em `server/events.mjs:64-75`. | ✅ PASS |
| EDGE-04 — terminal de uma sessão não muda outra | `tests/auto-spawn.test.mjs:50-59` verifica parent offline e child working. | ✅ PASS |
| EDGE-05 — falha de persistência não deixa sucesso parcial | `tests/village.test.mjs:162-173` verifica 503, rollback e transações concorrentes; `server/village.mjs:81-100` mantém fila/rename atômicos. | ✅ PASS |

## Refresh e detalhes do proprietário

Após refresh/polling, `loadReal` recarrega `/api/me` sempre que já existe uma
conta em `web/main.ts:162-165` (correção no `00f447d`), e `renderAccount` usa
`me.connections`/`me.robots` em `web/main.ts:155-159`. A API devolve os campos
do proprietário, parent e detalhes em `server/village.mjs:239-244,344-346`;
portanto o agrupamento, privacidade, conexão e detalhes autorizados são
reconstruídos após a atualização. A persistência/reabertura de configuração é
assertada em `tests/village.test.mjs:144-160`. Não foi realizado navegador
interativo nem smoke HML.

## Discrimination sensor

As mutações foram aplicadas somente em worktrees temporários derivados do
`00f447d`; o worktree do coordenador permaneceu limpo após cada remoção.

| Mutação | Scratch | Teste que matou | Resultado |
| --- | --- | --- | --- |
| 1 | `server/village.mjs:314` — `let spawned = false` → `true` | `tests/auto-spawn.test.mjs:32,67-68` falhou por `spawned` incorreto e duplicação | ✅ Killed |
| 2 | `server/events.mjs:123` — incluir `sessionId` em `publicRobot` | `tests/events.test.mjs:8-15`, `tests/http.test.mjs:32-42` e `tests/village.test.mjs:61-68` falharam por allowlist/privacidade | ✅ Killed |

**Sensor**: 2/2 mutações mortas — PASS ✅.

## Gates executados

| Comando | Resultado |
| --- | --- |
| `npm test --workspace apps/agent-village` | ✅ PASS — 44/44 testes, 0 falhas, 0 skips; `9e55751`. Inclui `tests/websocket.test.mjs` (2/2). |
| `npm run typecheck --workspace apps/agent-village` | ✅ PASS — exit 0. |
| `npm run build --workspace apps/agent-village` | ✅ PASS — Vite build; somente aviso existente de chunk acima de 500 kB. |
| `git diff --check 60e8a0a..HEAD` | ✅ PASS — exit 0. |
| `validate_spec.py --root . agent-village-auto-spawn` | ✅ PASS — 0 erros, 0 warnings. |
| `validate_tasks.py --root . agent-village-auto-spawn` | ✅ PASS — 0 erros, 5 warnings de granularidade T1–T5. |
| `validate_state.py --root . agent-village-auto-spawn` | ✅ PASS após este relatório; antes dele falhava corretamente por ausência de `validation.md`. |
| Smoke HML/healthz externo | ⏭️ Não executado — requer alvo e autorização atuais; não houve deploy. |

Durante a investigação, uma execução no checkout anterior `fbf2c53` falhou
intermitentemente em `CONN-12` (`7 !== 8`), e três repetições tiveram uma
falha. O `HEAD` validado aqui executou 44/44 com sucesso; a intermitência do
coletor concorrente permanece um risco a observar em CI, embora não tenha
reproduzido nesta execução final.

## Qualidade e rastreabilidade

- ✅ Sem alteração de código de produto pelo Verifier.
- ✅ Sensor isolado; porcelain do worktree do coordenador permaneceu limpo.
- ✅ Evidências cobrem store, reducer, coletor, HTTP, UI e persistência.
- ✅ `AGENTS.md`, `apps/agent-village/AGENTS.md` e `tlc-spec-driven/SKILL.md` foram seguidos.
- ⏭️ HML, navegador interativo, hook real de provedor e volume Docker continuam fora desta validação local.

**Resumo**: PASS local ✅ — 14/14 ACs cobertos, 2/2 mutações mortas, 44/44
testes, typecheck/build/diff/validadores verdes. HML deve ser executado por
um operador autorizado antes da promoção.
