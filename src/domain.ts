export const FLOAT = '3KguFi7YYzLgttG46fRism16CfcuNCkDh6U7td9JTqxX';
export const LAUNCHLAB = 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj';
export const SOLANA_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
export const NATIVE = 'native:sol';
export const FEE_SPLIT_BPS = Object.freeze({ holders: 1500, creator: 500, buyback: 3500, traders: 3500, treasury: 1000 });
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function address(value: unknown): string {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) throw Error('Invalid Solana address');
  let n = 0n;
  for (const c of value) {
    const i = alphabet.indexOf(c);
    if (i < 0) throw Error('Invalid Solana address');
    n = n * 58n + BigInt(i);
  }
  const zeros = value.match(/^1*/)?.[0].length ?? 0;
  if (zeros + (n === 0n ? 0 : Math.ceil(n.toString(16).length / 2)) !== 32) throw Error('Invalid Solana address length');
  return value;
}

export function handle(value: unknown): string {
  if (typeof value !== 'string') throw Error('X handle required');
  const id = value.trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(id)) throw Error('Invalid X handle');
  return id;
}

export const PAYOUT_RAILS = ['xmoney', 'cashapp', 'venmo'] as const;
export type PayoutRail = typeof PAYOUT_RAILS[number];
export function payoutDestination(rail: unknown, value: unknown) {
  if (rail !== 'xmoney' && rail !== 'cashapp' && rail !== 'venmo') throw Error('Select a supported payout app');
  if (rail === 'xmoney') return {rail,handle:handle(value)};
  if (typeof value !== 'string') throw Error('Payout handle required');
  const id = value.trim().replace(rail === 'cashapp' ? /^\$/ : /^@/,'');
  if (rail === 'cashapp' ? !/^[a-z0-9]{1,20}$/i.test(id) || !/[a-z]/i.test(id) : !/^[a-z0-9_-]{5,30}$/i.test(id)) throw Error('Invalid payout handle format');
  return {rail,handle:id};
}

export function amount(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,37})$/.test(value)) throw Error('Invalid base-unit amount');
  return BigInt(value);
}

function webUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 512) throw Error('Invalid URL');
  if (!value.trim()) return '';
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw Error('Only HTTPS URLs without credentials are supported');
  return url.href;
}

export function launchDraft(v: Record<string, unknown>) {
  const name = typeof v.name === 'string' ? v.name.trim() : '';
  const ticker = typeof v.ticker === 'string' ? v.ticker.trim().toUpperCase() : '';
  const description = typeof v.description === 'string' ? v.description.trim() : '';
  if (!name || Buffer.byteLength(name) > 32 || /[\x00-\x1f\x7f]/.test(name)) throw Error('Name must be 1–32 bytes without control characters');
  if (!/^[A-Z0-9]{1,10}$/.test(ticker)) throw Error('Ticker must be 1–10 letters or digits');
  if (description.length > 1000) throw Error('Description is too long');
  if (typeof v.feeBps !== 'number' || ![100, 200, 250].includes(v.feeBps)) throw Error('Select a reference trading-fee tier');
  const pair = v.pair === NATIVE ? NATIVE : address(v.pair);
  const destination = payoutDestination(v.payoutRail ?? 'xmoney',v.recipient);
  return {
    name, ticker, description, pair, feeBps: v.feeBps, recipient: destination.handle, payoutRail:destination.rail,
    website: webUrl(v.website ?? ''), x: webUrl(v.x ?? ''), telegram: webUrl(v.telegram ?? ''),
    firstBuyBaseUnits: amount(v.firstBuyBaseUnits ?? '0').toString(),
    creatorWallet: address(v.creatorWallet)
  };
}

export interface SwapQuote {
  inputMint: string; outputMint: string; inAmount: string; outAmount: string;
  otherAmountThreshold: string; routeProgramIds: string[]; quotedAt: number;
}
export function guardQuote(q: SwapQuote, p: {
  inputMint: string; units: bigint; slippageBps: number; referenceMinNet: bigint;
  allowedPrograms: Set<string>; now: number; maxAgeMs: number; mintApproved: boolean
}) {
  if (!p.mintApproved || q.inputMint !== p.inputMint || q.outputMint !== SOLANA_USDC ||
      amount(q.inAmount) !== p.units || p.units <= 0n) throw Error('Unapproved asset or incorrect quote');
  if (!Number.isSafeInteger(p.slippageBps) || p.slippageBps < 0 || p.slippageBps > 500 ||
      !Number.isSafeInteger(p.now) || !Number.isSafeInteger(p.maxAgeMs) || p.maxAgeMs <= 0 ||
      !Number.isSafeInteger(q.quotedAt) || q.quotedAt > p.now || p.now - q.quotedAt > p.maxAgeMs) throw Error('Stale quote or invalid policy');
  if (!q.routeProgramIds.length || q.routeProgramIds.some(id => !p.allowedPrograms.has(id))) throw Error('Unapproved route program');
  const expected = amount(q.outAmount), floor = amount(q.otherAmountThreshold);
  if (p.referenceMinNet <= 0n || floor <= 0n || floor > expected || floor < p.referenceMinNet ||
      floor * 10_000n < expected * BigInt(10_000 - p.slippageBps)) throw Error('Insufficient protected output');
  return floor;
}

export type Status = 'received'|'waiting_route'|'swap_pending'|'solana_usdc'|'bridge_pending'|'base_usdc'|'peer_pending'|'awaiting_buyer'|'partially_paid'|'returned'|'paid'|'review';
export type EventType = 'hold_route'|'swap_submitted'|'swap_finalized'|'bridge_submitted'|'bridge_finalized'|'peer_submitted'|'peer_deposit_finalized'|'fiat_proven'|'peer_return_finalized'|'resume_returned'|'review';
const transitions: Partial<Record<Status, Partial<Record<EventType, Status>>>> = {
  received: { hold_route: 'waiting_route', swap_submitted: 'swap_pending' },
  waiting_route: { swap_submitted: 'swap_pending' },
  swap_pending: { swap_finalized: 'solana_usdc' },
  solana_usdc: { bridge_submitted: 'bridge_pending' },
  bridge_pending: { bridge_finalized: 'base_usdc' },
  base_usdc: { peer_submitted: 'peer_pending' },
  peer_pending: { peer_deposit_finalized: 'awaiting_buyer' },
  awaiting_buyer: { fiat_proven: 'partially_paid', peer_return_finalized: 'returned' },
  partially_paid: { fiat_proven: 'partially_paid', peer_return_finalized: 'returned' },
  returned: { resume_returned: 'base_usdc' }
};
export function next(status: Status, event: EventType): Status {
  const target = event === 'review' && status !== 'paid' ? 'review' : transitions[status]?.[event];
  if (!target) throw Error('Invalid state transition');
  return target;
}
