import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createXMoneyReceiptBinding,
  reconcileBoundXMoneyReceipt,
  xMoneyPaymentReference,
  XMONEY_RECEIPT_CONTROLS
} from '../src/xmoney-receipt.ts';

const hash = (digit: string) => `0x${digit.repeat(64)}`;
const depositId = `${'0x' + '2'.repeat(40)}_7`;
const key = 'receipt-test-key-that-is-longer-than-thirty-two-bytes';

function binding() {
  return createXMoneyReceiptBinding({
    planReference: 'funded_batch:fixture-42',
    depositId,
    payeeHash: hash('5'),
    expectedBaseUsdcUnits: '2500000'
  });
}

function order() {
  return {
    depositId,
    state: 'delivered' as const,
    totalAmount: 2500000n,
    filledAmount: 2500000n,
    pendingAmount: 0n,
    returnedAmount: 0n,
    nextActions: [],
    isInFlight: false,
    deliveredAt: 1_800_000_020,
    payouts: [{
      platform: 'xmoney', platformHash: hash('3'), currency: 'USD', currencyHash: hash('4'),
      payeeHash: hash('5'), active: true, pricing: { marketRate: true }
    }],
    fills: [{
      intentHash: hash('6'), status: 'FULFILLED' as const, amount: 2500000n,
      buyer: `0x${'7'.repeat(40)}`, fiatPaid: 2.5, paidCurrency: 'USD',
      paymentId: 'xmoney-payment-7', paidAt: 1_800_000_010,
      signaledAt: 1_800_000_000, expiresAt: 1_800_000_060,
      releasedAmount: 2500000n, fulfilledAt: 1_800_000_015
    }],
    explain() { return 'delivered'; }
  };
}

test('receipt binding is deterministic and exposes no execution surface', () => {
  assert.equal(binding().bindingId, binding().bindingId);
  assert.equal(XMONEY_RECEIPT_CONTROLS.rawReceiptStorage, false);
  assert.equal(XMONEY_RECEIPT_CONTROLS.directReceiptLinksAccepted, false);
  assert.throws(() => createXMoneyReceiptBinding({ ...binding(), payeeHash: 'not-a-hash' }));
});

test('verified receipt is bound to deposit, payee, amount and provider intent window', () => {
  const result = reconcileBoundXMoneyReceipt(order(), binding(), key);
  assert.equal(result.verified, true);
  assert.equal(result.paidUsd, 2.5);
  assert.equal(result.releasedBaseUsdcUnits, '2500000');
  assert.equal(result.paymentCount, 1);
  assert.equal(result.rawReceiptStored, false);
  assert.equal(result.receiptReferences[0], xMoneyPaymentReference('xmoney-payment-7', key));
  assert.equal(JSON.stringify(result).includes('xmoney-payment-7'), false);
});

test('receipt admission fails closed on replay, mismatched obligations and bad timing', () => {
  const ref = xMoneyPaymentReference('xmoney-payment-7', key);
  assert.deepEqual(reconcileBoundXMoneyReceipt(order(), binding(), key, new Set([ref])).reasons, ['fill_0_receipt_replay']);
  assert.equal(reconcileBoundXMoneyReceipt({ ...order(), depositId: `${'0x' + '8'.repeat(40)}_1` }, binding(), key).verified, false);
  assert.equal(reconcileBoundXMoneyReceipt({ ...order(), totalAmount: 2400000n }, binding(), key).reasons.includes('deposit_amount_mismatch'), true);
  assert.equal(reconcileBoundXMoneyReceipt({ ...order(), payouts: [{ ...order().payouts[0], payeeHash: hash('9') }] }, binding(), key).reasons.includes('payee_hash_mismatch'), true);
  assert.equal(reconcileBoundXMoneyReceipt({ ...order(), fills: [{ ...order().fills[0], paidAt: 1_799_999_999 }] }, binding(), key).reasons.includes('fill_0_outside_provider_intent_window'), true);
});

test('raw receipt URLs, short keys and modified bindings reject', () => {
  assert.throws(() => xMoneyPaymentReference('https://money.x.com/receipt/private', key));
  assert.throws(() => xMoneyPaymentReference('payment', 'short-key'));
  assert.throws(() => reconcileBoundXMoneyReceipt(order(), { ...binding(), expectedBaseUsdcUnits: '1' }, key), /modified/);
});
