import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DryRun } from '../src/dry-run.ts';
import { demoEvidence } from '../src/demo.ts';
import { FLOAT, SOLANA_USDC, NATIVE, payoutDestination } from '../src/domain.ts';
import { Store } from '../src/store.ts';

const destination = {rail:'xmoney' as const,handle:'@fixture_creator',consentId:'fixture:consent'};
const receipt = {mint:FLOAT,asset:SOLANA_USDC,units:'10010000',originRef:'fixture:restart'};

test('the automatic worker resumes after restart and never credits an unmatched deposit',()=>{
  const dir=mkdtempSync(join(tmpdir(),'funded-dry-run-')), path=join(dir,'demo.sqlite');
  try {
    const a=new Store(path), w=new DryRun(a);
    const id=w.enroll(receipt,destination,0);
    assert.equal(w.enroll(receipt,destination,0),id);
    assert.throws(()=>w.enroll(receipt,{...destination,rail:'venmo'},0),/Conflicting destination/);
    for(let n=0;n<4;n++) w.tick(n*1000,demoEvidence);
    assert.equal(a.batch(id)?.status,'awaiting_buyer');
    assert.equal(a.batch(id)?.paid_usd,'0');
    a.db.close();
    const b=new Store(path);
    try {
      const restarted=new DryRun(b);
      assert.equal(restarted.tick(4000,()=>({kind:'pending',reason:'No buyer'}))?.outcome,'pending');
      assert.equal(restarted.tick(5999,demoEvidence),null);
      assert.equal(restarted.tick(6000,demoEvidence)?.status,'partially_paid');
      assert.equal(b.batch(id)?.paid_usd,'4000000');
      assert.equal(restarted.tick(7000,demoEvidence)?.status,'paid');
      assert.equal(b.batch(id)?.paid_usd,'10000000');
      assert.equal(restarted.tick(8000,demoEvidence),null);
    } finally { b.db.close(); }
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('no conversion route preserves original funds, retries, and rejects non-fixture evidence',()=>{
  const s=new Store(':memory:'), w=new DryRun(s);
  assert.throws(()=>w.enroll({...receipt,originRef:'chain:real'},destination,0),/fixture receipts/);
  const id=w.enroll({...receipt,asset:NATIVE},destination,0);
  assert.equal(w.tick(0,()=>({kind:'pending',reason:'No quote'}))?.status,'waiting_route');
  assert.equal(s.batch(id)?.asset,NATIVE);
  assert.equal(s.batch(id)?.units,receipt.units);
  assert.throws(()=>w.tick(2000,()=>({kind:'event',evidence:{id:'fake',kind:'swap_submitted',ref:'external'}})),/fixture evidence/);
  assert.equal(s.batch(id)?.status,'waiting_route');
  assert.equal(w.tick(2000,demoEvidence)?.status,'swap_pending');
  s.db.close();
});

test('unsupported payee formats and under-minimum orders fail closed',()=>{
  assert.deepEqual(payoutDestination('cashapp','$Test123'),{rail:'cashapp',handle:'Test123'});
  assert.deepEqual(payoutDestination('venmo','@test-creator'),{rail:'venmo',handle:'test-creator'});
  assert.throws(()=>payoutDestination('venmo','@a'),/format/);
  const s=new Store(':memory:'), w=new DryRun(s);
  const id=w.enroll({...receipt,units:'4999999'},{rail:'cashapp',handle:'$Test123',consentId:'fixture:consent'},0);
  assert.equal(w.tick(0,()=>{throw Error('should not observe');})?.outcome,'pending');
  assert.equal(s.batch(id)?.status,'solana_usdc');
  s.db.close();
});

test('fixture evidence and queue progression roll back together on failure',()=>{
  const s=new Store(':memory:'), w=new DryRun(s);
  const id=w.enroll(receipt,destination,0);
  s.db.exec("CREATE TRIGGER test_fail BEFORE UPDATE ON dry_run_jobs BEGIN SELECT RAISE(ABORT,'fixture forced rollback'); END;");
  assert.throws(()=>w.tick(0,demoEvidence),/forced rollback/);
  assert.equal(s.batch(id)?.status,'solana_usdc');
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM events').get()?.n,1);
  s.db.exec('DROP TRIGGER test_fail;');
  assert.equal(w.tick(0,demoEvidence)?.status,'bridge_pending');
  s.db.close();
});

test('small USDC receipts survive restart and combine once within one mint and consent',()=>{
  const dir=mkdtempSync(join(tmpdir(),'funded-batch-')), path=join(dir,'batch.sqlite');
  const one={...receipt,originRef:'fixture:staged:1',units:'2800000'};
  const two={...receipt,originRef:'fixture:staged:2',units:'2300000'};
  try {
    const a=new Store(path), w=new DryRun(a);
    assert.deepEqual(w.stageUsdc(one,destination,0),{batchId:null,duplicate:false});
    assert.equal(w.tick(0,demoEvidence),null);
    a.db.close();
    const b=new Store(path);
    try {
      const resumed=new DryRun(b);
      assert.deepEqual(resumed.stageUsdc(one,destination,1),{batchId:null,duplicate:true});
      assert.throws(()=>resumed.enroll(one,destination,1),/staged batching/);
      const result=resumed.stageUsdc(two,destination,2);
      assert.ok(result.batchId);
      assert.equal(b.batch(result.batchId)?.units,'5100000');
      assert.deepEqual(resumed.stageUsdc(one,destination,3),{batchId:result.batchId,duplicate:true});
      assert.deepEqual(resumed.stageUsdc(two,destination,3),{batchId:result.batchId,duplicate:true});
      assert.equal(b.db.prepare('SELECT COUNT(*) AS n FROM batches').get()?.n,1);
      assert.equal(b.db.prepare('SELECT COUNT(*) AS n FROM dry_run_staged WHERE batch_id=?').get(result.batchId)?.n,2);
    } finally { b.db.close(); }
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('batching isolates consent, rail and mint and rejects conflicting or direct receipt replays',()=>{
  const s=new Store(':memory:'), w=new DryRun(s);
  const small={...receipt,units:'3000000'};
  w.stageUsdc(small,destination,0);
  for(const [i,mint,to] of [
    [1,small.mint,{...destination,consentId:'fixture:different'}],
    [2,small.mint,{...destination,rail:'venmo' as const}],
    [3,SOLANA_USDC,destination]
  ] as const) {
    assert.equal(w.stageUsdc({...small,mint,originRef:'fixture:isolated:'+i},to,0).batchId,null);
  }
  assert.equal(w.tick(0,demoEvidence),null);
  assert.throws(()=>w.stageUsdc({...small,units:'3000001'},destination,0),/Conflicting/);
  assert.throws(()=>w.stageUsdc({...small,asset:NATIVE},destination,0),/USDC fixture/);
  const direct={...receipt,originRef:'fixture:direct'};
  w.enroll(direct,destination,0);
  assert.throws(()=>w.stageUsdc(direct,destination,0),/directly/);
  s.db.close();
});

test('a failed batch enqueue rolls back the staged contribution and leaves the open balance intact',()=>{
  const s=new Store(':memory:'), w=new DryRun(s);
  const one={...receipt,units:'3000000',originRef:'fixture:rollback:1'};
  const two={...receipt,units:'2500000',originRef:'fixture:rollback:2'};
  w.stageUsdc(one,destination,0);
  s.db.exec("CREATE TRIGGER fail_job BEFORE INSERT ON dry_run_jobs BEGIN SELECT RAISE(ABORT,'forced enqueue rollback'); END;");
  assert.throws(()=>w.stageUsdc(two,destination,1),/forced enqueue rollback/);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM dry_run_staged').get()?.n,1);
  assert.equal(s.db.prepare('SELECT units FROM dry_run_pending_totals').get()?.units,'3000000');
  s.db.exec('DROP TRIGGER fail_job');
  const id=w.stageUsdc(two,destination,1).batchId;
  assert.ok(id);
  assert.equal(s.batch(id)?.units,'5500000');
  s.db.close();
});
