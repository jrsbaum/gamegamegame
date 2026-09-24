# Casa por dentro Tasks

## Execution Protocol

Implement with `tlc-spec-driven`; run each task's gate before marking complete. No push, deployment, or production database action is included.

**Design**: `.specs/features/casa-por-dentro/design.md`
**Status**: In Progress

## Test Coverage Matrix

Guidelines found: root and app `AGENTS.md`, `apps/lafarmer/README.md`, server Vitest configuration and colocated server tests.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Shared home content | unit | Layout boundaries, defaults, collisions, catalog uniqueness | `packages/content/src/*.test.ts` | `npm test --workspace @lafarmer/content` |
| Home domain/service | unit | 1:1 for service ACs; invalid access, edits, interactions, cleanup, retries | `apps/server/src/*.test.ts` | `npm test --workspace @lafarmer/server` |
| WebSocket gateway | integration | Enter/exit/open/closed, house-only delivery, reconnect/disconnect | `apps/server/src/*.test.ts` | `npm test --workspace @lafarmer/server` |
| Phaser/client | build + browser smoke | Typecheck/build and manual visible flows with two clients | `apps/web/src/*.ts` | `npm run build --workspace @lafarmer/web` |
| PostgreSQL schema/adapter | unit/mock | Idempotent ensure, state mapping, update and defaults | `apps/server/src/*.test.ts` | `npm test --workspace @lafarmer/server` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Content/service unit tasks | `npm test --workspace @lafarmer/content` or `npm test --workspace @lafarmer/server` |
| Full | Gateway/domain completion | `npm test --workspace @lafarmer/server` |
| Build | Phase and feature completion | `npm run build; npm test` |

## Execution Plan

### Phase 1: Data and authoritative room behavior

```text
T1 → T2 → T3
```

**T1 — Define shared home map and furniture catalog**
- **Where**: `apps/lafarmer/packages/content/src/home.ts`
- **Depends on**: none
- **Tests**: content unit tests for valid defaults, room boundaries, furniture dimensions/IDs
- **Gate**: `npm test --workspace @lafarmer/content`
- **Done when**: layout, room openings, default furnishings and interaction catalog are exported to server and client; tests pass.

**T2 — Persist and idempotently provision homes**
- **Where**: `apps/lafarmer/apps/server/src/postgres-store.ts`
- **Depends on**: T1
- **Tests**: repository mock tests for default creation, conflict/retry and persisted state mapping
- **Gate**: `npm test --workspace @lafarmer/server`
- **Done when**: schema/adapters store door and furniture and `ensure` returns exactly one home per owner; in-memory and Postgres repositories match.

**T3 — Implement authoritative home actions and room state**
- **Where**: `apps/lafarmer/apps/server/src/home-service.ts`
- **Depends on**: T1, T2
- **Tests**: unit tests for access, door, enter/exit, bounds/collisions, owner-only edits, interaction range, poses, radio no-overlap and disconnect cleanup
- **Gate**: `npm test --workspace @lafarmer/server`
- **Done when**: all HOME-01 through HOME-08, HOME-10 through HOME-17 service behaviors are covered; player economy is unchanged.

### Phase 2: Multiplayer contract and client experience

```text
T4 → T5 → T6
```

**T4 — Route authenticated home messages only to matching occupants**
- **Where**: `apps/lafarmer/apps/server/src/websocket-gateway.ts`
- **Depends on**: T3
- **Tests**: WebSocket integration with multiple authenticated clients, including an unrelated home; open/closed access, isolation, and disconnect/reconnect
- **Gate**: `npm test --workspace @lafarmer/server`
- **Done when**: interior movement, poses and radio reach only same-house occupants; outside movement contract remains functional.

**T5 — Render interior, furniture editing, poses, entry and exit**
- **Where**: `apps/lafarmer/apps/web/src/game.ts`
- **Depends on**: T1, T4
- **Tests**: client build and browser smoke for map/house transitions, owner/visitor controls, mouse/keyboard/touch, layout and collision response
- **Gate**: `npm run build --workspace @lafarmer/web`
- **Done when**: the 2D house has sala/cozinha, bedroom, bathroom and office; owner drag persists; visitors can use stations; door open/close works.

**T6 — Add original radio tune and synchronize local playback**
- **Where**: `apps/lafarmer/apps/web/src/game.ts`
- **Depends on**: T4, T5
- **Tests**: browser smoke for click/E/touch, same-house playback, no overlap, out-of-house silence and blocked-audio fallback
- **Gate**: `npm run build --workspace @lafarmer/web`
- **Done when**: local original short tune plays once for current occupants from the server event and does not block play when unavailable.

