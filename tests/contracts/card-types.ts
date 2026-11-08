import type { CardId as CoreCard, SeatId as CoreSeat } from '@orbit/poker-core';
import type { CardId as WireCard, SeatId as WireSeat } from '@orbit/protocol';
const toWireCard = (card: CoreCard): WireCard => card;
const toCoreCard = (card: WireCard): CoreCard => card;
const toWireSeat = (seat: CoreSeat): WireSeat => seat;
const toCoreSeat = (seat: WireSeat): CoreSeat => seat;
void [toWireCard, toCoreCard, toWireSeat, toCoreSeat];
