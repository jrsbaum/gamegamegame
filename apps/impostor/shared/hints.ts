/**
 * Concessão de power-up de dica derivada do tempo decorrido da rodada.
 *
 * A concessão é calculada, nunca agendada: `server/game.ts` não pode ganhar um
 * `setTimeout` para liberar power-up (guarda TIME-09), e o cliente precisa do
 * mesmo cálculo para exibir a contagem sem esperar um evento do servidor.
 * Duplicar a regra criaria duas verdades sobre quando o power-up aparece, por
 * isso ela mora em `shared/`.
 */

const MINUTE_MS = 60_000;

/** Marcos de liberação, em ms desde `roundStartedAt` (HINT-01). */
export const HINT_UNLOCK_MS = [30 * MINUTE_MS, 40 * MINUTE_MS, 50 * MINUTE_MS];

/** Teto de acúmulo por jogador (HINT-03, HINT-23). */
export const MAX_HINT_POWERUPS = 3;

/**
 * Quantos power-ups o jogador já ganhou depois de `elapsedMs` de rodada. O
 * valor exato do marco já concede: 30 minutos cravados valem 1.
 */
export function earnedHintPowerups(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs)) return 0;
  const earned = HINT_UNLOCK_MS.filter((unlockMs) => elapsedMs >= unlockMs).length;
  return Math.min(earned, MAX_HINT_POWERUPS);
}

/** Quantos ainda dá para usar: o ganho menos o já gasto, nunca negativo (HINT-23). */
export function availableHintPowerups(elapsedMs: number, used: number): number {
  return Math.max(0, earnedHintPowerups(elapsedMs) - used);
}
