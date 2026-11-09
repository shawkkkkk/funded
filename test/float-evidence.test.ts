import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOAT, LAUNCHLAB, SOLANA_USDC } from '../src/domain.ts';
import { summarizeTrace } from '../src/float-evidence.ts';
import type { FinalizedTrace } from '../src/float-evidence.ts';

const sig='2'.repeat(87);
const tokenAccount={accountIndex:0,mint:SOLANA_USDC,owner:FLOAT,uiTokenAmount:{amount:'18446744073709551600',decimals:6}};
function sample(): FinalizedTrace {
  return {
    slot:21,version:0,transaction:{signatures:[sig],message:{
      accountKeys:[{pubkey:LAUNCHLAB,signer:false,writable:true},{pubkey:FLOAT,signer:false,writable:false}],
      instructions:[{programId:FLOAT,accounts:[LAUNCHLAB],data:'7Fv'}]
    }},
    meta:{err:null,innerInstructions:[{index:0,instructions:[{programId:LAUNCHLAB,accounts:[LAUNCHLAB],data:'8sB',stackHeight:2}]}],
      preTokenBalances:[tokenAccount],postTokenBalances:[{...tokenAccount,uiTokenAmount:{...tokenAccount.uiTokenAmount,amount:'18446744073709551604'}}]}
  };
}

test('captures Float instruction bytes and exact token delta without asserting provenance',()=>{
  const result=summarizeTrace(sig,sample());
  assert.equal(result.hasLaunchLabInnerCall,true);
  assert.equal(result.floatCalls[0].instruction.data,'7Fv');
  assert.equal(result.tokenDeltas[0].delta,'4');
  assert.equal(result.verifiedFundedLaunch,false);
  assert.equal(result.verifiedCreatorFee,false);
});
test('distinguishes missing RPC metadata from zero token movement',()=>{
  const tx=sample();
  delete tx.meta!.postTokenBalances;
  tx.meta!.innerInstructions=null;
  const result=summarizeTrace(sig,tx);
  assert.equal(result.innerInstructionRecordingAvailable,false);
  assert.equal(result.tokenBalanceRecordingAvailable,false);
  assert.deepEqual(result.tokenDeltas,[]);
});
test('rejects failed, unrelated, mismatched and contradictory RPC traces',()=>{
  assert.throws(()=>summarizeTrace('wrong',sample()),/matching transaction/);
  const failed=sample();
  failed.meta!.err={InstructionError:[0,'Custom']};
  assert.throws(()=>summarizeTrace(sig,failed),/successful/);
  const unrelated=sample();
  unrelated.transaction.message.instructions=[{programId:LAUNCHLAB}];
  assert.throws(()=>summarizeTrace(sig,unrelated),/No top-level Float/);
  const mismatch=sample();
  mismatch.meta!.postTokenBalances=[{...tokenAccount,owner:LAUNCHLAB}];
  assert.throws(()=>summarizeTrace(sig,mismatch),/identity changed/);
});
