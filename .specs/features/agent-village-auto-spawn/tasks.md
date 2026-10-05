# Vila dos Agentes: conexões e robôs auto-spawn

## Execution Protocol

Aplicar tlc-spec-driven. Cada tarefa deve atualizar seus testes, passar o gate, atualizar a rastreabilidade e ser commitada atomicamente. O Verifier independente será executado depois da última tarefa.

**Design**: `.specs/features/agent-village-auto-spawn/design.md`  
**Status**: In Progress

## Test Coverage Matrix

> Gerada a partir de `apps/agent-village/AGENTS.md`, specs existentes e testes do workspace. Não há lint configurado; typecheck/build e testes Node são os gates.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Connection/session domain | integration | Todos os ACs de spawn, lookup, lifecycle, corrida, revogação e migração | `apps/agent-village/tests/village.test.mjs`, `events.test.mjs` | `npm test --workspace apps/agent-village` |
| HTTP connection API | integration | Rotas novas e legadas: happy path, bounds, auth e falhas | `apps/agent-village/tests/http.test.mjs` | `npm test --workspace apps/agent-village` |
| Connector normalization | unit | Multi-sessão, parent opcional, redaction e sequência | `apps/agent-village/tests/connector.test.mjs` | `npm test --workspace apps/agent-village` |
| Client UI/model | e2e + typecheck | Conexão criada, robôs descobertos, agrupamento e privacidade | `apps/agent-village/web/`, QA Chrome | `npm run typecheck --workspace apps/agent-village && npm run build --workspace apps/agent-village` |
| Persistence/deploy docs | none | Build e documentação estrutural | `apps/agent-village/README.md`, `infra/dokploy/agent-village` | `npm run build --workspace apps/agent-village` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Reducer/connector | `npm test --workspace apps/agent-village` |
| Full | Store/HTTP | `npm test --workspace apps/agent-village && npm run typecheck --workspace apps/agent-village` |
| Build | Phase completion | `npm test --workspace apps/agent-village && npm run typecheck --workspace apps/agent-village && npm run build --workspace apps/agent-village` |

## Execution Plan

```text
Phase 1: T1 → T2 → T3
Phase 2: T4 → T5
Phase 3: T6 → T7
Phase 1 → Phase 2 → Phase 3
```

## Task Breakdown

### Phase 1: Contrato e domínio

### T1: Separar conexão de sessão no store

**What**: Introduzir registros de conexão e lookup `connectionId + sessionId`, preservando registros legados e removendo a fixação ao primeiro sessionId.
**Where**: `apps/agent-village/server/village.mjs`, `apps/agent-village/tests/village.test.mjs`
**Depends on**: None
**Requirement**: CONN-01, CONN-02, MIG-01
**Done when**:
- [x] Pairing cria conexão sem robô e retorna token compatível.
- [x] Eventos de duas sessões criam duas instâncias sem duplicar a mesma chave.
- [x] Fixture antiga continua legível e editável.
- [x] Corrida de primeiro evento deixa exatamente um robô.
**Tests**: integration
**Gate**: Full

### T2: Atualizar reducer e ciclo de vida de sessões

**What**: Aceitar parentSessionId opcional, aplicar spawn/lifecycle e preservar resumo/estado por sessão.
**Where**: `apps/agent-village/server/events.mjs`, `apps/agent-village/tests/events.test.mjs`
**Depends on**: T1
**Requirement**: SPAWN-03, LIFE-01, EDGE-02, EDGE-03, EDGE-04
**Done when**:
- [x] Parent/child e sessão sem parent são normalizados dentro dos limites.
- [x] SessionEnd encerra somente a sessão correspondente.
- [x] Evento tardio de sessão encerrada não reabre o robô.
- [x] Resumo e privacidade preservam o contrato BUBBLE.
**Tests**: integration
**Gate**: Quick

### T3: Expandir contrato do coletor multi-sessão

**What**: Enviar parent/session lifecycle opcionais com um token de conexão e manter sequência/retry idempotentes.
**Where**: `apps/agent-village/server/connector/logic.mjs`, `apps/agent-village/server/connector/collector.mjs`, `apps/agent-village/tests/connector.test.mjs`
**Depends on**: T2
**Requirement**: CONN-03, MIG-02, EDGE-03
**Done when**:
- [x] Eventos válidos de vários sessionIds preservam IDs e redaction.
- [x] Evento sem SessionStart ainda é aceito pelo contrato.
- [x] Campos desconhecidos, IDs inválidos e segredos continuam fora do payload.
- [x] Sequência da conexão é segura para eventos intercalados.
**Tests**: unit
**Gate**: Quick

### Phase 2: API e interface

### T4: Expor conexões e defaults de privacidade

