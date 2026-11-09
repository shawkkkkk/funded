import { createHash } from 'node:crypto';
import { amount, payoutDestination, SOLANA_USDC } from './domain.ts';
import type { PayoutRail, Status } from './domain.ts';
import { Store } from './store.ts';
import type { Evidence } from './store.ts';

type Rail = PayoutRail;
type Receipt = Parameters<Store['recordReceipt']>[0];
type Destination = { rail: Rail; handle: string; consentId: string };
type Job = { batch_id: string; rail: Rail; username: string; consent: string; due: number; failures: number; done: number };
type EvidenceAnswer = { kind: 'pending'; reason: string } | { kind: 'event'; evidence: Evidence };
export type SandboxSource = (input: Readonly<{
  batchId: string; rail: Rail; status: Status; asset: string; units: string; peerId: string|null;
}>) => EvidenceAnswer;

function normalize(input: Destination) {
  if (!/^fixture:[A-Za-z0-9_-]{1,80}$/.test(input.consentId)) throw Error('A simulated consent reference is required');
  // Use fixture handles only; this is not provider registration or proof of ownership.
  return { ...payoutDestination(input.rail,input.handle), consent:input.consentId };
}

/**
 * Durable, local-only settlement simulator. It cannot submit, sign or network.
 * A synchronous fixture observer supplies simulated evidence; neither the
 * HTTP app nor production-facing readers construct this class.
 */
export class DryRun {
  readonly store: Store;
  readonly minBaseUnits: bigint;
  constructor(store: Store, minBaseUnits = 5_000_000n) {
    if (minBaseUnits <= 0n) throw Error('Invalid batch minimum');
    this.store = store;
    this.minBaseUnits = minBaseUnits;
    this.store.db.exec(`CREATE TABLE IF NOT EXISTS dry_run_jobs(
      batch_id TEXT PRIMARY KEY REFERENCES batches(id), rail TEXT NOT NULL,
      username TEXT NOT NULL, consent TEXT NOT NULL, due INTEGER NOT NULL,
      failures INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0, reason TEXT
    ); CREATE INDEX IF NOT EXISTS dry_run_due ON dry_run_jobs(done,due,batch_id);`);
  }
  enroll(receipt: Receipt, destination: Destination, now: number) {
    if (!/^fixture:[\w:-]{1,140}$/.test(receipt.originRef)) throw Error('Only fixture receipts are accepted');
    if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) throw Error('Invalid time');
    const target = normalize(destination);
    return this.store.atomic(()=>{
      const {id,duplicate} = this.store.recordReceipt(receipt);
      if (duplicate) {
        const found = this.store.db.prepare('SELECT rail,username,consent FROM dry_run_jobs WHERE batch_id=?').get(id);
        if (!found || found.rail !== target.rail || found.username !== target.handle || found.consent !== target.consent) throw Error('Conflicting destination for existing receipt');
      } else {
        this.store.db.prepare('INSERT INTO dry_run_jobs(batch_id,rail,username,consent,due) VALUES(?,?,?,?,?)').run(id,target.rail,target.handle,target.consent,now);
      }
      return id;
    });
  }

  tick(now: number, observe: SandboxSource) {
    if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) throw Error('Invalid time');
    // No asynchronous calls inside the lock. Production needs a different,
    // fenced submit/reconcile worker with persisted attempt identity.
    return this.store.atomic(()=>{
      const job = this.store.db.prepare('SELECT * FROM dry_run_jobs WHERE done=0 AND due<=? ORDER BY due,batch_id LIMIT 1').get(now) as Job|undefined;
      if (!job) return null;
      const batch = this.store.batch(job.batch_id);
      if (!batch) throw Error('Missing batch for scheduled job');
      const reschedule = (reason: string) => {
        const failures = Math.min(job.failures+1,31);
        const delay = Math.min(3_600_000, 1000 * 2 ** Math.min(failures,12));
        this.store.db.prepare('UPDATE dry_run_jobs SET due=?,failures=?,reason=? WHERE batch_id=?').run(now+delay,failures,reason.slice(0,160),job.batch_id);
        return { id:job.batch_id, status:batch.status, outcome:'pending' as const };
      };
      if (batch.status === 'solana_usdc' && (batch.asset !== SOLANA_USDC || amount(batch.units) < this.minBaseUnits)) return reschedule('Below fixture batch minimum');
      if (batch.status === 'base_usdc' && amount(batch.units) < this.minBaseUnits) return reschedule('Below fixture order minimum');
      const answer = observe(Object.freeze({batchId:job.batch_id,rail:job.rail,status:batch.status,asset:batch.asset,units:batch.units,peerId:batch.peer_id}));
      if (answer.kind === 'pending') {
        if (batch.status === 'received') {
          const ref='fixture:route-hold:'+job.batch_id;
          this.store.apply(job.batch_id,{id:ref,ref,kind:'hold_route'});
          reschedule(answer.reason);
          return {id:job.batch_id,status:'waiting_route' as const,outcome:'pending' as const};
        }
        return reschedule(answer.reason);
      }
      if (answer.kind !== 'event' || !answer.evidence.ref.startsWith('fixture:')) throw Error('Unrecognized fixture evidence');
      const e = answer.evidence;
      if (e.kind === 'hold_route') throw Error('Hold must be signaled as pending');
      const eventKey = createHash('sha256').update(JSON.stringify([job.batch_id,e.kind,e.ref])).digest('hex');
      const next = this.store.apply(job.batch_id,{...e,id:'fixture-event:'+eventKey});
      if (!next) throw Error('Missing settlement state');
      const done = next.status === 'paid' || next.status === 'review';
      this.store.db.prepare('UPDATE dry_run_jobs SET due=?,failures=0,reason=NULL,done=? WHERE batch_id=?').run(now+1000,done ? 1 : 0,job.batch_id);
      return { id:job.batch_id,status:next.status,outcome:done ? 'terminal' as const : 'advanced' as const };
    });
  }
}
