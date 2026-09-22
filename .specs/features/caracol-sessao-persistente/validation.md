# Sessão do Caracol Sobrevive a Restart Validation

**Spec**: `.specs/features/caracol-sessao-persistente/spec.md`
**Verifier**: independente (author ≠ verifier), ciclo fix→re-verify (máximo 3 iterações)

---

## Iteração 1 (2026-09-21) — FAIL ❌

**Diff range**: working tree vs HEAD (209cd08) — `server/caracol/store.ts`, `server/caracol/game.ts`,
`tests/caracol.integration.test.ts`

### Task Completion

Nenhum `tasks.md` formal existe para esta feature (confirmado — só `spec.md` está presente no
diretório). Tratado o diff como as "tarefas": schema SQL, interface `CaracolStore`,
`MemoryCaracolStore`, `PgCaracolStore`, `initialize()`, `issueSession()`, `revokeSession()`, e o
novo teste de integração.

| Item | Status | Notes |
| ---- | ------ | ----- |
| Schema `caracol_sessions` (Postgres) | ✅ Done | `server/caracol/store.ts:246-256` |
| `CaracolStore.createSession`/`deleteSession` (interface + Memory + Pg) | ✅ Done | `server/caracol/store.ts:124-125,433-437,636-644` |
| `initialize()` recarrega `snapshot.sessions` | ✅ Done | `server/caracol/game.ts:161-162` |
| `issueSession`/`revokeSession` persistem no store | ✅ Done | `server/caracol/game.ts:950-966` |
| 3 call sites com `await` (`register`, `login`, `logout`) | ✅ Done | `server/caracol/game.ts:265,288,929` |
| Teste novo "mantém a sessão válida depois de um restart" | ✅ Done | `tests/caracol.integration.test.ts:224-241` |

### Spec-Anchored Acceptance Criteria

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| -------------------------- | --------------------- | ----------------------- | ------ |
| CARSESS-01 (P1): sessão emitida sobrevive a restart do processo | `caracol:resume` responde `{ ok: true, accountId, nickname }` | `tests/caracol.integration.test.ts:238-241` — `expect(resumed.ok).toBe(true); expect(resumed.nickname).toBe('Sobrevivente')` | ✅ PASS |
| CARSESS-02 (P1): sessão emitida/revogada guarda só o hash SHA-256 do token | Armazenamento persistente nunca recebe o token em claro | `server/caracol/game.ts:953,956` (hash) + `server/caracol/store.ts:248` (coluna `token_hash`) — verificado por inspeção de código, fluxo de dados torna impossível persistir o texto puro | ✅ PASS (sem teste dedicado ao esquema de coluna) |
| CARSESS-03 (P2): sessão revogada continua inválida (`SESSION_EXPIRED`) mesmo após restart | `caracol:resume` responde `ok: false`, `code: SESSION_EXPIRED` | **nenhuma** — zero ocorrências de `logout`/`SESSION_EXPIRED` em testes de logout | ❌ GAP — evidence-or-zero: sem `file:line`, conta como NÃO coberto |

**Status**: ❌ Gaps present — CARSESS-03 não tinha nenhum teste, apesar do código estar correto.

### Discrimination Sensor

3 mutações injetadas em worktree isolado (recarga do snapshot, `issueSession` sem persistir,
`resume()` com checagem invertida) — 3/3 mortas. Observação: mutação em `revokeSession`
(remover `store.deleteSession`) não foi testável por falta de cobertura de logout — consistente
com o GAP já reportado.

### Gate Check

- typecheck: limpo
- `npx vitest run tests/caracol.integration.test.ts`: 9 passed, 0 failed
- suíte completa: 390 passed, 2 falhas pré-existentes (`lafarmer/*`, `MODULE_NOT_FOUND`, sem relação)
- Test count before feature: 8; after: 9; delta: +1

### Veredito Iteração 1

**FAIL ❌** — CARSESS-03 (P2) sem nenhuma evidência de teste. Fix task roteada: adicionar teste de
`caracol:logout` + restart + `resume` esperando `ok: false, code: 'SESSION_EXPIRED'`.

### Requirement Traceability (após iteração 1)

| Requirement | Previous Status | New Status |
| ----------- | ---------------- | ---------- |
| CARSESS-01  | Implementing      | ✅ Verified |
| CARSESS-02  | Implementing      | ✅ Verified |
| CARSESS-03  | Implementing      | ❌ Needs Fix (sem teste) |

---

## Iteração 2 (2026-09-21) — PASS ✅

**Diff range**: working tree vs HEAD (209cd08) — mesmos 3 arquivos; nenhuma linha de código de
produção mudou desde a iteração 1. Único adicionado: um teste em
`tests/caracol.integration.test.ts`.

### O que mudou desde a iteração 1

