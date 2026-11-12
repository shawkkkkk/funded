import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.ts';
import { PgLedger } from '../src/pg-ledger.ts';
import { stepPipeline } from '../src/pipeline.ts';
import { SOLANA_USDC } from '../src/domain.ts';
import { app } from '../src/server.ts';
import { Store } from '../src/store.ts';
import { createXMoneyReceiptBinding, xMoneyPaymentReference } from '../src/xmoney-receipt.ts';

const url = process.env.FUNDED_DATABASE_URL;
const creator = 'ix9YkGjxyxvtADosH1mWWk3TUUuoNtbjHwm9bzN7DVq';
const receiver = 'C2C4ASTqWHaYx74EkZZ9AqKc4FnTpqnGJGy5d3aG1kRB';
const mint = '28Tcf5zCLRz8TbVcDyE89BcMw139FTyk6e1KCBqNGJrJ';

test('config keeps execution off and remembers the recommended defaults', () => {
  const config = loadConfig({ FUNDED_LAUNCH_ENABLED: 'true', FUNDED_PEER_ORDERS: 'true' });
  assert.equal(config.launchEnabled, false);
  assert.equal(config.peerOrdersEnabled, false);
  assert.equal(config.launchSigner, 'creator');
  assert.equal(config.custody, 'funded_receiver_unapproved');
  assert.equal(config.pricing, 'zero_spread');
  assert.equal(config.deploymentMode, 'local');
  assert.equal(config.bindAddress, '127.0.0.1');
  assert.equal(loadConfig({ FUNDED_PRICING: 'separate_incentive' }).pricing, 'separate_incentive');
  assert.throws(() => loadConfig({ FUNDED_DATABASE_URL: 'mysql://local' }), /postgres/);
});

