# Vila dos Agentes Connector Onboarding Validation

**Date**: 2026-10-05  
**Spec**: `.specs/features/agent-village-connector/spec.md`  
**Diff range**: `f40fd35..e9ec707`  
**Verifier**: fresh independent pass; no production or unrelated files changed by this verification

## Validation: Vila dos Agentes Connector Onboarding — PASS ✅

The current HEAD satisfies the connector acceptance criteria. The four gaps from the previous report are closed: pairing polling refreshes the authenticated projection, generated hooks carry their deduplication marker, persisted pairing removal is asserted, and direct edge tests cover malformed hook containers, network failure and concurrent sequence allocation.

## Task Completion

| Task | Status | Evidence |
| --- | --- | --- |
| T1 | ✅ Done | Pairing creation, expiry, one-use exchange, persisted cleanup and first-session binding pass in `apps/agent-village/tests/village.test.mjs:108-136`. |
| T2 | ✅ Done | Allowlist, hook marker, malformed hook validation, concurrent sequence lock and network failure pass in `apps/agent-village/tests/connector.test.mjs:11-79`; installer merge is `server/connector/install.mjs:13-24`. |
| T3 | ✅ Done | Provider/shell wizard, command copy and polling state are implemented in `apps/agent-village/web/main.ts:97-113,125-130,146-175`; typecheck/build pass. |
| T4 | ✅ Done | README documents install, privacy and uninstall in `apps/agent-village/README.md:19-27`; full gates and this independent report pass. |

## Spec-Anchored Acceptance Criteria

| Requirement | Evidence (`file:line`) | Result |
| --- | --- | --- |
| CONN-01 — authenticated wizard offers Codex/Claude, name and PowerShell/Git Bash/zsh | `apps/agent-village/web/main.ts:110-113`; shell/provider types in `apps/agent-village/web/types.ts:6-8` | ✅ PASS |
| CONN-02 — unique hashed 10-minute pairing, pending robot, no session exposed | `apps/agent-village/server/village.mjs:154-168`; `apps/agent-village/tests/village.test.mjs:108-121` checks code, pending/null session and persisted pairing | ✅ PASS |
| CONN-03 — shell-specific copyable command, expiry and no permanent token | `apps/agent-village/web/main.ts:97-113,148-149`; `apps/agent-village/tests/http.test.mjs:108-122` checks same-origin installer assets contain no secret | ✅ PASS |
| CONN-04 — invalid provider/name/shell/account creates no usable state | `apps/agent-village/server/village.mjs:154-162` validates provider, label, account and limits; `apps/agent-village/server/http.mjs:87-99` enforces route/auth boundary; `apps/agent-village/tests/http.test.mjs:94-99` rejects an unknown shell field and accepts a valid request | ✅ PASS |
| CONN-05 — one-use installer exchange writes local config and merges required hooks preserving existing hooks | `apps/agent-village/server/connector/install.mjs:13-24,27-46` validates before atomic writes and merges; `apps/agent-village/server/connector/logic.mjs:35-55` generates required hooks with stable robot marker; `apps/agent-village/tests/connector.test.mjs:24-35` checks marker/async shape and malformed container rejection | ✅ PASS |
| CONN-06 — reuse returns 410 without second token/change | `apps/agent-village/server/village.mjs:171-194`; `apps/agent-village/tests/village.test.mjs:116-122` and `apps/agent-village/tests/http.test.mjs:103-106` check one-use behavior and persisted removal | ✅ PASS |
| CONN-07 — first valid event binds session and is accepted | `apps/agent-village/server/village.mjs:211-225`; `apps/agent-village/tests/village.test.mjs:123-126` checks accepted event, bound session and later rejection | ✅ PASS |
| CONN-08 — incompatible provider/session is rejected without mutation | `apps/agent-village/server/village.mjs:218-220`; `apps/agent-village/tests/village.test.mjs:125-126` checks incompatible session returns 400 | ✅ PASS |
| CONN-09 — polling transitions pending/installed/connected/error | `apps/agent-village/web/main.ts:103-108,125-130,172-175`; `loadReal()` refreshes `/api/me` while `pairing` exists, so `pairingStatus()` sees the post-install robot state | ✅ PASS |
| CONN-10 — collector allowlists provider/session/lifecycle/tool/run/sequence fields | `apps/agent-village/server/connector/logic.mjs:3-32`; `apps/agent-village/tests/connector.test.mjs:11-22` exact-match sanitized Codex/Claude payloads; `collector.mjs:49-55` sends only sequence/event with bearer | ✅ PASS |
| CONN-11 — token, prompt, args, output, response, filename and credential stay out of public/error/persisted data | `apps/agent-village/tests/connector.test.mjs:11-22`; `apps/agent-village/tests/village.test.mjs:149-153`; `apps/agent-village/tests/http.test.mjs:80-86` | ✅ PASS |
| CONN-12 — rotate/remove revokes old token and uninstall path is documented | `apps/agent-village/tests/village.test.mjs:96-105` checks 401 after rotate/delete; `apps/agent-village/README.md:21` documents removing the marked local hook block | ✅ PASS |

