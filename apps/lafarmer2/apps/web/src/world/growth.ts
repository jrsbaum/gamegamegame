import type { GrowthStage } from "@lafarmer2/content";

/** Stage index and how far the item has grown toward the next stage (1 in the last stage). */
export type GrowthProgress = { stage: number; fraction: number };

/**
 * Walks the stages the way the server does (a stage starts once its duration has elapsed after
 * the previous one) and adds the fraction inside the current stage. The stage the server
 * reported wins over the local clock, which can drift from the server's.
 */
export const growthProgress = (stages: readonly GrowthStage[], plantedAt: number, now: number, reportedStageId?: string): GrowthProgress => {
  const last = stages.length - 1;
  let elapsed = Math.max(0, (now - plantedAt) / 1000);
  let stage = 0;
  let fraction = 1;
  for (let index = 1; index <= last; index += 1) {
    const duration = stages[index].durationSeconds;
    if (elapsed < duration) {
      fraction = elapsed / duration;
      break;
    }
    elapsed -= duration;
    stage = index;
  }
  const reported = reportedStageId === undefined ? -1 : stages.findIndex((candidate) => candidate.id === reportedStageId);
  if (reported < 0 || reported === stage) return { stage, fraction };
  if (reported > stage) return { stage: reported, fraction: reported === last ? 1 : 0 };
  return { stage: reported, fraction: 1 };
};

/** 0 right after a harvest cycle starts, 1 when the next unit is due. */
export const cycleProgress = (nextProductionAt: number | null, cycleSeconds: number | null, now: number): number => {
  if (nextProductionAt === null || !cycleSeconds) return 0;
  return Math.min(1, Math.max(0, 1 - (nextProductionAt - now) / (cycleSeconds * 1000)));
};
