import { readFile } from 'node:fs/promises';
import { address, amount, FLOAT } from './domain.ts';
import { summarizeTrace } from './float-evidence.ts';
import type { FinalizedTrace } from './float-evidence.ts';
import { instructionDiscriminator } from './float-handoff.ts';
import { SolanaReader } from './solana.ts';

export const LEGACY_TOKEN_PROGRAM='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
type CycleRoles = { launchMint: number; sourceVault: number; destination: number };
type CyclePolicy = {
  genesisHash: string; stage: 'bonding'|'graduated'; fromSlot: number; throughSlot: number;
  discriminatorHex: string; accountCount: number; roles: CycleRoles;
};
type ExpectedRoute = { launchMint:string; feeMint:string; feeReceiver:string; sourceVault:string; destination:string };
type Dict = Record<string,unknown>;
function object(value: unknown): Dict {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw Error('Invalid review input');
  return value as Dict;
}
function index(n: unknown, bound: number): n is number {
  return typeof n==='number' && Number.isSafeInteger(n) && n>=0 && n<bound;
}
export function parseCyclePolicy(input: unknown): CyclePolicy {
  const p=object(input), roles=object(p.roles);
  const {stage,fromSlot,throughSlot,discriminatorHex,accountCount}=p;
  if ((stage!=='bonding'&&stage!=='graduated') ||
      typeof fromSlot!=='number'||!Number.isSafeInteger(fromSlot)||fromSlot<0 ||
      typeof throughSlot!=='number'||!Number.isSafeInteger(throughSlot)||throughSlot<fromSlot ||
      typeof discriminatorHex!=='string'||!/^[0-9a-f]{16}$/i.test(discriminatorHex) ||
      typeof accountCount!=='number'||!Number.isInteger(accountCount)||accountCount<3||accountCount>256) throw Error('Invalid reviewed fee-cycle policy');
  const {launchMint,sourceVault,destination}=roles;
  if (!index(launchMint,accountCount)||!index(sourceVault,accountCount)||!index(destination,accountCount)||
      new Set([launchMint,sourceVault,destination]).size!==3) throw Error('Invalid fee-cycle account positions');
  return {genesisHash:address(p.genesisHash),stage,fromSlot,throughSlot,discriminatorHex:discriminatorHex.toLowerCase(),
    accountCount,roles:{launchMint,sourceVault,destination}};
}
function parseRoute(input: unknown): ExpectedRoute {
  const r=object(input);
  const route={launchMint:address(r.launchMint),feeMint:address(r.feeMint),feeReceiver:address(r.feeReceiver),
    sourceVault:address(r.sourceVault),destination:address(r.destination)};
  if (new Set(Object.values(route)).size!==5) throw Error('Fee-route addresses must be distinct');
  return route;
}

function references(value: unknown, pubkey: string): boolean {
  if (typeof value==='string') return value===pubkey;
  if (value && typeof value==='object') return Object.values(value).some(v=>references(v,pubkey));
  return false;
}

