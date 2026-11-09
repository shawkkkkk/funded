import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOAT, LAUNCHLAB, SOLANA_USDC } from '../src/domain.ts';
import { LEGACY_TOKEN_PROGRAM, reviewFloatFeeCycle } from '../src/float-fee-review.ts';
import type { FinalizedTrace } from '../src/float-evidence.ts';

// Synthetic fixture: no account positions or instruction bytes here are a production Float ABI.
const signature='2'.repeat(87), genesis='11111111111111111111111111111111';
const route={launchMint:'So11111111111111111111111111111111111111112',feeMint:SOLANA_USDC,
  feeReceiver:'7Fnkf7CkiW6aJaJnaqs97LoAc1LbfwxgYKsYfSHTCApi',sourceVault:LAUNCHLAB,
  destination:'2ouNPACQVBoDqWJ7Ft6EGhmCGScKpmRzaQn6a9vhKp6D'};
const policy={genesisHash:genesis,stage:'graduated',fromSlot:10,throughSlot:30,discriminatorHex:'0000000000000001',
  accountCount:3,roles:{launchMint:0,sourceVault:1,destination:2}};
const movement={programId:LEGACY_TOKEN_PROGRAM,stackHeight:2,parsed:{type:'transferChecked',info:{
  source:route.sourceVault,destination:route.destination,mint:route.feeMint,tokenAmount:{amount:'7',decimals:6}
}}};
function sample():FinalizedTrace {
  const keys=[route.launchMint,route.sourceVault,route.destination,FLOAT,LEGACY_TOKEN_PROGRAM,route.feeMint];
  const b=(accountIndex:number,owner:string,units:string)=>({accountIndex,owner,programId:LEGACY_TOKEN_PROGRAM,mint:route.feeMint,uiTokenAmount:{amount:units,decimals:6}});
  return {slot:20,transaction:{signatures:[signature],message:{accountKeys:keys.map(pubkey=>({pubkey,signer:false,writable:true})),
    instructions:[{programId:FLOAT,accounts:keys.slice(0,3),data:'11111112'}]}},meta:{err:null,
    innerInstructions:[{index:0,instructions:[structuredClone(movement)]}],
    preTokenBalances:[b(1,FLOAT,'80'),b(2,route.feeReceiver,'9007199254740999')],
    postTokenBalances:[b(1,FLOAT,'73'),b(2,route.feeReceiver,'9007199254741006')]
  }};
}
const review=(tx:FinalizedTrace,p=policy,r=route,g=genesis)=>reviewFloatFeeCycle(g,signature,tx,p,r);
test('reviews an isolated legacy fee credit using exact integer amounts without authorizing a payout',()=>{
  const result=review(sample());
  assert.equal(result.units,'7');
  assert.equal(result.status,'matches_reviewed_fee_cycle');
  assert.equal(result.sourceRef,`solana:${genesis}:${signature}:0:0`);
  assert.equal(result.creditAuthorized,false);
  assert.equal(result.payoutAuthorized,false);
});
test('rejects an unrelated payment to the same account, even if the net balance still matches',()=>{
  const tx=sample();
  tx.transaction.message.instructions.push(structuredClone(movement));
  assert.throws(()=>review(tx),/not isolated/);
  const other=sample();
  other.transaction.message.instructions.push({programId:LAUNCHLAB});
  other.meta!.innerInstructions!.push({index:1,instructions:[structuredClone(movement)]});
  assert.throws(()=>review(other),/not isolated/);
});
test('rejects misleading transfer shapes and duplicated inner groups',()=>{
  const nested=sample();
  nested.meta!.innerInstructions![0].instructions[0].stackHeight=3;
  assert.throws(()=>review(nested),/direct legacy/);
  const two=sample();
  two.meta!.innerInstructions![0].instructions.push(structuredClone(movement));
  assert.throws(()=>review(two),/not isolated/);
  const dupe=sample();
  dupe.meta!.innerInstructions!.push({index:0,instructions:[]});
  assert.throws(()=>review(dupe),/Ambiguous/);
  const wrongProgram=sample();
  wrongProgram.meta!.innerInstructions![0].instructions[0].programId=LAUNCHLAB;
  assert.throws(()=>review(wrongProgram),/direct legacy/);
  const source=sample();
  (source.meta!.innerInstructions![0].instructions[0].parsed as typeof movement.parsed).info.source=route.feeReceiver;
  assert.throws(()=>review(source),/reviewed source/);
});
test('rejects destination ownership and balance inconsistencies, missing metadata and wrong policy scope',()=>{
  const wrongOwner={...route,feeReceiver:FLOAT};
  assert.throws(()=>review(sample(),policy,wrongOwner),/reviewed receiver/);
  const wrongDelta=sample();
  wrongDelta.meta!.postTokenBalances![1].uiTokenAmount.amount='9007199254741007';
  assert.throws(()=>review(wrongDelta),/does not reconcile/);
  const missing=sample();
  delete missing.meta!.preTokenBalances;
  assert.throws(()=>review(missing),/Missing CPI/);
  assert.throws(()=>review(sample(),{...policy,throughSlot:19}),/outside reviewed/);
  assert.throws(()=>review(sample(),policy,route,FLOAT),/cluster/);
  assert.throws(()=>review(sample(),{...policy,discriminatorHex:'0000000000000002'}),/recognized Float/);
});
