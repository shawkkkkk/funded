import { DryRun } from './dry-run.ts';
import type { SandboxSource } from './dry-run.ts';
import { FLOAT, SOLANA_USDC } from './domain.ts';
import { Store } from './store.ts';

export const demoEvidence: SandboxSource = (b) => {
  const e = (kind: Parameters<Store['apply']>[1]['kind'], suffix: string, extra: Partial<Parameters<Store['apply']>[1]> = {}) => ({
    kind:'event' as const,evidence:{kind,id:'fixture:unused',ref:'fixture:'+b.batchId+':'+suffix,...extra}
  });
  switch (b.status) {
    case 'received':
    case 'waiting_route': return e('swap_submitted','swap');
    case 'swap_pending': return e('swap_finalized','swap-receipt',{units:'10010000'});
    case 'solana_usdc': return e('bridge_submitted','burn');
    case 'bridge_pending': return e('bridge_finalized','mint',{units:'10000000'});
    case 'base_usdc': return e('peer_submitted','deposit-tx');
    case 'peer_pending': return e('peer_deposit_finalized','deposit-receipt',{peerId:'fixture:peer:'+b.batchId,units:b.units,minFiatBps:'10000'});
    case 'awaiting_buyer': return e('fiat_proven','proof-1',{peerId:b.peerId!,units:'4000000',usdMicros:'4000000'});
    case 'partially_paid': return e('fiat_proven','proof-2',{peerId:b.peerId!,units:b.units,usdMicros:b.units});
    default: return {kind:'pending',reason:'No simulated evidence for '+b.status};
  }
};
if (import.meta.main) {
  const store=new Store(':memory:');
  try {
    const worker=new DryRun(store,10_000_000n);
    const destination={rail:'xmoney' as const,handle:'@fixture_creator',consentId:'fixture:local_consent'};
    const first=worker.stageUsdc({mint:FLOAT,asset:SOLANA_USDC,units:'4900000',originRef:'fixture:demo:receipt-1'},destination,0);
    const second=worker.stageUsdc({mint:FLOAT,asset:SOLANA_USDC,units:'5110000',originRef:'fixture:demo:receipt-2'},destination,0);
    const id=second.batchId;
    if (first.batchId||!id) throw Error('Simulation failed to queue the combined receipts');
    console.log('Simulation only. No keys, network calls or real transactions.');
    console.log('Two simulated USDC receipts combined into one payout batch.');
    for (let now=0; now<20_000; now+=1000) {
      const result=worker.tick(now,demoEvidence);
      if (result) console.log(result.status);
      if (result?.outcome === 'terminal') break;
    }
    const batch=store.batch(id);
    if (batch?.status !== 'paid') throw Error('Simulation did not settle');
    console.log('Simulated USD micros:',batch.paid_usd);
  } finally { store.db.close(); }
}
