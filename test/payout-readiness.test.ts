import assert from 'node:assert/strict';
import test from 'node:test';
import { payoutReadiness } from '../src/payout-readiness.ts';

const base = {
  rail: 'xmoney' as const,
  xMoneyEligibility: 'eligible' as const,
  partnerApproved: true,
  baseUsdcUnits: 10_000_000n,
  minimumBaseUsdcUnits: 5_000_000n
};

test('claimless payout requires recipient eligibility, partner approval, and the minimum', () => {
  assert.deepEqual(payoutReadiness(base), {
    status: 'ready', claimRequired: false, fallback: 'hold_base_usdc', reason: 'Eligible for a Peer X Money order'
  });
  assert.equal(payoutReadiness({ ...base, xMoneyEligibility: 'unverified' }).status, 'blocked_recipient');
  assert.equal(payoutReadiness({ ...base, xMoneyEligibility: 'ineligible' }).status, 'blocked_recipient');
  assert.equal(payoutReadiness({ ...base, partnerApproved: false }).status, 'blocked_partner');
  assert.equal(payoutReadiness({ ...base, baseUsdcUnits: 4_999_999n }).status, 'accumulating');
});

test('unapproved rails stay held and never become claim balances', () => {
  const result = payoutReadiness({ ...base, rail: 'cashapp' });
  assert.equal(result.status, 'blocked_partner');
  assert.equal(result.claimRequired, false);
  assert.equal(result.fallback, 'hold_base_usdc');
  assert.match(result.reason, /not approved/);
  assert.throws(() => payoutReadiness({ ...base, baseUsdcUnits: -1n }), /Invalid payout amount/);
});
