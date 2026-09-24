import { describe, expect, it } from "vitest";
import { createInMemoryRepositories } from "./in-memory-store.js";
import { HomeService } from "./home-service.js";
import type { PlayerState } from "./domain.js";

const testPlayer = (id: string, regionId: string, x = 30, y = 47): PlayerState => ({
  id, accountId: `account-${id}`, name: id, farmName: `${id} farm`, specialization: "vegetables",
  plot: null, homeRegionId: regionId, currentRegionId: regionId,
  appearance: { clothing: "forest", hair: "short" }, coins: 1_000, inventory: {}, inventoryQualities: {},
  inventoryCapacity: 50, lastActiveAt: 1_790_000_000_000, position: { x, y }
});

async function setup() {
  let now = 1_790_000_000_000;
  const repositories = createInMemoryRepositories();
  await repositories.players.insert(testPlayer("owner", "region-center"));
  await repositories.players.insert(testPlayer("guest", "region-north"));
  const homes = new HomeService(repositories.players, repositories.homes, () => now++);
  return { repositories, homes };
}

async function enterGuestHome(homes: HomeService, repositories: ReturnType<typeof createInMemoryRepositories>) {
  const guest = await repositories.players.findById("guest");
  if (!guest) throw new Error("guest_not_found");
  await repositories.players.update({ ...guest, currentRegionId: "region-center", position: { x: 30, y: 47 } });
  return homes.enter("guest", "region-center");
}

async function moveToRadio(homes: HomeService) {
  homes.move("guest", "left"); homes.move("guest", "left"); // x8,y12
  homes.move("guest", "up"); homes.move("guest", "up"); // x8,y10
  for (let step = 0; step < 2; step += 1) homes.move("guest", "left"); // x6,y10
  homes.move("guest", "up"); homes.move("guest", "up"); // x6,y8
  for (let step = 0; step < 3; step += 1) homes.move("guest", "left"); // x3,y8
  homes.move("guest", "up"); homes.move("guest", "up"); // x3,y6
  for (let step = 0; step < 2; step += 1) homes.move("guest", "right"); // x5,y6
  for (let step = 0; step < 2; step += 1) homes.move("guest", "left"); // x3,y6
  for (let step = 0; step < 4; step += 1) homes.move("guest", "up"); // x3,y2
  homes.move("guest", "right"); // x4, y2, beside radio
}

