# Funded investigation

Date of the reads: 9 November 2026. Product name: **Funded** (X: [@fundedonfloat](https://x.com/fundedonfloat)). Funded is an independent interface. It is not a Float product and is not endorsed by Float.

This note separates what was checked against a public source or a finalized mainnet account from what is only inferred. No launch, swap, bridge, or Peer order was submitted. No key was generated and no secret is recorded here.

## Answer

A Funded site can prepare a genuine Float launch whose creator allocation is paid to a Funded address.

The creator still has to sign the launch. The Float program `3KguFi7YYzLgttG46fRism16CfcuNCkDh6U7td9JTqxX` stores `fee_receiver` in the `launch` instruction and copies it into `LaunchState`. That address does not have to be the creator. On-chain accounts already show other wallets receiving the creator share for SOL, USDC, and a tokenized-stock quote, including after graduation. Claiming that share is a separate, permissionless Float instruction that pays the receiver's quote-token account.

Two limits are verified. Launching on Float's public Raydium fee tier without calling the Float program does not get Float's split. A quote mint launches only if Float has already enabled it. Float's admin can pause launches or upgrade the program, so the path stays available only while that permissionless program behavior remains.

Funded has not sent this transaction. Doing so needs the owner's explicit authorization and a receiver address the operator controls. It does not, on the evidence below, need a private integration agreement with Float.

## How the reads were made

- Float's docs, create page, and terms: [floatlaunch.xyz/docs](https://www.floatlaunch.xyz/docs), [/create](https://www.floatlaunch.xyz/create), [/terms](https://www.floatlaunch.xyz/terms).
- The public coins list: `GET https://www.floatlaunch.xyz/api/coins` (4,876 rows at the time of the read).
- The launch instruction layout published inside Float's current website bundle (`/_next/static/immutable/chunks/1g3wbw0ya0gj2.js`, program metadata name `launchpad` `0.1.0`). The bundle is minified client code, not a signed release, so it is evidence of what the site builds, then checked against accounts and one transaction.
- Finalized mainnet reads through `https://solana-rpc.publicnode.com`. `getGenesisHash` returned `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` (Solana mainnet).
- Peer Cash SDK `@zkp2p/cash@0.7.3` installed locally. `createCashClient` and `capabilities()` were called in-process. `estimate`, `prepare`, `cashout`, `order`, `withdraw`, and `topUp` were not called.
- Peer docs: [Peer Cash guide](https://docs.peer.xyz/developer/peer-cash/guide) and the [peer-cash repository](https://github.com/zkp2p/peer-cash).
- BagsPay, used only as a comparison: [Pay Fees to X Money](https://docs.bags.fm/how-to-guides/pay-fees-to-x-money).

## Verified facts

### The Float program is the launch path that carries the fee split

Float's docs say coins launch on Raydium LaunchLab with a fixed supply of 1,000,000,000, no mint or freeze authority, a launch market cap of about $20,000, and graduation at about 7.5x into a Raydium pool locked with Burn & Earn. The same page says Float's fee tiers are public LaunchLab platforms, so other apps can launch on those platforms outside the site, and those coins do not go through the Float program and do not get its fee split or rewards.

That warning matches the account model. The split is recorded on a Float `LaunchState` account. A Raydium-only launch does not create one.

The terms page says the site builds transactions for the user to sign and does not hold the user's keys. The create page offers **Me** and **Other wallet** under "Who gets the fees?" and says the share is paid in the pairing asset.

### Instruction the site actually builds

The published client builds Anchor instruction `launch` (discriminator `99f15de116454a3d`, 23 accounts) or `launch_keyed` (discriminator `1022baa4b3e3657e`, same account list). Arguments are `LaunchArgs`:

| Field | Type | Client documentation |
| --- | --- | --- |
| `name` | string | metadata name |
| `ticker` | string | 1–10 letters or digits; the ticker record is keyed by the uppercase form |
| `uri` | string | metadata URI |
| `fee_receiver` | pubkey | "The dev's wallet, paid the dev share of the coin's fees." |
| `fee_tier` | u8 | index into the three config rates; 0 is the default |
| `mint_nonce` | u64 | ignored by `launch_keyed`, where the mint keypair signs |

`fee_receiver` is instruction data, not an account. A reviewer that only checks account positions cannot see it.

`LaunchState.fee_receiver` is documented in that same client as "a wallet, or a pre-generated wallet for an X handle." The creator signs. The receiver does not.

Account order used by both the client and the transaction below:

`creator` (signer, writable), `config`, `treasury` (writable), `quote_asset`, `quote_mint`, `ticker_record` (writable), `coin_mint` (writable), `launch` (writable), `coin_vault`, `global_config`, `platform_config`, `launchlab_authority`, `pool_state` (writable), `base_vault` (writable), `quote_vault` (writable), `metadata` (writable), `event_authority`, `launchlab_program`, `token_program`, `quote_token_program`, `metadata_program`, `system_program`, `rent`.

Seeds checked by re-deriving them and matching a finalized transaction:

| Account | Seeds | Program |
| --- | --- | --- |
| config | `config` | Float |
| quote asset | `quote`, quote mint | Float |
| ticker | `ticker`, uppercase ticker | Float |
| mint, for `launch` | `mint`, creator, nonce as u64le | Float |
| launch | `launch`, mint | Float |
| coin vault | `coin`, mint | Float |
| global config | `global_config`, quote mint, `[0]`, `[0, 0]` | LaunchLab |
| platform | `platform`, `[tier]` | Float |
| platform config | `platform_config`, platform | LaunchLab |
| pool | `pool`, mint, quote mint | LaunchLab |
| pool vaults | `pool_vault`, pool, mint | LaunchLab |
| authority | `vault_auth_seed` | LaunchLab |
| event authority | `__event_authority` | LaunchLab |
| metadata | `metadata`, Metaplex program, mint | Metaplex |

### Finalized launch with a different receiver

Transaction [3zqQfDYM3SwvY15NfxURfMiCduGSUYdXigB4x8JxRGF4rAaFpTGsRyCHZPhUmnkgUMEZbQY1FVsNJsygULjvw4s2](https://solscan.io/tx/3zqQfDYM3SwvY15NfxURfMiCduGSUYdXigB4x8JxRGF4rAaFpTGsRyCHZPhUmnkgUMEZbQY1FVsNJsygULjvw4s2), slot 466976485, succeeded. It is the oldest signature on mint `28Tcf5zCLRz8TbVcDyE89BcMw139FTyk6e1KCBqNGJrJ` (56 signatures total).

- Log: `Instruction: Launch`, then LaunchLab `InitializeV2`.
- Discriminator: `99f15de116454a3d` (`launch`, not `launch_keyed`). Data length 120.
- Creator and signer: `ix9YkGjxyxvtADosH1mWWk3TUUuoNtbjHwm9bzN7DVq`.
- `fee_receiver`: `C2C4ASTqWHaYx74EkZZ9AqKc4FnTpqnGJGy5d3aG1kRB` (on-curve, not the creator).
- Name `José`, ticker `SoLMiNeR`, tier 0, nonce `1287779982042431197`.
- Metadata URI `https://floatmine.xyz/m/5V1KVwyGwH3hd1NqA.json`. This launch was not hosted on `float.mypinata.cloud`, which is what Float's own create flow uses. A third-party site has already submitted this shape.
- `launchlab_program` account: `LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj`. The inner call is that program's `InitializeV2`.
- Platform config account `2TDPJJPV6nvTEqXABxrqno6Uzpipxxvh1zjLN3SMYn69`, which is tier 0 in the config account below.
- Every derived PDA listed above matches this transaction, including the mint PDA.

The current Float website bundle hardcodes a different LaunchLab id, `DRay6fNdQ5J82H7xV6uq2aV3mNrUZ1J4PgSKsWgptcm6`, and does not mention `LanMV9s`. The program data account `3gxm2SYDuNrx3cGEWoqq3kguHVbj3ycpPwLMuuRpKnYq` records deploy slot 466726024, which is before this transaction. The bytecode that executed the transaction invoked `LanMV9s`, not `DRay`. Deriving the tier platform configs under `DRay` does **not** produce the platform addresses stored in Float's config. Deriving them under `LanMV9s` does. Funded must pin `LanMV9s` until a newer finalized launch shows a different program. The bundle's `DRay` constant is not evidence that a launch today should target it.

### Config, split, tiers, pause, supply

Config PDA `AgaKFP4SfEeeM4r4GcSWBwpEAbfHh7wLkJGHqpWrLBQV` is the address in Float's docs. It is owned by the Float program. Discriminator `9b0caae01efacc82` matches the client account `Config`. Length 426. Decoded prefix:

| Field | Value |
| --- | --- |
| admin | `2gJuHVeXf8x3VGLfWeDNkrGdReZomtNb635jf3ohSCTU` |
| treasury | `2LMWFmbGBfw78ZEas2NFmAYfo4bhyBqYboYh9nk3mDFQ` (matches the docs) |
| fee split, bps | holders 1500, dev 500, flagship 3500, traders 3500, treasury 1000 (sum 10000) |
| tier rates | 7500, 17500, 22500 |
| tier count | 3 |
| platforms | `2TDPJJPV6nvTEqXABxrqno6Uzpipxxvh1zjLN3SMYn69`, `7paQR4MLZcGdG8ZYAyj9Qu2UsJgXmNVQGha7g1gim1sG`, `CKpEUk5SRk8CUNhhxaVPKtzKUKLgQe2tQHPH2eXWtaGR` |
| flagship mint | `Bv1a7cEj5aRnJQhMw4kRQqAFesMSd5LwcDnUzq52BMmr` (matches the docs) |
| swap guard | TWAP 600 seconds, max deviation 200 ticks, max impact 100 bps |
| ticker takeover | 2,000,000,000 lamports (2 SOL) |
| ticker protect seconds | 0 |
| coin supply | 1,000,000,000,000,000 raw units (1,000,000,000 tokens at 6 decimals) |
| curve sell | 7325 bps |
| launches paused | 0 |

The client documents tier rates as "our fee on every curve trade … on top of Raydium's own 0.25%", in LaunchLab units where 10,000 = 1%. 7,500 + 2,500 = 10,000, and the same arithmetic fits 1.75% + 0.25% and 2.25% + 0.25%. That is the 1% / 2% / 2.5% headline schedule. The 0.25% Raydium piece is Float's documentation; this read did not decode Raydium's platform-fee field.

`curve_sell_bps` of 7325 is the figure the client uses for graduation at about `(0.7325 / 0.2675)^2 ≈ 7.5x`. One config value is used for every coin. There is not a second split for after graduation.

Flagship vault PDA `8CskoMx4FaXjp7gzxNzaWQXGXGVBWYnNWXGcisXuDYAa` and trader vault PDA `JEK3WrPuiePy8vYmzN7Xfk6YoMChbsiqzBs7X43y3snH` match the docs.

### Other wallet already works for more than one pairing asset

`LaunchState` discriminator `be958e9713c48564`, owner Float program, length 210. These finalized accounts store a receiver other than the creator:

| Coin | Status | Quote | Tier | Launch account |
| --- | --- | --- | --- | --- |
| SoLMiNeR | curve | wSOL `So111…112` | 0 | [AZxc1mZKAsFkr8KFYW8rzsAjuwTC5RtmwoVYDEsvqAv](https://solscan.io/account/AZxc1mZKAsFkr8KFYW8rzsAjuwTC5RtmwoVYDEsvqAv) |
| FLTCAT | curve | USDC `EPjFW…t1v` | 1 | [74eAg6TYWopGzqrpac1k5RMPgNwvAdefZ4kxpDeYv9Rf](https://solscan.io/account/74eAg6TYWopGzqrpac1k5RMPgNwvAdefZ4kxpDeYv9Rf) |
| TJR | curve | `Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ` | 0 | [13v93vAeC8CDhwkioCJwTdGhcDKw8zeKVhXRZ6MAXCz](https://solscan.io/account/13v93vAeC8CDhwkioCJwTdGhcDKw8zeKVhXRZ6MAXCz) |
| FUSE (FloatFuse) | graduated | wSOL | 0 | [4GdAJxw8umLFsqdR5Xm6axJJkzhAxHVRA2eYNwQaKRdi](https://solscan.io/account/4GdAJxw8umLFsqdR5Xm6axJJkzhAxHVRA2eYNwQaKRdi) |

The derived `launch` PDA for each mint equals the address in the coins API, and the stored creator, receiver, mint, quote, and tier match that API. FUSE's creator share was claimed (`coin_fees_claimed` 9,319,030,995, `dev_owed` 0) after graduation, with a receiver that is not the creator.

The coins API at read time: 4,876 coins, 195 with `feeReceiver != creator`, 53 `graduated`, tiers 3,958 / 542 / 376, 178 distinct quote mints. Those counts will move.

### How the 5% is paid, before and after graduation

The client's `FeeSplit` text says the coin's own shares (holders + dev) are collected by LaunchLab as its creator fee into the coin PDA, and the platform shares (flagship, traders, treasury) as the platform fee. One bps table applies in both stages. The crank path changes:

| Instruction | Who may call | Role |
| --- | --- | --- |
| `claim_coin_fees` `2c798ca991b3025d` | any payer | pull the curve creator-fee vault into the coin's accounting |
| `claim_dev_fees` `926238806bd22c29` | any payer | pay `dev_owed` to `dev_quote` |
| `harvest` `e4f11fb635a93bc7` | any payer | pull platform fees to flagship, traders, and treasury |
| `harvest_graduated` `dc5db8269e041cc4` | any payer, with `min_quote_out` | same split after graduation, through CPMM and the lock program |
| `cycle` `6f30b14767b706aa` | any payer | CLMM swap of a vault balance, under the swap guard |
| `cycle_amm` `15d528333cd6a6de` | distributor only | AMM swap with an explicit minimum |
| `pay_holders` `fa38422cbdb02e9b` | distributor only | pay the holder pot |
| `pay_traders` `d723394c11fb7886` | distributor only | pay an approved airdrop |

Error `WrongPayoutAccount` (6013): "Payout account is not the expected associated token account." The client passes the fee receiver's quote ATA as `dev_quote`. Error `PotShort` (6024): "Payout would dip into the dev's unpaid share." The dev balance sits in the coin vault and cannot be paid to holders.

So the 5% does not depend on Float's distributor bot. Anyone can crank `claim_dev_fees` to the receiver's ATA. Holder rewards and trader airdrops do depend on the distributor key (`NotDistributor`, 6029).

`QuoteDisabled` (6006): "This stock token is not enabled for launches." `list_pair` is `NotLister` (6031). A pasted mint that Float has not enabled cannot be launched. The create page's "paste a token address" box does not bypass that. Availability to launch and availability to liquidate are different gates: docs also say some quotes (XBTC, XHYPE at the time of the docs) have no Raydium pool back to SOL or USDC, so buyback and airdrop swaps wait.

`LaunchesPaused` (6005) is admin-only via `set_launches_paused`. It was off at this read.

### Program authority

The program is upgradeable (`BPFLoaderUpgradeab1e11111111111111111111111`). Upgrade authority and config admin are the same address, `2gJuHVeXf8x3VGLfWeDNkrGdReZomtNb635jf3ohSCTU`. That address is off-curve. Its account is owned by the System Program and has no data. It is not a normal single keypair, and this read did not identify which program can sign for it. Float's docs say the upgrade authority is still the team's deployer key and is moving to a multisig, and that the program has no outside audit. Those sentences and the off-curve account should both be re-checked before mainnet use. An upgrade can change discriminators, account order, and the fee split.

### Identifying a Float coin

A mint is a Float coin when the `launch` PDA exists, is owned by `3KguFi7…`, starts with discriminator `be958e9713c48564`, and its `coin_mint` field is that mint. The mint's own owner (Token or Token-2022) does not prove it. A LaunchLab CPI under some other program does not prove it. Float's docs say coins launched only on the public fee tiers are not in the split.

### First buy, ticker takeover, metadata

The SoLMiNeR launch had no buy instruction. The client appends a separate LaunchLab instruction when a first buy is requested, discriminator bytes `fa ea 0d 7b d5 9c 13 ec` in the bundle, with a quote amount and a minimum of 1. That buy layout was **not** checked against a finalized transaction here, so Funded does not build it.

The official form caps the first buy at 2% of supply. No error in the published IDL says the program enforces that cap. Treat 2% as a site rule.

Ticker takeover costs 2 SOL on chain. `ticker_protect_secs` is 0, so the on-chain refusal window is off. The docs' 48-hour graduation refund of that 2 SOL, for coins launched after 4 November 2026, 10:01pm CT, was not found as a config field. Treat the refund as site or bot behavior until a transaction shows it.

`InvalidMetadata` (6010) rejects an over-long name or URI. It does not require Float's upload host. SoLMiNeR used `https://floatmine.xyz/...`.

### Conversion and the bridge

Float pays the creator share in the quote mint. Docs name SOL, USDC, crypto, Hylo leveraged tokens, xStocks, PreStocks, Tessera, Sunrise, baskets, and commodities. Transfer-fee quotes named in the docs: PreStocks 1%, Tessera 0.2%. A privacy basket on the create page is marked 0.5%. Tokenized-stock issuers can pause, seize, or add rules later. Those are issuer powers, not Float powers.

Jupiter's quote API can propose an exact-input route. It does not settle. A route that fails a mint allowlist, a program allowlist, a slippage floor, or a transfer-fee net is left pending in the original asset. This was already the local preflight policy and is unchanged.

Circle CCTP documents Solana as domain 5 and Base as domain 6. The local preflight reads an existing Solana USDC burn from Circle Iris and checks one standard V2 message. It does not verify attestation signatures or Base minting. A missing message is not a reason to burn again. Canonical Base USDC used by that check is `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`.

Peer Cash can also route some non-Base assets through Relay, and the guide points non-EVM assets at a NEAR Intents path. This investigation did not find Solana as a Relay source in the Cash guide. Funded's path is Solana quote to Solana USDC, CCTP to canonical Base USDC, then a Base USDC cash-out. Relay is not a substitute for that bridge.

### Peer Cash and X Money

Installed `@zkp2p/cash@0.7.3` with the documented receive leg. `capabilities()` on the production client returned:

- pricing `oracle-market-rate`, `spreadBps` 0
- amount minimum 10,000 base units (0.01 USDC, since `usdc(1)` is 1,000,000), recommended minimum 1,000,000 (1 USDC), maximum `null`
- platform `xmoney`, currency `USD`, `requiresIdentityAttestation` false
- payee hint: "X username with X Money enabled, with or without the leading @ (e.g. @andrew)"

`createCashClient` accepts `production`, `staging`, and `preproduction`. Constructing the client does not create an order.

The guide's receive object is:

```ts
const receive = { platform: "xmoney", currency: "USD", payee: "@YourHandle" } as const;
```

Raw handles are trimmed, lowercased, and stripped of one leading `@`. Registration does not check that X Money is enabled. `prepareXMoneyConnect` / `isXMoneyConnected` link a mailbox so a receipt can be read. The guide says cash-out does not require that link, and a linked mailbox is not proof the account can receive X Money. This matches the existing local `PeerReads` gate: a connected inbox stays `eligibleForLivePayout: false`.

`cashout` and `prepare` deposit Base USDC and register a payee. The deposit is not a USD payment. `order(depositId)` is the read. Fills are reconciled on verified `fiatPaid`, `paidCurrency`, `paymentId`, `paidAt`, and `releasedAmount`. `withdraw` returns unspent USDC after pruning expired intents; a live intent blocks a full close. `topUp` adds USDC without changing the payee. Partial withdrawal is supported. `ORDER_NOT_FOUND` right after a deposit means the indexer is behind, not that the deposit should be created again.

The SDK does not expose a custom LP discount. BagsPay's published 10% then 20% discount is Bags' own pricing, not a Cash SDK parameter. Copying it would misstate the protocol. Peer's referral code pays the code owner 50 bps out of Peer's fee when liquidity fills. It does not change the creator's rate. Funded does not need a referral code to cash out.

The owner reports that a Peer developer, Telegram `sachin0x`, replied "pls use our sdk, feel free to ping on tg". That message was not independently retrieved here. It is consistent with the public SDK and is not a partnership, a limit increase, or approval to move funds.

[Peer's Solana contracts](https://github.com/zkp2p/zkp2p-solana-contracts) are a different codebase. They are not evidence that an X Money cash-out settles on Solana.

### Open questions for Peer

These are unresolved. The product must keep working if either answer is true.

1. Can the whole flow be tested end to end in preproduction, including a check that the USD arrived?
2. Do live payouts need partner approval from Peer, or a separate approval from X Money?
3. Does the creator see the matched liquidity provider as the X Money sender, or can the payment display as @fundedonfloat?

The creator-facing copy has to say that a third-party liquidity provider may be the sender. @fundedonfloat is Funded's public handle. It is not a confirmed payment sender, and it is not the payee. The payee is the creator's handle.

## Assumptions

- Raydium keeps 0.25% on the curve. The on-chain tier rates match that description. The Raydium fee field itself was not decoded.
- Float's integer rounding inside `claim_dev_fees` was not read from bytecode. Reporting uses integer bps and leaves the remainder out of the creator figure.
- The 48-hour takeover refund is off-chain or bot-driven. `ticker_protect_secs` is 0.
- Float's holder and trader bots scan `LaunchState` accounts rather than only rows created on floatlaunch.xyz. FloatFuse's docs say Float's bot pays holders of coins launched there. This read did not decode a `pay_holders` transaction for a third-party mint. The creator share does not depend on that bot.
- The website bundle's `DRay` ids are a migration or a stale constant. They were not the program used by the verified launch.
- Jupiter can quote every Float quote. Several quotes are documented as having no route. Those stay pending.
- CCTP remains the right Solana-to-Base path for canonical USDC. A fallback bridge was not qualified.
- Peer preproduction will behave like the documented order machine. That is the open testing question above, not a finding.
- The off-curve admin address is intentionally a PDA or multisig. The account data does not show which one.

## What needs whom

**Float, only for some operational edges.** Calling `launch` and `claim_dev_fees` does not need their permission while launches are unpaused and the program still has this interface. Their lister key is required to enable a new quote mint. Their admin can pause launches, change the split, or upgrade the program. A stable, versioned IDL and a statement of which LaunchLab program is current would remove the bundle-versus-chain discrepancy. Permission to use Float's name or mark is a brand question; Funded does not use them as its own mark.

**Peer.** The public SDK is the integration. No private partnership is assumed. Live or preproduction orders still need the owner's explicit authorization, a Base USDC balance that is not in this repo, and answers to the three questions above before a payout can be described as tested. X Money eligibility is not checked by the SDK.

**Owner.** Choose the custody model and supply only the public receiver address. Authorize any future devnet or mainnet write. Decide whether the creator's wallet signs the launch (recommended) or a Funded wallet launches on the creator's behalf. Decide whether any LP incentive will be funded separately, because the SDK's spread is zero and it has no discount field. Counsel has to review money transmission, sanctions, X Money terms, and tokenized-stock restrictions before a public launch that handles customer funds.

## What this repository will not do with these findings

It will not submit a transaction, create a Peer order, generate a key, or mark a USD payment complete. The encoder and the Peer adapter that follow this note are dry construction and fixture settlement. A preview that matches this layout is not authorization to sign.
