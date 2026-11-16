import assert from 'node:assert/strict';
import { request } from 'node:http';
import test from 'node:test';
import { loadConfig } from '../src/config.ts';
import { assessMainnetReadiness, SOLANA_MAINNET_GENESIS } from '../src/mainnet-readiness.ts';
import { localSdkFacts } from '../src/peer-cash.ts';
import { hostAllowed, writeOriginAllowed } from '../src/request-policy.ts';
import { app } from '../src/server.ts';
import { Store } from '../src/store.ts';

const publicEnv = {
  FUNDED_DEPLOYMENT_MODE: 'public_readonly',
  FUNDED_PUBLIC_ORIGIN: 'https://funded.example',
  FUNDED_DATABASE_URL: 'postgresql://funded:secret@db.example/funded',
  FUNDED_READ_RPC: 'https://rpc.example',
  FUNDED_EXPECT_GENESIS: SOLANA_MAINNET_GENESIS,
  FUNDED_FEE_RECEIVER: 'C2C4ASTqWHaYx74EkZZ9AqKc4FnTpqnGJGy5d3aG1kRB'
};

function rawRequest(port: number, path: string, method = 'GET', headers: Record<string, string> = {}, payload?: string) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('public preview readiness is explicit while funds execution stays blocked', () => {
  const report = assessMainnetReadiness(publicEnv, true, true, SOLANA_MAINNET_GENESIS);
  assert.equal(report.publicPreviewReady, true);
  assert.equal(report.fundsExecutionReady, false);
  assert.equal(report.gates.every(gate => gate.ready), true);
  assert.ok(report.financialBlockers.length >= 5);

  const wrongChain = assessMainnetReadiness(publicEnv, true, true, 'devnet-genesis');
  assert.equal(wrongChain.publicPreviewReady, false);
  assert.equal(wrongChain.gates.find(gate => gate.id === 'solana-mainnet-observed')?.ready, false);
});

test('public configuration requires HTTPS, Postgres, and an exact origin', () => {
  const config = loadConfig(publicEnv);
  assert.equal(config.bindAddress, '0.0.0.0');
  assert.equal(config.publicOrigin, 'https://funded.example');
  assert.equal(config.launchEnabled, false);
  assert.equal(config.peerOrdersEnabled, false);

  assert.throws(() => loadConfig({ ...publicEnv, FUNDED_PUBLIC_ORIGIN: 'http://funded.example' }), /HTTPS origin/);
  assert.throws(() => loadConfig({ ...publicEnv, FUNDED_PUBLIC_ORIGIN: 'https://funded.example/path' }), /HTTPS origin/);
  assert.throws(() => loadConfig({ ...publicEnv, FUNDED_DATABASE_URL: '' }), /requires/);
  assert.throws(() => loadConfig({ ...publicEnv, FUNDED_DEPLOYMENT_MODE: 'public_write' }), /deployment mode/);
});

test('host and write origin checks do not accept aliases', () => {
  const config = loadConfig(publicEnv);
  assert.equal(hostAllowed(config, 'funded.example'), true);
  assert.equal(hostAllowed(config, 'www.funded.example'), false);
  assert.equal(hostAllowed(config, 'funded.example.evil.test'), false);
  assert.equal(writeOriginAllowed(config, 'funded.example', 'https://funded.example'), true);
  assert.equal(writeOriginAllowed(config, 'funded.example', 'https://evil.test'), false);
});

test('reviewed Peer SDK surface is pinned to zero-spread intent pricing', () => {
  const peer = localSdkFacts();
  assert.equal(peer.package, '@zkp2p/cash@0.8.1');
  assert.equal(peer.xMoneyUsd, true);
  assert.equal(peer.spreadBps, 0);
  assert.equal(peer.marketDiscountBps, 0);
  assert.equal(peer.xMoneyPricingKind, 'oracle-at-intent-signal');
  assert.equal(peer.ordersEnabled, false);
});

test('public server serves reads and rejects every write', async () => {
  const store = new Store(':memory:');
  const server = app(store, undefined, undefined, loadConfig(publicEnv));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const page = await rawRequest(port, '/', 'GET', { host: 'funded.example' });
    assert.equal(page.status, 200);
    assert.match(String(page.headers['strict-transport-security'] ?? ''), /max-age/);
    assert.equal((await rawRequest(port, '/', 'GET', { host: 'evil.example' })).status, 403);
    assert.equal((await rawRequest(port, '/api/earnings?handle=creator', 'GET', { host: 'funded.example' })).status, 503);
    const write = await rawRequest(port, '/api/drafts', 'POST', {
      host: 'funded.example', origin: 'https://funded.example', 'content-type': 'application/json'
    }, '{}');
    assert.equal(write.status, 503);
  } finally {
    await new Promise(resolve => server.close(resolve));
    store.db.close();
  }
});
