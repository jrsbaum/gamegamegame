# Vila dos Agentes Validation

**Date**: 2026-10-04  
**Spec**: `.specs/features/agent-village/spec.md`  
**Diff range**: `47d1237..f2f85a6`  
**Verifier**: independent fresh-eyes pass (author ≠ verifier)

## Validation: Vila dos Agentes - PASS ✅

## Task Completion

| Task | Status | Evidence |
| --- | --- | --- |
| T1 | ✅ Done | `apps/agent-village/tests/foundation.test.mjs:5-8`; build/typecheck gate passed |
| T2 | ✅ Done | `apps/agent-village/tests/events.test.mjs:8-81`; reducer and adapter tests passed |
| T3 | ✅ Done | `apps/agent-village/tests/village.test.mjs:21-156`; store, ownership and persistence tests passed |
| T4 | ✅ Done | `apps/agent-village/tests/http.test.mjs:32-113`; HTTP, origin, cookie, rate-limit and proxy tests passed |
| T5 | ✅ Done | `apps/agent-village/web/main.ts:17-37,141-149`; `apps/agent-village/web/world.ts:101-174`; Vite build passed and the task record contains the coordinator's Chrome QA |
| T6 | ✅ Done | `packages/game-catalog/src/index.test.ts:6-34`; `apps/lobby/src/LobbyApp.test.tsx:6-34`; catalog and lobby tests/build passed |
| T7 | ✅ Done | `infra/dokploy/agent-village/docker-compose.yml:1-40`; `docker-compose.staging.yml:1-40`; both Compose configs and Docker build passed |

## Spec-Anchored Acceptance Criteria

