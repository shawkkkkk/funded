import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { app } from '../src/server.ts';
import { BASE_USDC, FLOAT, LAUNCHLAB, SOLANA_USDC, address, handle, guardQuote } from '../src/domain.ts';
import { bridgeEvidence, conversionDecision, prepareFloatLaunch, PeerReads } from '../src/policy.ts';
import { SolanaReader } from '../src/solana.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const draft = { name:'Token',ticker:'token',pair:SOLANA_USDC,feeBps:250,creatorWallet:FLOAT,recipient:' @EXAMPLE ',firstBuyBaseUnits:'0' };
test('validates Solana addresses, URL schemes, decimal units and handle without treating it as verified',()=>{
  assert.equal(address(FLOAT),FLOAT);
  assert.throws(()=>address('2'.repeat(32)));
  assert.equal(handle(' @EXAMPLE '),'example');
  assert.throws(()=>handle('https://x.com/example'));
  const s = new Store(':memory:');
  assert.equal(s.saveDraft(draft).unsignedTransaction,null);
  assert.throws(()=>s.saveDraft({...draft,website:'javascript:alert(1)'}));
  assert.throws(()=>s.saveDraft({...draft,firstBuyBaseUnits:'1.5'}));
  assert.throws(prepareFloatLaunch,/disabled/);
});

