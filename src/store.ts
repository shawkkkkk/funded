import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { amount, launchDraft, next, SOLANA_USDC, address } from './domain.ts';
import type { EventType, Status } from './domain.ts';

type Row = { id: string; status: Status; units: string; asset: string; paid_usd: string; payout_target: string|null; peer_id: string|null };
export type Evidence = { id: string; kind: EventType; ref: string; units?: string; usdMicros?: string; minFiatBps?: string; peerId?: string };
export class Store {
  db: DatabaseSync;
  private transactionDepth = 0;
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY, payload TEXT NOT NULL, image BLOB, image_type TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY, origin_ref TEXT NOT NULL UNIQUE, mint TEXT NOT NULL, status TEXT NOT NULL, units TEXT NOT NULL, asset TEXT NOT NULL, paid_usd TEXT NOT NULL DEFAULT '0', payout_target TEXT, peer_id TEXT);
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES batches(id), kind TEXT NOT NULL, ref TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(kind, ref));
      CREATE TABLE IF NOT EXISTS journals(event_id TEXT NOT NULL REFERENCES events(id), asset TEXT NOT NULL, account TEXT NOT NULL, delta TEXT NOT NULL, PRIMARY KEY(event_id, asset, account));
      CREATE TABLE IF NOT EXISTS controls(key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  }
  pause(reason: string) {
    if (!reason || reason.length > 200) throw Error('Pause reason required');
    this.atomic(() => {
      this.db.prepare("DELETE FROM controls WHERE key='pause'").run();
      this.db.prepare('INSERT INTO controls(key,value) VALUES(?,?)').run('pause', reason);
    });
  }
  resume() { this.db.prepare("DELETE FROM controls WHERE key='pause'").run(); }
  pauseReason() {
    return (this.db.prepare("SELECT value FROM controls WHERE key='pause'").get() as { value: string } | undefined)?.value;
  }
  balanced() {
    const rows = this.db.prepare('SELECT asset, delta FROM journals').all() as { asset: string; delta: string }[];
    const totals = new Map<string, bigint>();
    for (const row of rows) totals.set(row.asset, (totals.get(row.asset) ?? 0n) + BigInt(row.delta));
    for (const [asset, total] of totals) if (total !== 0n) throw Error('Journal does not balance for ' + asset);
    return true;
  }
  atomic<T>(fn: () => T): T {
    const depth = this.transactionDepth;
    const savepoint = 'nested_' + depth;
    this.db.exec(depth ? 'SAVEPOINT ' + savepoint : 'BEGIN IMMEDIATE');
    this.transactionDepth++;
    try {
      const result = fn();
      if (result && typeof (result as {then?:unknown}).then === 'function') throw Error('Database transactions must be synchronous');
      this.db.exec(depth ? 'RELEASE ' + savepoint : 'COMMIT');
      return result;
    } catch (e) {
      if (depth) this.db.exec('ROLLBACK TO ' + savepoint + '; RELEASE ' + savepoint);
      else this.db.exec('ROLLBACK');
      throw e;
    } finally { this.transactionDepth--; }
  }
  saveDraft(input: Record<string, unknown>, img?: {bytes: Buffer; type: string}) {
    const v = launchDraft(input), id = randomUUID();
    this.db.prepare('INSERT INTO drafts(id,payload,image,image_type) VALUES(?,?,?,?)').run(id, JSON.stringify(v), img?.bytes ?? null, img?.type ?? null);
    return { id, status: 'draft_only', program: null, feeReceiver: null, unsignedTransaction: null };
  }
  batch(id: string) {
    return this.db.prepare('SELECT * FROM batches WHERE id=?').get(id) as Row|undefined;
  }
  private event(batch: string, e: Evidence, fingerprint: string) {
    this.db.prepare('INSERT INTO events(id,batch_id,kind,ref,fingerprint) VALUES(?,?,?,?,?)').run(e.id,batch,e.kind,e.ref,fingerprint);
  }
  private journal(id: string, asset: string, from: string, to: string, units: bigint) {
    if (units === 0n) return;
    const entry = this.db.prepare('INSERT INTO journals VALUES(?,?,?,?)');
    entry.run(id,asset,from,(-units).toString());
    entry.run(id,asset,to,units.toString());
  }
  // Only trusted workers/test fixtures may call these methods. No public mutation endpoint.
  recordReceipt(r: { mint: string; asset: string; units: string; originRef: string }) {
    return this.atomic(() => {
      const u = amount(r.units);
      address(r.mint);
      if (r.asset !== 'native:sol') address(r.asset);
      if (u === 0n || !r.originRef || r.originRef.length > 250) throw Error('Invalid receipt');
      const old = this.db.prepare("SELECT batches.id AS id,receipt.fingerprint FROM batches JOIN events AS receipt ON receipt.batch_id=batches.id AND receipt.kind='receipt' AND receipt.ref=batches.origin_ref WHERE origin_ref=?").get(r.originRef);
      const fingerprint = JSON.stringify([r.mint,r.asset,r.units,r.originRef]);
      if (old) {
        if (old.fingerprint !== fingerprint) throw Error('Conflicting receipt replay');
        return { id: old.id as string, duplicate: true };
      }
      const id = randomUUID(), e = 'receipt:' + createHash('sha256').update(r.originRef).digest('hex');
      this.db.prepare('INSERT INTO batches(id,origin_ref,mint,status,units,asset) VALUES(?,?,?,?,?,?)').run(id,r.originRef,r.mint,r.asset === SOLANA_USDC ? 'solana_usdc' : 'received',r.units,r.asset);
      this.db.prepare("INSERT INTO events(id,batch_id,kind,ref,fingerprint) VALUES(?,?,'receipt',?,?)").run(e,id,r.originRef,fingerprint);
      this.journal(e,r.asset,'external_fee_source','solana_held',u);
      return { id, duplicate: false };
    });
  }
  apply(id: string, e: Evidence) {
    return this.atomic(() => {
      if (!e.id || !e.ref || e.id.length > 250 || e.ref.length > 250) throw Error('Evidence identifiers required');
      const fingerprint = JSON.stringify([id,e.kind,e.ref,e.units ?? null,e.usdMicros ?? null,e.minFiatBps ?? null,e.peerId ?? null]);
      const duplicate = this.db.prepare('SELECT fingerprint FROM events WHERE id=? OR (kind=? AND ref=?)').all(e.id,e.kind,e.ref);
      if (duplicate.length) {
        if (duplicate.some(x => x.fingerprint !== fingerprint)) throw Error('Conflicting evidence replay');
        return this.batch(id);
      }
      const b = this.batch(id);
      if (!b) throw Error('Unknown batch');
      if (this.pauseReason() && (e.kind === 'swap_submitted' || e.kind === 'bridge_submitted' || e.kind === 'peer_submitted')) throw Error('Paused: new submissions are stopped');
      let status = next(b.status,e.kind), asset = b.asset, units = amount(b.units), usd = amount(b.paid_usd), target = b.payout_target, peer = b.peer_id;
      if (e.kind === 'intent_expired' && (!peer || e.peerId !== peer || e.units || e.usdMicros || e.minFiatBps)) throw Error('Expiry does not move funds');
      const move = (a: string, from: string, to: string, n: bigint) => this.journal(e.id,a,from,to,n);
      this.event(id,e,fingerprint);
      if (e.kind === 'swap_finalized' || e.kind === 'bridge_finalized') {
        const out = amount(e.units);
        if (out === 0n || (e.kind === 'bridge_finalized' && out > units)) throw Error('Invalid net settlement');
        const swap = e.kind === 'swap_finalized';
        move(asset,'solana_held',swap ? 'external_swap' : 'external_bridge',units);
        asset = swap ? SOLANA_USDC : 'base:usdc';
        move(asset,swap ? 'external_swap' : 'external_bridge',swap ? 'solana_held' : 'base_held',out);
        units = out;
      }
      if (e.kind === 'peer_deposit_finalized') {
        const minBps = amount(e.minFiatBps);
        if (!e.peerId || amount(e.units) !== units || minBps === 0n || minBps > 10_000n) throw Error('Peer settlement mismatch');
        peer = e.peerId; target = minBps.toString();
        move(asset,'base_held','peer_escrow',units);
      }
      if (e.kind === 'fiat_proven' || e.kind === 'peer_return_finalized') {
        const consumed = amount(e.units);
        if (!peer || e.peerId !== peer || consumed === 0n || consumed > units) throw Error('Invalid Peer evidence');
        if (e.kind === 'fiat_proven') {
          const paid = amount(e.usdMicros);
          if (paid === 0n || paid > consumed || paid * 10_000n < consumed * amount(target)) throw Error('Verified USD does not reconcile with order economics');
          move(asset,'peer_escrow','lp_settled',consumed);
          move('usd:micros','verified_external_fiat','creator_fiat',paid);
          units -= consumed; usd += paid;
          if (units === 0n) status = 'paid';
        } else {
          if (consumed !== units) throw Error('Final return must reconcile all unspent escrow');
          move(asset,'peer_escrow','base_held',consumed);
          peer = null; target = null;
        }
      }
      this.db.prepare('UPDATE batches SET status=?,asset=?,units=?,paid_usd=?,payout_target=?,peer_id=? WHERE id=?').run(status,asset,units.toString(),usd.toString(),target,peer,id);
      return this.batch(id);
    });
  }
  publicBatches() {
    return this.db.prepare('SELECT id,mint,status,units,asset,paid_usd FROM batches ORDER BY rowid DESC LIMIT 100').all();
  }
}
