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
