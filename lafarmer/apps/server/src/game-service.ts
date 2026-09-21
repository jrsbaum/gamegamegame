import type { Direction } from "./domain.js";
import type { MoveCommand, MoveResult, PlayerState, WorldSnapshot } from "./domain.js";
import type { PlayerRepository } from "./repositories.js";

const WORLD_BOUNDS = { minX: 0, maxX: 100, minY: 0, maxY: 100 } as const;

export class GameError extends Error {
  constructor(public readonly code: "player_not_found" | "invalid_action" | "invalid_direction") {
    super(code);
  }
}

export class GameService {
  private readonly actionReceipts = new Map<string, MoveResult>();

  constructor(private readonly players: PlayerRepository) {}

  async snapshot(playerId: string): Promise<WorldSnapshot> {
    const player = await this.players.findById(playerId);
    if (!player) throw new GameError("player_not_found");
    return { bounds: WORLD_BOUNDS, player };
  }

  async move(playerId: string, command: MoveCommand): Promise<MoveResult> {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(command.actionId)) throw new GameError("invalid_action");
    if (!isDirection(command.direction)) throw new GameError("invalid_direction");
    const receiptKey = `${playerId}:${command.actionId}`;
    const previous = this.actionReceipts.get(receiptKey);
    if (previous) return previous;

    const player = await this.players.findById(playerId);
    if (!player) throw new GameError("player_not_found");
    const position = { ...player.position };
    if (command.direction === "up") position.y -= 1;
    if (command.direction === "down") position.y += 1;
    if (command.direction === "left") position.x -= 1;
    if (command.direction === "right") position.x += 1;
    const updated: PlayerState = {
      ...player,
      position: {
        x: clamp(position.x, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX),
        y: clamp(position.y, WORLD_BOUNDS.minY, WORLD_BOUNDS.maxY)
      }
    };
    await this.players.update(updated);
    const result: MoveResult = { actionId: command.actionId, accepted: true, player: updated };
    this.actionReceipts.set(receiptKey, result);
    return result;
  }
}

function isDirection(value: string): value is Direction {
  return value === "up" || value === "down" || value === "left" || value === "right";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
