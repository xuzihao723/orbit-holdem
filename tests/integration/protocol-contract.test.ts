import { expect, it } from 'vitest';
import examples from '../../docs/examples/protocol.json';

it('preserves all fourteen independently correlated examples and their outcomes', () => {
  expect(examples).toHaveLength(14);
  expect(examples.filter((example) => example.response.ok)).toHaveLength(8);
  expect(examples.filter((example) => !example.response.ok)).toHaveLength(6);
  for (const example of examples) {
    if ('commandId' in example.request) {
      expect(example.response.commandId).toBe(example.request.commandId);
    } else {
      expect(example.response.requestId).toBe(example.request.requestId);
    }
    for (const emission of example.emittedEvents) {
      if (emission.event === 'game:view') {
        if (!('self' in emission.payload) || !emission.payload.self) {
          throw new Error('Private game view lacks its owner');
        }
        expect(emission.audience).toBe(`participant:${emission.payload.self.participantId}`);
      }
    }
  }
});

it('keeps the replay terminal stacks aligned with the declared settlement', () => {
  const replay = examples.find((example) => example.event === 'replay:get' && example.response.ok);
  if (!replay?.response.frames || !replay.response.result)
    throw new Error('Missing replay fixture');
  expect(replay.response.frames).toHaveLength(16);
  const last = replay.response.frames.at(-1);
  expect(last?.state.phase).toBe('settled');
  for (const player of replay.response.result.finalStacks) {
    expect(last?.state.players.find((p) => p.participantId === player.participantId)?.stack).toBe(
      player.stack,
    );
  }
});
