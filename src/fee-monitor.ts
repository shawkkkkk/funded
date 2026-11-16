import { address, amount, NATIVE } from './domain.ts';

const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

type Key = { pubkey: string };
type Balance = { accountIndex: number; mint: string; owner?: string; programId?: string; uiTokenAmount: { amount: string } };
export type ParsedTransaction = {
  transaction?: { message?: { accountKeys?: (string | Key)[] } };
  meta?: { preBalances?: number[]; postBalances?: number[]; preTokenBalances?: Balance[]; postTokenBalances?: Balance[] } | null;
};

export function classifyDeposit(input: { signature: string; asset: string; delta: bigint | null; programId?: string; mint?: string; owner?: string; expectedOwner: string }) {
  const base = { signature: input.signature, asset: input.asset, credited: false, executionAuthorized: false as const };
  if (input.delta === null) return { ...base, attribution: 'held_missing_metadata', units: '0' };
  if (input.delta <= 0n) return { ...base, attribution: 'no_increase', units: '0' };
  if (input.asset === NATIVE) return { ...base, attribution: 'held_native', units: input.delta.toString() };
  if (input.programId === TOKEN_2022) return { ...base, attribution: 'held_token2022', units: input.delta.toString() };
  if (input.programId === TOKEN && input.mint === input.asset && input.owner === input.expectedOwner) {
    return { ...base, attribution: 'held_pending_review', units: input.delta.toString() };
  }
  return { ...base, attribution: 'held_ambiguous', units: input.delta.toString() };
}

export function depositsFromTransaction(signature: string, tx: ParsedTransaction, destination: string, asset: string, expectedOwner: string) {
  const keys = tx.transaction?.message?.accountKeys ?? [];
  const index = keys.findIndex(key => (typeof key === 'string' ? key : key.pubkey) === destination);
  if (index < 0) return classifyDeposit({ signature, asset, delta: null, expectedOwner });
  if (asset === NATIVE) {
    const pre = tx.meta?.preBalances?.[index];
    const post = tx.meta?.postBalances?.[index];
    const delta = typeof pre === 'number' && typeof post === 'number' ? BigInt(post) - BigInt(pre) : null;
    return classifyDeposit({ signature, asset, delta, expectedOwner });
  }
  address(asset);
  const pre = (tx.meta?.preTokenBalances ?? []).filter(row => row.accountIndex === index);
  const post = (tx.meta?.postTokenBalances ?? []).filter(row => row.accountIndex === index);
  if (pre.length !== 1 || post.length !== 1) return classifyDeposit({ signature, asset, delta: null, expectedOwner });
  const delta = amount(post[0].uiTokenAmount.amount) - amount(pre[0].uiTokenAmount.amount);
  return classifyDeposit({ signature, asset, delta, programId: post[0].programId, mint: post[0].mint, owner: post[0].owner, expectedOwner });
}

type Reader = {
  finalizedAddressSignatures(account: string, limit: number): Promise<{ signature: string; err: unknown }[]>;
  finalizedTransaction(signature: string): Promise<ParsedTransaction | null>;
};

/** One page of finalized history. Nothing in the result is credited. */
export async function watchReceiver(reader: Reader, input: { account: string; asset: string; expectedOwner: string; limit?: number }) {
  const signatures = await reader.finalizedAddressSignatures(address(input.account), input.limit ?? 5);
  const rows = [];
  for (const row of signatures) {
    if (row.err) continue;
    const tx = await reader.finalizedTransaction(row.signature);
    if (!tx) continue;
    rows.push(depositsFromTransaction(row.signature, tx, input.account, input.asset, input.expectedOwner));
  }
  return { rows, credited: false, executionAuthorized: false as const };
}
