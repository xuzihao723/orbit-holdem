import { scenario, array, record, text, integer, bool } from './fixture-read.js';
export function connectionTakeoverFixture() {
  const s = scenario('PRIV04', ['projectBotVariantsAndValidateConnection']),
    variant = array(s.given.variants)
      .map(record)
      .find((v) => v.name === 'connectionTakeover');
  if (!variant) throw new Error('MISSING_CONNECTION_VARIANT');
  const e = record(s.expected.connectionTakeover);
  return {
    oldGeneration: integer(variant.oldGeneration),
    newGeneration: integer(variant.newGeneration),
    commandFromGeneration: integer(variant.commandFromGeneration),
    expected: {
      accepted: bool(e.accepted),
      error: text(e.error),
      stateUnchanged: bool(e.stateUnchanged),
      newConnectionControlsSeat: bool(e.newConnectionControlsSeat),
    },
    scope: 'connectionTakeover subassertions only; botObservation deferred to W25',
  };
}
