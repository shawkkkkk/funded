# Funded architecture

Funded launches genuine Float tokens and pays only the creator allocation out in dollars. There is no claim page. Creators do not need a wallet to receive USD. They do need a wallet to sign the launch, unless the owner later chooses a custodial launcher.

The verified protocol facts are in [INVESTIGATION.md](./INVESTIGATION.md). This document is the system that sits on top of them. It does not authorize a mainnet write.

## Stack

| Piece | Choice | Why |
| --- | --- | --- |
| Language | TypeScript on Node 24 | Already the repo. The owner prefers it. |
| HTTP and pages | The existing Node server, responsive HTML, and CSS | The draft flow, same-origin checks, and payout journal are tested here. |
| Solana | `@solana/web3.js` for PDA derivation and instruction data | The launch account list was checked against a finalized transaction. |
| Peer | `@zkp2p/cash` 0.7.3 | Public SDK. The owner-supplied Peer reply says no separate partner approval is required. Order methods stay unreachable. |
| Production database | PostgreSQL | Durable payouts, unique source locators, and worker leases need it. The schema is `db/postgres.sql`. |
| Local database | SQLite through `node:sqlite` | Zero-credential draft mode already works. It is not the production ledger. |
| Jobs | A leased outbox in the same database | Restart, duplicate delivery, and pause have to survive a process crash. |
| UI framework | Not Next.js in this increment | Next.js is the right shell once the API is stable. Replacing the tested pages before the encoder and payout gates exist does not make a launch safer. |

Deviation from the owner's Next.js preference: keep the tested server as the application core. A later Next.js app should call the same API rather than grow a second payout implementation.

## What the system is

```text
creator wallet  --signs-->  Float launch  --fee_receiver-->  Funded quote account
                                                                      |
                                                              attribute receipt
                                                                      |
                                                         Jupiter route or pending
                                                                      |
                                                         Solana USDC burn (CCTP)
                                                                      |
                                                         verified Base USDC
                                                                      |
                                                         Peer Cash order (X Money)
                                                                      |
                                                         verified USD to creator handle
```

Only the 5% creator allocation is Funded's. Holder rewards, buyback, trader rewards, and treasury stay on Float's own crank. Funded may crank `claim_dev_fees` later, because that instruction is permissionless, but this build does not sign it.

## Launch

`launch` on program `3KguFi7YYzLgttG46fRism16CfcuNCkDh6U7td9JTqxX`, LaunchLab `LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj`, 23 accounts, discriminator `99f15de116454a3d`. `fee_receiver` is the borsh pubkey in `LaunchArgs`. The pinned LaunchLab id is the one in the verified transaction, not the `DRay` constant in the current website bundle.

The preview:

- derives the mint from `["mint", creator, nonce]`
- sets `fee_receiver` to the operator's public address (`FUNDED_FEE_RECEIVER`), never to the creator and never to an X handle
- refuses a quote token program other than Token or Token-2022, and maps `native:sol` to wSOL plus Tokenkeg
- maps headline tiers 1% / 2% / 2.5% to on-chain indexes 0 / 1 / 2
- does not build the first-buy instruction
- returns no blockhash and no signature
- when a read-only RPC is configured, re-reads config and refuses the preview if launches are paused or the treasury, split, or tier rates differ from the 9 November 2026 pin

A quote mint still has to be enabled on chain (`QuoteDisabled` otherwise). The preview does not invent an allowlist of all 178 current quotes. An operator read of the quote-asset account is a separate gate before any signature.

## Custody

A generated receiving wallet is custodial if Funded can sign for it. Calling it noncustodial because the address is a normal keypair would be false. The creator authorizes the address by signing a launch whose `fee_receiver` is that pubkey. After that signature, the creator cannot redirect fees. Recovery belongs to whoever controls the key, not to a claim button.

Options:

1. **Creator signs, Funded holds the receiver key.** Recommended for the product as specified. The creator never custodies the fees. Funded does. This needs a licensed or otherwise approved custody arrangement, scoped signing, dual control for policy changes, and a written return policy.
2. **Qualified custodian holds the key and Funded is an instruction client.** Better isolation. Depends on a vendor the owner has not selected.
3. **Funded also signs the launch.** This is how some third-party sites operate. It means Funded is the on-chain creator, holds launch authority, and takes customer SOL for the launch. That is a larger transmission and operational risk. Not recommended.

