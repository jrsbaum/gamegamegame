import { describe, expect, it } from "vitest";
import { CONTENT_CATALOG, getContentDefinition, STARTING_COINS } from "./index.js";

describe("content catalog", () => {
  it("contains the MVP content families", () => {
    expect(CONTENT_CATALOG.map((item) => item.id)).toEqual([
      "tomato",
      "orange-tree",
      "cow",
      "dinosaur"
    ]);
  });

  it("keeps growth visuals data-driven", () => {
    expect(getContentDefinition("dinosaur")?.stages.map((stage) => stage.visualKey)).toEqual([
      "dinosaur-fossil",
      "dinosaur-egg",
      "dinosaur-hatchling",
      "dinosaur-adult"
    ]);
    expect(STARTING_COINS).toBe(1_000);
  });
});