### Phase 3: Feature acceptance

```text
T7
```

**T7 — Run full LaFarmer acceptance and record evidence**
- **Where**: `.specs/features/casa-por-dentro/validation.md`
- **Depends on**: T1, T2, T3, T4, T5, T6
- **Tests**: full server/content suite, workspace build, two-client browser acceptance
- **Gate**: `npm run build; npm test` from `apps/lafarmer`
- **Done when**: all HOME requirements are verified, browser and database limitations are stated, and independent validation reports PASS.

## Task Breakdown

### Phase 1: Data and authoritative room behavior

### T1: Define shared home layout and furniture catalog

**What**: Add canonical house dimensions, walls, default furniture and interaction metadata to shared content.
**Where**: `apps/lafarmer/packages/content/src/home.ts`
**Depends on**: None
**Reuses**: `WORLD_TILE_SIZE` conventions.
**Requirement**: HOME-01, HOME-10, HOME-12 through HOME-17
**Tools**: MCP NONE; Skill `tlc-spec-driven`

**Done when**:
- [x] Layout defines 4 domestic zones, entrances, valid cells and furnished defaults.
- [x] Furniture IDs and dimensions are usable by server collision checks and client rendering.
- [x] Content tests cover defaults, boundaries and collisions.
- [x] Gate check passes: `npm test --workspace @lafarmer/content`
- [x] Test count: 3 new tests pass; 6 package tests pass total.

**Tests**: unit — shared content
**Gate**: quick

### T2: Add home persistence contracts and adapters

**What**: Add HomeRecord, HomeRepository, idempotent PostgreSQL schema/operations and in-memory adapter.
**Where**: `apps/lafarmer/apps/server/src/postgres-store.ts`
**Depends on**: T1
**Reuses**: `RepositoryBundle`, JSONB persistence and idempotent schema pattern.
**Requirement**: HOME-01, HOME-02, HOME-05, HOME-06, HOME-10
**Tools**: MCP NONE; Skill `tlc-spec-driven`

**Done when**:
- [x] One persisted home per owner stores region, door and furniture.
- [x] Repeated/concurrent ensure returns existing state without resetting it.
- [x] In-memory and PostgreSQL adapters return equivalent values.
- [x] Repository mock tests pass; server TypeScript build passes.
- [x] Gate check passes: `npm test --workspace @lafarmer/server`
- [x] Test count: 3 new persistence tests pass; 18 server tests pass total.

**Tests**: unit/mock — ensure, mapping, update and conflict
**Gate**: quick

### T3: Implement authoritative home actions and room state

**What**: Add HomeService for provisioning, entry/exit, movement, access, furniture validation, poses, radio and disconnect cleanup.
**Where**: `apps/lafarmer/apps/server/src/home-service.ts`
**Depends on**: T2
**Reuses**: shared layout catalog and `PlayerRepository`.
**Requirement**: HOME-01 through HOME-08, HOME-10 through HOME-17
**Tools**: MCP NONE; Skill `tlc-spec-driven`

**Done when**:
- [x] Owner can enter closed home; visitors can only enter open home at its outdoor door.
- [x] Exit restores the prior exterior; reconnect starts outside the player's own home.
- [x] Actions validate membership, position, object type, bounds and collisions.
- [x] Poses do not affect wallet or production; one radio tune may play per home at a time.
- [x] Unit tests cover service acceptance criteria and edge cases.
- [x] Gate check passes: `npm test --workspace @lafarmer/server`
- [x] Test count: 6 new service tests pass; 24 server tests pass total.

**Tests**: unit — all HomeService branches and listed edge cases
**Gate**: quick

### Phase 2: Multiplayer contract and client experience

### T4: Add room-scoped WebSocket protocol

**What**: Route home messages and broadcasts only to occupants of the matching house.
**Where**: `apps/lafarmer/apps/server/src/websocket-gateway.ts`
**Depends on**: T3
**Reuses**: authenticated socket, serialized per-client queue and world protocol.
**Requirement**: HOME-03, HOME-04, HOME-07, HOME-09, HOME-11, HOME-15, HOME-16
**Tools**: MCP NONE; Skill `tlc-spec-driven`