**Spec-anchored check**: 12/12 acceptance criteria PASS.

## Discrimination Sensor

Each mutation was applied only to an isolated copy of `apps/agent-village` under `%TEMP%`, tested with the same `npm test` command, and the scratch directories were deleted afterward. The real worktree was not used for mutation and its pre-existing unrelated porcelain was preserved.

| Mutation | Scratch target | Result |
| --- | --- | --- |
| A | `server/village.mjs:192` — remove persisted `state.pairings` filter after exchange | ✅ Killed: 29/30 tests; the pairing test fails because reopened JSON still contains the pairing. |
| B | `server/village.mjs:220` — remove first-event `robot.sessionId = event.sessionId` binding | ✅ Killed: 29/30 tests; `CONN-02/06/07/08` fails on accepted status/session binding. |
| C | `server/connector/logic.mjs:23-25` — include raw Claude event in sanitizer output | ✅ Killed: 29/30 tests; exact allowlist assertion fails. |

**Sensor depth**: 3 targeted mutations; 3/3 killed. The sensor discriminates persisted one-use state, first-session binding and privacy filtering.

## Edge Cases

| Edge case | Evidence | Result |
| --- | --- | --- |
| Expired, used or malformed pairing code | `apps/agent-village/server/village.mjs:171-186`; expiry cleanup test `tests/village.test.mjs:129-136`; exchange routes `tests/http.test.mjs:103-106` | ✅ PASS |
| Invalid hook JSON/container stops before overwrite | `apps/agent-village/server/connector/install.mjs:13-17`; `validateHookConfig` and rejection assertion `tests/connector.test.mjs:33-36` | ✅ PASS |
| Network unavailable fails locally with generic non-sensitive error | `apps/agent-village/server/connector/collector.mjs:44-58`; direct failure test `tests/connector.test.mjs:63-79` | ✅ PASS |
| Concurrent hooks keep strictly increasing sequences | `apps/agent-village/server/connector/collector.mjs:23-41`; 8-process lock test `tests/connector.test.mjs:38-61` | ✅ PASS |
| Restart preserves valid pairing state and drops expired unprovisioned robots | `apps/agent-village/server/village.mjs:41-57,158-168`; persisted state is re-opened and pairing removal is asserted at `tests/village.test.mjs:115-121`; expiry cleanup at `tests/village.test.mjs:129-136` | ✅ PASS |

## Gate Check

| Gate | Result |
| --- | --- |
| `npm test --workspace apps/agent-village` | ✅ PASS — 30/30 tests |
| `npm run typecheck --workspace apps/agent-village` | ✅ PASS |
| `npm run build --workspace apps/agent-village` | ✅ PASS — Vite build; existing chunk-size warning only |
| `python .agents/skills/tlc-spec-driven/scripts/validate_spec.py .specs/features/agent-village-connector/spec.md` | ✅ PASS — 0 errors, 0 warnings |
| `python .agents/skills/tlc-spec-driven/scripts/validate_tasks.py .specs/features/agent-village-connector/tasks.md` | ✅ PASS — 0 errors, 3 non-blocking granularity warnings |
| `python .agents/skills/tlc-spec-driven/scripts/validate_state.py agent-village-connector` | ✅ PASS — 0 errors |

## Code Quality and Scope

- ✅ Production files were not changed by this verification.
- ✅ Existing unrelated changes in LaFarmer2, `.notebook`, `.specs/LESSONS.md`, `.specs/lessons.json`, Compose files, `.agents/skills/` and `cert_hml.pem` were preserved.
- ✅ No token, prompt, raw event, session identifier or secret was added to the report.
- ✅ The report cites implementation and test evidence for every acceptance criterion.

## Summary

**Overall**: ✅ Ready  
**Spec-anchored check**: 12/12 PASS  
**Sensor**: 3/3 mutations killed  
**Gates**: app tests, typecheck, build and structural validators pass.