| Criterion | Spec-defined outcome | `file:line` + assertion or implementation evidence | Result |
| --- | --- | --- | --- |
| WORLD-01 | Three.js garden/office, three fictional residents and five simulated robots | `apps/agent-village/tests/http.test.mjs:34-42` asserts demo health, residents, five robots and `simulated`; `apps/agent-village/web/main.ts:20-27` defines both views and simulation label; `apps/agent-village/web/world.ts:116-128` builds entry, garden, desks, residents and robots | ✅ PASS |
| WORLD-02 | Selection shows owner/provider/status and only authorized title/description | `apps/agent-village/web/main.ts:53-64` renders selected member/robot from projected fields; `apps/agent-village/tests/village.test.mjs:67-76` asserts none/title/description projections | ✅ PASS |
| WORLD-03 | Desk accepts only small/medium/large and persists | `apps/agent-village/tests/village.test.mjs:45-47,108-120` asserts valid desk, invalid `giant`, restart persistence and offline transition | ✅ PASS |
| WORLD-04 | WebGL fallback keeps list, selection, login and controls usable | `apps/agent-village/web/main.ts:89-99,141-145` keeps account/list controls in HTML and inserts a fallback message when renderer creation fails; `apps/agent-village/web/styles.css:8` styles fallback | ✅ PASS |
| WORLD-05 | Reduced motion disables continuous robot animation | `apps/agent-village/web/world.ts:22,163-175` checks `prefers-reduced-motion` and only installs animation loop when it does not match; `apps/agent-village/web/styles.css:8` disables CSS motion | ✅ PASS |
| AUTH-01 | Valid invite/fields create isolated account, medium desk and strict 30-day HttpOnly cookie | `apps/agent-village/tests/village.test.mjs:26-28` asserts medium desk, expiry and authentication; `apps/agent-village/tests/http.test.mjs:54-59` asserts 201, HttpOnly, SameSite=Strict, Max-Age and Secure | ✅ PASS |
| AUTH-02 | Invalid invite/credential returns 403/401 without state | `apps/agent-village/tests/http.test.mjs:49-52,60` asserts unauthenticated 401, bad invite 403 and wrong password 401; `apps/agent-village/tests/village.test.mjs:23,32` covers invalid invite/password | ✅ PASS |
| AUTH-03 | Login authenticates the service account and logout revokes that session | `apps/agent-village/tests/village.test.mjs:34-38` asserts login account identity and expiry/revocation; `apps/agent-village/tests/http.test.mjs:61-63` asserts logout then 401 and subsequent login | ✅ PASS |
| AUTH-04 | Cross-owner edits/delete/token rotation return 404 without mutation | `apps/agent-village/tests/http.test.mjs:69-73` asserts 404 for all cross-owner mutations; `apps/agent-village/tests/village.test.mjs:53-58` asserts ownership and unchanged privacy | ✅ PASS |
| AUTH-05 | Foreign Origin is 403 and more than 20 auth attempts per IP is 429 | `apps/agent-village/tests/http.test.mjs:51-52,94-102` asserts Origin 403, invalid body handling and 429; `apps/agent-village/tests/http.test.mjs:105-113` asserts forwarded IP is honored only with trusted proxy | ✅ PASS |
| ROBOT-01 | Valid provider/session creates idle robot with one-time 64-char token; duplicate and 13th robot are rejected | `apps/agent-village/tests/village.test.mjs:48-56,139-149` asserts default none/idle, token length, duplicate 409 and 12-robot/account limits | ✅ PASS |
| ROBOT-02 | Only matching bearer token and session can ingest events; browser/revoked/other sessions fail | `apps/agent-village/tests/village.test.mjs:79-93` asserts bad token 401, wrong session 400 and accepted matching event; `apps/agent-village/tests/http.test.mjs:75-78` asserts browser 401 and forged/session mismatch 400 | ✅ PASS |
| ROBOT-03 | Older sequence is accepted=false; concurrent tools remain active until the last one ends | `apps/agent-village/tests/events.test.mjs:18-33` asserts two tools, tool state after first completion, working after last and terminal rejection; `apps/agent-village/tests/village.test.mjs:89-90` asserts sequence ordering | ✅ PASS |
| ROBOT-04 | Public allowlist omits sessionId/runId/tools/raw events/tokens and applies privacy projection | `apps/agent-village/tests/events.test.mjs:8-15` exact-deep-equals allowlist for all modes; `apps/agent-village/tests/village.test.mjs:61-68` asserts exact keys and no private session; `apps/agent-village/tests/http.test.mjs:80` asserts no session, title/description secrets, token or connectorHash | ✅ PASS |
| ROBOT-05 | Privacy is exactly none/title/description; invalid value is 400 | `apps/agent-village/tests/village.test.mjs:57-58,69-76` asserts invalid privacy 400 and exact title/description visibility; `apps/agent-village/tests/http.test.mjs:81-86` asserts wire projection | ✅ PASS |
| ROBOT-06 | Collector works while owner is offline; owner presence expires after 20 seconds | `apps/agent-village/tests/village.test.mjs:85-93` asserts offline owner, accepted collector event and independent robot state; `apps/agent-village/server/village.mjs:178-185` computes 20-second presence | ✅ PASS |
| ROBOT-07 | Rotated/deleted token returns 401 and current token is scoped to its robot | `apps/agent-village/tests/village.test.mjs:96-105` and `apps/agent-village/tests/http.test.mjs:88-91` assert old/deleted tokens fail and rotated token succeeds | ✅ PASS |
| ROBOT-08 | Accepted reading/tool/waiting/completed/interrupted/error events map to exact states | `apps/agent-village/tests/events.test.mjs:44-57,61-81` asserts reading, waiting, resume and all terminal states plus provider mapping | ✅ PASS |
| OPS-01 | Atomic persisted state survives restart; active robots become offline; failed writes preserve prior state | `apps/agent-village/tests/village.test.mjs:108-123` asserts restart, credentials, desk/privacy, offline and no prompt/token in file; `apps/agent-village/tests/village.test.mjs:126-136` asserts rollback and serialized concurrent mutations | ✅ PASS |
| OPS-02 | `/healthz` returns service identity and production serves same-origin client/API | `apps/agent-village/tests/http.test.mjs:34-35` asserts exact health JSON and `/`; `apps/agent-village/tests/foundation.test.mjs:5-8` asserts Node 22/build contract; `apps/agent-village/README.md:15` documents gates and same-origin server | ✅ PASS |
| OPS-03 | Node 22, one replica, dedicated external volume, dokploy-network, TLS and exclusive production/HML routers and volumes | `infra/dokploy/agent-village/docker-compose.yml:1-40` and `docker-compose.staging.yml:1-40` show environment-specific names, origins, routers, volumes, TLS, network and replicas; structural Compose assertions passed with synthetic CI values | ✅ PASS |
| OPS-04 | Lobby/catalog expose production and HML canonical links | `packages/game-catalog/src/index.test.ts:6-16,23-34` asserts six IDs, canonical agent domain and navigation; `apps/lobby/src/LobbyApp.test.tsx:24-34` asserts HML mapping | ✅ PASS |
| OPS-05 | Documentation covers dev/test/build, collector protocol, observation limits, backup and staging→main promotion | `apps/agent-village/README.md:5-31` and `infra/dokploy/agent-village/README.md:3-35` document these operational items | ✅ PASS |
| EDGE-01 | Invalid JSON is 400 and body over 32 KiB is 413 without reflection | `apps/agent-village/tests/http.test.mjs:94-102` asserts 400, 413 and absent password reflection | ✅ PASS |
| EDGE-02 | Oversized title/description/ID/control text/unknown fields return 400 | `apps/agent-village/tests/village.test.mjs:139-143` asserts all bounds/controls/unknown-field cases; `apps/agent-village/tests/http.test.mjs:96-98` asserts malformed/unknown HTTP input | ✅ PASS |
| EDGE-03 | Incompatible prior run is ignored and unknown event is 400 | `apps/agent-village/tests/events.test.mjs:36-41` asserts incompatible/unknown session ignored; `apps/agent-village/tests/http.test.mjs:76-78` asserts unknown session 400 and valid event result | ✅ PASS |
| EDGE-04 | More than 100 accounts or 12 robots returns 409 with no extra resources | `apps/agent-village/tests/village.test.mjs:145-149` asserts 12 robots, thirteenth 409, unchanged count and account cap 409 | ✅ PASS |
| EDGE-05 | Corrupt file prevents startup and is not replaced | `apps/agent-village/tests/village.test.mjs:152-156` asserts startup rejection and exact `{broken}` file contents | ✅ PASS |

