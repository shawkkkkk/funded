import { BASE_USDC, FLOAT, SOLANA_USDC, amount, guardQuote, handle } from './domain.ts';
import type { SwapQuote } from './domain.ts';

export class IntegrationBlocked extends Error {}
export function prepareFloatLaunch(): never {
  throw new IntegrationBlocked('Need verified Float instruction schema, signer rules and pre/post-graduation receipt traces; transaction construction disabled');
}

type PeerReader = {
  isXMoneyConnected: (payeeDetails: string) => Promise<boolean>;
  order: (depositId: string) => Promise<unknown>;
};
export class PeerReads {
  client: PeerReader;
  constructor(client: PeerReader) { this.client = client; }
  async eligibility(input: { handle: string; payeeDetails: string; holderConsent: boolean }) {
    const username = handle(input.handle);
    if (!input.holderConsent || !input.payeeDetails) return { username, receiptInboxConnected:false, eligibleForLivePayout:false };
    const connected = await this.client.isXMoneyConnected(input.payeeDetails);
    // An active receipt credential is not independent proof of X Money eligibility.
    return { username, receiptInboxConnected:connected === true, eligibleForLivePayout:false };
  }
  async inspect(depositId: string) {
    if (!depositId || depositId.length > 160) throw Error('Invalid deposit reference');
    return this.client.order(depositId);
  }
}

export function conversionDecision(input: { mint: string; units: bigint; quote?: SwapQuote; policy: Parameters<typeof guardQuote>[1] }) {
  if (!input.policy.mintApproved || input.units <= 0n) return { status:'waiting_route' as const, reason:'Asset not cleared' };
  if (input.mint === SOLANA_USDC) return { status:'already_usdc' as const, units:input.units };
  if (!input.quote) return { status:'waiting_route' as const, reason:'No acceptable quote' };
  try {
    const floor = guardQuote(input.quote,{...input.policy,inputMint:input.mint,units:input.units});
    // Quote acceptance is not transaction validation. No executable payload leaves this boundary.
    return { status:'quote_only' as const, minOut:floor };
  } catch (e) {
    return { status:'waiting_route' as const, reason:e instanceof Error ? e.message : 'Quote rejected' };
  }
}

export function bridgeEvidence(input: {
  expectedBurn: string; observedBurn: string; burnFinalized: boolean;
  attestationComplete: boolean; destinationChain: number; destinationFinalized: boolean;
  expectedRecipient: string; recipient: string; mint: string;
  expectedMessageHash: string; deliveredMessageHash: string;
  deliveredUnits: string; maxUnits: string; minUnits: string;
}) {
  const addr = /^0x[0-9a-f]{40}$/i, hash = /^0x[0-9a-f]{64}$/i;
  if (!input.expectedBurn || input.expectedBurn !== input.observedBurn || !input.burnFinalized ||
      !input.attestationComplete || !input.destinationFinalized || input.destinationChain !== 8453 ||
      !addr.test(input.expectedRecipient) || input.recipient.toLowerCase() !== input.expectedRecipient.toLowerCase() ||
      input.mint.toLowerCase() !== BASE_USDC || !hash.test(input.expectedMessageHash) ||
      input.expectedMessageHash.toLowerCase() !== input.deliveredMessageHash.toLowerCase()) throw Error('Canonical destination settlement not verified');
  const units = amount(input.deliveredUnits), min = amount(input.minUnits), max = amount(input.maxUnits);
  if (!min || units < min || units > max) throw Error('Bridge settlement outside bounds');
  return units;
}

export const runtimeGates = Object.freeze({
  float:FLOAT, launch:false, feeAttribution:false, swapExecution:false,
  bridgeExecution:false, peerExecution:false, walletProvisioning:false
});
