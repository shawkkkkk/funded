import assert from 'node:assert/strict';
import test from 'node:test';
import { SolanaReader } from '../src/solana.ts';
import { app } from '../src/server.ts';
import { Store } from '../src/store.ts';

test('RPC health reports a failed endpoint and fails over without exposing the URL', async () => {
  const reader = new SolanaReader(['https://down.example/secret?api-key=hidden', 'https://ok.example/also-secret'], async (url) => {
    if (url.host === 'down.example') throw Error('down');
    return Response.json({ id: 1, result: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' });
  });
  const health = await reader.health();
  assert.equal(health.healthy, true);
  assert.equal(health.readsOnly, true);
  assert.deepEqual(health.checks.map(check => check.host), ['down.example', 'ok.example']);
  assert.equal(health.checks[0].ok, false);
  assert.equal(health.checks[1].ok, true);
  assert.equal(JSON.stringify(health).includes('api-key'), false);
  const store = new Store(':memory:');
  const server = app(store, reader);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  try {
    const body = await (await fetch(origin + '/api/rpc-health')).json();
    assert.equal(body.configured, true);
    assert.equal(body.healthy, true);
    const script = await (await fetch(origin + '/app.js')).text();
    assert.match(script, /Transaction review/);
    assert.match(script, /Fee receiver/);
    assert.match(await (await fetch(origin + '/alerts')).text(), /Alerts/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    store.db.close();
  }
});
