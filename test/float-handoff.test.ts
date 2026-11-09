import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOAT, LAUNCHLAB, SOLANA_USDC } from '../src/domain.ts';
import { parseLaunchPolicy, reviewFloatHandoff } from '../src/float-handoff.ts';
import type { LaunchPolicy } from '../src/float-handoff.ts';
import type { FinalizedTrace } from '../src/float-evidence.ts';

// Synthetic layout only. These positions and bytes are not a deployed ABI.
const signature='2'.repeat(87);
const genesis='11111111111111111111111111111111';
const expected={mint:'So11111111111111111111111111111111111111112',creator:SOLANA_USDC,feeReceiver:'7Fnkf7CkiW6aJaJnaqs97LoAc1LbfwxgYKsYfSHTCApi'};
const policy: LaunchPolicy={genesisHash:genesis,fromSlot:10,throughSlot:30,discriminatorHex:'0000000000000001',accountCount:3,roles:{mint:0,creator:1,feeReceiver:2}};
function sample(): FinalizedTrace {
  return {slot:20,version:0,transaction:{signatures:[signature],message:{
    accountKeys:[expected.mint,expected.creator,expected.feeReceiver,FLOAT,LAUNCHLAB].map(pubkey=>({pubkey,signer:pubkey===expected.creator,writable:false})),
    instructions:[{programId:FLOAT,accounts:[expected.mint,expected.creator,expected.feeReceiver],data:'11111112'}]
  }},meta:{err:null,innerInstructions:[{index:0,instructions:[{programId:LAUNCHLAB,accounts:[expected.mint],stackHeight:2}]}]}};
}
test('a policy-matched external launch is review evidence, never fee or payout authorization',()=>{
  const result=reviewFloatHandoff(genesis,signature,sample(),policy,expected);
  assert.equal(result.status,'matches_reviewed_launch_instruction');
  assert.equal(result.feeReceiver,expected.feeReceiver);
  assert.equal(result.feeCycleVerified,false);
  assert.equal(result.payoutAuthorized,false);
});
test('rejects wrong or reused fee recipient, swapped roles, and creator who did not sign',()=>{
  const wrong=sample();
  wrong.transaction.message.instructions[0].accounts![2]=expected.creator;
  assert.throws(()=>reviewFloatHandoff(genesis,signature,wrong,policy,expected),/does not match/);
  assert.throws(()=>reviewFloatHandoff(genesis,signature,sample(),policy,{...expected,feeReceiver:expected.creator}),/must be distinct/);
  const unsigned=sample();
  unsigned.transaction.message.accountKeys[1].signer=false;
  assert.throws(()=>reviewFloatHandoff(genesis,signature,unsigned,policy,expected),/did not sign/);
  assert.throws(()=>parseLaunchPolicy({...policy,roles:{mint:0,creator:1,feeReceiver:1}}),/overlapping/);
});
test('rejects unrelated and ambiguous instructions even with the expected accounts present',()=>{
  const unknown=sample();
  unknown.transaction.message.instructions[0].data='11111113';
  assert.throws(()=>reviewFloatHandoff(genesis,signature,unknown,policy,expected),/Exactly one/);
  const multiple=sample();
  multiple.transaction.message.instructions.push(multiple.transaction.message.instructions[0]);
  assert.throws(()=>reviewFloatHandoff(genesis,signature,multiple,policy,expected),/Exactly one/);
  const indirect=sample();
  indirect.meta!.innerInstructions![0].instructions[0].stackHeight=3;
  assert.throws(()=>reviewFloatHandoff(genesis,signature,indirect,policy,expected),/No direct/);
  const wrongMint=sample();
  wrongMint.meta!.innerInstructions![0].instructions[0].accounts=[expected.creator];
  assert.throws(()=>reviewFloatHandoff(genesis,signature,wrongMint,policy,expected),/No direct/);
});
test('rejects wrong cluster, slot outside reviewed range, and unavailable CPI evidence',()=>{
  assert.throws(()=>reviewFloatHandoff(FLOAT,signature,sample(),policy,expected),/cluster/);
  assert.throws(()=>reviewFloatHandoff(genesis,signature,sample(),{...policy,throughSlot:19},expected),/slot range/);
  const missing=sample();
  missing.meta!.innerInstructions=null;
  assert.throws(()=>reviewFloatHandoff(genesis,signature,missing,policy,expected),/omitted/);
});
