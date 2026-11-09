import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from '../src/server.ts';
import { Store } from '../src/store.ts';

test('sqlite dashboard exposes cost breakdown and no claimable balance', async () => {
  const store = new Store(':memory:');
  const server = app(store);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  try {
    assert.equal((await fetch(origin + '/api/earnings')).status, 400);
    const earnings = await (await fetch(origin + '/api/earnings?handle=@creator')).json();
    assert.deepEqual(earnings.items, []);
    assert.equal(earnings.paymentComplete, false);
    assert.equal(earnings.lpDiscountBps, 0);
    const liquidity = await (await fetch(origin + '/api/liquidity')).json();
    assert.deepEqual(liquidity.items, []);
    assert.equal(liquidity.ordersEnabled, false);
    const payouts = await (await fetch(origin + '/api/payouts')).json();
    assert.equal(payouts.spreadBps, 0);
    assert.match(await (await fetch(origin + '/earnings')).text(), /no claim page/i);
  } finally {
    await new Promise(resolve => server.close(resolve));
    store.db.close();
  }
});
