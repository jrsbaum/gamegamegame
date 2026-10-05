# Vila dos Agentes: tarefas no balão

## Execution Protocol

Uma tarefa atômica: coletor, reducer e cliente mudam juntos porque o contrato do resumo atravessa as três camadas. Cada gate deve passar antes do commit.

## Gate Check Commands

| Gate | Command |
| --- | --- |
| Full | `npm test --workspace apps/agent-village && npm run typecheck --workspace apps/agent-village && npm run build --workspace apps/agent-village` |

## Test Coverage Matrix

| Layer | Required test | Location | Gate |
| --- | --- | --- | --- |
| Connector/reducer | Sanitized task summary, redaction, and state retention | `apps/agent-village/tests/connector.test.mjs`, `events.test.mjs` | Full |
| Client | Privacy presentation and 3D bubble mapping | `apps/agent-village/tests/bubbles.test.mjs`, `apps/agent-village/web/` | Full |

## Execution Plan

```text
T1
```

## Task Breakdown

### T1: Derivar tarefas e exibir balões por privacidade

**Status**: Done
**What**: Transportar um resumo sanitizado da tarefa atual, atualizar o robô e exibir o resumo no balão/caderninho sem campos manuais.
**Where**: `apps/agent-village/server/connector/logic.mjs`, `apps/agent-village/server/events.mjs`, `apps/agent-village/web/main.ts`, `apps/agent-village/web/world.ts`, testes e README.
**Requirement**: BUBBLE-01..04.
**Tests**: connector/reducer unit tests, typecheck/build.
**Gate**: Full.

## Traceability

| Requirement | Task |
| --- | --- |
| BUBBLE-01 | T1 |
| BUBBLE-02 | T1 |
| BUBBLE-03 | T1 |
| BUBBLE-04 | T1 |
