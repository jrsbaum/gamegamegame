import { describe, expect, it } from "vitest";
import { BODY_RADIUS, RUN_SPEED, WALK_SPEED, createWalker, facingDirection, placeWalker, stepWalker, tileOf, type Circle, type WalkerWorld } from "./controller";
import { TILE, tileToWorldX, tileToWorldZ } from "./height";
import type { Direction } from "./movement";

const worldWith = (blockedTiles: Array<[number, number]>, circles: Circle[] = []): WalkerWorld => {
  const blocked = new Set(blockedTiles.map(([x, y]) => `${x},${y}`));
  return { blocked: (x, y) => blocked.has(`${x},${y}`), circles };
};

const run = (walker: ReturnType<typeof createWalker>, intent: { x: number; z: number; run: boolean }, seconds: number, world: WalkerWorld): Direction[] => {
  const steps: Direction[] = [];
  for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 60) steps.push(...stepWalker(walker, intent, 1 / 60, world));
  return steps;
};

const at = (tileX: number, tileY: number): ReturnType<typeof createWalker> => createWalker(tileToWorldX(tileX), tileToWorldZ(tileY));

describe("stepWalker", () => {
  it("reaches walking speed and reports each tile it enters", () => {
    const walker = at(20, 20);
    const steps = run(walker, { x: 1, z: 0, run: false }, 2, worldWith([]));
    expect(Math.hypot(walker.vx, walker.vz)).toBeCloseTo(WALK_SPEED, 1);
    expect(steps.every((step) => step === "right")).toBe(true);
    expect(steps.length).toBe(walker.tileX - 20);
    expect(walker.tileX).toBe(tileOf(walker.x, walker.z).x);
    expect(walker.x - tileToWorldX(20)).toBeGreaterThan(WALK_SPEED * 1.7);
  });

  it("runs faster when asked", () => {
    const walker = at(20, 20);
    run(walker, { x: 0, z: -1, run: true }, 1.5, worldWith([]));
    expect(Math.hypot(walker.vx, walker.vz)).toBeCloseTo(RUN_SPEED, 1);
  });

  it("stops against a blocked tile without entering it", () => {
    const world = worldWith([[22, 19], [22, 20], [22, 21]]);
    const walker = at(20, 20);
    const steps = run(walker, { x: 1, z: 0, run: true }, 2, world);
    expect(steps).toEqual(["right"]);
    expect(walker.tileX).toBe(21);
    expect(walker.x).toBeLessThanOrEqual(tileToWorldX(22) - TILE / 2 - BODY_RADIUS + 1e-6);
    expect(walker.vx).toBeCloseTo(0, 3);
  });

  it("slides along a wall when pushing into it at an angle", () => {
    const wall: Array<[number, number]> = Array.from({ length: 12 }, (_, index) => [22, 14 + index]);
    const walker = at(21, 20);
    run(walker, { x: 1, z: 1, run: false }, 1.2, worldWith(wall));
    expect(walker.tileX).toBe(21);
    expect(walker.z - tileToWorldZ(20)).toBeGreaterThan(3);
  });

  it("keeps the body outside trunks and slides around them", () => {
    const trunk = { x: tileToWorldX(21), z: tileToWorldZ(20), radius: 0.5 };
    const walker = at(20, 20);
    walker.z += 0.2;
    run(walker, { x: 1, z: 0, run: false }, 2, worldWith([], [trunk]));
    expect(walker.x).toBeGreaterThan(trunk.x);
    for (let index = 0; index < 50; index += 1) {
      stepWalker(walker, { x: -1, z: 0, run: false }, 1 / 60, worldWith([], [trunk]));
      expect(Math.hypot(walker.x - trunk.x, walker.z - trunk.z)).toBeGreaterThanOrEqual(trunk.radius + BODY_RADIUS - 1e-6);
    }
  });

  it("reports both steps when the centre crosses a tile corner", () => {
    const walker = createWalker(tileToWorldX(20) + TILE / 2 - 0.05, tileToWorldZ(20) + TILE / 2 - 0.05);
    const steps = stepWalker(walker, { x: 1, z: 1, run: true }, 0.05, worldWith([]));
    expect(steps).toEqual(["right", "down"]);
    expect([walker.tileX, walker.tileY]).toEqual([21, 21]);
  });

  it("comes to rest when the input is released", () => {
    const walker = at(20, 20);
    run(walker, { x: 0, z: 1, run: true }, 1, worldWith([]));
    run(walker, { x: 0, z: 0, run: false }, 0.6, worldWith([]));
    expect(walker.vx).toBe(0);
    expect(walker.vz).toBe(0);
  });

  it("never lets the centre into a blocked tile and reports a walkable path", () => {
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const blockedTiles: Array<[number, number]> = [];
    for (let y = 10; y <= 30; y += 1) {
      for (let x = 10; x <= 30; x += 1) {
        const edge = x === 10 || x === 30 || y === 10 || y === 30;
        if (edge || (random() < 0.22 && !(x === 20 && y === 20))) blockedTiles.push([x, y]);
      }
    }
    const world = worldWith(blockedTiles, [{ x: tileToWorldX(18), z: tileToWorldZ(22), radius: 0.6 }]);
    const walker = at(20, 20);
    let tileX = 20;
    let tileY = 20;
    let intent = { x: 1, z: 0, run: false };
    for (let frame = 0; frame < 6000; frame += 1) {
      if (frame % 40 === 0) {
        const angle = random() * Math.PI * 2;
        intent = { x: Math.cos(angle), z: Math.sin(angle), run: random() < 0.5 };
      }
      const steps = stepWalker(walker, intent, random() < 0.05 ? 0.05 : 1 / 60, world);
      for (const step of steps) {
        if (step === "right") tileX += 1;
        if (step === "left") tileX -= 1;
        if (step === "down") tileY += 1;
        if (step === "up") tileY -= 1;
        expect(world.blocked(tileX, tileY)).toBe(false);
      }
      const centre = tileOf(walker.x, walker.z);
      expect(world.blocked(centre.x, centre.y)).toBe(false);
      expect([tileX, tileY]).toEqual([walker.tileX, walker.tileY]);
      expect([centre.x, centre.y]).toEqual([walker.tileX, walker.tileY]);
    }
  });
});

describe("placeWalker and facingDirection", () => {
  it("snaps to a tile centre at rest", () => {
    const walker = at(20, 20);
    run(walker, { x: 1, z: 0, run: true }, 0.5, worldWith([]));
    placeWalker(walker, 33, 12);
    expect([walker.x, walker.z, walker.vx, walker.vz, walker.tileX, walker.tileY]).toEqual([tileToWorldX(33), tileToWorldZ(12), 0, 0, 33, 12]);
  });

  it("maps the heading to the cardinal tile in front", () => {
    const walker = at(20, 20);
    const expectations: Array<[number, Direction]> = [[0, "down"], [Math.PI / 2, "right"], [Math.PI, "up"], [-Math.PI / 2, "left"]];
    for (const [heading, direction] of expectations) {
      walker.heading = heading;
      expect(facingDirection(walker)).toBe(direction);
    }
  });
});
