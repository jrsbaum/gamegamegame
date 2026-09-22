/**
 * Pontos de um acerto pela posição em que ele chegou (SCORE-01).
 *
 * `playerCount` é o número de jogadores registrado no início da rodada, não o
 * de agora: congelar N torna a pontuação auditável quando alguém sai no meio
 * (SCORE-02, SCORE-15).
 *
 * O primeiro leva `playerCount` e o último a acertar leva 1, nunca 0.
 */
export function pointsForRank(rank: number, playerCount: number): number {
  return playerCount - rank + 1;
}
