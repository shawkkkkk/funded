import assert from 'node:assert/strict';
import test from 'node:test';
import { bridgeState } from '../src/bridge-state.ts';
import { planConversion } from '../src/conversion-plan.ts';
import { depositsFromTransaction, watchReceiver } from '../src/fee-monitor.ts';
import { reconcile } from '../src/reconcile.ts';
import { alerts } from '../src/alerts.ts';
import { NATIVE, SOLANA_USDC } from '../src/domain.ts';

const owner = 'C2C4ASTqWHaYx74EkZZ9AqKc4FnTpqnGJGy5d3aG1kRB';
const account = '38UvSmzx5erhrkwUCGyvHpksni5YCNYLNoKoab8Km5gb';
const usdc = SOLANA_USDC;

test('receiver deposits stay uncredited for SOL, legacy tokens, and Token-2022', async () => {
  const sol = depositsFromTransaction('sig-sol', {
    transaction: { message: { accountKeys: [account] } },
    meta: { preBalances: [10], postBalances: [15] }
  }, account, NATIVE, owner);
  assert.equal(sol.attribution, 'held_native');
  assert.equal(sol.credited, false);
  const legacy = depositsFromTransaction('sig-usdc', {
    transaction: { message: { accountKeys: [{ pubkey: account }] } },
    meta: {
      preTokenBalances: [{ accountIndex: 0, mint: usdc, owner, programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', uiTokenAmount: { amount: '1' } }],
      postTokenBalances: [{ accountIndex: 0, mint: usdc, owner, programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', uiTokenAmount: { amount: '6' } }]
    }
  }, account, usdc, owner);
  assert.equal(legacy.attribution, 'held_pending_review');
  assert.equal(legacy.units, '5');
  const next = depositsFromTransaction('sig-2022', {
    transaction: { message: { accountKeys: [account] } },
    meta: {
      preTokenBalances: [{ accountIndex: 0, mint: usdc, owner, programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', uiTokenAmount: { amount: '1' } }],
      postTokenBalances: [{ accountIndex: 0, mint: usdc, owner, programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', uiTokenAmount: { amount: '4' } }]
    }
  }, account, usdc, owner);
  assert.equal(next.attribution, 'held_token2022');
  const watched = await watchReceiver({
    finalizedAddressSignatures: async () => [{ signature: 'sig-sol', err: null }, { signature: 'bad', err: { failed: true } }],
    finalizedTransaction: async () => ({ transaction: { message: { accountKeys: [account] } }, meta: { preBalances: [1], postBalances: [2] } })
  }, { account, asset: NATIVE, expectedOwner: owner });
  assert.equal(watched.rows.length, 1);
  assert.equal(watched.credited, false);
});

test('conversion and bridge plans cannot execute or credit', async () => {
  const quote = await planConversion(
    { asset: NATIVE, units: '1000', taker: owner },
    { assets: new Set([NATIVE]), pools: new Set([owner]), topLevelPrograms: new Set([owner]), slippageBps: 50, maxImpactBps: 50, maxAgeMs: 1000, referenceMinNet: '1' },
    { transport: async () => new Response('no', { status: 503 }), clock: () => 1_000 }
  );
  assert.equal(quote.executionAuthorized, false);
  assert.equal(quote.swaps, false);
  const bridge = await bridgeState({
    signature: '2'.repeat(87), senderProgram: owner, baseMessenger: '0x' + '11'.repeat(20), sourceWallet: owner,
    baseRecipient: '0x' + '22'.repeat(20), burnUnits: '100', maxFeeUnits: '1', minimumNetUnits: '90'
  }, async () => new Response('missing', { status: 404 }));
  assert.equal(bridge.burnAuthorized, false);
  assert.equal(bridge.baseSettlementVerified, false);
  assert.equal(bridge.executionAuthorized, false);
});

test('reconciliation reports drift and never a completed payment', () => {
  assert.equal(reconcile({ credited: 10n, attributed: 10n, paidUsdMicros: 0n }).balanced, true);
  const drifted = reconcile({ credited: 10n, attributed: 4n, paidUsdMicros: 3n });
  assert.equal(drifted.balanced, false);
  assert.equal(drifted.paymentComplete, false);
  assert.deepEqual(alerts({ paused: false, unbalanced: false, oldestAwaitingBuyerMs: null, maxWaitMs: 1, attributionDrift: true }).map(row => row.kind), ['attribution_drift']);
});
