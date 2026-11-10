# Pause and recovery

Funded does not sign, burn, or create Peer orders in this build. `launchEnabled` and `peerOrdersEnabled` stay false. The custody mode defaults to `funded_receiver_unapproved`: a Funded-held receiver is custodial, and that arrangement is not approved for live funds.

## Pause

A fresh Postgres ledger starts paused (`default closed`). SQLite pause is explicit.

Pause stops:

- unsigned launch previews
- leasing of pipeline jobs
- `swap_submitted`, `bridge_submitted`, and `peer_submitted` on the local journal

Pause does not stop:

- reading finalized chain data
- recording a receipt that already happened
- proving a fill or return that already happened
- reading alerts

Resume only after the reason is written down and the ledger still balances. Resume does not broadcast anything.

## Unknown outcome

Look up the recorded identity before any later authorized signer does anything.

| Stage | Look up | Do not |
| --- | --- | --- |
| Launch | Mint nonce and the `launch` PDA | Send a second launch for a nonce whose first transaction might exist |
| Swap | The recorded signature for that receipt | Build a second swap for the same receipt |
| Bridge | The burn signature and CCTP message | Burn again because an attestation is missing |
| Peer | `order(depositId)` | Create another deposit because the indexer has not caught up |
| Buyer intent | Whether a live intent still locks the order | Withdraw the full remainder while an intent is open |
| Program | Config pin, discriminator, LaunchLab id | Preview against a drifted or paused config |

A quote, an attestation response, or a matched buyer is not a completed USD payment.

## Screening

`FixtureScreener` answers from `FUNDED_SCREEN_DENY`. `live` is always false. `clear` does not mean a person or a mint may be paid. There is no OFAC, Chainalysis, or X Money eligibility vendor in this process. A `blocked` or `review` result stops the Peer plan. It does not move funds.

## After an incident

1. Pause and record the reason.
2. Stop any future signer. This repository does not hold one.
3. Re-read the ledger. `balanced()` must succeed. An imbalance is a page, not something to patch with a manual journal line.
4. Re-read chain observations. Keep the original signature, message, and deposit id.
5. Resume planning only. Leave execution flags false until the owner authorizes a separate live test.
