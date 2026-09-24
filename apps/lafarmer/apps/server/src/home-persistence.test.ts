import { describe, expect, it, vi } from "vitest";
import { createDefaultHomeFurniture } from "@lafarmer/content";
import { createInMemoryRepositories } from "./in-memory-store.js";
import { createPostgresRepositories, initializePostgresSchema } from "./postgres-store.js";
import type { HomeRecord } from "./domain.js";
import type { Pool } from "pg";

const now = 1_790_000_000_000;
const home = (overrides: Partial<HomeRecord> = {}): HomeRecord => ({
  ownerId: "owner-1", regionId: "region-center", doorOpen: true, furniture: createDefaultHomeFurniture(), updatedAt: now, ...overrides
});

describe("home persistence", () => {
  it("creates a default home once and retains edited layout and door state", async () => {
    const repository = createInMemoryRepositories().homes;
    const created = await repository.ensure(home());
    const saved = { ...created, doorOpen: false, furniture: created.furniture.map((item) => item.id === "radio" ? { ...item, x: 8 } : item), updatedAt: now + 1 };
    await repository.update(saved);

    const retried = await repository.ensure(home());
    expect(retried).toEqual(saved);
    expect(await repository.findByRegionId("region-center")).toEqual(saved);
    await expect(repository.ensure(home({ regionId: "different-region" }))).rejects.toThrow("home_region_immutable");
  });

  it("uses a non-destructive owner conflict and maps persisted furniture values", async () => {
    const persisted = home({ doorOpen: false, furniture: createDefaultHomeFurniture().map((item) => item.id === "radio" ? { ...item, x: 8 } : item) });
    const row = { owner_id: persisted.ownerId, region_id: persisted.regionId, door_open: persisted.doorOpen, furniture: persisted.furniture, updated_at: new Date(persisted.updatedAt) };
    const query = vi.fn(async (_sql: string) => ({ rows: [row], rowCount: 1 }));
    const repositories = createPostgresRepositories({ query } as unknown as Pool);

    const result = await repositories.homes.ensure(home());

    expect(result).toEqual(persisted);
    expect(query.mock.calls[0][0]).toContain("ON CONFLICT (owner_id) DO UPDATE SET owner_id = EXCLUDED.owner_id");
    expect(query.mock.calls[0][0]).not.toMatch(/DO UPDATE SET (door_open|furniture)/);
  });

  it("initializes the homes table idempotently", async () => {
    const query = vi.fn(async (_sql: string) => ({ rows: [], rowCount: 0 }));
    await initializePostgresSchema({ query } as unknown as Pool);
    expect(query.mock.calls[0][0]).toContain("CREATE TABLE IF NOT EXISTS homes");
    expect(query.mock.calls[0][0]).toContain("owner_id UUID PRIMARY KEY REFERENCES players(id)");
  });
});
