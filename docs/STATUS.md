# Funded status

Audit against the original brief, as of the dashboard pull request. Later pull requests move items out of "remaining." Nothing in this list was merged. `launchEnabled` and `peerOrdersEnabled` stay false. No launch, swap, bridge burn, or Peer order has been sent.

## Done

| Spec item | Where it stands |
| --- | --- |
| Investigation, verified facts separated from assumptions | [INVESTIGATION.md](./INVESTIGATION.md) |
| Architecture, custody called custodial, Postgres schema, cost disclosure | [ARCHITECTURE.md](./ARCHITECTURE.md), `db/postgres.sql` |
| Genuine Float `launch` encoding, fee receiver in instruction data, 23 accounts checked against a finalized transaction | Unsigned preview. It returns no blockhash and no signature |
| First buy `BuyExactIn` layout checked against finalized TOEY and NIXO launches | Added to the preview only when the amount is positive. Minimum out is 1 |
| Creator signs; Funded-held receiver; zero spread | Defaults in `loadConfig`. Configurable. Execution flags stay false |
| Idempotent receipts, conflicting replays rejected, balanced journal | SQLite and Postgres |
| Multi-token per creator | Postgres `creatorBatches` |
| Durable jobs: lease, fence, retry, dead-letter, idempotency keys | `outbox` |
| Planning path intake → swap quote or hold → bridge read → Peer plan | No submission. A missing route does not enqueue a bridge |
| Partial fill, full fill, refund, expiry, duplicate order ids | Fixture only |
| Pause blocks preview, job lease, and submission events; reads continue | [RUNBOOK.md](./RUNBOOK.md) |
| Fee deposit watch for SOL, legacy SPL, and Token-2022 | Uncredited. Token-2022 and native SOL stay in review |
| Jupiter quote guard: slippage, impact, single pool, program allowlist | Quote only |
| CCTP attestation read | Does not verify destination minting and does not burn |
| Reconciliation drift alert | `paymentComplete` stays false |
| Fixture sanctions screen | Not a live clearance |
| Earnings, payout history, liquidity activity, cost lines | Existing pages |
| Responsive layout | Existing CSS |
| CI | `npm test` on Postgres 16 |
| No claim page | Copy and routes |

## Blocked

| Item | On whom | Why it is blocked |
| --- | --- | --- |
| A public fee-receiver address | Owner | The preview will not name a receiver until `FUNDED_FEE_RECEIVER` is set. The key must stay outside the repo |
| Approved custody before any balance is held | Owner and counsel | The default mode is `funded_receiver_unapproved`. Holding fees is custodial |
| Any devnet or mainnet signature | Owner | Needs a separate explicit authorization |
| Preproduction Peer test that proves USD arrived | Peer, then owner | Open question. The SDK can construct a preproduction client; we have not sent an order |
| Whether live payouts need Peer or X Money approval | Peer and X Money | Open question |
| Whether the X Money sender can display as @fundedonfloat | Peer and X Money | Open question. The site says a liquidity provider may be the sender |
| Enabling a quote Float has not listed | Float's lister key | The program returns `QuoteDisabled` |
| A stable LaunchLab program id if Float upgrades | Float | The verified launches used `LanMV9s…`. The website bundle also names `DRay…` |
| Live sanctions screening | Owner | No vendor is connected. Fixture `clear` is not clearance |
| Money-transmission, sanctions, tax, and tokenized-stock review | Counsel | Required before a public service that holds funds |
| Brand permission for Float's name or mark | Float, if we ever use their mark | Funded does not present itself as endorsed |

## Remaining

These do not need the owner before they can be built. They are still open in this revision.

| Item | Gap |
| --- | --- |
| Original branding | The interface still uses the dark-blue palette and DM Sans associated with Float's site |
| Launch portal | The fields exist. Review is a short JSON summary, not a transaction review screen that lists every account, the fee receiver, and the first buy before anything could be signed |
| Token explorer and token pages | A signature dump and a mint readout. The token page does not show the Float launch account, provenance, or the read-only deposit watch |
| RPC failover health | Failover exists inside `SolanaReader`. There is no health report of which endpoints answered |
| Alerts in the product | `GET /api/alerts` exists. No page shows pause, journal imbalance, attribution drift, or a stale order |
| End-to-end fixture of fee → USDC plan → bridge read → Peer plan, including crash recovery | The pipeline plans those stages, but a non-USDC fee stops after the quote, and a leased job is not reclaimed after the worker dies |

## Not claimed

A configured preview, a Jupiter quote, an attestation, a matched buyer, or a fixture fill is not a completed USD payment. Postgres is the financial ledger only when `FUNDED_DATABASE_URL` is set. Drafts stay in SQLite.
