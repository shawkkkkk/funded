import { address, FLOAT } from './domain.ts';
import { summarizeTrace } from './float-evidence.ts';
import { instructionDiscriminator } from './float-handoff.ts';
import { SolanaReader, validSignature } from './solana.ts';

type Reader=Pick<SolanaReader,'read'|'finalizedAddressSignatures'|'finalizedTransaction'>;
type Row={signature:string;slot:number;err:unknown;confirmationStatus?:string|null};
function readRows(value: unknown, limit: number, before?: string): Row[] {
  if (!Array.isArray(value)||value.length>limit) throw Error('Invalid finalized history page');
  let previous=Infinity;
  const seen=new Set<string>();
  for(const row of value) {
    if (!row||typeof row!=='object'||!validSignature(row.signature)||row.signature===before||seen.has(row.signature)||
        !Number.isSafeInteger(row.slot)||row.slot<0||row.slot>previous||!Object.hasOwn(row,'err')||
        (row.confirmationStatus!=null&&row.confirmationStatus!=='finalized')) throw Error('Invalid finalized history entry');
    seen.add(row.signature);
    previous=row.slot;
  }
  return value as Row[];
}

/** Read one bounded page. Candidates are evidence leads, never receipts or credits. */
export async function discoverFloatHistory(reader: Reader, options: {
  account:string; expectedGenesis:string; before?:string; limit?:number
}) {
  const account=address(options.account), expectedGenesis=address(options.expectedGenesis);
  const {before}=options, limit=options.limit??15;
  if (!Number.isSafeInteger(limit)||limit<1||limit>25||(before!==undefined&&!validSignature(before))) throw Error('Invalid history bounds');
  if (await reader.read('getGenesisHash',[])!==expectedGenesis) throw Error('RPC cluster does not match expected genesis');
  const rows=readRows(await reader.finalizedAddressSignatures(account,limit,before),limit,before);
  const checked=[];
  for(let i=0;i<rows.length;i+=4) {
    const group=await Promise.all(rows.slice(i,i+4).map(async ({signature,slot,err})=>{
      if (err!==null) return {signature,slot,status:'failed_on_chain' as const};
      try {
        const tx=await reader.finalizedTransaction(signature);
        if (!tx||tx.slot!==slot||tx.transaction.signatures[0]!==signature||tx.meta?.err!==null||
            !tx.transaction.message.accountKeys.some((key:{pubkey:string})=>key.pubkey===account)) throw Error('Unresolved transaction');
        if (!tx.transaction.message.instructions.some((ix:{programId:string})=>ix.programId===FLOAT)) {
          return {signature,slot,status:'no_top_level_float' as const};
        }
        const trace=summarizeTrace(signature,tx);
        return {signature,slot,status:'candidate_only' as const, floatCalls:trace.floatCalls.map(c=>({
          index:c.index,discriminatorHex:instructionDiscriminator(c.instruction.data),
          accounts:c.instruction.accounts??[],innerPrograms:c.inner.map(ix=>ix.programId)
        })), tokenDeltas:trace.tokenDeltas.filter(d=>d.account===account||d.owner===account),
        innerInstructionRecordingAvailable:trace.innerInstructionRecordingAvailable,
        tokenBalanceRecordingAvailable:trace.tokenBalanceRecordingAvailable};
      } catch {
        return {signature,slot,status:'unresolved' as const};
      }
    }));
    checked.push(...group);
  }
  const incomplete=checked.some(x=>x.status==='unresolved');
  return {account,genesisHash:expectedGenesis,rows:checked,incomplete,
    // No archive completeness claim. Refuse to advance past unavailable transactions.
    nextBefore:!incomplete&&rows.length===limit ? rows.at(-1)!.signature : null,
    creditAuthorized:false,payoutAuthorized:false};
}

if (import.meta.main) {
  try {
    const [account,before,...extra]=process.argv.slice(2);
    if(!account||extra.length) throw Error('Usage: npm run discover:float -- <account> [before-signature]');
    const urls=(process.env.FUNDED_READ_RPC??'').split(',').map(s=>s.trim()).filter(Boolean);
    if(urls.length!==1||!process.env.FUNDED_EXPECT_GENESIS) throw Error('Discovery requires one trusted FUNDED_READ_RPC and FUNDED_EXPECT_GENESIS');
    const result=await discoverFloatHistory(new SolanaReader(urls),{account,before,expectedGenesis:process.env.FUNDED_EXPECT_GENESIS});
    console.log(JSON.stringify(result,null,2));
    if(result.incomplete) process.exitCode=2;
  } catch(e) {
    console.error(e instanceof Error?e.message:'Float history discovery failed');
    process.exitCode=1;
  }
}
