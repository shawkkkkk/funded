import type { PayoutRail } from './domain.ts';

export type XMoneyEligibility = 'unverified' | 'eligible' | 'ineligible';
export type PayoutReadinessStatus =
  | 'ready'
  | 'accumulating'
  | 'blocked_recipient'
  | 'blocked_partner';

export type PayoutReadiness = {
  status: PayoutReadinessStatus;
  claimRequired: false;
  fallback: 'hold_base_usdc';
  reason: string;
};

/**
 * Product gate for a claimless payout. It never creates a recovery wallet and
 * never treats a dashboard balance as creator-owned fiat.
 */
export function payoutReadiness(input: {
  rail: PayoutRail;
  xMoneyEligibility: XMoneyEligibility;
  partnerApproved: boolean;
  baseUsdcUnits: bigint;
  minimumBaseUsdcUnits: bigint;
}): PayoutReadiness {
  if (input.baseUsdcUnits < 0n || input.minimumBaseUsdcUnits <= 0n) throw Error('Invalid payout amount');
  const held = { claimRequired: false as const, fallback: 'hold_base_usdc' as const };

  if (input.rail !== 'xmoney') {
    return { ...held, status: 'blocked_partner', reason: `${input.rail} payouts are not approved` };
  }
  if (input.xMoneyEligibility !== 'eligible') {
    return {
      ...held,
      status: 'blocked_recipient',
      reason: input.xMoneyEligibility === 'ineligible'
        ? 'Recipient cannot receive X Money payouts'
        : 'Recipient X Money eligibility has not been verified'
    };
  }
  if (!input.partnerApproved) {
    return { ...held, status: 'blocked_partner', reason: 'Peer production access is not approved' };
  }
  if (input.baseUsdcUnits < input.minimumBaseUsdcUnits) {
    return { ...held, status: 'accumulating', reason: 'Below the verified Peer order minimum' };
  }
  return { ...held, status: 'ready', reason: 'Eligible for a Peer X Money order' };
}