**Done when**:
- [x] Entry returns a home snapshot and updates occupants of that home.
- [x] Interior movement, poses, furniture and radio never reach other homes/outside.
- [x] Door changes reach same-region outdoor clients without interior positions.
- [x] Disconnect removes the occupant and broadcasts room-scoped leave.
- [x] Multi-client test covers isolation, door access, world-action denial and reconnect.
- [x] Gate check passes: `npm test --workspace @lafarmer/server`
- [x] Test count: 25 server tests pass, including the three-client home integration.

**Tests**: integration — authenticated multi-client protocol
**Gate**: full

### T5: Build the 2D interior and home interactions

**What**: Render rooms, furniture, entry/exit, owner controls, door state and work/rest poses.
**Where**: `apps/lafarmer/apps/web/src/game.ts`
**Depends on**: T4
**Reuses**: `WorldScene`, avatar, camera, pointer, keyboard and touch input.
**Requirement**: HOME-03, HOME-05, HOME-07 through HOME-14
**Tools**: MCP NONE; Skills `frontend-design`, `tlc-spec-driven`

**Done when**:
- [x] 2D house shows sala/cozinha, escritório, quarto and banheiro in current game style.
- [x] Owner drag persists; visitors cannot edit; same-house occupants see the change.
- [x] E, pointer/touch and prompts support entry, exit and station interactions.
- [x] Walls/furniture block movement; outdoor scene restores after exit.
- [x] Gate check passes: `npm run build --workspace @lafarmer/web`
- [ ] Browser smoke covers owner, visitor, editing and door transitions.

**Tests**: build + browser smoke
**Gate**: build

### T6: Add local radio jingle playback

**What**: Add a short original one-shot tune and play it from the room-scoped radio event.
**Where**: `apps/lafarmer/apps/web/src/game.ts`
**Depends on**: T5
**Reuses**: Phaser audio manager and server radio event.
**Requirement**: HOME-15 through HOME-17
**Tools**: MCP NONE; Skill `tlc-spec-driven`

**Done when**:
- [x] Click/E/touch requests playback for that house.
- [x] Each current occupant plays the tune once; outside clients stay silent.
- [x] Clicks during playback do not overlap music.
- [x] Blocked browser audio does not break controls/rendering.
- [x] Gate check passes: `npm run build --workspace @lafarmer/web`
- [ ] Browser smoke covers playback and blocked-audio fallback.

**Tests**: build + browser smoke
**Gate**: build

### Phase 3: Feature acceptance

### T7: Complete feature acceptance and independent verification

**What**: Run full gates and browser acceptance, record evidence and PostgreSQL validation limits.
**Where**: `.specs/features/casa-por-dentro/validation.md`
**Depends on**: T6
**Reuses**: all feature tests and TLC Verifier checklist.
**Requirement**: HOME-01 through HOME-17
**Tools**: MCP CUA browser if available; Skill `tlc-spec-driven`

**Done when**:
- [ ] `npm run build` and `npm test` pass from `apps/lafarmer`.
- [ ] Two-client acceptance covers access, persistence adapter, isolation and radio.
- [ ] Report distinguishes mock/in-memory from real PostgreSQL evidence.
- [ ] Independent verifier returns PASS with implementation/test `file:line` evidence.
- [ ] Gate check passes: `npm run build; npm test`.

**Tests**: full feature suite + browser acceptance
**Gate**: build

## Test Co-location Validation

| Task | Required layer | Co-located coverage |
| --- | --- | --- |
| T1 | Shared content unit | Yes — geometry/catalog tests in content package |
| T2 | Repository/mock unit | Yes — `ensure` and persisted state mapping |
| T3 | Domain/service unit | Yes — all service requirements and listed edge cases |
| T4 | WebSocket integration | Yes — multiple clients and isolation assertions |
| T5 | Client build/browser | Yes — compile plus manual visual flow |
| T6 | Client audio/browser | Yes — all trigger/fallback scenarios |
| T7 | Feature validation | Yes — executes accumulated gates and independent review |

## Dependency Cross-Check

| Task | Dependencies | Diagram path |
| --- | --- | --- |
| T1 | none | start |
| T2 | T1 | T1 → T2 |
| T3 | T1, T2 | T1 → T2 → T3 |
| T4 | T3 | T3 → T4 |
| T5 | T1, T4 | T1 → T4 → T5 |
| T6 | T4, T5 | T4 → T5 → T6 |
| T7 | T1–T6 | all → T7 |
