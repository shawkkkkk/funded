import { loadConfig } from './config.ts';
import { address } from './domain.ts';
import { localSdkFacts } from './peer-cash.ts';
import { PgLedger } from './pg-ledger.ts';
import { SolanaReader } from './solana.ts';

export const SOLANA_MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export type ReadinessGate = { id: string; ready: boolean; detail: string };

export function assessMainnetReadiness(env: NodeJS.ProcessEnv = process.env, databaseConnected = false, databasePaused = false, observedGenesis?: string) {
  let config;
  try { config = loadConfig(env); }
  catch (error) {
    return {
      publicPreviewReady: false,
      fundsExecutionReady: false,
      gates: [{ id: 'configuration', ready: false, detail: error instanceof Error ? error.message : 'Invalid configuration' }]
    };
  }
  const peer = localSdkFacts();
  const rpc = (env.FUNDED_READ_RPC ?? '').split(',').map(value => value.trim()).filter(Boolean);
  let feeReceiverReady = false;
  try { feeReceiverReady = !!config.feeReceiver && address(config.feeReceiver) === config.feeReceiver; } catch { /* reported below */ }
  const gates: ReadinessGate[] = [
    { id: 'deployment-mode', ready: config.deploymentMode === 'public_readonly', detail: config.deploymentMode },
    { id: 'https-origin', ready: !!config.publicOrigin, detail: config.publicOrigin ?? 'not configured' },
    { id: 'postgres-configured', ready: !!config.databaseUrl, detail: config.databaseUrl ? 'configured' : 'not configured' },
    { id: 'postgres-connected', ready: databaseConnected, detail: databaseConnected ? 'connected' : 'not connected' },
    { id: 'postgres-paused', ready: databasePaused, detail: databasePaused ? 'paused' : 'not paused or unavailable' },
    { id: 'solana-rpc', ready: rpc.length >= 1, detail: rpc.length ? `${rpc.length} endpoint(s) configured` : 'not configured' },
    { id: 'solana-mainnet-pin', ready: env.FUNDED_EXPECT_GENESIS === SOLANA_MAINNET_GENESIS, detail: env.FUNDED_EXPECT_GENESIS ?? 'not configured' },
    { id: 'solana-mainnet-observed', ready: observedGenesis === SOLANA_MAINNET_GENESIS, detail: observedGenesis ?? 'not checked' },
    { id: 'fee-receiver', ready: feeReceiverReady, detail: feeReceiverReady ? 'valid public address' : 'missing or invalid' },
    { id: 'peer-sdk', ready: peer.package === '@zkp2p/cash@0.8.1' && peer.xMoneyUsd, detail: `${peer.package}; X Money USD ${peer.xMoneyUsd ? 'available' : 'unavailable'}` }
  ];
  const publicPreviewReady = gates.every(gate => gate.ready);
  return {
    publicPreviewReady,
    fundsExecutionReady: false,
    gates,
    financialBlockers: [
      'No authorized transaction signer or custody adapter is connected',
      'No live sanctions and counterparty screening provider is connected',
      'No production Float fee-attribution policy is bundled',
      'No controlled X Money test has verified actual USD receipt and recovery',
      'No independent security and regulatory approval is recorded'
    ]
  };
}

if (import.meta.main) {
  let databaseConnected = false;
  let databasePaused = false;
  let observedGenesis: string | undefined;
  let ledger: PgLedger | undefined;
  try {
    const config = loadConfig();
    if (config.databaseUrl) {
      ledger = await PgLedger.connect(config.databaseUrl);
      databaseConnected = true;
      try { databasePaused = !!await ledger.pauseReason(); } catch { /* An unmigrated or unavailable pause table is not ready. */ }
    }
    const rpc = (process.env.FUNDED_READ_RPC ?? '').split(',').map(value => value.trim()).filter(Boolean);
    if (rpc.length) observedGenesis = String(await new SolanaReader(rpc).read('getGenesisHash', []));
  } catch { /* The report below preserves each failed gate. */ }
  finally { await ledger?.close(); }
  const report = assessMainnetReadiness(process.env, databaseConnected, databasePaused, observedGenesis);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.publicPreviewReady ? 0 : 2;
}
