import type { PlayerAppearance } from "@lafarmer/content";

export type Account = {
  id: string;
  normalizedNick: string;
  nick: string;
  passwordHash: string;
  createdAt: string;
};

export type Session = {
  token: string;
  accountId: string;
  expiresAt: number;
};

export type PlayerState = {
  id: string;
  accountId: string;
  name: string;
  appearance: PlayerAppearance;
  coins: number;
  position: {
    x: number;
    y: number;
  };
};

export type Direction = "up" | "down" | "left" | "right";

export type MoveCommand = {
  actionId: string;
  direction: Direction;
};

export type MoveResult = {
  actionId: string;
  player: PlayerState;
  accepted: true;
};

export type WorldSnapshot = {
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  player: PlayerState;
};
