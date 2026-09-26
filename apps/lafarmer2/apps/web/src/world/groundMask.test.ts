import { describe, expect, it } from "vitest";
import { clearBareSpots, sampleGroundMask, setBareSpots } from "./groundMask";

describe("bare spots", () => {
  it("keeps grass out of a spot until its owner clears it", () => {
    const x = -45;
    const z = -45;
    const before = sampleGroundMask(x, z);
    const away = sampleGroundMask(x + 3, z);
    setBareSpots("tree", [{ x, z, radius: 0.85 }]);
    expect(sampleGroundMask(x, z).bare).toBe(1);
    expect(sampleGroundMask(x, z).tilled).toBe(before.tilled);
    expect(sampleGroundMask(x + 3, z)).toEqual(away);
    clearBareSpots("tree");
    expect(sampleGroundMask(x, z)).toEqual(before);
  });

  it("keeps the spots of other owners when one is cleared", () => {
    setBareSpots("a", [{ x: -30, z: -30, radius: 1 }]);
    setBareSpots("b", [{ x: -30.4, z: -30, radius: 1 }]);
    clearBareSpots("a");
    expect(sampleGroundMask(-30.4, -30).bare).toBe(1);
    clearBareSpots("b");
  });

  it("shows trampled earth only in dirt spots, fading toward their edge", () => {
    const x = -40;
    const z = -20;
    const before = sampleGroundMask(x, z);
    setBareSpots("grass", [{ x, z, radius: 1 }]);
    expect(sampleGroundMask(x, z).path).toBe(before.path);
    clearBareSpots("grass");
    setBareSpots("pen", [{ x, z, radius: 3, dirt: true }]);
    expect(sampleGroundMask(x, z)).toMatchObject({ path: 1, bare: 1 });
    const edge = sampleGroundMask(x + 2.4, z).path;
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(1);
    clearBareSpots("pen");
    expect(sampleGroundMask(x, z)).toEqual(before);
  });
});
