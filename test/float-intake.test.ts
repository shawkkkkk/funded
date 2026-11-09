import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FloatIntake } from '../src/float-intake.ts';
import { Store } from '../src/store.ts';
import { FLOAT, LAUNCHLAB, NATIVE, SOLANA_USDC } from '../src/domain.ts';
import { LEGACY_TOKEN_PROGRAM } from '../src/float-fee-review.ts';
import type { FinalizedTrace } from '../src/float-evidence.ts';

const CREATOR='So11111111111111111111111111111111111111112';
const WALLET='ComputeBudget111111111111111111111111111111';
const MINT='SysvarRent111111111111111111111111111111111';
const DEST='SysvarC1ock11111111111111111111111111111111';
const GENESIS='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2dY';
const LAUNCH='2'.repeat(87), RECEIPT='3'.repeat(87);
const key = (pubkey:string,signer=false)=>({pubkey,signer,writable:true});
const draft = (pair:string)=>({name:'Token',ticker:'TKN',pair,feeBps:100,creatorWallet:CREATOR,recipient:'example'});
const launch = () => ({slot:10,transaction:{signatures:[LAUNCH],message:{accountKeys:[key(CREATOR,true),key(MINT)],instructions:[{programId:FLOAT}]}},meta:{err:null}});
const tx = (account:string=WALLET) => ({slot:11,transaction:{signatures:[RECEIPT],message:{accountKeys:[key(account)],instructions:[]}},meta:{err:null,preBalances:[5],postBalances:[12]}});

test('reserves a separate fee wallet once, confirms official handoff without a historic sample, and persists a held receipt once across restart',()=>{
  const dir=mkdtempSync(join(tmpdir(),'funded-intake-'));
  const path=join(dir,'state.sqlite');
  let store=new Store(path);
  try {
    const id=store.saveDraft(draft(NATIVE)).id, other=store.saveDraft(draft(NATIVE)).id;
    let intake=new FloatIntake(store);
    assert.throws(()=>intake.reserve(id,CREATOR,GENESIS),/separate/);
    assert.equal(intake.reserve(id,WALLET,GENESIS).createUrl,'https://www.floatlaunch.xyz/create');
    assert.equal(intake.reserve(id,WALLET,GENESIS).duplicate,true);
    assert.throws(()=>intake.reserve(other,WALLET,GENESIS),/already reserved/);
    assert.throws(()=>intake.observe(id,GENESIS,RECEIPT,tx()),/confirmed/);
    assert.throws(()=>intake.confirm(id,GENESIS,LAUNCH,launch(),MINT,DEST,'operator:001'),/receiving account/);
    const bad=launch(); bad.transaction.message.accountKeys[0].signer=false;
    assert.throws(()=>intake.confirm(id,GENESIS,LAUNCH,bad,MINT,WALLET,'operator:001'),/does not match/);
    assert.equal(intake.confirm(id,GENESIS,LAUNCH,launch(),MINT,WALLET,'operator:001').walletSelection,'operator_attested');
    assert.equal(intake.confirm(id,GENESIS,LAUNCH,launch(),MINT,WALLET,'operator:001').duplicate,true);
    assert.throws(()=>intake.confirm(id,GENESIS,LAUNCH,launch(),MINT,WALLET,'operator:002'),/Conflicting/);
    assert.throws(()=>intake.observe(id,LAUNCHLAB,RECEIPT,tx()),/cluster/);
    assert.throws(()=>intake.observe(id,GENESIS,LAUNCH,tx()),/matching/i);
    assert.throws(()=>intake.observe(id,GENESIS,RECEIPT,{...tx(),slot:10}),/follow/);
    assert.throws(()=>intake.observe(id,GENESIS,RECEIPT,tx(DEST)),/not writable/);
    const evidence=intake.observe(id,GENESIS,RECEIPT,tx());
    assert.equal(evidence.netUnits,'7');
    assert.equal(evidence.status,'held_pending_attribution');
    assert.equal(evidence.creditAuthorized,false);
    assert.equal(evidence.payoutAuthorized,false);
    store.db.close();
    store=new Store(path);
    intake=new FloatIntake(store);
    assert.equal(intake.observe(id,GENESIS,RECEIPT,tx()).duplicate,true);
    const conflicting=tx(); conflicting.meta.postBalances[0]=13;
    assert.throws(()=>intake.observe(id,GENESIS,RECEIPT,conflicting),/Conflicting observation/);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM float_observations').get()?.n,1);
    assert.deepEqual(store.publicBatches(),[]);
  } finally { store.db.close(); rmSync(dir,{recursive:true,force:true}); }
});

