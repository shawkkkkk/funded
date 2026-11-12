# X Money payout benchmark

Observed November 11, 2026. This is a competitor and architecture review, not an endorsement or proof that any external service will accept Funded in production.

## Payday Direct

The public [Payday payout documentation](https://payday.direct/explore#docs/payouts) describes a pump.fun product that routes creator fees to one payout wallet, swaps them to USDC, bridges to Base, and lists a Peer order with the X account as payee. A Peer buyer sends dollars through X Money; Peer checks payment proof before releasing USDC to the buyer.

The same documentation says:

- the account owner does not need a Payday wallet or account when X Money delivery works;
- the matched order can remain unfilled and the fill is not guaranteed;
- order economics may use roughly a 10% buyer discount, then roughly 20% after a day;
- a failed X Money route can fall back to an X-authenticated USDC wallet after seven days; and
- the visible fiat sender is the marketplace buyer, not necessarily the product brand.

These are Payday's published product claims. Funded has not reproduced its transactions, tested its Peer account, audited its custody, or verified that its pricing applies to Funded.

## What the benchmark establishes

| Question | Evidence | Funded decision |
| --- | --- | --- |
| Can creator fees fund an X Money marketplace order? | A public competitor documents that design. | Keep Peer as the first rail to validate. This is supporting evidence, not Funded's approval. |
| What controls Funded's recipient rate? | Peer Cash 0.8.1 documents a zero-spread Base oracle rate that binds when the buyer submits intent. Payday's historical discount is a separate product claim. | Store the bound intent rate; label earlier estimates approximate and require fiat proof before `paid`. |
| Is “no claim” universal? | No. It depends on recipient eligibility and successful delivery. | Verify recipient eligibility before routing. Hold Base USDC if blocked; do not create a public claim balance. |
| Who appears as sender? | Payday documents the marketplace buyer; the owner-supplied Peer reply confirms the matched buyer for Funded. | Disclose the matched buyer as sender and identify `@fundedonfloat` only in payment notes. |
| Is delivery immediate or guaranteed? | No. Orders depend on buyer liquidity. | Persist awaiting, partial, returned, and paid as separate states. |

## Acceptance gates

Before enabling production orders, require all of the following:

1. Configure the public Peer SDK. The owner-supplied Peer reply says no separate partner approval is required; business, legal, and X Money eligibility checks remain separate gates.
2. A controlled test verifies payee ownership/consent, recipient eligibility, accepted order, partial/full fill evidence, return behavior, and actual USD receipt.
3. The live minimum, intent-bound oracle rate, expiry, fees, and sender presentation are returned by a trusted provider response or contract state and stored with the order.
4. Custody and signing are approved, segregated, capped, monitored, and independently reconciled.
5. The public UI labels anything short of verified fiat evidence as pending—not paid.

Funded deliberately does not copy Payday's recovery-wallet claim flow. An ineligible or blocked recipient remains a held Base USDC exception until an operator-approved automatic rail is available.

## Backers receipt controls

[Backers' public guide](https://trybackers.com/docs#overview), reviewed November
11, 2026, documents a different product: a backer first pays a named recipient
through X Money, then submits the X Money receipt so a Solana pool can reimburse
the backer with a bonus. Funded does not adopt that rebate, bonus, SOL pool,
ten-minute hold, strike, or user-submitted receipt-link model.

The reusable control pattern is receipt binding. Backers documents one payment
per hold, sender/recipient/amount/currency/time/status checks, rejection of reused
payments, encrypted receipt handling, and explicit pending/manual-review states.
Funded adapts those controls to Peer orders in `src/xmoney-receipt.ts`:

- bind one reviewed plan to the persisted Peer `depositId`, on-chain payee hash,
  and exact Base-USDC amount;
- require exactly one X Money/USD payout leg and only fulfilled fills;
- require each payment time to fall inside that fill's provider-reported intent
  window and require released Base USDC to match the fill amount;
- derive a keyed HMAC reference from each external payment id for replay checks;
  do not return or persist raw receipt links or payment ids in the receipt view;
- admit a verified result through `003_xmoney_receipts.sql`, whose globally
  unique keyed references preserve replay protection across process restarts;
- keep public verification and live execution disabled.

Peer still performs the underlying payment-proof verification. Funded's binding
does not independently authenticate X Money, prove the recipient owns the X
account, or replace the preproduction USD-arrival test.
