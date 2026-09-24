# Validation: Casa por dentro - FAIL

**Date**: 2026-09-24  
**Spec**: `.specs/features/casa-por-dentro/spec.md`  
**Diff range**: `3ba63ec..9eb458d` (T1–T6 plus follow-up fixes)  
**Verifier**: independent sub-agent (author ≠ verifier)

**Verdict**: FAIL for feature acceptance sign-off: the required browser smoke and live PostgreSQL checks could not be performed. Automated gates and covered server behavior pass.

---

## Task Completion

| Task | Status | Notes |
| --- | --- | --- |
| T1 | ✅ Done | Shared room layout, furniture catalog, geometry tests. |
| T2 | ✅ Done | Memory and PostgreSQL repository adapters; PostgreSQL behavior is mock-tested only. |
| T3 | ✅ Done | Authoritative provisioning, access, movement, furniture, poses and radio throttle. |
| T4 | ✅ Done | Three-client WebSocket coverage for access, room-scoped updates, radio and reconnect. |
| T5 | ⚠️ Partial | Client builds; browser smoke for transitions, controls, layout, collisions and editing was unavailable. |
| T6 | ⚠️ Partial | Audio synthesis and event routing exist; playback and blocked-audio fallback were not browser-tested. |
| T7 | ⚠️ Partial | Build and automated gates pass; no browser smoke or live PostgreSQL run. |

---

## Spec-Anchored Acceptance Criteria

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| Home P1.1: First snapshot provisions a free home with an open door and starter furniture. | One default home exists once a regional player authenticates; no charge. | `apps/lafarmer/apps/server/src/websocket-gateway.ts:44-52` provisions before `hello`; `apps/lafarmer/apps/server/src/home-service.test.ts:43-51` asserts retry equality, open door, furnished defaults, unchanged 1,000 coins. | ✅ PASS |
| Home P1.2: Existing homes are not duplicated or reset. | Retry keeps one owner record and preserves edits/door. | `apps/lafarmer/apps/server/src/home-persistence.test.ts:14-23` asserts retried record equals edited state; `:26-43` asserts non-destructive SQL conflict and unique owner key. | ✅ PASS (adapter/mock; no live DB) |
| Home P1.3: Authorized entry joins that owner's instance and returns a snapshot only to occupants. | Occupants receive the same home snapshot and same-room presence updates. | `apps/lafarmer/apps/server/src/home-service.test.ts:61-62`; `apps/lafarmer/apps/server/src/index.test.ts:221-224`; gateway `apps/lafarmer/apps/server/src/websocket-gateway.ts:110-117`. | ✅ PASS |
| Home P1.4: A closed door denies a visitor without changing state. | Reject with `home_closed`; guard precedes player/session mutation. | `apps/lafarmer/apps/server/src/home-service.test.ts:65-67`; guard at `apps/lafarmer/apps/server/src/home-service.ts:88-100`. | ✅ PASS |
| Home P1.5: Owner door changes persist and block new visitors. | Door state remains closed and visitor entry fails. | `apps/lafarmer/apps/server/src/home-persistence.test.ts:14-23`; `apps/lafarmer/apps/server/src/home-service.test.ts:65-67`; WebSocket closed-door check `apps/lafarmer/apps/server/src/index.test.ts:228-231`. | ✅ PASS (repository/mock; no live DB) |
| Home P1.6: An open home accepts visitors when its owner is offline. | Entry depends on persisted door/region, not owner presence. | `apps/lafarmer/apps/server/src/home-service.test.ts:54-63` creates home, enters guest without entering owner. | ✅ PASS |
| Home P1.7: Exit/disconnect clears occupancy and temporary pose. | Occupant disappears; pose is session-scoped and cleared with the session. | `apps/lafarmer/apps/server/src/home-service.test.ts:136-146` asserts disconnect empties occupants; implementation `apps/lafarmer/apps/server/src/home-service.ts:104-117,197-206` removes session; gateway broadcasts leave at `apps/lafarmer/apps/server/src/websocket-gateway.ts:62-73`. | ✅ PASS |
| Home P1.8: Reconnect returns outside at the player's own home entry. | Reconnected guest's region is its own and position is `(30,47)`. | `apps/lafarmer/apps/server/src/index.test.ts:244-253` asserts own region and exact entry position. | ✅ PASS |
| Home P1.9: Movement/presence is scoped to one house. | Only matching occupants receive interior movement/radio; outside avatar presence excludes occupants. | Room delivery `apps/lafarmer/apps/server/src/websocket-gateway.ts:92-100,143-150`; three-client isolation assertion `apps/lafarmer/apps/server/src/index.test.ts:239-242`; outside presence filtering `apps/lafarmer/apps/server/src/websocket-gateway.ts:211-224`. | ✅ PASS |
| Decor P1.1: Owner can move furniture to a valid location and everyone in the house sees it. | Valid move persists and broadcasts updated home state. | `apps/lafarmer/apps/server/src/home-service.test.ts:100-105`; persistence `apps/lafarmer/apps/server/src/home-service.ts:148-158`; broadcast `apps/lafarmer/apps/server/src/websocket-gateway.ts:138-141`. | ✅ PASS (broadcast path code-reviewed; no explicit multi-client furniture assertion) |
| Decor P1.2: Visitor cannot move furniture. | In-room non-owner receives `not_home_owner`; previous layout remains. | `apps/lafarmer/apps/server/src/home-service.test.ts:86-97` enters guest before expecting `not_home_owner` and checks layout remains unchanged; guard `apps/lafarmer/apps/server/src/home-service.ts:148-155`. | ✅ PASS |
| Decor P1.3: Invalid, colliding or out-of-bounds furniture moves are rejected. | Position remains unchanged after invalid placement. | Content geometry assertions `apps/lafarmer/packages/content/src/home.test.ts:29-38`; service assertion `apps/lafarmer/apps/server/src/home-service.test.ts:90-97`; validation `apps/lafarmer/packages/content/src/home.ts:76-97`. | ✅ PASS |
| Decor P1.4: Desk shows work pose while near the desk; leaving ends it. | Pose becomes `working`, clears after leaving; no economic change. | `apps/lafarmer/apps/server/src/home-service.test.ts:116-133`; server pose lifecycle `apps/lafarmer/apps/server/src/home-service.ts:132-135,183-185`. | ✅ PASS |
| Decor P1.5: Sofa/bed rest pose has no progression/economy effect. | Interaction shows resting pose without coin change. | `apps/lafarmer/apps/server/src/home-service.test.ts:132-133`; furniture interactions `apps/lafarmer/packages/content/src/home.ts:40-52`. | ✅ PASS |
| Decor P1.6: Idle radio starts one original, non-looping home tune for occupants. | One start notifies occupants in the room; tune is short and one-shot. | Throttle result `apps/lafarmer/apps/server/src/home-service.test.ts:136-142`; room broadcast `apps/lafarmer/apps/server/src/websocket-gateway.ts:143-149`; original oscillator melody/boing `apps/lafarmer/apps/web/src/game.ts:471-485`. | ⚠️ Server/event PASS; audible playback not browser-verified |
| Decor P1.7: Radio activation while playing does not overlap. | Further activation is ignored until the current 3-second server window ends. | `apps/lafarmer/apps/server/src/home-service.test.ts:141-142`; server throttle `apps/lafarmer/apps/server/src/home-service.ts:171-180`; client one-shot guard `apps/lafarmer/apps/web/src/game.ts:471-485`. | ✅ PASS for server throttle; audio overlap not browser-verified |
| Decor P1.8: Blocked browser audio does not break other interactions. | Audio can be unavailable while game interactions remain usable. | `apps/lafarmer/apps/web/src/game.ts:464-469` catches audio context errors; `:471-472` silently skips unavailable audio. No automated assertion or browser smoke. | ⚠️ Code path present; behavior unverified |