test('postgres ledger, outbox, and planning pipeline', { skip: url ? false : 'FUNDED_DATABASE_URL not set' }, async () => {
  const ledger = await PgLedger.connect(url!);
  try {
    const first = await ledger.migrate();
    const second = await ledger.migrate();
    assert.deepEqual(second, []);
    assert.ok(first.includes('db/postgres.sql') || first.length === 0);
    await ledger.resetData();
    assert.equal(await ledger.pauseReason(), 'default closed');
    assert.equal(await ledger.lease('worker', new Date()), null);
    await ledger.resume();

    const enrolled = await ledger.enroll({ creatorHandle: '@Creator', rail: 'xmoney', payee: '@creator', consentVersion: 1, mint, quoteMint: 'native:sol', feeTier: 0, feeReceiver: receiver, creatorWallet: creator });
    assert.equal((await ledger.enroll({ creatorHandle: 'creator', rail: 'xmoney', payee: '@creator', consentVersion: 1, mint, quoteMint: 'native:sol', feeTier: 0, feeReceiver: receiver, creatorWallet: creator })).duplicate, true);
    await assert.rejects(ledger.enroll({ creatorHandle: 'creator', rail: 'xmoney', payee: '@creator', consentVersion: 1, mint, quoteMint: SOLANA_USDC, feeTier: 0, feeReceiver: receiver, creatorWallet: creator }), /Conflicting launch/);
    const credited = await ledger.credit({ launchId: enrolled.launchId, originRef: 'solana:test:receipt', signature: 'sig', asset: SOLANA_USDC, units: '5000000' });
    assert.equal((await ledger.credit({ launchId: enrolled.launchId, originRef: 'solana:test:receipt', signature: 'sig', asset: SOLANA_USDC, units: '5000000' })).duplicate, true);
    await assert.rejects(ledger.credit({ launchId: enrolled.launchId, originRef: 'solana:test:receipt', signature: 'sig', asset: SOLANA_USDC, units: '1' }), /Conflicting receipt/);
    const receiptKey = 'postgres-receipt-test-key-that-is-at-least-thirty-two-bytes';
    const binding = createXMoneyReceiptBinding({
      planReference: 'funded_batch:postgres-test',
      depositId: `${'0x' + '2'.repeat(40)}_7`,
      payeeHash: `0x${'5'.repeat(64)}`,
      expectedBaseUsdcUnits: '5000000'
    });
    const verifiedReceipt = {
      bindingId: binding.bindingId,
      depositId: binding.depositId,
      state: 'delivered' as const,
      verified: true,
      paidUsd: 5,
      releasedBaseUsdcUnits: '5000000',
      paymentCount: 1,
      receiptReferences: [xMoneyPaymentReference('postgres-payment-1', receiptKey)],
      rawReceiptStored: false as const,
      reasons: []
    };
    assert.equal((await ledger.admitVerifiedXMoneyReceipt({ batchId: credited.batchId, binding, receipt: verifiedReceipt })).duplicate, false);
    assert.equal((await ledger.admitVerifiedXMoneyReceipt({ batchId: credited.batchId, binding, receipt: verifiedReceipt })).duplicate, true);
    await assert.rejects(ledger.admitVerifiedXMoneyReceipt({ batchId: credited.batchId, binding, receipt: { ...verifiedReceipt, paidUsd: 4 } }), /Conflicting/);
    assert.equal(await ledger.balanced(), true);

    const now = new Date('2026-11-09T00:00:00Z');
    const job = await ledger.enqueue({ idempotencyKey: 'fixture:job', kind: 'swap_plan', batchId: credited.batchId, payload: { asset: 'native:sol', units: '1' }, maxAttempts: 2, dueAt: now });
    assert.equal((await ledger.enqueue({ idempotencyKey: 'fixture:job', kind: 'swap_plan', batchId: credited.batchId, payload: { asset: 'native:sol', units: '1' } })).duplicate, true);
    await assert.rejects(ledger.enqueue({ idempotencyKey: 'fixture:job', kind: 'swap_plan', payload: { asset: 'other' } }), /Conflicting job/);
    const leased = await ledger.lease('worker-a', now);
    assert.equal(leased?.id, job.id);
    assert.equal(await ledger.lease('worker-b', now), null);
    await assert.rejects(ledger.complete(leased!.id, leased!.fence - 1), /Stale/);
    const failed = await ledger.fail(leased!.id, leased!.fence, 'route down', now);
    assert.equal(failed.status, 'retry');
    assert.equal(await ledger.lease('worker-b', now), null);
    const again = await ledger.lease('worker-b', new Date(now.getTime() + failed.attempts * 5000));
    assert.equal(again?.fence, leased!.fence + 1);
    await assert.rejects(ledger.complete(leased!.id, leased!.fence), /Stale/);
    const dead = await ledger.fail(again!.id, again!.fence, 'still down', now);
    assert.equal(dead.status, 'dead');

    await ledger.resetData();
    await ledger.resume();
    const ports = {
      planSwap: async () => ({ status: 'waiting_route' as const, reason: 'no route', executionAuthorized: false as const }),
      readBridge: async () => ({ status: 'attestation_reported', baseSettlementVerified: false as const, burnAuthorized: false as const, executionAuthorized: false as const }),
      screen: async (input: { value: string }) => ({ decision: input.value.includes('blocked') ? 'blocked' as const : 'clear' as const, provider: 'fixture' as const, live: false as const })
    };
    const clock = new Date();
    await ledger.enqueue({
      idempotencyKey: 'intake:solana:one', kind: 'intake', dueAt: clock, payload: {
        enrollment: { creatorHandle: 'creator', rail: 'xmoney', payee: '@creator', consentVersion: 1, mint, quoteMint: 'native:sol', feeTier: 0, feeReceiver: receiver, creatorWallet: creator },
        receipt: { originRef: 'solana:one', signature: 'sig-one', asset: 'native:sol', units: '10' }
      }
    });
    const intake = await stepPipeline(ledger, ports, clock);
    assert.equal(intake?.executionAuthorized, false);
    const planned = await stepPipeline(ledger, ports, clock);
    assert.equal(planned && 'status' in planned && planned.status, 'waiting_route');
    assert.equal(await ledger.lease('nobody', clock), null);
    const notes = await ledger.observations(intake!.batchId!);
    assert.equal(notes[0].payload.executionAuthorized, false);

    await ledger.enqueue({
      idempotencyKey: 'intake:usdc', kind: 'intake', dueAt: clock, payload: {
        enrollment: { creatorHandle: 'creator', rail: 'xmoney', payee: '@blocked', consentVersion: 2, mint: '4aHLHiAqrKA5CV3isUiX7JC7C4HcWdjC322KPWVfLoat', quoteMint: SOLANA_USDC, feeTier: 1, feeReceiver: receiver, creatorWallet: creator },
        receipt: { originRef: 'solana:usdc', signature: 'sig-usdc', asset: SOLANA_USDC, units: '2500000' }
      }
    });
    const usdc = await stepPipeline(ledger, ports, clock);
    const bridge = await stepPipeline(ledger, ports, clock);
    assert.equal(bridge?.kind, 'bridge_check');
    const peer = await stepPipeline(ledger, ports, clock);
    assert.equal(peer && 'decision' in peer && peer.decision, 'blocked');
    const peerNotes = await ledger.observations(usdc!.batchId!);
    assert.equal(peerNotes.some(note => note.payload.ordersEnabled === false), true);
    assert.equal(peerNotes.some(note => note.payload.baseSettlementVerified === true), false);
    const rows = await ledger.creatorBatches('creator');
    assert.equal(rows.length, 2);
    assert.equal((await ledger.publicBatches()).length, 2);
    const server = app(new Store(':memory:'), undefined, ledger);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    try {
      const status = await (await fetch(origin + '/api/status')).json();
      assert.equal(status.database, 'postgres');
      assert.equal(status.launchEnabled, false);
      assert.equal(status.peerOrdersEnabled, false);
      assert.equal(status.launchSigner, 'creator');
      assert.equal(status.pricing, 'zero_spread');
      const payouts = await (await fetch(origin + '/api/payouts')).json();
      assert.equal(payouts.items.length, 2);
      assert.equal(payouts.items[0].cost.lpDiscountBps, 0);
      assert.equal(payouts.items[0].cost.paymentComplete, false);
      assert.match(payouts.senderNotice, /matched buyer/);
      const earnings = await (await fetch(origin + '/api/earnings?handle=creator')).json();
      assert.equal(earnings.items.length, 2);
      assert.equal(earnings.paymentComplete, false);
      const liquidity = await (await fetch(origin + '/api/liquidity')).json();
      assert.equal(liquidity.ordersEnabled, false);
      assert.equal(liquidity.senderDisplay, 'matched_buyer');
      assert.equal(liquidity.paymentNoteBranding, '@fundedonfloat');
      assert.equal(liquidity.partnerApprovalRequired, false);
      assert.ok(liquidity.items.length >= 1);
    } finally { await new Promise(resolve => server.close(resolve)); }
  } finally { await ledger.close(); }
});
