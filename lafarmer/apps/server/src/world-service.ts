import type { LandOption, PlayerState } from "./domain.js";

const LANDSCAPES = [
  { biome: "river", title: "Vale do rio", feature: "rio + ponte", summary: "Água por perto e caminhos fáceis para visitar a fronteira.", fertility: 78 },
  { biome: "forest", title: "Clareira do bosque", feature: "bosque + madeira", summary: "Mais madeira e coleta, com bastante espaço aberto para começar.", fertility: 70 },
  { biome: "meadow", title: "Prado ensolarado", feature: "solo fértil", summary: "Uma área aberta e fértil para ciclos produtivos mais rápidos.", fertility: 86 },
  { biome: "lake", title: "Margem do lago", feature: "lago + fósseis", summary: "Paisagem tranquila, pedras e chance de encontrar materiais raros.", fertility: 66 },
  { biome: "rocky", title: "Encosta rochosa", feature: "caverna + pedra", summary: "Menos solo livre, mas uma identidade forte e recursos minerais.", fertility: 60 }
] as const;

export function buildLandOptions(players: PlayerState[], playerId: string): LandOption[] {
  const occupied = new Set(players.filter((player) => player.id !== playerId && player.plot).map((player) => `${player.plot!.x}:${player.plot!.y}`));
  const anchors = players.filter((player) => player.plot).map((player) => player.plot!);
  const candidates = anchors.length
    ? anchors.flatMap((plot) => [{ x: plot.x + 1, y: plot.y }, { x: plot.x - 1, y: plot.y }, { x: plot.x, y: plot.y + 1 }, { x: plot.x, y: plot.y - 1 }])
    : [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
  const unique = new Map<string, { x: number; y: number }>();
  for (const candidate of candidates) {
    const key = `${candidate.x}:${candidate.y}`;
    if (!occupied.has(key) && !unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()].slice(0, 3).map((plot, index) => {
    const landscape = LANDSCAPES[index % LANDSCAPES.length];
    return { id: `plot-${plot.x}-${plot.y}`, x: plot.x, y: plot.y, biome: landscape.biome, title: landscape.title, feature: landscape.feature, summary: landscape.summary, fertility: landscape.fertility, nearbyNeighbors: anchors.filter((anchor) => Math.abs(anchor.x - plot.x) + Math.abs(anchor.y - plot.y) === 1).length };
  });
}
