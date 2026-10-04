# Vila dos Agentes Tasks

## Execution Protocol

Aplicar tlc-spec-driven, testes derivados da spec e um commit local por tarefa. O orchestrator dispara Verifier fresco ao final; author ≠ verifier. Aprovação inicial autoriza escolhas rotineiras e implementação local; operação Dokploy ocorre separadamente.

**Design:** `.specs/features/agent-village/design.md`
**Status:** In Progress

## Test Coverage Matrix

> Generated from AGENTS.md, apps/lobby/AGENTS.md, testes do catálogo/lobby e testes do ensaio. Não há lint configurado; TypeScript e node --check são o gate estático.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Event reducer | unit | Privacidade, estados, sessões/ferramentas concorrentes, turnos atrasados | tests/events.test.mjs | npm test --workspace apps/agent-village |
| Store/village | integration | Contas, limites, isolamento, revogação, persistência e rollback | tests/village.test.mjs | npm test --workspace apps/agent-village |
| HTTP | integration | Rotas happy/edge/error, origin, cookies e respostas públicas | tests/http.test.mjs | npm test --workspace apps/agent-village |
| Cliente Three/HTML | e2e | Demo, navegação, seleção, conta e configuração; fallback/reduced-motion | QA Chrome coordenador | npm run build --workspace apps/agent-village + QA |
| Catálogo/lobby | unit | IDs e URLs canônicos/projeção HML | apps/lobby/src/*.test.tsx | npm test --workspace apps/lobby |
| Config/deploy | none | Build e Compose estrutural | infra/dokploy/agent-village | docker compose config |

## Gate Check Commands

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Reducer | npm test --workspace apps/agent-village |
| Full | Store/HTTP | npm test --workspace apps/agent-village + npm run typecheck --workspace apps/agent-village |
| Build | Foundation/client/deploy | npm run build --workspace apps/agent-village + npm test --workspace apps/agent-village |
| Catalog | Lobby | npm test --workspace apps/lobby + npm run build --workspace apps/lobby |

## Execution Plan

### Phase 1: Aplicação independente

```text
T1 → T2 → T3 → T4 → T5 → T6 → T7
```

## Task Breakdown

### T1: Registrar workspace e especificação

**What**: Criar fundação executável do app e requisitos decididos.
**Where**: `apps/agent-village/`
**Depends on**: None
**Reuses**: convenções Vite/Node22 da raiz
**Requirement**: OPS-02
**Tools**: filesystem; tlc-spec-driven
**Done when**:
- [x] Spec/tasks passam validators; workspace instala e build mínimo passa (Node22, 1 teste).
**Tests**: none (config)
**Gate**: Build

### T2: Adaptar o reducer de eventos e projeção

**What**: Copiar e adaptar o componente puro do ensaio sem modificar sua origem.
**Where**: `apps/agent-village/server/events.mjs`
**Depends on**: T1
**Reuses**: village-events.mjs original
**Requirement**: ROBOT-03, ROBOT-04, ROBOT-08, EDGE-03
**Tools**: filesystem; tlc-spec-driven
**Done when**:
- [x] Testes de projeção e estados exatos passam, incluindo sessão/turno independente (6 testes totais).
**Tests**: unit
**Gate**: Quick

### T3: Implementar vila persistida e propriedade

**What**: Criar componente autoritativo de contas, mesas, robôs e store serial.
**Where**: `apps/agent-village/server/village.mjs`
**Depends on**: T2
**Reuses**: reducer T2 e crypto/fs Node22
**Requirement**: WORLD-03, AUTH-01..04, ROBOT-01..07, OPS-01, EDGE-02, EDGE-04..05
**Tools**: filesystem; tlc-spec-driven
**Done when**:
- [x] Testes persistem/reabrem, provam rollback e rejeitam mutações entre donos (15 testes totais).
- [x] Snapshots omitem IDs de sessão/tokens e privacidade é aplicada antes da entrega.
**Tests**: integration
**Gate**: Full

### T4: Expor gateway HTTP na mesma origem

**What**: Criar servidor HTTP com rotas autenticadas e healthz.
**Where**: `apps/agent-village/server/http.mjs`
**Depends on**: T3
**Reuses**: service T3
**Requirement**: AUTH-01..05, ROBOT-02, ROBOT-04..05, ROBOT-07, OPS-02, EDGE-01..02
**Tools**: filesystem; tlc-spec-driven
**Done when**:
- [x] Integração HTTP prova cookies, projeção pública, limites, Origin, rate limit e revogação (19 testes totais).
**Tests**: integration
**Gate**: Full

### T5: Construir cliente da vila 3D

**What**: Criar cliente de diorama, demo e caderninho de contas/mesas/robôs.
**Where**: `apps/agent-village/web/`
**Depends on**: T4
**Reuses**: geometrias/cores do ensaio; demo filtrada pelo servidor
**Requirement**: WORLD-01..05, ROBOT-05, ROBOT-08
**Tools**: filesystem; frontend-design; computer-use (QA coordenador)
**Done when**:
- [x] TypeScript/build passam e QA Chrome permite demo, cenas, seleção e cadastro/configuração (QA coordenador 2026-10-04).
**Tests**: e2e
**Gate**: Build

### T6: Incluir jogo no catálogo do lobby

**What**: Registrar entrada única da Vila e destino HML.
**Where**: `packages/game-catalog/`
**Depends on**: T5
**Reuses**: platform-contracts e LobbyApp
**Requirement**: OPS-04
**Tools**: filesystem; tlc-spec-driven
**Done when**:
- [x] Catálogo/lobby passam com seis jogos e URLs corretos, inclusive HML (10 testes, build lobby PASS).
**Tests**: unit
**Gate**: Catalog

### T7: Preparar distribuição Dokploy e guia

**What**: Entregar imagem/Compose e documentação operacional da aplicação.
**Where**: `infra/dokploy/agent-village/`
**Depends on**: T6
**Reuses**: padrões Dokploy/Node22
**Requirement**: OPS-03, OPS-05
**Tools**: filesystem; Docker Compose
**Done when**:
- [ ] Compose renderiza com volume/router exclusivos; build/test final passa; README contém protocolo e limites.
**Tests**: none (config)
**Gate**: Build

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1 | Fundação do workspace | ✅ |
| T2 | Reducer puro | ✅ |
| T3 | Componente autoritativo da vila | ✅ |
| T4 | Gateway HTTP | ✅ |
| T5 | Cliente da vila | ✅ |
| T6 | Registro de catálogo | ✅ |
| T7 | Distribuição do app | ✅ |

## Diagram-Definition Cross-Check

| Task | Depends On | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | None | ✅ |
| T2 | T1 | T1 | ✅ |
| T3 | T2 | T2 | ✅ |
| T4 | T3 | T3 | ✅ |
| T5 | T4 | T4 | ✅ |
| T6 | T5 | T5 | ✅ |
| T7 | T6 | T6 | ✅ |

## Test Co-location Validation

| Task | Layer | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Config | none | none | ✅ |
| T2 | Reducer | unit | unit | ✅ |
| T3 | Store/village | integration | integration | ✅ |
| T4 | HTTP | integration | integration | ✅ |
| T5 | Cliente | e2e | e2e | ✅ |
| T6 | Catálogo | unit | unit | ✅ |
| T7 | Config | none | none | ✅ |

## Per-task Evidence

### T2 adequacy

| AC | Evidence / assertion | Outcome | Reverse mapping |
| --- | --- | --- | --- |
| ROBOT-04 | tests/events.test.mjs:12 `assert.deepEqual(publicRobot(robot), common)`; :14/:16 exact allowlists | none/title/description | Keep: privacy |
| ROBOT-03 | tests/events.test.mjs:28 `assert.equal(robots[0].status, 'tool')`; :29 other idle; :31 working; :33 completed | independent tools/session | Keep: concurrency |
| EDGE-03 | tests/events.test.mjs:41 `assert.equal(applyEvent(robots, signal('finish')), null)` | old turn ignored | Keep: ordering |
| ROBOT-08 | tests/events.test.mjs:51/:53/:55 exact reading/waiting/reading; :59 terminals | distinct states | Keep: state transitions |
| ROBOT-02 | tests/events.test.mjs:80 `assert.equal(JSON.stringify(event).includes('secret'), false)` | raw content discarded | Keep: adapters |

Verdict: exact outcomes, no shallow assertions, every test bounded to spec; Node native tests beside app follow project isolation. Gate 6/6 PASS.

### T3 adequacy

| AC | Evidence / assertion | Outcome | Reverse mapping |
| --- | --- | --- | --- |
| AUTH-01..03 | tests/village.test.mjs:27/28/29 `deskSize=medium`, `expiresAt=1000+SESSION_MS`, authenticated username; :32 password omitted; :38/:40 revoked/expired 401 | isolated auth | Keep: credentials |
| AUTH-04/ROBOT-01/05 | tests/village.test.mjs:56 `assert.rejects(action(), {status:404})`; :60 invalid privacy 400; :50 default none; :59 duplicate 409 | owned mutations | Keep: ownership |
| ROBOT-04/05 | tests/village.test.mjs:70 exact public keys; :71 private thread absent; :74 title and :75 no description; :77 description; :79 title removed | projection before transmission | Keep: privacy |
| ROBOT-02/03/06 | tests/village.test.mjs:89/:90 invalid token/session; :91 accepted working; :92 late sequence false; :93 offline owner; :94 independent session idle | authenticated ordered sessions | Keep: ingestion |
| ROBOT-07 | tests/village.test.mjs:104/:107 previous/deleted token 401 | granular revoke | Keep: token scope |
| OPS-01 | tests/village.test.mjs:120..124 persisted account, desk, privacy, offline then working; :136 rollback medium; :140 two sessions | durability/atomic queue | Keep: persistence |
| EDGE-02/04 | tests/village.test.mjs:149 bounds 400; :152 limit 409; :155 account cap409 | validation | Keep: limits |
| EDGE-05 | tests/village.test.mjs:161 reject open; :162 exact corrupt file | no silent data replacement | Keep: startup |

Verdict: exact outcome and state assertions; every test maps to spec; 15/15 PASS plus static gate. WORLD-03 desk persistence is asserted by restart test.

### T4 adequacy

| AC | Evidence / assertion | Outcome | Reverse mapping |
| --- | --- | --- | --- |
| OPS-02/WORLD-01 | tests/http.test.mjs:34 exact health response; :35 HTML; :37 demo true; :38 named members; :39 five robots; :41 omitted title | executable/demo projected | Keep: serving |
| AUTH-01..03/05 | tests/http.test.mjs:50 unauth401; :52 invite403; :53 origin403; :57 cookie attributes; :58 token omitted; :64 logout401; :65 login200 | browser auth | Keep: auth boundary |
| AUTH-04/ROBOT-02/04/05/07 | tests/http.test.mjs:74 cross-owner404; :79 cookie not collector401; :80 forged owner400; :81 session400; :82 exact working; :84 hidden fields absent; :87/:88 title only; :91 description; :93 previous token401 | HTTP ownership and privacy | Keep: wire payload |
| EDGE-01/02/AUTH-05 | tests/http.test.mjs:101 invalid JSON400; :102 oversized413; :103 unknown400; :106 rate429; :107 secret not echoed | bounded ingress | Keep: errors |

Verdict: 19/19 PASS plus static gate. API tests exercise real HTTP and saved state, no mocks; each assertion encodes a spec outcome.

### T5 adequacy

Coordenador fez QA Chrome em http://127.0.0.1:5176: jardim 3D, botão Entrar no escritório, Próximo sinal levou Codex 1 a Trabalhando (1/20), seleção Cursor mostrou título Criar um portfólio sem descrição, cadastro criou QA Browser, mesa mudou Bancada → Ateliê. Screenshot capturado pelo coordenador. Build TypeScript/Vite PASS; 19 testes regressivos PASS. WORLD-04/05 têm fallback HTML e media query observada no código; verificação adversarial final fica com Verifier.
