import { ROOM_CODE } from '../../app/router';
export function inviteLink(origin: string, code: string) {
  if (!ROOM_CODE.test(code)) throw Error('ROOM_CODE_INVALID');
  return new URL('/play?mode=join&room=' + code, origin).href;
}
