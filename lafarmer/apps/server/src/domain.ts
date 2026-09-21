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
  inventory: Record<string, number>;
  lastActiveAt: number;
  position: {
    x: number;
    y: number;
  };
};

export type FarmItem = {
  id: string;
  ownerId: string;
  contentId: string;
  plantedAt: number;
  lastCareAt: number | null;
  position: { x: number; y: number };
};

export type FarmItemView = FarmItem & {
  stageId: string;
  visualKey: string;
  ready: boolean;
};

export type MarketListing = {
  id: string;
  sellerId: string;
  sellerName: string;
  contentId: string;
  quantity: number;
  unitPrice: number;
  createdAt: number;
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
  players: PlayerState[];
  farmItems: FarmItemView[];
  listings: MarketListing[];
};
