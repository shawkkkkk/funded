import { createCashClient } from '@zkp2p/cash';
import { handle } from './domain.ts';
import { IntegrationBlocked } from './policy.ts';
import { XMONEY_RECEIPT_CONTROLS } from './xmoney-receipt.ts';

export const SENDER_NOTICE = 'A matched buyer sends the dollars through X Money and appears as the sender. Funded can be identified as @fundedonfloat in the X Money payment notes, not as the sender.';
export const CLAIMLESS_NOTICE = 'Funded has no withdrawal or claim balance. Claimless X Money delivery is available only after the recipient and production payout route are verified; otherwise Base USDC stays held and no payout is labeled complete.';
export const MARKETPLACE_NOTICE = 'Peer Cash 0.8.1 reports a zero-spread oracle market rate that binds when a buyer submits intent. The estimate remains approximate, and Funded has not yet verified X Money fill timing, liquidity, or actual USD receipt end to end.';

export const OPEN_QUESTIONS = Object.freeze([
  'Can the whole flow be tested end to end in preproduction, including proof the USD arrived?',
  'What observed X Money liquidity, fill time, expiry, and return behavior apply in preproduction and production?'
]);

export function xmoneyReceive(payee: string) {
  return { platform: 'xmoney' as const, currency: 'USD' as const, payee: '@' + handle(payee) };
}

/** Local SDK metadata only. This does not estimate, register a payee, or create an order. */
export function localSdkFacts() {
  const caps = createCashClient({ environment: 'production' }).capabilities();
  const xmoney = caps.platforms.find(item => item.platform === 'xmoney');
  if (!xmoney?.currencies.includes('USD') || xmoney.requiresIdentityAttestation || caps.pricing.spreadBps !== 0) {
    throw Error('Installed Peer SDK does not match the reviewed X Money USD surface');
  }
  return {
    package: '@zkp2p/cash@0.8.1',
    xMoneyUsd: true as const,
    xMoneyPricingKind: xmoney.pricing.USD.kind,
    pricingKind: caps.pricing.kind,
    spreadBps: caps.pricing.spreadBps,
    minBaseUnits: caps.amount.min.toString(),
    recommendedMinBaseUnits: caps.amount.recommendedMin.toString(),
    maxBaseUnits: caps.amount.max === null ? null : caps.amount.max.toString(),
    marketDiscountBps: 0,
    ordersEnabled: false,
    usdArrivalVerified: false,
    claimlessEligibility: 'unverified' as const,
    partnerApprovalRequired: false as const,
    senderDisplay: 'matched_buyer' as const,
    paymentNoteBranding: '@fundedonfloat' as const,
    receiptControls: XMONEY_RECEIPT_CONTROLS
  };
}

export function livePeerOrder(): never {
  throw new IntegrationBlocked('Peer orders stay disabled until custody, signer policy, live screening, recipient eligibility, and controlled end-to-end USD receipt testing are complete.');
}

type Order = {
  id: string;
  payee: string;
  units: bigint;
  filled: bigint;
  usdMicros: bigint;
  status: 'awaiting_buyer' | 'partially_paid' | 'paid' | 'returned';
};
export class FixtureCash {
  private orders = new Map<string, Order>();
  private keys = new Map<string, string>();
  deposit(idempotency: string, units: bigint, payee: string) {
    if (!/^fixture:[\w:-]{1,120}$/.test(idempotency)) throw Error('Fixture order ids only');
    const receive = xmoneyReceive(payee);
    const prior = this.keys.get(idempotency);
    if (prior) {
      const order = this.orders.get(prior)!;
      if (order.units !== units || order.payee !== receive.payee) throw Error('Conflicting order replay');
      return { order, duplicate: true, submits: false as const, receive };
    }
    if (units < BigInt(localSdkFacts().minBaseUnits)) throw Error('Below the SDK minimum');
    const order: Order = { id: 'fixture-deposit:' + idempotency, payee: receive.payee, units, filled: 0n, usdMicros: 0n, status: 'awaiting_buyer' };
    this.orders.set(order.id, order);
    this.keys.set(idempotency, order.id);
    return { order, duplicate: false, submits: false as const, receive, paymentVerified: false as const };
  }
  private open(id: string) {
    const order = this.orders.get(id);
    if (!order || order.status === 'returned' || order.status === 'paid') throw Error('Order is not open');
    return order;
  }
  prove(id: string, units: bigint, usdMicros: bigint, minFiatBps: bigint) {
    const order = this.open(id);
    const left = order.units - order.filled;
    if (units <= 0n || units > left || usdMicros <= 0n || usdMicros > units || usdMicros * 10_000n < units * minFiatBps) throw Error('Fill does not meet the disclosed economics');
    order.filled += units;
    order.usdMicros += usdMicros;
    order.status = order.filled === order.units ? 'paid' : 'partially_paid';
    return { ...order, paymentVerified: true as const, submits: false as const };
  }
  withdraw(id: string) {
    const order = this.open(id);
    const remainder = order.units - order.filled;
    if (remainder === 0n) throw Error('Nothing to return');
    order.status = 'returned';
    return { remainder, submits: false as const, paymentVerified: false as const };
  }
  expireIntent(id: string) {
    this.open(id);
    return { fundsMoved: false as const, paymentVerified: false as const };
  }
}
