import assert from 'node:assert/strict';
import test from 'node:test';
import { FixtureScreener, liveScreener, screenerFromEnv } from '../src/screening.ts';

test('fixture screening never claims a live clearance', async () => {
  const screen = new FixtureScreener(['BadActor', '@blocked']);
  assert.deepEqual(await screen.screen({ kind: 'handle', value: '@BadActor' }), { decision: 'blocked', provider: 'fixture', live: false, reason: 'Fixture denial list' });
  assert.equal((await screen.screen({ kind: 'mint', value: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' })).decision, 'clear');
  assert.equal((await screen.screen({ kind: 'address', value: '   ' })).decision, 'review');
  assert.equal((await screenerFromEnv({ FUNDED_SCREEN_DENY: 'evil' }).screen({ kind: 'handle', value: 'Evil' })).decision, 'blocked');
  assert.throws(liveScreener, /not clearance/);
});