Implementador adicionou o teste faltante:
`'sessão revogada por logout continua inválida mesmo depois de um restart do processo'` em
`tests/caracol.integration.test.ts:248-272`. O teste registra conta, chama `caracol:logout`
(sem ack — aguarda 50ms para o servidor processar, mesmo padrão já usado em
`tests/caracol.integration.test.ts:196`), desconecta o socket, sobe um novo
`CaracolGameManager` via `createHarness(harness.store)` (restart simulado, mesmo `MemoryCaracolStore`),
conecta um novo socket e chama `caracol:resume` com o token antigo.

### Spec-Anchored Acceptance Criteria (atualizado)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| -------------------------- | --------------------- | ----------------------- | ------ |
| CARSESS-01 (P1): sessão emitida sobrevive a restart do processo | `caracol:resume` responde `{ ok: true, accountId, nickname }` da mesma conta | `tests/caracol.integration.test.ts:244-245` — `expect(resumed.ok).toBe(true); if (resumed.ok) expect(resumed.nickname).toBe('Sobrevivente')` | ✅ PASS |
| CARSESS-02 (P1): sessão emitida/revogada guarda só o hash SHA-256 do token | Armazenamento persistente nunca recebe o token em claro | `server/caracol/game.ts:953,956,969-972` (hash SHA-256 antes de qualquer persistência) + `server/caracol/store.ts:248` (coluna `token_hash`) | ✅ PASS (por inspeção de código; nenhum call site passa `sessionToken` bruto ao store) |
| **CARSESS-03 (P2): sessão revogada (logout) continua inválida (`SESSION_EXPIRED`) mesmo após restart** | `caracol:resume` com token revogado responde `ok: false`, `code: 'SESSION_EXPIRED'` | `tests/caracol.integration.test.ts:270-271` — `expect(resumed.ok).toBe(false); if (!resumed.ok) expect(resumed.code).toBe('SESSION_EXPIRED')` — encadeado com `logout(player)` em `:256`, espera de 50ms em `:260`, `player.disconnect()` em `:261`, restart via `createHarness(harness.store)` em `:266` | ✅ PASS — outcome exato bate com o spec (`ok: false`, código exato `SESSION_EXPIRED`), não é uma asserção vaga |

**Status**: ✅ Todos os ACs cobertos, com outcome exato do spec (nenhum spec-precision gap).

### Discrimination Sensor (mutação alvo desta iteração)

Executado em worktree git isolado (`git worktree add /tmp/caracol-sensor-wt HEAD`), com os 3
arquivos do diff working-tree-vs-HEAD copiados por cima (o diff ainda não está commitado) e
`node_modules` symlinkado (não compartilhado por `git worktree`).

- **Baseline (antes da mutação)**: `npx vitest run tests/caracol.integration.test.ts` no worktree
  isolado → 10/10 passed.
- **Mutação aplicada**: `server/caracol/game.ts` (worktree), método `revokeSession()` — removida a
  chamada `await this.store.deleteSession(tokenHash)`, deixando só
  `this.sessions.delete(tokenHash)` em memória (mesma mutação pedida no prompt de verificação:
  remoção de side-effect obrigatório).
- **Resultado**: teste `'sessão revogada por logout continua inválida mesmo depois de um restart do
  processo'` (`tests/caracol.integration.test.ts:248`) **FALHOU**:
  `AssertionError: expected true to be false` em `tests/caracol.integration.test.ts:270` (o resume
  pós-restart voltou `ok: true` porque a revogação só existia em memória, perdida no "restart").
  Os outros 9 testes continuaram passando (9 passed, 1 failed).

| Mutation | File:line | Description | Killed? |
| -------- | --------- | ------------ | ------- |
| 1 (nova, iteração 2) | `server/caracol/game.ts:963-964` (no scratch) | Removida `await this.store.deleteSession(tokenHash)` em `revokeSession()`, mantendo só `this.sessions.delete(tokenHash)` em memória | ✅ Killed — `tests/caracol.integration.test.ts:270` falhou (`expected true to be false`) |

**Sensor depth**: lightweight (1 mutação direcionada especificamente ao gap fechado nesta iteração;
as 3 mutações da iteração 1 continuam válidas e não foram re-executadas por não terem mudado).
**Sensor outcome**: 1/1 mutante morto nesta iteração (4/4 no total do ciclo, somando iteração 1).

**Isolamento confirmado**: `git status --porcelain` do working tree real capturado antes
(`/tmp/wt_baseline_before.txt`) e depois (`/tmp/wt_baseline_after.txt`) da criação/remoção do
worktree — `diff` entre os dois arquivos vazio (idênticos). Worktree removido com
`git worktree remove --force`; `git worktree list` confirma que só o worktree principal resta.
Nenhum `git stash` foi usado.

### Gate Check (re-executado)

