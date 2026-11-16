import { createHash, createHmac } from 'node:crypto';
import type { CashOrder } from '@zkp2p/cash';

const HASH32 = /^0x[0-9a-fA-F]{64}$/;
const REFERENCE = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{7,239}$/;

export const XMONEY_RECEIPT_CONTROLS = Object.freeze({
  obligationBinding: 'plan+deposit+payee-hash+exact-usdc-units',
  paymentWindow: 'provider-intent-window',
  replayProtection: 'one-hmac-payment-reference-per-fill',
  rawReceiptStorage: false,
  directReceiptLinksAccepted: false,
  publicVerificationEndpoint: false
});

export type XMoneyReceiptBinding = {
  bindingId: string;
  planReference: string;
  depositId: string;
  payeeHash: `0x${string}`;
  expectedBaseUsdcUnits: string;
};

export type BoundXMoneyReceipt = {
  bindingId: string;
  depositId: string;
  state: CashOrder['state'];
  verified: boolean;
  paidUsd: number;
  releasedBaseUsdcUnits: string;
  paymentCount: number;
  receiptReferences: string[];
  rawReceiptStored: false;
  reasons: string[];
};

function positiveUnits(value: unknown) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value)) throw Error('Expected Base USDC units must be a positive integer string');
  return BigInt(value);
}

function reference(value: unknown, label: string) {
  if (typeof value !== 'string' || !REFERENCE.test(value)) throw Error(`${label} is missing or malformed`);
  return value;
}

/**
 * Persist this binding after the provider deposit id and on-chain payee hash
 * are known. It binds later receipt evidence to one previously reviewed plan.
 */
export function createXMoneyReceiptBinding(input: {
  planReference: string;
  depositId: string;
  payeeHash: string;
  expectedBaseUsdcUnits: string;
}): XMoneyReceiptBinding {
  const normalized = {
    planReference: reference(input.planReference, 'planReference'),
    depositId: reference(input.depositId, 'depositId'),
    payeeHash: input.payeeHash.toLowerCase(),
    expectedBaseUsdcUnits: positiveUnits(input.expectedBaseUsdcUnits).toString()
  };
  if (!HASH32.test(normalized.payeeHash)) throw Error('Invalid X Money payee hash');
  return {
    bindingId: 'xmoney_binding_' + createHash('sha256').update(JSON.stringify(normalized)).digest('hex'),
    ...normalized,
    payeeHash: normalized.payeeHash as `0x${string}`
  };
}

/**
 * Payment ids are sensitive receipt data. Persist only this keyed reference,
 * using a managed server secret of at least 32 bytes, for global replay checks.
 */
export function xMoneyPaymentReference(paymentId: string, hmacKey: string | Uint8Array) {
  if (typeof paymentId !== 'string' || paymentId.length < 1 || paymentId.length > 256 || /^https?:\/\//i.test(paymentId) || /[\x00-\x1f\x7f]/.test(paymentId)) {
    throw Error('Invalid X Money payment id');
  }
  const key = typeof hmacKey === 'string' ? Buffer.from(hmacKey, 'utf8') : Buffer.from(hmacKey);
  if (key.length < 32) throw Error('Receipt HMAC key must be at least 32 bytes');
  return 'xmoney_receipt_' + createHmac('sha256', key).update('xmoney/payment-id/v1\0').update(paymentId).digest('hex');
}

/**
 * Backers-style receipt controls adapted to Peer orders: exact obligation and
 * payee binding, provider intent windows, one payment per fill, and keyed replay
 * references. Raw receipt links and payment ids are never returned.
 */