**Status**: ⚠️ Server and repository behavior has assertion-level evidence; UI/audio browser acceptance remains unverified. The requirement set has no implementation failure after the final authorization test was added.

---

## Discrimination Sensor

| Mutation | File:line | Description | Killed? |
| --- | --- | --- | --- |
| 1 | `apps/lafarmer/apps/server/src/home-service.ts:90` | Reversed the closed-door predicate; visitor access tests failed. | ✅ Killed |
| 2 | `apps/lafarmer/apps/server/src/home-service.ts:151` | Inverted owner-only edit guard; owner furniture tests failed. | ✅ Killed |
| 3 | `apps/lafarmer/apps/server/src/home-service.ts:151` | Removed owner-only edit guard; after the author added an in-room guest assertion, `home-service.test.ts:92` failed with a resolved move instead of `not_home_owner`. | ✅ Killed |

**Sensor depth**: Lightweight (3 targeted behavior mutations)  
**Sensor status**: 3/3 killed - PASS

All mutations ran in detached scratch worktrees. The real tree was clean before each sensor. Windows worktree cleanup left two temporary directories outside the repository: `C:\Users\Usuario\AppData\Local\Temp\lafarmer-casa-verifier-scratch` and `C:\Users\Usuario\AppData\Local\Temp\lafarmer-casa-verifier-scratch2`. The worktree registrations are gone. Cleanup via PowerShell `Remove-Item` was rejected by the execution policy; no application changes from the sensors remain in the repository. The main tree was restored to the clean `9eb458d` commit and confirmed clean.

