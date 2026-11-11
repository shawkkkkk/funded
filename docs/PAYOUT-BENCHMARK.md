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
