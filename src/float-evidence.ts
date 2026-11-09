import { address, amount, FLOAT, LAUNCHLAB } from './domain.ts';
import { SolanaReader } from './solana.ts';

type Instruction = { programId: string; accounts?: string[]; data?: string; parsed?: unknown; stackHeight?: number|null };
type Balance = { accountIndex:number; mint:string; owner?:string; programId?:string; uiTokenAmount:{ amount:string; decimals:number } };
export type FinalizedTrace = {
  slot:number; version?:'legacy'|number;
  transaction: {signatures:string[]; message:{accountKeys:{pubkey:string; signer:boolean; writable:boolean; source?:string}[]; instructions:Instruction[]}};
  meta: {err:unknown; innerInstructions?:{index:number; instructions:Instruction[]}[]|null; preTokenBalances?:Balance[]; postTokenBalances?:Balance[]}|null;
};

export function summarizeTrace(signature: string, tx: FinalizedTrace) {
  if (!Number.isSafeInteger(tx.slot) || tx.slot < 0 || tx.meta?.err !== null || tx.transaction.signatures[0] !== signature) throw Error('Finalized successful matching transaction required');
  const keys = tx.transaction.message.accountKeys;
  const outer = tx.transaction.message.instructions;
  const floatCalls = outer.flatMap((ix,index) => ix.programId === FLOAT ? [{
    index, instruction:ix,
    inner:tx.meta!.innerInstructions?.find(i=>i.index === index)?.instructions ?? []
  }] : []);
  if (!floatCalls.length) throw Error('No top-level Float instruction; unsupported evidence shape');
  const pre = tx.meta.preTokenBalances, post = tx.meta.postTokenBalances;
  const deltas = [];
  if (pre && post) {
    const byIndex = (values: Balance[]) => {
      const m=new Map<number,Balance>();
      for(const b of values) {
        if (!keys[b.accountIndex] || m.has(b.accountIndex) || !Number.isSafeInteger(b.accountIndex) || !Number.isInteger(b.uiTokenAmount.decimals) || b.uiTokenAmount.decimals < 0 || b.uiTokenAmount.decimals > 255) throw Error('Invalid token balance metadata');
        address(b.mint); if (b.owner) address(b.owner); if (b.programId) address(b.programId);
        amount(b.uiTokenAmount.amount);
        m.set(b.accountIndex,b);
      }
      return m;
    };
    const p=byIndex(pre), q=byIndex(post);
    for (const i of new Set([...p.keys(),...q.keys()])) {
      const before=p.get(i), after=q.get(i), b=after ?? before!;
      if (before && after && (before.mint !== after.mint || before.uiTokenAmount.decimals !== after.uiTokenAmount.decimals ||
        before.programId !== after.programId || before.owner !== after.owner)) throw Error('Token account identity changed within the transaction');
      const delta=amount(after?.uiTokenAmount.amount ?? '0')-amount(before?.uiTokenAmount.amount ?? '0');
      if (delta) deltas.push({account:address(keys[i].pubkey),owner:b.owner ?? null,mint:b.mint,
        tokenProgram:b.programId ?? null,decimals:b.uiTokenAmount.decimals,delta:delta.toString()});
    }
  }
  return {
    signature, slot:tx.slot, version:tx.version ?? 'unknown', accountKeys:keys,
    floatCalls, hasLaunchLabInnerCall:floatCalls.some(c=>c.inner.some(i=>i.programId === LAUNCHLAB)),
    innerInstructionRecordingAvailable:Array.isArray(tx.meta.innerInstructions),
    tokenBalanceRecordingAvailable:Array.isArray(pre)&&Array.isArray(post), tokenDeltas:deltas,
    verifiedFundedLaunch:false, verifiedCreatorFee:false
  };
}

if (import.meta.main) {
  try {
    const [signature,...more]=process.argv.slice(2);
    if (!signature || more.length) throw Error('Provide exactly one finalized Solana transaction signature');
    const urls=(process.env.FUNDED_READ_RPC ?? '').split(',').map(v=>v.trim()).filter(Boolean);
    if (urls.length !== 1) throw Error('Evidence capture requires exactly one trusted FUNDED_READ_RPC endpoint');
    const rpc=new SolanaReader(urls);
    const genesis=await rpc.read('getGenesisHash',[]);
    address(genesis);
    if (process.env.FUNDED_EXPECT_GENESIS && genesis !== process.env.FUNDED_EXPECT_GENESIS) throw Error('RPC cluster does not match expected genesis hash');
    const tx=await rpc.finalizedTransaction(signature);
    if (!tx) throw Error('Transaction unavailable from this RPC');
    console.log(JSON.stringify({rpcGenesisHash:genesis,...summarizeTrace(signature,tx)},null,2));
  } catch(e) {
    console.error(e instanceof Error ? e.message : 'Evidence capture failed');
    process.exitCode=1;
  }
}