test('records once, survives process restart, and rejects a conflicting replay',()=>{
  const dir = mkdtempSync(join(tmpdir(),'funded-test-'));
  try {
    const path = join(dir,'state.sqlite'), a = new Store(path);
    const receipt = {mint:FLOAT,asset:SOLANA_USDC,units:'9000000',originRef:'fixture:solana:0:3'};
    const {id} = a.recordReceipt(receipt);
    a.db.close();
    const b = new Store(path);
    assert.deepEqual(b.recordReceipt(receipt),{id,duplicate:true});
    assert.throws(()=>b.recordReceipt({...receipt,units:'9000001'}),/Conflicting/);
    assert.equal(b.batch(id)?.units,'9000000');
    b.db.close();
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('only verified fills increase USD; partial fill and return reconcile exactly',()=>{
  const s = new Store(':memory:');
  const {id} = s.recordReceipt({mint:FLOAT,asset:SOLANA_USDC,units:'10000000',originRef:'fixture:receipt'});
  const step = (kind,ref,extra={})=>s.apply(id,{id:'id:'+ref,kind,ref,...extra});
  assert.throws(()=>step('bridge_finalized','before-burn',{units:'9999999'}),/transition/);
  step('bridge_submitted','source');
  step('bridge_finalized','destination',{units:'9999999'});
  step('peer_submitted','peer-tx');
  step('peer_deposit_finalized','peer-created',{peerId:'42',units:'9999999',minFiatBps:'9000'});
  assert.equal(s.batch(id)?.paid_usd,'0');
  const payment = {peerId:'42',units:'2000000',usdMicros:'1800000'};
  assert.throws(()=>step('fiat_proven','wrong-peer',{...payment,peerId:'41'}),/evidence/);
  assert.throws(()=>step('fiat_proven','bad-economics',{...payment,usdMicros:'1700000'}),/economics/);
  step('fiat_proven','proof-1',payment);
  step('fiat_proven','proof-1',payment);
  assert.equal(s.batch(id)?.paid_usd,'1800000');
  assert.equal(s.batch(id)?.status,'partially_paid');
  assert.throws(()=>step('peer_return_finalized','under-return',{peerId:'42',units:'7999998'}),/reconcile/);
  step('peer_return_finalized','return',{peerId:'42',units:'7999999'});
  step('resume_returned','resume');
  step('peer_submitted','second-peer-tx');
  step('peer_deposit_finalized','second-peer-created',{peerId:'43',units:'7999999',minFiatBps:'10000'});
  step('fiat_proven','proof-2',{peerId:'43',units:'7999999',usdMicros:'7999999'});
  assert.equal(s.batch(id)?.status,'paid');
  assert.equal(s.batch(id)?.units,'0');
  const totals = new Map();
  for (const r of s.db.prepare('SELECT * FROM journals').all()) {
    const k = r.event_id+'|'+r.asset;
    totals.set(k,(totals.get(k) ?? 0n) + BigInt(r.delta));
  }
  assert.ok([...totals.values()].every(x=>x===0n));
});

test('conversion holds unsupported mints and rejects unsafe or stale quotes',()=>{
  const q = {inputMint:FLOAT,outputMint:SOLANA_USDC,inAmount:'100',outAmount:'10000000',otherAmountThreshold:'9900000',routeProgramIds:[LAUNCHLAB],quotedAt:90};
  const p = {inputMint:FLOAT,units:100n,slippageBps:100,referenceMinNet:9_800_000n,allowedPrograms:new Set([LAUNCHLAB]),now:100,maxAgeMs:20,mintApproved:true};
  assert.equal(guardQuote(q,p),9900000n);
  assert.throws(()=>guardQuote({...q,otherAmountThreshold:'9899999'},p),/protected/);
  assert.throws(()=>guardQuote({...q,routeProgramIds:['unknown']},p),/route program/);
  assert.throws(()=>guardQuote(q,{...p,now:200}),/Stale/);
  assert.equal(conversionDecision({mint:FLOAT,units:100n,policy:p}).status,'waiting_route');
  assert.equal(conversionDecision({mint:SOLANA_USDC,units:100n,policy:p}).status,'already_usdc');
});

test('source burn or attestation alone cannot release Base settlement',()=>{
  const hash='0x'+'b'.repeat(64), recipient='0x'+'c'.repeat(40);
  const args={expectedBurn:'sig',observedBurn:'sig',burnFinalized:true,attestationComplete:true,destinationChain:8453,destinationFinalized:true,expectedRecipient:recipient,recipient,mint:BASE_USDC,expectedMessageHash:hash,deliveredMessageHash:hash,deliveredUnits:'999',minUnits:'990',maxUnits:'1000'};
  assert.equal(bridgeEvidence(args),999n);
  assert.throws(()=>bridgeEvidence({...args,destinationFinalized:false}),/not verified/);
  assert.throws(()=>bridgeEvidence({...args,recipient:BASE_USDC}),/not verified/);
  assert.throws(()=>bridgeEvidence({...args,deliveredUnits:'950'}),/bounds/);
});

test('RPC allows reads only, fails over, and does not equate a Float CPI with provenance',async()=>{
  const tx={slot:123,transaction:{message:{instructions:[{programId:FLOAT}]}},meta:{err:null,innerInstructions:[{index:0,instructions:[{programId:LAUNCHLAB}]}]}};
  const r=new SolanaReader(['https://bad.example','https://ok.example'],async (url,init)=>{
    const req=JSON.parse(init.body);
    assert.equal(req.params[1].commitment,'finalized');
    if (url.hostname === 'bad.example') return new Response('',{status:503});
    return Response.json({id:1,result:tx});
  });
  await assert.rejects(r.read('sendTransaction',[]),/disabled/);
  const result=await r.inspect('2'.repeat(87));
  assert.equal(result.launchLabUnderFloat,true);
  assert.equal(result.verifiedFundedLaunch,false);
});

test('a connected Peer receipt inbox does not enable payouts',async()=>{
  const p=new PeerReads({isXMoneyConnected:async()=>true,order:async id=>({id})});
  assert.deepEqual(await p.eligibility({handle:'@Example',payeeDetails:'fixture-hash',holderConsent:true}),{username:'example',receiptInboxConnected:true,eligibleForLivePayout:false});
});

test('serves Funded branding and persists same-origin drafts; live routes are absent',async()=>{
  const store=new Store(':memory:'), server=app(store);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  try {
    const get=await fetch(origin+'/launch');
    assert.equal(get.status,200);
    assert.match(await get.text(),/FUNDED/);
    assert.equal((await fetch(origin+'/funded-mark.webp')).headers.get('content-type'),'image/webp');
    assert.equal((await (await fetch(origin+'/api/status')).json()).launchEnabled,false);
    const submit=(from)=>fetch(origin+'/api/drafts',{method:'POST',headers:{'content-type':'application/json',origin:from},body:JSON.stringify(draft)});
    assert.equal((await submit('https://elsewhere.example')).status,403);
    assert.equal((await submit(origin)).status,201);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM drafts').get().n,1);
    assert.equal((await fetch(origin+'/api/launch',{method:'POST'})).status,404);
    assert.equal((await fetch(origin+'/api/transactions')).status,503);
  } finally { await new Promise(resolve=>server.close(resolve)); store.db.close(); }
});