/** Evidence for a deliberately narrow, operator-reviewed fee-cycle shape. No credit or payout. */
export function reviewFloatFeeCycle(genesisHash: string, signature: string, tx: FinalizedTrace, policyInput: unknown, routeInput: unknown) {
  const p=parseCyclePolicy(policyInput), r=parseRoute(routeInput);
  if (genesisHash!==p.genesisHash) throw Error('RPC cluster does not match fee-cycle policy');
  const trace=summarizeTrace(signature,tx);
  if (trace.slot<p.fromSlot||trace.slot>p.throughSlot) throw Error('Transaction is outside reviewed fee-cycle slots');
  if (!trace.innerInstructionRecordingAvailable||!trace.tokenBalanceRecordingAvailable) throw Error('Missing CPI or token balance metadata');
  const cycles=trace.floatCalls.filter(c=>instructionDiscriminator(c.instruction.data)===p.discriminatorHex);
  if (cycles.length!==1) {
    throw Error('Exactly one recognized Float fee cycle is required');
  }
  const cycle=cycles[0];
  const a=cycle.instruction.accounts;
  if (!a||a.length!==p.accountCount||a[p.roles.launchMint]!==r.launchMint||a[p.roles.sourceVault]!==r.sourceVault||a[p.roles.destination]!==r.destination) {
    throw Error('Fee-cycle accounts do not match the expected route');
  }
  const keys=trace.accountKeys;
  if (new Set(keys.map(k=>k.pubkey)).size!==keys.length||a.some(k=>!keys.some(key=>key.pubkey===k))) throw Error('Missing or ambiguous account metadata');
  const groups=tx.meta!.innerInstructions!;
  const outer=tx.transaction.message.instructions;
  if (new Set(groups.map(g=>g.index)).size!==groups.length||groups.some(g=>!index(g.index,outer.length))) throw Error('Ambiguous CPI metadata');
  const touching=cycle.inner.flatMap((ix,i)=>references(ix,r.destination)?[{ix,i}]:[]);
  if (touching.length!==1 || outer.some((ix,i)=>i!==cycle.index&&references(ix,r.destination)) ||
      groups.some(g=>g.index!==cycle.index&&references(g.instructions,r.destination))) {
    throw Error('Destination activity is not isolated to one fee-cycle transfer');
  }
  const {ix,i}=touching[0];
  if (ix.programId!==LEGACY_TOKEN_PROGRAM||ix.stackHeight!==2) throw Error('Only a direct legacy SPL Token CPI is supported');
  const parsed=object(ix.parsed), info=object(parsed.info), value=object(info.tokenAmount);
  if (parsed.type!=='transferChecked'||info.source!==r.sourceVault||info.destination!==r.destination||info.mint!==r.feeMint) {
    throw Error('Fee transfer does not match the reviewed source, mint and destination');
  }
  const units=amount(value.amount);
  if (units<=0n) throw Error('Fee transfer must be positive');
  const destinationIndex=keys.findIndex(k=>k.pubkey===r.destination);
  const sourceIndex=keys.findIndex(k=>k.pubkey===r.sourceVault);
  for (const list of [tx.meta!.preTokenBalances!,tx.meta!.postTokenBalances!]) {
    const dest=list.find(b=>b.accountIndex===destinationIndex);
    const source=list.find(b=>b.accountIndex===sourceIndex);
    if (!dest||!source||dest.owner!==r.feeReceiver||[dest,source].some(b=>b.mint!==r.feeMint||
        b.programId!==LEGACY_TOKEN_PROGRAM||b.uiTokenAmount.decimals!==value.decimals)) {
      throw Error('Fee token balance metadata does not match the reviewed receiver, mint and program');
    }
  }
  const change=trace.tokenDeltas.find(d=>d.account===r.destination);
  if (!change||BigInt(change.delta)!==units) throw Error('Fee transfer does not reconcile to the destination balance');
  return {
    status:'matches_reviewed_fee_cycle', stage:p.stage, signature, slot:trace.slot, ...r,
    units:units.toString(), sourceRef:`solana:${genesisHash}:${signature}:${cycle.index}:${i}`,
    creditAuthorized:false, payoutAuthorized:false
  };
}

if (import.meta.main) {
  try {
    const [policyPath,routePath,signature,...extra]=process.argv.slice(2);
    if (!policyPath||!routePath||!signature||extra.length) throw Error('Usage: npm run review:float-fee -- <reviewed-policy.json> <expected-route.json> <signature>');
    const p=parseCyclePolicy(JSON.parse(await readFile(policyPath,'utf8')));
    const r=parseRoute(JSON.parse(await readFile(routePath,'utf8')));
    const urls=(process.env.FUNDED_READ_RPC??'').split(',').map(s=>s.trim()).filter(Boolean);
    if (urls.length!==1) throw Error('Fee review requires exactly one trusted FUNDED_READ_RPC endpoint');
    const rpc=new SolanaReader(urls);
    const genesis=await rpc.read('getGenesisHash',[]);
    if (genesis!==p.genesisHash) throw Error('RPC cluster does not match fee-cycle policy');
    const tx=await rpc.finalizedTransaction(signature);
    if (!tx) throw Error('Transaction unavailable from this RPC');
    console.log(JSON.stringify(reviewFloatFeeCycle(genesis,signature,tx,p,r),null,2));
  } catch(e) {
    console.error(e instanceof Error?e.message:'Float fee review failed');
    process.exitCode=1;
  }
}