This repository never generates or stores a key. The server accepts only a public address. Signing stays outside the web process. Pause stops new submission events and does not stop reading or reconciling money already in flight.

## Fee processing

A balance increase is not a creator fee. Credit requires a finalized `claim_dev_fees` (or a later reviewed shape) that pays the enrolled ATA, matches the mint and owner, and has not been used as a source locator. The existing SPL reviewer covers one narrow shape. Native SOL and Token-2022 stay in review until their own reviewed policies exist. Ambiguous transfers stay in review.

Each credited receipt has a unique origin (`chain, signature, account`). Replays with the same payload return the original row. A conflicting payload throws.

One creator handle can have many mints. Batches do not mix mints, rails, or consent versions. Changing the handle does not rewrite an open Peer order. The new handle applies to later receipts, and the change is an audit event that holds new submissions until consent is recorded again.

## Conversion

Exact-input only, to Solana USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`. The route must name an allowlisted mint, an allowlisted program set, a fresh quote, and a minimum out that satisfies slippage and a configured floor. Transfer fees come off the net. No route, a thin book, or a quote that fails the guard leaves the receipt in the original asset with `waiting_route`. Nothing is swapped to a different payout rail to "make it work."

The Jupiter preflight remains read-only. It does not return a transaction for the server to send.

## Bridge

CCTP V2, Solana domain 5 to Base domain 6, canonical Base USDC, standard transfer, no hooks. Persist the burn signature and message identity before treating a submission as unknown. On timeout, look up that signature. Do not burn a second time because the first result is missing. Credit Base USDC only after the destination mint, recipient, amount, and message match the pin. The current Iris preflight does not itself verify attestation signatures or the mint transaction. Those remain a later verification step, not a shortcut.

## Peer

The adapter speaks the public SDK:

- receive leg `{ platform: "xmoney", currency: "USD", payee: "@handle" }`
- local `capabilities()` for limits and the zero spread
- `prepare` / `cashout` / `withdraw` / `topUp` are coded as a blocked port, not called
- `order` is the only status source, and a fixture implements it in tests

Deposit confirmation moves a batch to `awaiting_buyer`. It is not `paid`. A fill counts only when `fiat_proven` carries a payment id, USDC consumed, and USD micros inside the order's economics. Partial fills stay `partially_paid` until the escrow is zero. `withdraw` of the full remainder returns the batch to Base USDC for another attempt. An expired intent records `intent_expired` and moves no funds. Based on the owner-supplied Peer reply, the matched buyer appears as the X Money sender and `@fundedonfloat` can appear in the payment notes. Funded does not present itself as the sender.

Cash App and Venmo remain visible as disabled planned rails in the draft form. They are not enabled for live payout. X Money is the first rail to test, after recipient eligibility, SDK integration, custody, and a controlled test wallet are ready. If a gate fails, funds stay held as Base USDC; Funded does not create a creator-facing recovery wallet or claim balance.

## Payout state

`received → waiting_route → swap_pending → solana_usdc → bridge_pending → base_usdc → peer_pending → awaiting_buyer → partially_paid → paid`

Branches: `awaiting_buyer` or `partially_paid` can return unspent escrow to `returned`, then resume at `base_usdc`. Any non-paid state can enter `review`. `intent_expired` stays on the current open order and does not journal funds. `paid` is terminal.

`paid` is written only when verified USD covers the consumed USDC at the recorded minimum. A quote, an unsigned transaction, a deposit, or a buyer match is not `paid`.

## Data

`db/postgres.sql` is the production schema: creators, consent versions, launches, receipts, batches, events, journal lines, peer orders, fills, jobs, and pauses. Source locators and Peer order ids are unique. Journal lines are append-only. Jobs carry a lease owner and a fencing token.

The local server keeps using SQLite for drafts, the existing batch journal, pause, and fixture runs. It does not open a Postgres connection until the owner provides a database and this process is explicitly pointed at it. Dual-writing is worse than one temporary store with a declared production schema.

## API

Local and same-origin, as today.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/`, `/launch`, `/how`, `/explore`, `/token/:mint`, `/earnings`, `/payouts`, `/liquidity` | Pages. No claim control. |
| POST | `/api/drafts` | Validate and store a draft. |
| POST | `/api/launch-preview` | Unsigned instruction preview. `submit` is false. |
| GET | `/api/status` | Gates, pause, SDK facts that are local, open questions. |
| GET | `/api/disclosure` | Cost breakdown shape and the sender notice. |
| GET | `/api/payouts` | Public batch rows. No handles. |
| GET | `/api/transactions`, `/api/mint`, `/api/float-account` | Read-only chain views when one RPC is configured. |

