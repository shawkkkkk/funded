import { randomUUID } from 'node:crypto';
import { Store } from './store.ts';

type Job = { id: string; batch_id: string; kind: string; due: number; owner: string | null; until: number | null; fence: number };
export class JobQueue {
  private store: Store;
  constructor(store: Store) {
    this.store = store;
    store.db.exec(`CREATE TABLE IF NOT EXISTS jobs(
      id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, kind TEXT NOT NULL, due INTEGER NOT NULL,
      owner TEXT, until INTEGER, fence INTEGER NOT NULL DEFAULT 0, UNIQUE(batch_id, kind))`);
  }
  enqueue(batch: string, kind: string, due: number) {
    if (!batch || !kind || !Number.isSafeInteger(due) || due < 0) throw Error('Invalid job');
    return this.store.atomic(() => {
      const old = this.store.db.prepare('SELECT id FROM jobs WHERE batch_id=? AND kind=?').get(batch, kind) as { id: string } | undefined;
      if (old) return { id: old.id, duplicate: true };
      const id = randomUUID();
      this.store.db.prepare('INSERT INTO jobs(id,batch_id,kind,due) VALUES(?,?,?,?)').run(id, batch, kind, due);
      return { id, duplicate: false };
    });
  }
  lease(owner: string, now: number, ttl: number) {
    if (!owner || !Number.isSafeInteger(now) || !Number.isSafeInteger(ttl) || ttl < 1) throw Error('Invalid lease');
    return this.store.atomic(() => {
      const row = this.store.db.prepare('SELECT * FROM jobs WHERE due<=? AND (until IS NULL OR until<=?) ORDER BY due,id LIMIT 1').get(now, now) as Job | undefined;
      if (!row) return null;
      const fence = row.fence + 1;
      this.store.db.prepare('UPDATE jobs SET owner=?, until=?, fence=? WHERE id=? AND fence=?').run(owner, now + ttl, fence, row.id, row.fence);
      return { id: row.id, fence, kind: row.kind, batchId: row.batch_id };
    });
  }
  complete(id: string, fence: number) {
    return this.store.atomic(() => {
      const changed = this.store.db.prepare('DELETE FROM jobs WHERE id=? AND fence=?').run(id, fence).changes;
      if (changed !== 1) throw Error('Stale job lease');
    });
  }
}
