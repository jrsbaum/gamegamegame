# Vila dos Agentes Connector Onboarding Tasks

## Execution Protocol

One atomic commit per task. Tests derive from the acceptance criteria. Local implementation only; Dokploy promotion remains a separate authorized operation.

## Gate Check Commands

| Gate | Command |
| --- | --- |
| Quick | `npm test --workspace apps/agent-village` |
| Build | `npm run typecheck --workspace apps/agent-village && npm run build --workspace apps/agent-village` |
| Full | `npm test --workspace apps/agent-village && npm run typecheck --workspace apps/agent-village && npm run build --workspace apps/agent-village` |

## Test Coverage Matrix

| Layer | Required test | Location | Gate |
| --- | --- | --- | --- |
| Pairing state/HTTP | integration: expiry, one-use, pending binding and rejection | `apps/agent-village/tests/village.test.mjs`, `http.test.mjs` | Quick |
| Connector | unit: allowlist, merge, lock and malformed config | `apps/agent-village/tests/connector.test.mjs` | Quick |
| Browser wizard | build/typecheck and manual smoke | `apps/agent-village/web/` | Build |
| Documentation/distribution | README and full app build/test | `apps/agent-village/README.md` | Full |

## Execution Plan

```text
T1 → T2 → T3 → T4
```

## Task Breakdown

### T1: Pairing state and pending session binding

**Status**: ✅ Done
**What**: Add persisted one-use pairings, pending robots, exchange endpoint behavior and first-event session binding.
**Where**: `apps/agent-village/server/village.mjs`, `apps/agent-village/server/http.mjs`, existing server tests.
**Depends on**: None.
**Requirement**: CONN-02, CONN-04, CONN-06, CONN-07, CONN-08.
**Tests**: village/http integration for expiry, one-use, invalid ownership, pending transition and provider/session mismatch.
**Gate**: Quick.

### T2: Real local collector and shell installers

**What**: Serve PowerShell/POSIX wrappers, Node installer, privacy allowlist collector, atomic sequence lock, hook merge and uninstall metadata.
**Where**: `apps/agent-village/server/connector.mjs`, `apps/agent-village/server/http.mjs`, `apps/agent-village/tests/connector.test.mjs`.
**Depends on**: T1.
**Requirement**: CONN-05, CONN-10, CONN-11, CONN-12.
**Tests**: connector unit tests for sanitized payloads, hook preservation, duplicate prevention, malformed JSON refusal and one-use exchange.
**Gate**: Quick.

### T3: Provider/shell onboarding wizard

**What**: Replace manual session ID form with provider, label and shell wizard; display command, expiry, copy action and connection states.
**Where**: `apps/agent-village/web/main.ts`, `apps/agent-village/web/types.ts`, `apps/agent-village/web/styles.css`.
**Depends on**: T2.
**Requirement**: CONN-01, CONN-03, CONN-09.
**Tests**: typecheck/build plus browser smoke of provider/shell selection and command copy fallback.
**Gate**: Build.

### T4: Documentation, regression and validation

**What**: Document local auth boundary, install/uninstall commands, privacy payload and HML validation; run full gates and independent verification.
**Where**: `apps/agent-village/README.md`, `.specs/features/agent-village-connector/`.
**Depends on**: T3.
**Requirement**: all.
**Tests**: Full gate, focused connector tests and fresh-eyes validation report.
**Gate**: Full.

## Traceability

| Requirement | Task |
| --- | --- |
| CONN-01 | T3 |
| CONN-02 | T1 |
| CONN-03 | T3 |
| CONN-04 | T1 |
| CONN-05 | T2 |
| CONN-06 | T1 |
| CONN-07 | T1 |
| CONN-08 | T1 |
| CONN-09 | T3 |
| CONN-10 | T2 |
| CONN-11 | T2 |
| CONN-12 | T2 |
