import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOAT, LAUNCHLAB, NATIVE, SOLANA_USDC } from '../src/domain.ts';
import { jupiterPreflight, WRAPPED_SOL } from '../src/jupiter-preflight.ts';
import { cctpPreflight } from '../src/cctp-preflight.ts';

const response=(value:unknown)=>Response.json(value);
const quote=()=>({inputMint:WRAPPED_SOL,outputMint:SOLANA_USDC,inAmount:'1000000',outAmount:'200000',otherAmountThreshold:'199000',
  swapMode:'ExactIn',slippageBps:50,priceImpactPct:'0.0002201352184531394710191833',routePlan:[{bps:10000,swapInfo:{ammKey:LAUNCHLAB,
    inputMint:WRAPPED_SOL,outputMint:SOLANA_USDC,inAmount:'1000000',outAmount:'200000'}}],swapInstruction:{programId:FLOAT,data:'never-exported'},
  setupInstructions:[],computeBudgetInstructions:[],otherInstructions:[],cleanupInstruction:null});
const swap={asset:NATIVE,units:'1000000',taker:LAUNCHLAB};
const policy={assets:new Set([NATIVE,SOLANA_USDC,WRAPPED_SOL]),pools:new Set([LAUNCHLAB]),topLevelPrograms:new Set([FLOAT]),
  slippageBps:50,maxImpactBps:10,maxAgeMs:2500,referenceMinNet:'190000'};

test('requests a fixed exact-input Jupiter quote and discards all executable instructions',async()=>{
  const out=await jupiterPreflight(swap,policy,{apiKey:'fixture',transport:async(url,options)=>{
    const u=new URL(String(url));
    assert.equal(u.origin+u.pathname,'https://api.jup.ag/swap/v2/build');
    assert.equal(u.searchParams.get('inputMint'),WRAPPED_SOL);
    assert.equal(u.searchParams.get('outputMint'),SOLANA_USDC);
    assert.equal(u.searchParams.get('platformFeeBps'),'0');
    assert.equal(u.searchParams.get('wrapAndUnwrapSol'),'true');
    assert.equal(options?.method,'GET'); assert.equal(options?.redirect,'error');
    assert.equal(new Headers(options?.headers).get('x-api-key'),'fixture');
    return response(quote());
  }});
  assert.deepEqual(out,{status:'quote_only',expectedUsdcUnits:'200000',minimumUsdcUnits:'199000',pool:LAUNCHLAB,executionAuthorized:false});
  const spl=await jupiterPreflight({...swap,asset:WRAPPED_SOL},policy,{transport:async url=>{
    assert.equal(new URL(String(url)).searchParams.get('wrapAndUnwrapSol'),'false');
    return response(quote());
  }});
  assert.equal(spl.status,'quote_only');
});

test('holds stale, malformed, oversized or unexpected quotes and never calls out for unapproved assets',async()=>{
  const noFetch=async()=>assert.fail('Must not call provider');
  assert.equal((await jupiterPreflight({...swap,asset:SOLANA_USDC},policy,{transport:noFetch})).status,'already_solana_usdc');
  assert.equal((await jupiterPreflight({...swap,asset:FLOAT},policy,{transport:noFetch})).status,'held_unapproved_asset_or_amount');
  const variants=[{priceImpactPct:'0.001000000000000001'},{otherAmountThreshold:'198999'},{swapMode:'ExactOut'},
    {tipInstruction:{programId:FLOAT}},{swapInstruction:{programId:LAUNCHLAB}},{inAmount:'1000001'},
    {routePlan:[{...quote().routePlan[0],bps:5000}]},{outputMint:FLOAT}];
  for(const variant of variants) assert.equal((await jupiterPreflight(swap,policy,{transport:async()=>response({...quote(),...variant})})).status,'held_quote_rejected');
  let calls=0;
  assert.match((await jupiterPreflight(swap,policy,{transport:async()=>response(quote()),clock:()=>calls++*2600})).reason??'',/Stale/);
  assert.deepEqual(await jupiterPreflight(swap,policy,{transport:async()=>new Response('sensitive provider text',{status:429})}),
    {status:'held_provider_unavailable',httpStatus:429,executionAuthorized:false});
  assert.equal((await jupiterPreflight(swap,policy,{transport:async()=>new Response('X'.repeat(256001))})).status,'held_provider_unavailable');
});

const intent={signature:'2'.repeat(87),senderProgram:'11111111111111111111111111111112',
  baseMessenger:'0x'+'22'.repeat(20),sourceWallet:'11111111111111111111111111111113',baseRecipient:'0x'+'33'.repeat(20),
  burnUnits:'1000000',maxFeeUnits:'1000',minimumNetUnits:'999000'};
function message() {
  // Synthetic Circle v2 message; no signatures or executed bridge.
  const m=Buffer.alloc(376);
  m.writeUInt32BE(1,0); m.writeUInt32BE(5,4); m.writeUInt32BE(6,8); m[43]=10; m[75]=1;
  m.fill(0x22,88,108); m.writeUInt32BE(2000,140); m.writeUInt32BE(2000,144); m.writeUInt32BE(1,148);
  const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const mint=[...SOLANA_USDC].reduce((v,k)=>v*58n+BigInt(alphabet.indexOf(k)),0n);
  Buffer.from(mint.toString(16).padStart(64,'0'),'hex').copy(m,152);
  m.fill(0x33,196,216); m.writeUInt32BE(1000000,244); m[279]=2;
  m.writeUInt32BE(1000,308); m.writeUInt32BE(20,340);
  return m;
}
const circle=(m=message())=>({sourceTxHash:intent.signature,messages:[{message:'0x'+m.toString('hex'),cctpVersion:2,
  status:'complete',attestation:'0x'+'ab'.repeat(65)}]});

test('matches an existing standard CCTP message to the pinned intent but does not claim Base delivery',async()=>{
  const r=await cctpPreflight(intent,async(url,options)=>{
    const u=new URL(String(url)); assert.equal(u.origin+u.pathname,'https://iris-api.circle.com/v2/messages/5');
    assert.equal(u.searchParams.get('transactionHash'),intent.signature); assert.equal(options?.method,'GET');
    return response(circle());
  });
  assert.equal(r.status,'attestation_reported'); assert.equal(r.expectedNetUnits,'999980');
  assert.equal(r.signatureVerified,false); assert.equal(r.baseSettlementVerified,false);
  assert.equal((await cctpPreflight(intent,async()=>new Response(null,{status:404}))).status,'awaiting_attestation');
});

test('rejects wrong burn identifiers, unexpected domain or recipient, fast finality, extra messages and excess fees',async()=>{
  const bad=message(), fast=message(), wrongDestination=message(), fee=message();
  bad[215]^=1; fast.writeUInt32BE(1000,144); wrongDestination.writeUInt32BE(3,8); fee.writeUInt32BE(1001,340);
  const v=circle();
  for(const variant of [circle(bad),circle(fast),circle(wrongDestination),circle(fee),{...v,sourceTxHash:'3'.repeat(87)},
    {...v,messages:[...v.messages,...v.messages]}]) {
    const r=await cctpPreflight(intent,async()=>response(variant));
    assert.equal(r.status,'held_attestation_rejected'); assert.equal(r.baseSettlementVerified,false);
  }
});
