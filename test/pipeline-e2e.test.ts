import assert from 'node:assert/strict';
import test from 'node:test';
import { PgLedger } from '../src/pg-ledger.ts';
import { stepPipeline } from '../src/pipeline.ts';

const url = process.env.FUNDED_DATABASE_URL;
const creator = 'ix9YkGjxyxvtADosH1mWWk3TUUuoNtbjHwm9bzN7DVq';
const receiver = 'C2C4ASTqWHaYx74EkZZ9AqKc4FnTpqnGJGy5d3aG1kRB';
const mint = '28Tcf5zCLRz8TbVcDyE89BcMw139FTyk6e1KCBqNGJrJ';

test('fixture fee plans USDC, a bridge read, and a Peer leg, and a crashed lease runs once', { skip: url ? false : 'FUNDED_DATABASE_URL not set' }, async () => {
  const ledger = await PgLedger.connect(url!);
  const clock = new Date('2026-11-09T12:00:00Z');
  const ports = {
    planSwap: async () => ({ status: 'quote_only' as const, minimumUsdcUnits: '4000000', executionAuthorized: false as const, fixtureAdvance: true }),
    readBridge: async () => ({ status: 'attestation_reported', baseSettlementVerified: false as const, burnAuthorized: false as const, executionAuthorized: false as const }),
    screen: async () => ({ decision: 'clear' as const, provider: 'fixture' as const, live: false as const })
  };
  try {
    await ledger.migrate();
    await ledger.resetData();
    await ledger.resume();
    await ledger.enqueue({
      idempotencyKey: 'intake:fixture:fee', kind: 'intake', dueAt: clock, payload: {
        enrollment: { creatorHandle: 'creator', rail: 'xmoney', payee: '@creator', consentVersion: 1, mint, quoteMint: 'native:sol', feeTier: 0, feeReceiver: receiver, creatorWallet: creator },
        receipt: { originRef: 'fixture:fee:1', signature: 'sig-fee', asset: 'native:sol', units: '1000000000' }
      }
    });
    const crashed = await ledger.lease('dead-worker', clock);
    assert.equal(crashed?.kind, 'intake');
    const later = new Date(clock.getTime() + 31_000);
    const kinds: string[] = [];
    for (let step = 0; step < 4; step += 1) {
      const result = await stepPipeline(ledger, ports, later);
      if (!result) break;
      kinds.push(result.kind);
      assert.equal(result.executionAuthorized, false);
    }
    assert.deepEqual(kinds, ['intake', 'swap_plan', 'bridge_check', 'peer_plan']);
    await assert.rejects(ledger.complete(crashed!.id, crashed!.fence), /Stale/);
    const again = await stepPipeline(ledger, ports, later);
    assert.equal(again, null);
    const rows = await ledger.creatorBatches('creator');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].asset, 'native:sol');
    assert.equal(rows[0].paid_usd, '0');
    const notes = await ledger.observations(rows[0].id);
    assert.deepEqual(notes.map(note => note.kind), ['swap_plan', 'bridge_check', 'peer_plan']);
    assert.equal(notes[0].payload.minimumUsdcUnits, '4000000');
    assert.equal(notes[1].payload.baseSettlementVerified, false);
    assert.equal(notes[1].payload.burnAuthorized, false);
    assert.equal(notes[2].payload.ordersEnabled, false);
    assert.equal(notes[2].payload.receive.platform, 'xmoney');
  } finally { await ledger.close(); }
});