export function reconcileBoundXMoneyReceipt(
  order: CashOrder,
  binding: XMoneyReceiptBinding,
  hmacKey: string | Uint8Array,
  usedReceiptReferences: ReadonlySet<string> = new Set()
): BoundXMoneyReceipt {
  const expected = createXMoneyReceiptBinding(binding);
  if (expected.bindingId !== binding.bindingId) throw Error('Receipt binding was modified');

  const reasons: string[] = [];
  if (order.depositId !== binding.depositId) reasons.push('deposit_id_mismatch');
  if (order.totalAmount !== BigInt(binding.expectedBaseUsdcUnits)) reasons.push('deposit_amount_mismatch');
  if (order.state !== 'delivered') reasons.push('order_not_delivered');
  if (order.filledAmount !== order.totalAmount || order.pendingAmount !== 0n || order.returnedAmount !== 0n) reasons.push('amounts_not_fully_delivered');

  const payouts = order.payouts?.filter(candidate => candidate.platform === 'xmoney' && candidate.currency === 'USD') ?? [];
  if (payouts.length !== 1) reasons.push('single_xmoney_usd_payout_not_proven');
  else if (payouts[0].payeeHash.toLowerCase() !== binding.payeeHash) reasons.push('payee_hash_mismatch');

  let paidUsd = 0;
  let released = 0n;
  const receiptReferences: string[] = [];
  const localReferences = new Set<string>();
  const intentHashes = new Set<string>();
  for (let index = 0; index < order.fills.length; index += 1) {
    const fill = order.fills[index];
    const prefix = `fill_${index}`;
    if (!HASH32.test(fill.intentHash) || intentHashes.has(fill.intentHash.toLowerCase())) reasons.push(`${prefix}_invalid_or_duplicate_intent`);
    intentHashes.add(fill.intentHash.toLowerCase());
    if (fill.status !== 'FULFILLED') reasons.push(`${prefix}_not_fulfilled`);
    if (typeof fill.fiatPaid !== 'number' || !Number.isFinite(fill.fiatPaid) || fill.fiatPaid <= 0 || fill.paidCurrency !== 'USD') {
      reasons.push(`${prefix}_usd_receipt_missing`);
    } else paidUsd += fill.fiatPaid;
    if (typeof fill.releasedAmount !== 'bigint' || fill.releasedAmount <= 0n || fill.releasedAmount !== fill.amount) {
      reasons.push(`${prefix}_released_amount_mismatch`);
    } else released += fill.releasedAmount;

    const windowComplete = Number.isSafeInteger(fill.signaledAt) && Number.isSafeInteger(fill.expiresAt) &&
      Number.isSafeInteger(fill.paidAt) && Number.isSafeInteger(fill.fulfilledAt);
    if (!windowComplete || fill.signaledAt! <= 0 || fill.expiresAt! <= fill.signaledAt! ||
      fill.paidAt! < fill.signaledAt! || fill.paidAt! > fill.expiresAt! || fill.fulfilledAt! < fill.paidAt!) {
      reasons.push(`${prefix}_outside_provider_intent_window`);
    }

    try {
      const receiptReference = xMoneyPaymentReference(fill.paymentId ?? '', hmacKey);
      if (localReferences.has(receiptReference) || usedReceiptReferences.has(receiptReference)) reasons.push(`${prefix}_receipt_replay`);
      localReferences.add(receiptReference);
      receiptReferences.push(receiptReference);
    } catch {
      reasons.push(`${prefix}_payment_id_missing`);
    }
  }
  if (!order.fills.length) reasons.push('no_fills');
  if (released !== order.filledAmount) reasons.push('released_amount_total_mismatch');
  if (order.deliveredAt !== undefined && (!Number.isSafeInteger(order.deliveredAt) || order.fills.some(fill => Number.isSafeInteger(fill.fulfilledAt) && fill.fulfilledAt! > order.deliveredAt!))) {
    reasons.push('delivery_time_mismatch');
  }

  return {
    bindingId: binding.bindingId,
    depositId: binding.depositId,
    state: order.state,
    verified: reasons.length === 0,
    paidUsd: Math.round(paidUsd * 100) / 100,
    releasedBaseUsdcUnits: released.toString(),
    paymentCount: receiptReferences.length,
    receiptReferences,
    rawReceiptStored: false,
    reasons
  };
}
