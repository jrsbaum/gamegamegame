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
});
