import { describe, expect, it } from "vitest";
import { getContentDefinition } from "@lafarmer2/content";
import { cycleProgress, growthProgress } from "./growth";

const tomato = getContentDefinition("tomato")!.stages;
const orange = getContentDefinition("orange-tree")!.stages;
const at = (seconds: number): number => 1_000_000 + seconds * 1000;

describe("growthProgress", () => {
  it("advances through the tomato stages with the fraction inside each one", () => {
    expect(growthProgress(tomato, at(0), at(0))).toEqual({ stage: 0, fraction: 0 });
    expect(growthProgress(tomato, at(0), at(300))).toEqual({ stage: 0, fraction: 0.5 });
    expect(growthProgress(tomato, at(0), at(600))).toEqual({ stage: 1, fraction: 0 });
    expect(growthProgress(tomato, at(0), at(900))).toEqual({ stage: 1, fraction: 0.5 });
    expect(growthProgress(tomato, at(0), at(1200))).toEqual({ stage: 2, fraction: 1 });
    expect(growthProgress(tomato, at(0), at(99_999))).toEqual({ stage: 2, fraction: 1 });
  });

  it("skips zero-length stages like the server, so an orange tree goes from sapling to producing", () => {
    expect(growthProgress(orange, at(0), at(900))).toEqual({ stage: 0, fraction: 0.5 });
    expect(growthProgress(orange, at(0), at(1800))).toEqual({ stage: 2, fraction: 1 });
  });

  it("never runs ahead of or behind the stage the server reported", () => {
    expect(growthProgress(tomato, at(0), at(590), "sprout")).toEqual({ stage: 1, fraction: 0 });
    expect(growthProgress(tomato, at(0), at(610), "soil")).toEqual({ stage: 0, fraction: 1 });
    expect(growthProgress(tomato, at(0), at(100), "ready")).toEqual({ stage: 2, fraction: 1 });
    expect(growthProgress(tomato, at(0), at(300), "unknown")).toEqual({ stage: 0, fraction: 0.5 });
  });

  it("treats a clock behind the planting time as just planted", () => {
    expect(growthProgress(tomato, at(10), at(0))).toEqual({ stage: 0, fraction: 0 });
  });
});

describe("cycleProgress", () => {
  it("measures the time toward the next unit and clamps it", () => {
    expect(cycleProgress(at(1200), 1200, at(0))).toBe(0);
    expect(cycleProgress(at(1200), 1200, at(600))).toBe(0.5);
    expect(cycleProgress(at(1200), 1200, at(5000))).toBe(1);
    expect(cycleProgress(null, 1200, at(0))).toBe(0);
    expect(cycleProgress(at(10), null, at(0))).toBe(0);
  });
});
