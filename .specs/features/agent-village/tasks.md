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
- [ ] Testes de projeção e estados exatos passam, incluindo sessão/turno independente.
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
- [ ] Testes persistem/reabrem, provam rollback e rejeitam mutações entre donos.
- [ ] Snapshots omitem IDs de sessão/tokens e privacidade é aplicada antes da entrega.
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
- [ ] Integração HTTP prova cookies, projeção pública, limites, Origin, rate limit e revogação.
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
- [ ] TypeScript/build passam e QA Chrome permite demo, cenas, seleção e cadastro/configuração.
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
- [ ] Catálogo/lobby passam com seis jogos e URLs corretos, inclusive HML.
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