**What**: Adicionar rotas autenticadas para listar, editar e revogar conexões e adaptar pairing/events sem expor token.
**Where**: `apps/agent-village/server/http.mjs`, `apps/agent-village/tests/http.test.mjs`
**Depends on**: T1, T3
**Requirement**: PRIV-01, CONN-03, MIG-02
**Done when**:
- [x] Dono consegue listar/editar/revogar somente suas conexões.
- [x] Token bruto aparece apenas no exchange/rotação autorizado.
- [x] Eventos de conexão revogada retornam 401 e endpoints antigos continuam respondendo.
- [x] Origin, limites e erros seguem os contratos atuais.
**Tests**: integration
**Gate**: Full

### T5: Trocar onboarding manual por conexão e lista auto-spawn

**What**: Atualizar tipos, editor, agrupamento e controles para criar conexões e renderizar robôs descobertos sem título/descrição manual.
**Where**: `apps/agent-village/web/types.ts`, `apps/agent-village/web/main.ts`, `apps/agent-village/web/world.ts`, `apps/agent-village/web/styles.css`, `apps/agent-village/tests/`
**Depends on**: T4
**Requirement**: UI-01, UI-02, PRIV-01, PRIV-02
**Done when**:
- [x] UI oferece conexão como ação criada pelo dono e não oferece criação manual de robô.
- [x] Robôs novos aparecem automaticamente agrupados por provider/conexão.
- [x] Parent/child é indicado sem expor IDs privados.
- [x] Balões/caderninho continuam obedecendo as três políticas de privacidade.
**Tests**: e2e + typecheck
**Gate**: Build

### Phase 3: Migração e operação

### T6: Migrar fixtures e documentar protocolo

**What**: Atualizar README, fixtures e testes de compatibilidade para o novo modelo sem quebrar robôs já pareados.
**Where**: `apps/agent-village/README.md`, `apps/agent-village/tests/`, `.specs/features/agent-village-auto-spawn/`
**Depends on**: T4, T5
**Requirement**: MIG-01, MIG-02, OPS-01
**Done when**:
- [x] README explica conexão, auto-spawn, parent, revogação e limites.
- [x] Fixture anterior e fixture nova passam pela mesma suíte.
- [x] Spec traceability aponta todas as evidências.
**Tests**: integration
**Gate**: Full

### T7: Gate final e validação HML

**What**: Rodar suíte, typecheck, build, diff check e smoke test HML da conexão e de duas sessões.
**Where**: `.specs/features/agent-village-auto-spawn/validation.md`, `apps/agent-village/`
**Depends on**: T6
**Requirement**: OPS-01
**Done when**:
- [x] `npm test`, typecheck e build passam sem reduzir contagem de testes.
- [x] Verifier independente registra PASS/FAIL com evidência file:line e sensor.
- [ ] HML confirma healthz, conexão, dois robôs e privacidade.
**Tests**: e2e + integration
**Gate**: Build

## Phase Execution Map

```text
Phase 1: T1 ──→ T2 ──→ T3
Phase 2: T4 ──→ T5
Phase 3: T6 ──→ T7
```

## Requirement Traceability

| Requirement | Task |
| --- | --- |
| CONN-01, CONN-02, MIG-01 | T1 |
| SPAWN-03, LIFE-01, EDGE-02..04 | T2 |
| CONN-03, MIG-02, EDGE-03 | T3 |
| PRIV-01, CONN-03, MIG-02 | T4 |
| UI-01, UI-02, PRIV-01..02 | T5 |
| MIG-01..02, OPS-01 | T6 |
| OPS-01 | T7 |

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1 | Store/connection lookup | ✅ |
| T2 | Reducer lifecycle | ✅ |
| T3 | Connector contract | ✅ |
| T4 | HTTP connection routes | ✅ |
| T5 | Client connection UI | ✅ |
| T6 | Fixtures/docs | ✅ |
| T7 | Final validation | ✅ |

## Diagram-Definition Cross-Check

| Task | Depends on | Diagram shows | Status |
| --- | --- | --- | --- |
| T1 | None | None | ✅ |
| T2 | T1 | T1 | ✅ |
| T3 | T1, T2 | T1, T2 | ✅ |
| T4 | T1, T3 | T1, T3 | ✅ |
| T5 | T4 | T4 | ✅ |
| T6 | T4, T5 | T4, T5 | ✅ |
| T7 | T6 | T6 | ✅ |

## Test Co-location Validation

| Task | Code layer | Matrix requires | Task says | Status |
| --- | --- | --- | --- | --- |
| T1 | Connection/session domain | integration | integration | ✅ |
| T2 | Connection/session domain | integration | integration | ✅ |
| T3 | Connector normalization | unit | unit | ✅ |
| T4 | HTTP connection API | integration | integration | ✅ |
| T5 | Client UI/model | e2e + typecheck | e2e + typecheck | ✅ |
| T6 | Persistence/docs | integration | integration | ✅ |
| T7 | All layers | build + integration/e2e | e2e + integration | ✅ |