describe("HomeService", () => {
  it("provisions one free default for new and existing regional profiles", async () => {
    const { repositories, homes } = await setup();
    const first = await homes.ensurePlayerHome("owner");
    const retry = await homes.ensurePlayerHome("owner");
    expect(first).toEqual(retry);
    expect(first?.doorOpen).toBe(true);
    expect(first?.furniture.length).toBeGreaterThan(5);
    expect((await repositories.players.findById("owner"))?.coins).toBe(1_000);
    expect(await repositories.homes.findByRegionId("region-center")).toEqual(first);
  });

  it("allows a visitor into an open offline owner's house but rejects closed, distant or wrong-region entry", async () => {
    const { repositories, homes } = await setup();
    await homes.ensurePlayerHome("owner");
    await expect(homes.enter("guest", "region-center")).rejects.toMatchObject({ code: "not_at_home_door" });
    const guest = await repositories.players.findById("guest");
    if (!guest) throw new Error("guest_not_found");
    await repositories.players.update({ ...guest, currentRegionId: "region-center", position: { x: 30, y: 47 } });
    const entered = await homes.enter("guest", "region-center");
    expect(entered.occupants.map((occupant) => occupant.playerId)).toEqual(["guest"]);
    await homes.exit("guest");

    await homes.setDoor("owner", false);
    await expect(enterGuestHome(homes, repositories)).rejects.toMatchObject({ code: "home_closed" });
    await expect(homes.enter("guest", "region-north")).rejects.toMatchObject({ code: "not_at_home_door" });
  });

  it("lets the owner enter with the door closed and restores the visitor's exterior on exit", async () => {
    const { repositories, homes } = await setup();
    await homes.ensurePlayerHome("owner");
    await homes.setDoor("owner", false);
    const ownHome = await homes.enter("owner", "region-center");
    expect(ownHome.occupants[0].playerId).toBe("owner");
    await homes.exit("owner");

    await expect(enterGuestHome(homes, repositories)).rejects.toMatchObject({ code: "home_closed" });
    await homes.setDoor("owner", true);
    const guestHome = await enterGuestHome(homes, repositories);
    expect(guestHome.occupants.map((occupant) => occupant.playerId)).toContain("guest");
    const exit = await homes.exit("guest");
    expect(exit).toMatchObject({ regionId: "region-center", position: { x: 30, y: 47 } });
  });

  it("keeps movement in bounds and rejects unauthorized or colliding furniture edits", async () => {
    const { repositories, homes } = await setup();
    await homes.ensurePlayerHome("owner");
    await homes.enter("owner", "region-center");
    const before = (await homes.snapshotAsync("owner")).home.furniture.find((item) => item.id === "radio");
    await expect(homes.moveFurniture("guest", "radio", 8, 3)).rejects.toMatchObject({ code: "not_inside_home" });
    await expect(homes.moveFurniture("owner", "radio", 2, 2)).rejects.toMatchObject({ code: "invalid_home_furniture" });
    const moved = await homes.move("owner", "up");
    expect(moved.position).toEqual({ x: 10, y: 11 });
    const blocked = homes.move("owner", "up"); // bed blocks x10,y10
    expect(blocked.position).toEqual({ x: 10, y: 11 });
    expect((await repositories.homes.findByOwnerId("owner"))?.furniture.find((item) => item.id === "radio")).toEqual(before);
  });

  it("persists owner furniture moves and keeps work/rest poses outside the economy", async () => {
    const { repositories, homes } = await setup();
    await homes.ensurePlayerHome("owner");
    await homes.enter("owner", "region-center");
    const changed = await homes.moveFurniture("owner", "radio", 8, 2);
    expect(changed.home.furniture.find((item) => item.id === "radio")).toMatchObject({ x: 8, y: 2 });

    const { repositories: workRepos, homes: workHomes } = await setup();
    await workHomes.ensurePlayerHome("owner");
    await workHomes.enter("owner", "region-center");
    workHomes.move("owner", "left"); workHomes.move("owner", "left"); // x8,y12
    workHomes.move("owner", "up"); workHomes.move("owner", "up"); // x8,y10
    workHomes.move("owner", "left"); workHomes.move("owner", "left"); // x6,y10 through bedroom doorway
    workHomes.move("owner", "up"); workHomes.move("owner", "up"); // x6,y8
    workHomes.move("owner", "left"); workHomes.move("owner", "left"); // x4,y8
    workHomes.move("owner", "down"); // x4,y9 beside desk
    const work = await workHomes.interact("owner", "work-desk");
    expect(work).toMatchObject({ kind: "pose", occupant: { pose: "working" } });
    const coins = (await workRepos.players.findById("owner"))?.coins;
    workHomes.move("owner", "left"); // into desk collision leaves occupant in place
    expect((await workRepos.players.findById("owner"))?.coins).toBe(coins);
    expect((await workHomes.snapshotAsync("owner")).occupants[0].pose).toBe("working");
    workHomes.move("owner", "down"); // x4,y10
    workHomes.move("owner", "up"); // x4,y9
    workHomes.move("owner", "up"); // x4,y8
    workHomes.move("owner", "left"); // x3,y8
    workHomes.move("owner", "up"); // x3,y7 doorway
    workHomes.move("owner", "up"); // x3,y6
    for (let step = 0; step < 7; step += 1) workHomes.move("owner", "right"); // x10,y6
    workHomes.move("owner", "down"); // bedroom doorway
    workHomes.move("owner", "down"); // x10,y8 beside bed
    expect((await workHomes.snapshotAsync("owner")).occupants[0].pose).toBe(null);
    expect(await workHomes.interact("owner", "bed")).toMatchObject({ kind: "pose", occupant: { pose: "resting" } });
    expect((await workRepos.players.findById("owner"))?.coins).toBe(coins);
  });

  it("plays one house-scoped radio tune at a time and clears occupants on disconnect", async () => {
    const { repositories, homes } = await setup();
    await homes.ensurePlayerHome("owner");
    await enterGuestHome(homes, repositories);
    await moveToRadio(homes);
    expect(await homes.interact("guest", "radio")).toMatchObject({ kind: "radio", started: true, durationMs: 3_000 });
    expect(await homes.interact("guest", "radio")).toEqual({ kind: "radio", started: false });
    expect(await homes.disconnect("guest")).toBe("owner");
    expect((await homes.snapshotAsync("owner")).occupants).toEqual([]);
    const persisted = await repositories.players.findById("guest");
    expect(persisted).toMatchObject({ currentRegionId: "region-north", position: { x: 30, y: 47 } });
  });
});
