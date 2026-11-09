import { cctpPreflight } from './cctp-preflight.ts';

/** Reads an existing burn message. An attestation is not destination credit and is not permission to burn again. */
export async function bridgeState(intent: Parameters<typeof cctpPreflight>[0], transport?: typeof fetch) {
  const view = await cctpPreflight(intent, transport);
  return { ...view, burnAuthorized: false as const, baseSettlementVerified: false as const, executionAuthorized: false as const };
}