test('reconciles exact SPL integer units only for the enrolled token account, owner, mint and program metadata',()=>{
  const store=new Store(':memory:');
  try {
    const intake=new FloatIntake(store), id=store.saveDraft(draft(SOLANA_USDC)).id;
    intake.reserve(id,WALLET,GENESIS);
    intake.confirm(id,GENESIS,LAUNCH,launch(),MINT,DEST,'operator:spl');
    const bal=(amount:string)=>({accountIndex:0,owner:WALLET,mint:SOLANA_USDC,programId:LEGACY_TOKEN_PROGRAM,uiTokenAmount:{amount,decimals:6}});
    const raw=tx(DEST), receipt={...raw,meta:{...raw.meta,preTokenBalances:[bal('9007199254740993')],postTokenBalances:[bal('9007199254741000')]}};
    for(const wrong of [{owner:CREATOR},{mint:CREATOR},{programId:FLOAT}]) {
      assert.throws(()=>intake.observe(id,GENESIS,RECEIPT,{...receipt,meta:{...receipt.meta,postTokenBalances:[{...receipt.meta.postTokenBalances[0],...wrong}]}}),/metadata/);
    }
    assert.throws(()=>intake.observe(id,GENESIS,RECEIPT,raw),/metadata/);
    assert.equal(intake.observe(id,GENESIS,RECEIPT,receipt).netUnits,'7');
    assert.deepEqual(store.publicBatches(),[]);
  } finally { store.db.close(); }
});

test('stores an optional policy match separately, rejects unrelated sources and never credits the ledger',()=>{
  const store=new Store(':memory:');
  try {
    const intake=new FloatIntake(store), id=store.saveDraft(draft(SOLANA_USDC)).id;
    intake.reserve(id,WALLET,GENESIS);
    intake.confirm(id,GENESIS,LAUNCH,launch(),MINT,DEST,'operator:spl');
    const policy={genesisHash:GENESIS,stage:'graduated',fromSlot:10,throughSlot:30,discriminatorHex:'0000000000000001',
      accountCount:3,roles:{launchMint:0,sourceVault:1,destination:2}};
    const keys=[MINT,LAUNCHLAB,DEST,FLOAT,LEGACY_TOKEN_PROGRAM,SOLANA_USDC];
    const b=(accountIndex:number,owner:string,amount:string)=>({accountIndex,owner,programId:LEGACY_TOKEN_PROGRAM,mint:SOLANA_USDC,uiTokenAmount:{amount,decimals:6}});
    const raw:FinalizedTrace={slot:20,transaction:{signatures:[RECEIPT],message:{accountKeys:keys.map(k=>key(k)),
      instructions:[{programId:FLOAT,accounts:keys.slice(0,3),data:'11111112'}]}},meta:{err:null,
      innerInstructions:[{index:0,instructions:[{programId:LEGACY_TOKEN_PROGRAM,stackHeight:2,parsed:{type:'transferChecked',info:{
        source:LAUNCHLAB,destination:DEST,mint:SOLANA_USDC,tokenAmount:{amount:'7',decimals:6}}}}]}],
      preTokenBalances:[b(1,FLOAT,'80'),b(2,WALLET,'10')],postTokenBalances:[b(1,FLOAT,'73'),b(2,WALLET,'17')]}};
    assert.throws(()=>intake.review(id,GENESIS,RECEIPT,raw,policy,CREATOR),/expected route/);
    assert.equal(intake.audit(id).latestObservations.length,0);
    const match=intake.review(id,GENESIS,RECEIPT,raw,policy,LAUNCHLAB);
    assert.equal(match.status,'matches_reviewed_fee_cycle');
    assert.equal(match.creditAuthorized,false);
    assert.equal(intake.review(id,GENESIS,RECEIPT,raw,policy,LAUNCHLAB).duplicate,true);
    assert.throws(()=>intake.review(id,GENESIS,RECEIPT,raw,{...policy,stage:'bonding'},LAUNCHLAB),/Conflicting attribution/);
    const [{observation,review}]=intake.audit(id).latestObservations;
    assert.equal(observation.ref,review.observationRef);
    assert.equal(observation.netUnits,review.units);
    assert.deepEqual(store.publicBatches(),[]);
  } finally { store.db.close(); }
});
