import { SOLANA_USDC } from './domain.ts';
import type { PgLedger } from './pg-ledger.ts';

export type SwapPlan = { status: 'quote_only' | 'waiting_route' | 'already_usdc'; minimumUsdcUnits?: string; reason?: string; executionAuthorized: false };
export type BridgeView = { status: string; baseSettlementVerified: false; burnAuthorized: false; executionAuthorized: false };
export type ScreenDecision = { decision: 'clear' | 'review' | 'blocked'; provider: 'fixture' | 'unconfigured'; live: false };
export type PipelinePorts = {
  planSwap(input: { asset: string; units: string }): Promise<SwapPlan>;
  readBridge(input: { batchId: string }): Promise<BridgeView>;
  screen(input: { kind: 'handle'; value: string }): Promise<ScreenDecision>;
};

const receive = (payee: string) => ({ platform: 'xmoney' as const, currency: 'USD' as const, payee });

/** One leased job. Planning only: no swap, burn, or Peer order is submitted. */
export async function stepPipeline(ledger: PgLedger, ports: PipelinePorts, now = new Date()) {
  const job = await ledger.lease('pipeline', now);
  if (!job) return null;
  try {
    if (job.kind === 'intake') {
      const body = job.payload as { enrollment: Parameters<PgLedger['enroll']>[0]; receipt: { originRef: string; signature: string; asset: string; units: string } };
      const enrolled = await ledger.enroll(body.enrollment);
      const credited = await ledger.credit({ ...body.receipt, launchId: enrolled.launchId });
      const next = body.receipt.asset === SOLANA_USDC ? 'bridge_check' : 'swap_plan';
      await ledger.enqueue({ idempotencyKey: next + ':' + credited.batchId, batchId: credited.batchId, kind: next, payload: { asset: body.receipt.asset, units: body.receipt.units, payee: body.enrollment.payee }, dueAt: now });
      await ledger.complete(job.id, job.fence);
      return { kind: job.kind, batchId: credited.batchId, executionAuthorized: false as const };
    }
    if (!job.batchId) throw Error('Pipeline job is missing its batch');
    if (job.kind === 'swap_plan') {
      const plan = await ports.planSwap({ asset: String(job.payload.asset), units: String(job.payload.units) });
      if (plan.executionAuthorized !== false) throw Error('Swap execution is disabled');
      await ledger.observe({ id: 'swap:' + job.batchId, batchId: job.batchId, kind: 'swap_plan', payload: plan });
      await ledger.complete(job.id, job.fence);
      return { kind: job.kind, batchId: job.batchId, status: plan.status, executionAuthorized: false as const };
    }
    if (job.kind === 'bridge_check') {
      const view = await ports.readBridge({ batchId: job.batchId });
      if (view.baseSettlementVerified !== false || view.burnAuthorized !== false || view.executionAuthorized !== false) throw Error('Bridge credit is disabled');
      await ledger.observe({ id: 'bridge:' + job.batchId, batchId: job.batchId, kind: 'bridge_check', payload: view });
      await ledger.enqueue({ idempotencyKey: 'peer_plan:' + job.batchId, batchId: job.batchId, kind: 'peer_plan', payload: { payee: job.payload.payee }, dueAt: now });
      await ledger.complete(job.id, job.fence);
      return { kind: job.kind, batchId: job.batchId, executionAuthorized: false as const };
    }
    if (job.kind === 'peer_plan') {
      const screen = await ports.screen({ kind: 'handle', value: String(job.payload.payee ?? '') });
      if (screen.live !== false) throw Error('Live screening is disabled');
      const payload = screen.decision === 'blocked'
        ? { decision: 'blocked', ordersEnabled: false, spreadBps: 0 }
        : { decision: screen.decision, ordersEnabled: false, spreadBps: 0, receive: receive(String(job.payload.payee)) };
      await ledger.observe({ id: 'peer:' + job.batchId, batchId: job.batchId, kind: 'peer_plan', payload });
      await ledger.complete(job.id, job.fence);
      return { kind: job.kind, batchId: job.batchId, decision: screen.decision, executionAuthorized: false as const };
    }
    throw Error('Unknown pipeline job');
  } catch (error) {
    await ledger.fail(job.id, job.fence, error instanceof Error ? error.message : 'Pipeline failed', now);
    return { kind: job.kind, failed: true as const, executionAuthorized: false as const };
  }
}