- **typecheck**: `npm run typecheck` → passou sem erros
- **Escopo**: `npx vitest run tests/caracol.integration.test.ts` → **10 passed**, 0 failed (era 9 na
  iteração 1; +1 novo teste de logout+restart)
- **Suíte completa**: `npx vitest run` → **391 passed** (era 390), 2 suites falharam
  (`lafarmer/apps/server/src/index.test.ts`, `lafarmer/apps/server/src/production.test.ts`), ambas
  por `MODULE_NOT_FOUND` (`fastify`, `@lafarmer/content`) — pré-existentes, sem relação com esta
  feature, confirmadas idênticas à iteração 1. Nenhuma outra falha.
- **Test count before feature**: 8 (histórico, antes de qualquer trabalho desta feature)
- **Test count after iteração 1**: 9
- **Test count after iteração 2**: 10
- **Delta desta iteração**: +1 teste (logout + restart)
- **Skipped tests**: nenhum
- **Failures**: nenhuma (fora as 2 pré-existentes do lafarmer, ignoradas conforme instrução)

### Code Quality

| Principle        | Status |
| ---------------- | ------ |
| Minimum code     | ✅ Única mudança desde a iteração 1: 1 teste novo (25 linhas), nada em código de produção |
| Surgical changes | ✅ Nenhum arquivo de produção tocado; só `tests/caracol.integration.test.ts` |
| No scope creep   | ✅ Teste cobre exatamente o gap apontado (CARSESS-03), nada além disso |
| Matches patterns | ✅ Segue o padrão já usado no arquivo (helper `logout()`, espera de 50ms sem ack, `createHarness(store)` para restart) |
| Spec-anchored outcome check (asserted values match spec) | ✅ 3/3 ACs com outcome exato do spec |
| Per-layer Coverage Expectation met | ✅ CARSESS-01/02/03 têm cobertura 1:1; edge case de duas sessões coexistindo segue sem teste dedicado (ver nota abaixo, não bloqueante) |
| Every test maps to a spec requirement - no unclaimed tests | ✅ Teste novo mapeia diretamente a CARSESS-03 |
| Documented guidelines followed | none - strong defaults applied |

### Edge Cases

- [x] "IF o token não existe em nenhuma sessão... THEN SESSION_EXPIRED" — comportamento
  pré-existente, não alterado por esta feature; fora de escopo (spec já rotula como "não alterado").
- [ ] "WHEN duas sessões diferentes (dois logins) da mesma conta coexistem THEN ambas SHALL
  continuar válidas depois de um restart" — ainda **não testado** diretamente. Risco baixo (a
  estrutura de dados é indexada por `tokenHash`, não por conta), não é uma AC de P1/P2 obrigatória
  isolada — é mencionado como edge case no spec, não como critério com "Independent Test" próprio.
  Não bloqueante para o veredito desta feature (P1 e P2 estão cobertos); registrado como melhoria
  opcional, não como gap desta validação.

### Fix Plans

Nenhum fix pendente. O único gap da iteração 1 (CARSESS-03 sem teste) foi fechado com evidência
`file:line` + outcome exato. A observação sobre "duas sessões coexistindo" é um nice-to-have,
não um requisito do spec com veredito de teste obrigatório (spec não define um "Independent Test"
próprio para esse edge case, ao contrário de CARSESS-01/02/03).

### Requirement Traceability Update (final)

| Requirement | Previous Status | New Status |
| ----------- | ---------------- | ---------- |
| CARSESS-01  | Implementing      | ✅ Verified |
| CARSESS-02  | Implementing      | ✅ Verified |
| CARSESS-03  | ❌ Needs Fix      | ✅ Verified |

### Veredito Iteração 2

## Validation: caracol-sessao-persistente - PASS ✅

**Overall**: ✅ Ready

**Spec-anchored check**: 3/3 ACs cobertas com evidência exata do spec (CARSESS-01, CARSESS-02,
CARSESS-03); 0 gaps.
**Sensor**: 4/4 mutações mortas no ciclo completo (3 na iteração 1 + 1 nova na iteração 2, alvo
específico de `revokeSession`/persistência da revogação).
**Gate**: typecheck limpo; 10/10 testes do escopo passaram (+1 desde a iteração 1); suíte completa
391 passed / 2 falhas pré-existentes e não relacionadas (lafarmer, sem `node_modules` própria).

**What works**: Persistência de sessão (P1) e revogação persistente (P2) estão ambas sólidas e
com evidência de teste precisa. O teste novo de logout+restart mata a mutação que remove a
chamada `store.deleteSession()`, provando que ele realmente cobre a persistência da revogação
(não apenas o comportamento em memória).

**Issues found**: nenhum.

**Next steps**: Nenhum. Feature pronta para ser marcada como concluída — atualizar
`spec.md` Requirement Traceability (CARSESS-03 → Verified), o que este relatório já reflete.
