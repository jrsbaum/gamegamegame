import { describe, expect, it } from "vitest";
import { bladeTuft } from "./grass";
import { createRng } from "./foliage";

const atCrest = (position: { count: number; getY: (index: number) => number }): number => {
  let crest = 0;
  for (let index = 0; index < position.count; index += 1) crest = Math.max(crest, position.getY(index));
  let count = 0;
  for (let index = 0; index < position.count; index += 1) if (position.getY(index) > crest - 1e-4) count += 1;
  return count;
};

const tipGap = (position: { count: number; getX: (index: number) => number; getZ: (index: number) => number }): number => {
  const last = position.count - 1;
  return Math.hypot(position.getX(last) - position.getX(last - 1), position.getZ(last) - position.getZ(last - 1));
};

describe("bladeTuft", () => {
  it("ends a reed in a single point", () => {
    const geometry = bladeTuft(1, createRng(1), 1, 1, 0, 2);
    const position = geometry.getAttribute("position");
    expect(position.count).toBe(5);
    expect(atCrest(position)).toBe(1);
    geometry.dispose();
  });

  it("keeps a drooping ribbon when a meadow shape is given", () => {
    const geometry = bladeTuft(1, createRng(1), 1, 1, 0, 3, {
      tipWidth: 0.4,
      droop: 0.5,
      width: [0.1, 0.1],
      height: [1, 1],
      lean: [0, 0]
    });
    const position = geometry.getAttribute("position");
    expect(position.count).toBe(8);
    expect(atCrest(position)).toBe(2);
    expect(tipGap(position)).toBeGreaterThan(0.05);
    expect(position.getY(position.count - 1)).toBeLessThan(0.6);
    geometry.dispose();
  });
});
