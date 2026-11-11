import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { address, amount, handle, SOLANA_USDC } from './domain.ts';

type Queryable = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }> };
export type OutboxJob = {
  id: string; idempotencyKey: string; batchId: string | null; kind: string;
  payload: Record<string, unknown>; attempts: number; maxAttempts: number; fence: number;
};

const FILES = ['db/postgres.sql', 'db/migrations/002_pipeline.sql'];
function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : 1);
    return '{' + entries.map(([key, item]) => JSON.stringify(key) + ':' + stable(item)).join(',') + '}';
  }
  return JSON.stringify(value);
}

export class PgLedger {
  private pool: pg.Pool;
  private constructor(pool: pg.Pool) { this.pool = pool; }
  static async connect(url: string) {
    if (!/^postgres(?:ql)?:\/\//.test(url)) throw Error('Postgres URL required');
    const pool = new pg.Pool({ connectionString: url, max: 4, statement_timeout: 8_000 });
    pool.on('error', () => { /* The caller observes the failed query. */ });
    const ledger = new PgLedger(pool);
    await pool.query('SELECT 1');
    return ledger;
  }
  async close() { await this.pool.end(); }
  private async tx<T>(fn: (db: Queryable) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  async migrate(root = new URL('../', import.meta.url)) {
    await this.pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const applied: string[] = [];
    for (const file of FILES) {
      const name = file;
      const seen = await this.pool.query('SELECT 1 FROM schema_migrations WHERE filename=$1', [name]);
      if (seen.rowCount) continue;
      const sql = await readFile(new URL(file, root), 'utf8');
      await this.tx(async db => {
        await db.query(sql);
        await db.query('INSERT INTO schema_migrations(filename) VALUES($1)', [name]);
      });
      applied.push(name);
    }
    return applied;
  }
  async resetData() {
    await this.pool.query('TRUNCATE creators, consents, launches, receipts, batches, batch_receipts, events, journal, peer_orders, fills, jobs, outbox, observations RESTART IDENTITY CASCADE');
    await this.pool.query("UPDATE pauses SET paused=true, reason='default closed', at=now()");
  }
  async pause(reason: string) {
    if (!reason || reason.length > 200) throw Error('Pause reason required');
    await this.pool.query('UPDATE pauses SET paused=true, reason=$1, at=now()', [reason]);
  }
  async resume() { await this.pool.query('UPDATE pauses SET paused=false, reason=$1, at=now()', ['resumed']); }
  async pauseReason() {
    const row = await this.pool.query('SELECT paused, reason FROM pauses');
    return row.rows[0]?.paused ? String(row.rows[0].reason) : undefined;
  }
  async balanced() {
    const rows = await this.pool.query('SELECT asset, COALESCE(SUM(delta),0)::text AS total FROM journal GROUP BY asset');
    for (const row of rows.rows) if (BigInt(row.total) !== 0n) throw Error('Journal does not balance for ' + row.asset);
    return true;
  }
  async enroll(input: {
    creatorHandle: string; rail: 'xmoney' | 'cashapp' | 'venmo'; payee: string; consentVersion: number;
    mint: string; quoteMint: string; feeTier: number; feeReceiver: string; creatorWallet: string;
  }) {
    const creatorHandle = handle(input.creatorHandle);
    const mint = address(input.mint), feeReceiver = address(input.feeReceiver), creatorWallet = address(input.creatorWallet);
    const quoteMint = input.quoteMint === 'native:sol' ? 'native:sol' : address(input.quoteMint);
    if (![0, 1, 2].includes(input.feeTier) || feeReceiver === creatorWallet) throw Error('Invalid launch enrollment');
    if (!Number.isInteger(input.consentVersion) || input.consentVersion < 1) throw Error('Invalid consent');
    return this.tx(async db => {
      let creator = await db.query('SELECT id FROM creators WHERE handle=$1', [creatorHandle]);
      const creatorId = creator.rows[0]?.id ?? randomUUID();
      if (!creator.rows[0]) await db.query('INSERT INTO creators(id, handle) VALUES($1,$2)', [creatorId, creatorHandle]);
      let consent = await db.query('SELECT id, rail, handle FROM consents WHERE creator_id=$1 AND version=$2', [creatorId, input.consentVersion]);
      const consentId = consent.rows[0]?.id ?? randomUUID();
      if (!consent.rows[0]) await db.query('INSERT INTO consents(id, creator_id, rail, handle, version) VALUES($1,$2,$3,$4,$5)', [consentId, creatorId, input.rail, input.payee, input.consentVersion]);
      else if (consent.rows[0].rail !== input.rail || consent.rows[0].handle !== input.payee) throw Error('Conflicting consent');
      const existing = await db.query('SELECT id, fee_receiver, creator_wallet, quote_mint, fee_tier FROM launches WHERE mint=$1', [mint]);
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (row.fee_receiver !== feeReceiver || row.creator_wallet !== creatorWallet || row.quote_mint !== quoteMint || row.fee_tier !== input.feeTier) throw Error('Conflicting launch');
        return { launchId: row.id as string, duplicate: true };
      }
      const launchId = randomUUID();
      await db.query('INSERT INTO launches(id, creator_id, consent_id, mint, quote_mint, fee_tier, fee_receiver, creator_wallet) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [launchId, creatorId, consentId, mint, quoteMint, input.feeTier, feeReceiver, creatorWallet]);
      return { launchId, duplicate: false };
    });
  }
  async credit(input: { launchId: string; originRef: string; signature: string; asset: string; units: string }) {
    const units = amount(input.units);
    if (units <= 0n || !input.originRef || input.originRef.length > 250) throw Error('Invalid receipt');
    const asset = input.asset === 'native:sol' ? input.asset : address(input.asset);
    return this.tx(async db => {
      const prior = await db.query(`SELECT r.units::text AS units, br.batch_id FROM receipts r LEFT JOIN batch_receipts br ON br.origin_ref=r.origin_ref WHERE r.origin_ref=$1`, [input.originRef]);
      if (prior.rows[0]) {
        if (prior.rows[0].units !== input.units) throw Error('Conflicting receipt replay');
        return { batchId: prior.rows[0].batch_id as string, duplicate: true };
      }
      const launch = await db.query('SELECT id, mint FROM launches WHERE id=$1', [input.launchId]);
      if (!launch.rows[0]) throw Error('Unknown launch');
      const batchId = randomUUID();
      const status = asset === SOLANA_USDC ? 'solana_usdc' : 'received';
      const eventId = 'receipt:' + input.originRef;
      await db.query('INSERT INTO receipts(origin_ref, launch_id, signature, asset, units) VALUES($1,$2,$3,$4,$5)', [input.originRef, input.launchId, input.signature, asset, input.units]);
      await db.query('INSERT INTO batches(id, launch_id, consent_id, status, asset, units) SELECT $1, id, consent_id, $2, $3, $4 FROM launches WHERE id=$5', [batchId, status, asset, input.units, input.launchId]);
      await db.query('INSERT INTO batch_receipts(batch_id, origin_ref) VALUES($1,$2)', [batchId, input.originRef]);
      await db.query('INSERT INTO events(id, batch_id, kind, ref, fingerprint) VALUES($1,$2,$3,$4,$5)', [eventId, batchId, 'receipt', input.originRef, JSON.stringify([input.units, asset])]);
      await db.query('INSERT INTO journal(event_id, asset, account, delta) VALUES($1,$2,$3,$4),($1,$2,$5,$6)', [eventId, asset, 'external_fee_source', (-units).toString(), 'solana_held', units.toString()]);
      return { batchId, duplicate: false };
    });
  }
  async enqueue(input: { idempotencyKey: string; batchId?: string | null; kind: OutboxJob['kind']; payload: Record<string, unknown>; dueAt?: Date; maxAttempts?: number }) {
    if (!/^[\w:.-]{1,200}$/.test(input.idempotencyKey)) throw Error('Invalid idempotency key');
    const maxAttempts = input.maxAttempts ?? 8;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) throw Error('Invalid attempt limit');
    return this.tx(async db => {
      const id = randomUUID();
      const inserted = await db.query(
        'INSERT INTO outbox(id, idempotency_key, batch_id, kind, payload, status, due_at, max_attempts) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id',
        [id, input.idempotencyKey, input.batchId ?? null, input.kind, JSON.stringify(input.payload), 'pending', input.dueAt ?? new Date(), maxAttempts]);
      if (inserted.rows[0]) return { id, duplicate: false };
      const old = await db.query('SELECT id, payload FROM outbox WHERE idempotency_key=$1', [input.idempotencyKey]);
      if (stable(old.rows[0].payload) !== stable(input.payload)) throw Error('Conflicting job replay');
      return { id: old.rows[0].id as string, duplicate: true };
    });
  }
  async lease(owner: string, now: Date) {
    if (!owner) throw Error('Lease owner required');
    if (await this.pauseReason()) return null;
    return this.tx(async db => {
      const row = await db.query(
        `SELECT id, idempotency_key, batch_id, kind, payload, attempts, max_attempts, fence FROM outbox
         WHERE status IN ('pending','retry') AND due_at <= $1 AND (lease_until IS NULL OR lease_until <= $1)
         ORDER BY due_at, id FOR UPDATE SKIP LOCKED LIMIT 1`, [now]);
      if (!row.rows[0]) return null;
      const fence = Number(row.rows[0].fence) + 1;
      const until = new Date(now.getTime() + 30_000);
      const updated = await db.query('UPDATE outbox SET status=$1, lease_owner=$2, lease_until=$3, fence=$4 WHERE id=$5 AND fence=$6',
        ['leased', owner, until, fence, row.rows[0].id, row.rows[0].fence]);
      if (updated.rowCount !== 1) throw Error('Lease lost');
      return {
        id: row.rows[0].id as string, idempotencyKey: row.rows[0].idempotency_key as string,
        batchId: row.rows[0].batch_id as string | null, kind: row.rows[0].kind as string,
        payload: row.rows[0].payload as Record<string, unknown>, attempts: row.rows[0].attempts as number,
        maxAttempts: row.rows[0].max_attempts as number, fence
      } satisfies OutboxJob;
    });
  }
  async complete(id: string, fence: number) {
    const updated = await this.pool.query("UPDATE outbox SET status='done', lease_owner=NULL, lease_until=NULL WHERE id=$1 AND fence=$2 AND status='leased'", [id, fence]);
    if (updated.rowCount !== 1) throw Error('Stale job lease');
  }
  async fail(id: string, fence: number, error: string, now: Date) {
    return this.tx(async db => {
      const row = await db.query('SELECT attempts, max_attempts FROM outbox WHERE id=$1 AND fence=$2 AND status=$3', [id, fence, 'leased']);
      if (!row.rows[0]) throw Error('Stale job lease');
      const attempts = Number(row.rows[0].attempts) + 1;
      const dead = attempts >= Number(row.rows[0].max_attempts);
      const due = new Date(now.getTime() + Math.min(3_600_000, 2 ** attempts * 1000));
      await db.query('UPDATE outbox SET attempts=$1, status=$2, due_at=$3, lease_owner=NULL, lease_until=NULL, last_error=$4 WHERE id=$5 AND fence=$6',
        [attempts, dead ? 'dead' : 'retry', due, error.slice(0, 500), id, fence]);
      return { status: dead ? 'dead' as const : 'retry' as const, attempts };
    });
  }
  async observe(input: { id: string; batchId: string; kind: string; payload: Record<string, unknown> }) {
    await this.pool.query(
      'INSERT INTO observations(id, batch_id, kind, payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT (id) DO NOTHING',
      [input.id, input.batchId, input.kind, JSON.stringify({ ...input.payload, executionAuthorized: false })]);
  }
  async observations(batchId: string) {
    const rows = await this.pool.query('SELECT id, kind, payload FROM observations WHERE batch_id=$1 ORDER BY created_at, id', [batchId]);
    return rows.rows.map(row => ({ id: row.id as string, kind: row.kind as string, payload: row.payload as Record<string, unknown> }));
  }
  async publicBatches() {
    const rows = await this.pool.query(`SELECT b.id, l.mint, b.status, b.units::text AS units, b.asset, b.paid_usd_micros::text AS paid_usd
      FROM batches b JOIN launches l ON l.id=b.launch_id ORDER BY b.created_at DESC LIMIT 100`);
    return rows.rows;
  }
  async liquidityActivity() {
    const rows = await this.pool.query(`SELECT o.batch_id, o.payload, l.mint, b.status, b.asset, b.units::text AS units, b.paid_usd_micros::text AS paid_usd
      FROM observations o JOIN batches b ON b.id=o.batch_id JOIN launches l ON l.id=b.launch_id
      WHERE o.kind='peer_plan' ORDER BY o.created_at DESC LIMIT 100`);
    return rows.rows.map(row => ({
      batchId: row.batch_id, mint: row.mint, status: row.status, asset: row.asset, units: row.units, paidUsd: row.paid_usd,
      decision: row.payload?.decision ?? null, ordersEnabled: false, spreadBps: 0, senderDisplay: 'matched_buyer' as const
    }));
  }
  async creatorBatches(creatorHandle: string) {
    const rows = await this.pool.query(`SELECT l.mint, l.quote_mint, b.id, b.status, b.asset, b.units::text AS units, b.paid_usd_micros::text AS paid_usd
      FROM batches b JOIN launches l ON l.id=b.launch_id JOIN creators c ON c.id=l.creator_id WHERE c.handle=$1 ORDER BY b.created_at DESC`, [handle(creatorHandle)]);
    return rows.rows;
  }
}
