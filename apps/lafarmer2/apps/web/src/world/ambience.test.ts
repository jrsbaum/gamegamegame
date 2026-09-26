import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { LANTERN_SPAN, LANTERN_UPSTREAM, createFireflyHomes, lanternDrift, riverHalfWidth, stepCrownSlots, type CrownSlot } from "./ambience";
import { WATER_LEVEL, createRandom, groundHeight, riverCenterWorld, waterField, worldToTile } from "./height";

const lanterns = Array.from({ length: 16 }, (_, index) => ({
  seed: index / 16,
  across: index % 2 === 0 ? -0.42 : 0.42,
  speed: 0.5 + (index % 5) * 0.08,
  phase: index * 1.3
}));

describe("lanternDrift", () => {
  it("keeps every lantern on the water, bridge rows and valley ends included", () => {
    const out = new THREE.Vector4();
    for (const focusZ of [-260, -120, -40, 0, 45, 88, 150, 300]) {
      for (let time = 0; time < 600; time += 7.3) {
        for (const lantern of lanterns) {
          lanternDrift(lantern, time, focusZ, out);
          const tile = worldToTile(out.x, out.z);
          expect(waterField(tile.x, tile.y)).toBeGreaterThan(0.5);
          expect(out.y).toBe(WATER_LEVEL);
        }
      }
    }
  });

  it("drifts downstream through a window that starts upstream of the focus", () => {
    const out = new THREE.Vector4();
    const focusZ = 20;
    for (const lantern of lanterns) {
      for (let time = 0; time < 400; time += 3.1) {
        const z = lanternDrift(lantern, time, focusZ, out).z;
        expect(z).toBeGreaterThanOrEqual(focusZ - LANTERN_UPSTREAM);
        expect(z).toBeLessThan(focusZ - LANTERN_UPSTREAM + LANTERN_SPAN);
        expect(out.w).toBeGreaterThanOrEqual(0);
        expect(out.w).toBeLessThanOrEqual(1);
        const later = lanternDrift(lantern, time + 0.5, focusZ, out);
        if (later.z > z) expect(later.z - z).toBeCloseTo(lantern.speed * 0.5, 5);
        else expect(later.w).toBeLessThan(0.05);
      }
    }
  });

  it("fades lanterns out at both ends of the window and shows them near the focus", () => {
    const out = new THREE.Vector4();
    const lantern = { seed: 0, across: 0, speed: 1, phase: 0 };
    const focusZ = 0;
    const timeAtOffset = (offset: number): number => offset - LANTERN_UPSTREAM + LANTERN_SPAN;
    expect(lanternDrift(lantern, timeAtOffset(0.2), focusZ, out).w).toBeLessThan(0.01);
    expect(lanternDrift(lantern, timeAtOffset(LANTERN_SPAN - 0.2), focusZ, out).w).toBeLessThan(0.01);
    expect(lanternDrift(lantern, timeAtOffset(LANTERN_UPSTREAM), focusZ, out).w).toBe(1);
    expect(out.z).toBeCloseTo(focusZ, 9);
    expect(Math.abs(out.x - riverCenterWorld(focusZ))).toBeLessThanOrEqual(0.3);
  });
});

describe("riverHalfWidth", () => {
  it("matches the water that is actually drawn", () => {
    for (let z = -300; z <= 300; z += 13) {
      const half = riverHalfWidth(z);
      const centre = riverCenterWorld(z);
      const inside = worldToTile(centre + half * 0.5, z);
      const outside = worldToTile(centre + half + 6, z);
      expect(waterField(inside.x, inside.y)).toBeGreaterThan(0.5);
      expect(waterField(outside.x, outside.y)).toBeLessThan(0.5);
    }
  });
});

describe("stepCrownSlots", () => {
  it("fills empty slots with distinct wanted crowns and fades them in", () => {
    const slots: CrownSlot[] = [{ crown: -1, fade: 0 }, { crown: -1, fade: 0 }];
    stepCrownSlots(slots, [4, 7], 0.1, 1);
    expect(slots.map((slot) => slot.crown).sort()).toEqual([4, 7]);
    for (let step = 0; step < 20; step += 1) stepCrownSlots(slots, [4, 7], 0.1, 1);
    expect(slots.every((slot) => slot.fade === 1)).toBe(true);
  });

  it("fades a crown that is no longer wanted out before handing its slot to another tree", () => {
    const slots: CrownSlot[] = [{ crown: 4, fade: 1 }, { crown: 7, fade: 1 }];
    stepCrownSlots(slots, [7, 9], 0.25, 1);
    expect(slots[0]).toEqual({ crown: 4, fade: 0.75 });
    expect(slots[1]).toEqual({ crown: 7, fade: 1 });
    for (let step = 0; step < 2; step += 1) stepCrownSlots(slots, [7, 9], 0.25, 1);
    expect(slots[0]).toEqual({ crown: 4, fade: 0.25 });
    stepCrownSlots(slots, [7, 9], 0.25, 1);
    expect(slots[0]).toEqual({ crown: 9, fade: 0 });
    stepCrownSlots(slots, [7, 9], 0.25, 1);
    expect(slots[0].fade).toBeCloseTo(0.25, 10);
  });

  it("never gives one crown to two slots and empties slots nobody needs", () => {
    const slots: CrownSlot[] = [{ crown: 2, fade: 0.1 }, { crown: -1, fade: 0 }, { crown: 5, fade: 0 }];
    for (let step = 0; step < 10; step += 1) stepCrownSlots(slots, [2], 0.2, 1);
    expect(slots.filter((slot) => slot.crown === 2)).toHaveLength(1);
    expect(slots.filter((slot) => slot.crown === -1)).toHaveLength(2);
  });
});

describe("createFireflyHomes", () => {
  it("hovers low over the ground or the water, crowded along the river", () => {
    const homes = createFireflyHomes(600, createRandom(7));
    expect(homes.length % 4).toBe(0);
    const count = homes.length / 4;
    expect(count).toBeGreaterThan(500);
    let nearRiver = 0;
    for (let index = 0; index < count; index += 1) {
      const x = homes[index * 4];
      const y = homes[index * 4 + 1];
      const z = homes[index * 4 + 2];
      const floor = Math.max(groundHeight(x, z), WATER_LEVEL);
      expect(y - floor).toBeGreaterThanOrEqual(0.4);
      expect(y - floor).toBeLessThanOrEqual(2.3);
      expect(homes[index * 4 + 3]).toBeGreaterThanOrEqual(0);
      expect(homes[index * 4 + 3]).toBeLessThan(1);
      if (Math.abs(x - riverCenterWorld(z)) - riverHalfWidth(z) < 16) nearRiver += 1;
    }
    expect(nearRiver / count).toBeGreaterThan(0.4);
  });
});