---

## Interactive UAT Results

| # | Test | Result | Details |
| --- | --- | --- | --- |
| 1 | House entry/exit, layout and owner/visitor controls in browser | ⏭️ Skip | CUA kernel failed to initialize; no visual browser smoke was available. |
| 2 | Two-client audio, no-overlap and blocked-audio fallback | ⏭️ Skip | Requires browser playback; event distribution is covered by server integration only. |
| 3 | Persisted house across a real PostgreSQL restart/reconnect | ⏭️ Skip | PostgreSQL adapter is mock-tested; no live database was used. |

---

## Code Quality

| Principle | Status |
| --- | --- |
| Scope limited to the requested house experience | ✅ |
| Server validates access, position, ownership and furniture geometry | ✅ |
| Room presence and broadcasts remain house-scoped | ✅ |
| Economy and progression stay unchanged by work/rest | ✅ |
| Tests assert expected values and errors for covered service behavior | ✅ |
| Multi-client path covers access, room-scoped radio and reconnect | ✅ |
| Visual/audio user flows verified in browser | ⚠️ Not run |
| Live PostgreSQL persistence verified | ⚠️ Not run |
| Project guidance followed | ✅ `AGENTS.md`, LaFarmer guidance and TLC feature plan |

---

## Edge Cases

- [x] Player without a region does not receive a provisioned home until a region exists (`apps/lafarmer/apps/server/src/home-service.ts:68-70`).
- [x] Open home accepts offline-owner visits (`apps/lafarmer/apps/server/src/home-service.test.ts:54-63`).
- [x] Closed-door visitor rejected; owner may enter (`apps/lafarmer/apps/server/src/home-service.test.ts:65-79`).
- [x] Door/retry path preserves saved furniture and door state in repository tests (`apps/lafarmer/apps/server/src/home-persistence.test.ts:14-43`).
- [x] Invalid and colliding furniture placements are rejected (`apps/lafarmer/packages/content/src/home.test.ts:29-38`).
- [x] Reconnect returns outdoors at own home's entrance (`apps/lafarmer/apps/server/src/index.test.ts:244-253`).
- [x] Room radio and movement are not delivered to outside client (`apps/lafarmer/apps/server/src/index.test.ts:239-242`).
- [ ] Mouse, keyboard and touch visual interaction response: browser smoke unavailable.

---

## Gate Check

- **Gate command**: `npm run build; npm test` from `apps/lafarmer`.
- **Result**: Build passed; tests passed: server 25/25, content 6/6, layout 1/1 (32 total, 0 failed).
- **Test count before feature**: Not independently recorded.
- **Test count after feature**: 32.
- **Delta**: Not stated; baseline count was not captured.
- **Skipped tests**: Browser smoke and live PostgreSQL validation; environment limitations above.
- **Failures**: None in the final build/test gate. Vite reports a non-fatal large-chunk warning (about 1.77 MB minified).
- **Runtime note**: Local Node is v21.7.3; the repo instructions specify Node 22. Build and tests pass on this runtime, but were not repeated under Node 22.

---

## Fix Plans

No surviving code/test mutant or implementation defect remains. Complete a browser smoke when CUA/browser is available, and exercise house provisioning plus door/furniture persistence against a disposable PostgreSQL instance before claiming those runtime behaviors are live-verified.

---

## Requirement Traceability Update

| Requirement | Result |
| --- | --- |
| HOME-01 through HOME-14 | Automated/server/content coverage passes; browser presentation remains unverified for client criteria. |
| HOME-15 through HOME-17 | Server routing/throttle and client audio code present; audible behavior and browser fallback remain unverified. |

---

## Summary

**Overall**: ❌ Not ready for acceptance sign-off — automated gates and server behaviors pass, but required user-facing browser acceptance and real PostgreSQL evidence are missing.  
**Spec-anchored check**: 17/17 criteria traced to implementation/test evidence; three client/audio criteria have code evidence only and need browser verification.  
**Sensor**: 3/3 mutations killed.  
**Gate**: Build passed; 32 tests passed.

**What works**: Idempotent provisioning, owner/visitor access rules, persistence adapters, server-side furniture permissions/placement, room-scoped occupancy and radio events, reconnect fallback, work/rest poses and economy neutrality are covered by passing automated evidence.

**Issues found**: No application-code regression found. Browser smoke and live PostgreSQL verification are outstanding evidence gaps.

**Next steps**: Run the T5/T6 two-client browser smoke and a disposable PostgreSQL persistence/restart check when those environments are available.
