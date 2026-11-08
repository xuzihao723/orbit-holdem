import { secureRandomInt } from '../game/random.js';
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function createRoomCode() {
  return Array.from({ length: 6 }, () => alphabet[secureRandomInt(0, alphabet.length)]!).join('');
}
