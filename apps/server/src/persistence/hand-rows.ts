import type { Positions } from '@orbit/poker-core';
import type { HandResult } from '@orbit/protocol';
import type { RoomCommit } from './domain-rows.js';
import type { EventInsert } from './rows.js';
export interface HandRow {
  readonly handId: string;
  readonly roomId: string;
  readonly matchId: string;
  readonly startEpoch: string;
  readonly handVersion: number;
  readonly status: 'active' | 'settled' | 'interrupted';
  readonly participantIds: readonly string[];
  readonly startingStacks: readonly { readonly participantId: string; readonly stack: number }[];
  readonly positions: Positions;
  readonly initialChipTotal: number;
  readonly result: HandResult | null;
  readonly startedAt: number;
  readonly endedAt: number | null;
}
export interface HandWrite {
  readonly row: HandRow;
  readonly expectedVersion: number | null;
  readonly events: readonly EventInsert[];
}
export interface HandStartCommit extends RoomCommit {
  readonly hand: HandRow;
  readonly events: readonly EventInsert[];
}
export interface HandActionCommit extends HandStartCommit {
  readonly expectedHandVersion: number;
}
export interface HandRepositories {
  commitHandAction(batch: HandActionCommit): void;
  commitHandStart(batch: HandStartCommit): void;
  readHand(handId: string): HandRow | null;
}