**Spec-anchored check**: 28/28 criteria matched their specified outcome; no spec-precision gaps found.

## Discrimination Sensor

The real-tree porcelain baseline contained only the pre-existing LaFarmer2, `.notebook`, `.specs/LESSONS.md`, `.specs/lessons.json` and `.agents/skills/` changes. All mutations ran in `C:\Users\Usuario\AppData\Local\Temp\agent-village-sensor-6b0329f9414540babc91f29b497a3538`, which was deleted after each run; the baseline was identical afterward.

| Mutation | Scratch target | Description | Killed? |
| --- | --- | --- | --- |
| 1 | `server/events.mjs:publicRobot` | Added `sessionId` to public output | ✅ Killed by exact allowlist, demo and village snapshot tests |
| 2 | `server/events.mjs:publicRobot` | Added `runId`, `tools`, `rawEvent`, `token` and `connectorHash` | ✅ Killed by exact key and secret absence assertions |
| 3 | `server/events.mjs:normalizeEvent` | Returned raw provider event as `raw` | ✅ Killed by raw secret discard assertion at `tests/events.test.mjs:74-77` |
| 4 | `server/village.mjs:ownerRobot` | Removed `r.ownerId === ownerId` ownership predicate | ✅ Killed by cross-owner HTTP/store tests at `tests/http.test.mjs:71` and `tests/village.test.mjs:53` |
| 5 | `server/http.mjs:createVillageServer` | Used forwarded IP even when `trustProxy` was false | ✅ Killed by direct/proxied distinction at `tests/http.test.mjs:105-113` |

**Sensor depth**: P1/full manual fault injection for privacy, auth isolation and proxy trust.  
**Result**: 5/5 killed - PASS ✅.

## Edge Cases

- [x] EDGE-01 invalid/oversized HTTP body
- [x] EDGE-02 bounds, controls and unknown fields
- [x] EDGE-03 incompatible run/session and unknown event
- [x] EDGE-04 account and robot limits
- [x] EDGE-05 corrupt persisted file

## Gate Check

| Gate | Result |
| --- | --- |
| `npm run build --workspace apps/agent-village` | PASS; typecheck/node checks and Vite production build |
| `npm test --workspace apps/agent-village` | PASS; 20/20 tests |
| `npm test --workspace apps/lobby` | PASS; 4/4 tests |
| `npm run build --workspace apps/lobby` | PASS; TypeScript and Vite production build |
| `npx vitest run packages/game-catalog/src/index.test.ts` | PASS; 3/3 tests |
| `docker compose ... config --quiet` (production + staging, synthetic CI values) | PASS |
| Docker build `infra/docker/agent-village.Dockerfile` | PASS; `node:22-alpine`, image `gamegamegame-agent-village:ci` |
| `validate_spec.py` | PASS; 0 errors, 0 warnings |
| `validate_tasks.py` | PASS; 0 errors, 2 informational warnings for config tasks with no tests |

The direct `npm test --workspace packages/game-catalog` command is unavailable because that package intentionally has no `test` script; its three Vitest tests were run explicitly through the root's installed Vitest binary and passed.

**Test count before feature**: 0 app tests because `apps/agent-village` did not exist at the feature base (`47d1237`).  
**Test count after feature**: 20 app tests, 3 catalog tests and 4 lobby tests.  
**Skipped tests**: none in executed suites.  
**Failures**: none in required gates.

## Code Quality

| Principle | Status |
| --- | --- |
| No feature scope creep | ✅ |
| Surgical changes | ✅; feature commits are isolated from pre-existing LaFarmer2/notebook/lessons edits |
| Matches project patterns | ✅; app owns its server, client, auth and data file |
| Spec-anchored assertions | ✅; every criterion above cites an assertion or directly observable implementation contract |
| Per-layer coverage | ✅; reducer, store, HTTP, browser source, catalog/lobby and Compose were checked |
| No unclaimed feature tests | ✅; test names map to requirements or edge cases |
| Guidelines followed | ✅; root `AGENTS.md`, `apps/agent-village/AGENTS.md` and `.agents/skills/tlc-spec-driven/SKILL.md` |

## Requirement Traceability Update

All 28 requirement rows in `.specs/features/agent-village/spec.md` were updated from `Pending` to `✅ Verified` after the evidence pass.

## Summary

**Overall**: ✅ Ready  
**Spec-anchored check**: 28/28 ACs matched spec outcome  
**Sensor**: 5/5 mutations killed  
**Gate**: all required application, lobby/catalog, Compose, Docker and validator gates passed.

The implementation is ready for the next authorized staging workflow. Production deployment and remote promotion remain outside this local validation scope.
