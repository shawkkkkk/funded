# Mainnet release checklist

The repository can be deployed as a **public read-only preview** after `npm run mainnet:check` exits successfully. That check verifies an HTTPS origin, PostgreSQL connectivity and paused state, a trusted Solana RPC that actually reports the pinned mainnet genesis hash, an authorized public fee-receiver address, and the reviewed Peer Cash SDK surface.

Passing the check does **not** authorize money movement. `fundsExecutionReady` remains hard-coded to `false`; no environment variable can turn it on.

## Public preview

- Set the variables in `.env.example` through the deployment secret manager. Never commit real credentials.
- Terminate TLS at the platform and preserve the configured `Host` header.
- Run PostgreSQL backups and a restore drill before retaining any production records.
- Deploy the container and require both `/healthz` and `/readyz` to succeed.
- Keep the database paused. Public mode rejects every POST and creator-specific earnings reads until creator authentication is implemented.
- Confirm the public pages state that launches and payouts are inactive.

## Financial execution blockers

All of these require separate implementation and review:

1. Qualified custody or an approved policy-controlled signer. The web process must never hold a seed.
2. Solana creator authentication, versioned recipient consent, session expiry, replay protection, and payee-change holds.
3. Production Float launch and fee-cycle policies tied to reviewed program versions and slot ranges.
4. Live sanctions, wallet, mint, and counterparty screening. The fixture denial list is not clearance.
5. A signer-isolated Jupiter transaction builder with decoded instruction allowlists, simulation, output floors, fee caps, and unknown-outcome recovery.
6. CCTP burn construction plus attestation-signature and Base mint verification. The existing command is read-only.
7. A Peer Cash `0.8.1` prepared-transaction adapter that persists the plan before signing, finalizes the confirmed receipt, stores `depositId`, follows `nextActions`, and never resubmits an unknown transaction.
8. A controlled preproduction test that proves X Money enrollment, full/partial fill handling, return behavior, payment-note branding, and actual USD receipt.
9. Independent security review, incident exercise, reconciliation sign-off, custody approval, and qualified legal/compliance review.
10. An explicitly authorized, capped mainnet canary with automatic pause thresholds.

## Go/no-go rule

Do not enable a launch, swap, bridge burn, or Peer deposit merely because the public preview is healthy. The first financial release must be a separately reviewed signer service and worker deployment with a capped canary authorization. Until then, keep every execution route absent and keep funds held rather than creating a claim balance.
