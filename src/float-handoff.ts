import { readFile } from 'node:fs/promises';
import { address, FLOAT, LAUNCHLAB } from './domain.ts';
import { summarizeTrace } from './float-evidence.ts';
import type { FinalizedTrace } from './float-evidence.ts';
import { SolanaReader } from './solana.ts';

type Roles = { mint: number; creator: number; feeReceiver: number };
export type LaunchPolicy = {
  genesisHash: string;
  fromSlot: number;
  throughSlot: number;
  discriminatorHex: string;
  accountCount: number;
  roles: Roles;
};
type ExpectedLaunch = { mint: string; creator: string; feeReceiver: string };

export function parseLaunchPolicy(input: unknown): LaunchPolicy {
  if (!input || typeof input !== 'object') throw Error('A locally reviewed launch policy is required');
  const p = input as Partial<LaunchPolicy>;
  const genesisHash = address(p.genesisHash);
  const { fromSlot, throughSlot, discriminatorHex, accountCount, roles } = p;
  if (typeof fromSlot !== 'number' || typeof throughSlot !== 'number' ||
      !Number.isSafeInteger(fromSlot) || !Number.isSafeInteger(throughSlot) ||
      fromSlot < 0 || throughSlot < fromSlot ||
      typeof discriminatorHex !== 'string' || !/^[0-9a-f]{16}$/i.test(discriminatorHex) ||
      typeof accountCount !== 'number' || !Number.isInteger(accountCount) || accountCount < 3 || accountCount > 256 ||
      !roles || typeof roles !== 'object') throw Error('Invalid reviewed launch policy');
  const { mint, creator, feeReceiver } = roles;
  const positions = [mint, creator, feeReceiver];
  if (new Set(positions).size !== positions.length ||
      positions.some(i => !Number.isInteger(i) || i < 0 || i >= accountCount)) throw Error('Invalid or overlapping launch role positions');
  return { genesisHash, fromSlot, throughSlot, discriminatorHex:discriminatorHex.toLowerCase(), accountCount, roles:{mint,creator,feeReceiver} };
}

const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function decodeData(value: unknown) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1800) throw Error('Float instruction data unavailable or invalid');
  let n=0n;
  for (const c of value) {
    const i=alphabet.indexOf(c);
    if (i < 0) throw Error('Float instruction data is not base58');
    n=n*58n+BigInt(i);
  }
  const zeros=value.match(/^1*/)?.[0].length ?? 0;
  const hex=n.toString(16);
  return Buffer.concat([Buffer.alloc(zeros), n===0n ? Buffer.alloc(0) : Buffer.from(hex.length%2 ? '0'+hex : hex,'hex')]);
}

/**
 * Corroborates an external launch against operator-reviewed account semantics.
 * This is not a fee-credit authorization and never signs or sends anything.
 */
export function reviewFloatHandoff(
  rpcGenesisHash: string, signature: string, tx: FinalizedTrace, policyInput: unknown, expected: ExpectedLaunch
) {
  const policy=parseLaunchPolicy(policyInput);
  if (rpcGenesisHash !== policy.genesisHash) throw Error('RPC cluster does not match launch policy');
  const mint=address(expected.mint), creator=address(expected.creator), feeReceiver=address(expected.feeReceiver);
  if (new Set([mint,creator,feeReceiver]).size !== 3) throw Error('Mint, creator and separate fee receiver must be distinct');
  const trace=summarizeTrace(signature,tx);
  if (trace.slot < policy.fromSlot || trace.slot > policy.throughSlot) throw Error('Transaction is outside the reviewed deployment slot range');
  if (!trace.innerInstructionRecordingAvailable) throw Error('RPC omitted inner instruction metadata');
  const launches=trace.floatCalls.filter(c=>decodeData(c.instruction.data).subarray(0,8).toString('hex')===policy.discriminatorHex);
  if (launches.length !== 1) throw Error('Exactly one reviewed Float launch instruction is required');
  const launch=launches[0];
  const a=launch.instruction.accounts;
  if (!a || a.length !== policy.accountCount) throw Error('Launch account layout does not match reviewed policy');
  if (a[policy.roles.mint] !== mint || a[policy.roles.creator] !== creator || a[policy.roles.feeReceiver] !== feeReceiver) {
    throw Error('Launch mint, creator or fee receiver does not match');
  }
  const keys=new Map(trace.accountKeys.map(k=>[k.pubkey,k]));
  if (keys.size !== trace.accountKeys.length || a.some(k=>!keys.has(k))) throw Error('Incomplete or ambiguous transaction account metadata');
  if (keys.get(creator)?.signer !== true) throw Error('Expected creator did not sign the launch');
  if (!launch.inner.some(i=>i.programId===LAUNCHLAB && i.stackHeight===2 && i.accounts?.includes(mint))) {
    throw Error('No direct LaunchLab invocation for the mint under the reviewed Float launch');
  }
  return {
    status:'matches_reviewed_launch_instruction', signature, slot:trace.slot, genesisHash:rpcGenesisHash,
    program:FLOAT, instructionIndex:launch.index, mint, creator, feeReceiver,
    feeCycleVerified:false, payoutAuthorized:false
  };
}

if (import.meta.main) {
  try {
    const [path, signature, mint, creator, feeReceiver, ...extra]=process.argv.slice(2);
    if (!path || !signature || !mint || !creator || !feeReceiver || extra.length) {
      throw Error('Usage: npm run review:float -- <reviewed-policy.json> <signature> <mint> <creator> <fee-receiver>');
    }
    const policy=parseLaunchPolicy(JSON.parse(await readFile(path,'utf8')));
    const urls=(process.env.FUNDED_READ_RPC ?? '').split(',').map(v=>v.trim()).filter(Boolean);
    if (urls.length !== 1) throw Error('Launch review requires exactly one trusted FUNDED_READ_RPC endpoint');
    const rpc=new SolanaReader(urls);
    const genesis=await rpc.read('getGenesisHash',[]);
    if (genesis !== policy.genesisHash) throw Error('RPC cluster does not match launch policy');
    const tx=await rpc.finalizedTransaction(signature);
    if (!tx) throw Error('Transaction unavailable from this RPC');
    console.log(JSON.stringify(reviewFloatHandoff(genesis,signature,tx,policy,{mint,creator,feeReceiver}),null,2));
  } catch(e) {
    console.error(e instanceof Error ? e.message : 'Float launch review failed');
    process.exitCode=1;
  }
}