There is no `/api/launch`, `/api/claim`, `/api/cashout`, or `/api/withdraw`.

## Jobs, pause, and alerts

Workers lease a job with a fencing token, write the chain identity they are about to use, then broadcast only in a future authorized signer. This build's worker is the fixture loop: it does not sign and does not open a socket to Peer.

Pause rejects `swap_submitted`, `bridge_submitted`, and `peer_submitted`. It does not reject finalized observations, fill proofs, or returns. Alerts are pure records: paused, stale stage, config pin drift, journal imbalance, and a Peer order with no proof past a configured age. Nothing is paged to an external vendor from this process.

## Cost disclosure

Shown per batch, in integers:

- original quote-asset units received
- creator share of the Float fee at 500 / 10000, with division dust excluded from the creator figure
- the headline tier is not the creator's take: on the curve the verified tier rates are 0.75%, 1.75%, and 2.25% of volume for Float, and Float documents an additional 0.25% to Raydium
- conversion units in and USDC out, or "pending, no safe route"
- bridge fee and net Base USDC, or "not bridged"
- Peer protocol spread: 0 bps in the reviewed SDK capability metadata
- Marketplace buyer discount: unknown until a live quote/order supplies it; never infer it from the SDK spread or default it to zero
- USD micros delivered, only after `fiat_proven`
- amount still pending

No dollar price is invented for an illiquid quote.

## Security

- Web process does not sign and does not see a seed.
- Same-origin JSON for writes. DNS-rebinding host check stays.
- RPC client allows only the existing read methods.
- Preview cannot target a receiver other than the configured public address.
- Peer payee changes do not alter an order id already stored.
- Fixture order ids and consent ids cannot be mistaken for production ids; production execution throws.
- Sanctions and denied-handle checks are not implemented because no screening vendor is connected. That blocks a live payout, not a fixture.
- Tokenized-stock quotes can be frozen by their issuers. The holder of the receiver key bears that delay. The creator is told before launch.

## Recovery

| Failure | Action |
| --- | --- |
| Launch signature unknown | Look up the exact nonce and mint PDA. Do not send a second launch for the same nonce until the first is absent. |
| Swap unknown | Look up the recorded signature. Do not build a second swap for the same receipt. |
| Bridge message missing | Keep the burn signature. Do not burn again. |
| Peer indexer lag | Re-read `order(depositId)`. Do not create another deposit. |
| Live buyer intent | Do not withdraw the full order. Partial withdraw only of unlocked funds, and only once authorized. |
| Pause | Stop new submissions. Keep reading. |
| Program upgrade | Refuse previews whose config pin or discriminator no longer matches. |

## Regulatory gate

Do not deploy this as a public service that receives customer funds until counsel has reviewed, at least:

- FinCEN money-services and convertible-virtual-currency guidance, and whether holding creator fees for conversion is money transmission
- state money-transmitter licensing
- OFAC screening of handles, mints, and counterparties
- X Money's and Peer's terms for a business that originates payouts
- whether specific tokenized-stock and pre-IPO quotes are securities or otherwise restricted
- tax reporting on USD payouts
- the brand boundary with Float

A local fixture, a quote, or a successful unit test is not that review.

## Owner decisions

1. **Custody.** Options are Funded-held receiver, qualified custodian, or Funded-signed launches. Recommendation: creator-signed launches and a Funded-held receiver under an approved custody arrangement. Supply the public address only.
2. **LP incentive.** Options are the SDK's zero spread, or a separately funded discount with its own accounting. Recommendation: zero spread, fully disclosed, until Peer answers the fill-time question. Do not copy BagsPay's 10/20 percent.
3. **UI shell.** Options are to stay on this server or rewrite in Next.js now. Recommendation: stay, and add Next.js only as a client of this API.
4. **Peer testing.** Recommendation: disclose the matched buyer as sender and `@fundedonfloat` as payment-note identity, and do not run a controlled test until the owner authorizes a funded wallet.

## Still blocked on someone else

- Owner: public receiver address, custody approval, any live or devnet signature, counsel.
- Float: enabling a quote that is not already listed; they can also pause or upgrade without notice.
- Peer: the two open questions in the investigation. The SDK integration does not wait on them. A real payout does.
