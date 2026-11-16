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

## Done in the stack after the first audit

| Item | Where |
| --- | --- |
| Transaction review lists every launch account, the fee receiver, and the first buy | Launch page, on top of the brand already on main |
| Token explorer, token page with the Float launch account, alerts page | `/explore`, `/token/:mint`, `/alerts` |
| RPC health lists each endpoint host and fails over | `GET /api/rpc-health` |
| Fixture walks a fee quote, a bridge read, and a Peer plan after a crashed lease | `test/pipeline-e2e.test.ts` |

The planned USDC amount is an observation. The batch stays in the original asset, Base settlement stays unverified, and `ordersEnabled` stays false.

## Still remaining, and not blocked on the owner

| Item | Gap |
| --- | --- |
| Mark file | `public/funded-mark.webp` is still the earlier wave-and-dollar image |
| Scheduled retry of a route that was not safe | A missing route completes the planning job instead of requeueing itself |
| Token-2022 and native SOL attribution | Deposits are classified and held. They are not credited |

## Not claimed

A configured preview, a Jupiter quote, an attestation, a matched buyer, or a fixture fill is not a completed USD payment. Postgres is the financial ledger only when `FUNDED_DATABASE_URL` is set. Drafts stay in SQLite.
