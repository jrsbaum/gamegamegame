# LaFarmer Character Movement Specification

## Problem Statement

The character currently moves only in four cardinal directions, and mobile movement uses four separate buttons. Movement also feels slow. Restore a direct mobile movement control, allow diagonal movement, and modestly increase the walking pace while keeping the server authoritative over tile movement and collisions.

## Goals

- [x] Raise normal walking speed from 4 to approximately 4.55 tiles per second.
- [x] Support eight movement directions with the same maximum travel speed in every direction.
- [x] Show a draggable virtual joystick on mobile and stop movement when its pointer is released or cancelled.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Changing sprint speed or controls | The request concerns the normal pace and movement direction. |
| Changing movement persistence or the database schema | Existing server movement remains tile-based. |
| Reproducing the exact old joystick artwork | The old source is absent from the available Git history. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Meaning of "a little faster" | Increase normal pace by about 14%, from 4 to 4.55 tiles per second. | This is a modest, measurable increase using the existing movement cadence. | n |
| Joystick implementation | Use a circular draggable virtual joystick with eight directional sectors; releasing or cancelling the pointer stops movement. | The previous source and artwork are unavailable, while this preserves the requested joystick interaction. | n |
| Diagonal collision | The server blocks diagonal corner-cutting across impassable tiles or structures. | Diagonal movement must keep the server's existing collision authority. | n |

**Open questions:** none - all decisions are recorded as assumptions.

---

## User Stories

### P1: Move around the farm ⭐ MVP

**User Story**: As a LaFarmer player, I want faster eight-direction movement and a mobile joystick so that I can navigate the world comfortably on desktop and touch devices.

**Why P1**: Character movement is the primary way to explore and interact with the world.

**Acceptance Criteria**:

1. WHEN the player walks in a cardinal direction without sprinting THEN the client SHALL move at a maximum of 4.55 tiles per second.
2. WHEN horizontal and vertical input are active together THEN the client and server SHALL move in the resulting diagonal direction at the same maximum vector speed as cardinal movement.
3. IF a diagonal step crosses an impassable tile or structure corner THEN the server SHALL keep the player at the last walkable tile.
4. WHERE the viewport width is at most 760 CSS pixels THEN the client SHALL show a circular virtual joystick and hide the four-button touch control.
5. WHEN the player drags the joystick outside its dead zone THEN the client SHALL select the nearest of eight movement directions.
6. WHEN the active joystick pointer is released, cancelled, or lost THEN the client SHALL reset the joystick to center and stop joystick movement.
7. IF the server receives a direction outside the eight supported directions THEN the server SHALL reject the move without changing the player's position.

**Independent Test**: Move the character on desktop using cardinal and combined keyboard input, then use and release the mobile joystick; confirm pace, normalized diagonals, collision handling, and stop-on-release behavior.

## Edge Cases

- IF a diagonal step would cross the corner of a blocked tile or structure THEN the server SHALL keep the player on the previous safe tile.
- WHEN the joystick pointer is cancelled or lost THEN the client SHALL stop movement immediately.
- IF a malformed movement direction reaches the server THEN the server SHALL leave the player position unchanged.

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| MOVE-01 | P1: Move around the farm | Execute | Verified |
| MOVE-02 | P1: Move around the farm | Execute | Verified |
| MOVE-03 | P1: Move around the farm | Execute | Verified |
| MOVE-04 | P1: Move around the farm | Execute | Verified |
| MOVE-05 | P1: Move around the farm | Execute | Verified |
| MOVE-06 | P1: Move around the farm | Execute | Verified |
| MOVE-07 | P1: Move around the farm | Execute | Verified |

**Coverage**: 7 total, 0 mapped to automated tests, 7 checked by source review and workspace build.

## Success Criteria

- [x] Normal walking speed is 4.55 tiles per second; sprint remains twice normal speed.
- [x] Cardinal and diagonal movement use the same maximum vector speed.
- [x] Mobile users can steer with a circular joystick and movement stops on release or cancellation.
- [x] Server movement rejects invalid directions and prevents diagonal corner-cutting.

**Verification boundary**: `npm run build` passed. Automated tests and browser or physical-mobile interaction were not run.
