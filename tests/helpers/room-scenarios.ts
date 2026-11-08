import { scenario, array, record, integer, seats, text } from './fixture-read.js';
export function roomJoinVariants() {
  const f = scenario('ROOM11', ['applyIndependentJoinVariants']);
  return array(f.given.variants).map((value) => {
    const g = record(value),
      name = text(g.name),
      expected = record(array(f.expected.variants).find((x) => record(x).name === name));
    return {
      name,
      capacity: integer(g.capacity) as 2 | 3 | 4,
      occupiedSeats: seats(g.occupiedSeats),
      requests: integer(g.joinRequests),
      successes: integer(expected.successes),
      occupiedAfter: seats(expected.occupiedAfter),
    };
  });
}

export function roomStartModes() {
  const result = [];
  for (let n = 1; n <= 9; n++) {
    const id = 'ROOM' + String(n).padStart(2, '0'),
      f = scenario(id, ['evaluateStartAndFreezeParticipants']),
      members = array(f.given.members).map(record),
      variants =
        f.given.difficultyVariants === undefined
          ? [null]
          : array(f.given.difficultyVariants).map(text);
    for (const difficulty of variants)
      result.push({
        name: id + (difficulty ? ':' + difficulty : ''),
        capacity: integer(f.given.capacity) as 2 | 3 | 4,
        members,
        difficulty,
        count: integer(f.expected.participantCount),
        empty: integer(f.expected.emptySeatCount),
        frozen: array(f.expected.frozenParticipantIds).map(text),
      });
  }
  return result;
}
export function roomStartVariants() {
  const f = scenario('ROOM12', ['evaluateStartVariants']);
  return array(f.given.variants).map((v) => {
    const g = record(v),
      e = record(array(f.expected.variants).find((x) => record(x).name === g.name));
    return {
      name: text(g.name),
      capacity: integer(g.capacity) as 2 | 3 | 4,
      humans: integer(g.humans),
      online: integer(g.online),
      ready: integer(g.ready),
      expected: e,
    };
  });
}

export function roomManagementFixture() {
  const f = scenario('LIFE11', ['applyIndependentRoomManagementVariants']);
  const given = array(f.given.variants).map(record),
    expected = array(f.expected.variants).map(record);
  if (given.length !== 6 || expected.length !== 6) throw new Error('INVALID_MANAGEMENT_FIXTURE');
  for (const v of given)
    if (!expected.some((e) => e.name === v.name)) throw new Error('MISSING_MANAGEMENT_EXPECTATION');
  return {
    baseMembers: array(f.given.baseMembers).map(record),
    given: (name: string) => {
      const r = given.find((v) => v.name === name);
      if (!r) throw new Error('MISSING_VARIANT');
      return r;
    },
    expected: (name: string) => {
      const r = expected.find((v) => v.name === name);
      if (!r) throw new Error('MISSING_EXPECTATION');
      return r;
    },
  };
}
