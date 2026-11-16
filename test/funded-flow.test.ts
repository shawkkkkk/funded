import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PublicKey } from '@solana/web3.js';
import { alerts } from '../src/alerts.ts';
import { disclose, splitFloatFee } from '../src/disclosure.ts';
import { configFixture, configMatchesPin, decodeLaunchData, decodeLaunchState, LAUNCH_STATE_DISCRIMINATOR, launchAccounts, launchAddress, TOKEN_PROGRAM_ID, WSOL_MINT } from '../src/float-program.ts';
import { JobQueue } from '../src/jobs.ts';
import { previewLaunch } from '../src/launch-preview.ts';
import { FixtureCash, livePeerOrder, localSdkFacts, OPEN_QUESTIONS, xmoneyReceive } from '../src/peer-cash.ts';
import { app } from '../src/server.ts';
import { SolanaReader } from '../src/solana.ts';
import { Store } from '../src/store.ts';
import { SOLANA_USDC } from '../src/domain.ts';

const creator = 'ix9YkGjxyxvtADosH1mWWk3TUUuoNtbjHwm9bzN7DVq';
const receiver = 'C2C4ASTqWHaYx74EkZZ9AqKc4FnTpqnGJGy5d3aG1kRB';
const mint = '28Tcf5zCLRz8TbVcDyE89BcMw139FTyk6e1KCBqNGJrJ';
const expected = [
  creator, 'AgaKFP4SfEeeM4r4GcSWBwpEAbfHh7wLkJGHqpWrLBQV', '2LMWFmbGBfw78ZEas2NFmAYfo4bhyBqYboYh9nk3mDFQ',
  'B9hvvyGzC2ohdg4PpEU18dPRJaRdxotEVAVJYFQRjmUv', WSOL_MINT, '6GxhMsj9emXEo7TYj9Ykq3VkwiW6HzUKQRJjJUGV98LE',
  mint, 'AZxc1mZKAsFkr8KFYW8rzsAjuwTC5RtmwoVYDEsvqAv', '38UvSmzx5erhrkwUCGyvHpksni5YCNYLNoKoab8Km5gb',
  '6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX', '2TDPJJPV6nvTEqXABxrqno6Uzpipxxvh1zjLN3SMYn69',
  'WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh', 'HGsCyZT3WBXardeGYwKUmdHXosyLMBXzk2cWc7sKwAvs',
  '2Ud2eWJ2gCwsf2WpoZNstTCNxFP3JNtpYPV7wKWJ4Lb6', '6j4cmep3AW1cnrHgAmPtRj3AZRUTwLA6pGcH8VUt981',
  '8W63ouMtyEnPAJYb32fFpCG8YbiDybwgy7qQox9Z6s4X', '2DPAtwB8L12vrMRExbLuyGnC7n2J5LNoZQSejeQGpwkr',
  'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj', TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID,
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s', '11111111111111111111111111111111',
  'SysvarRent111111111111111111111111111111111'
];

test('unsigned launch matches the finalized SoLMiNeR accounts and fee receiver', () => {
  const built = launchAccounts({
    creator: new PublicKey(creator), ticker: 'SoLMiNeR', name: 'José',
    uri: 'https://floatmine.xyz/m/5V1KVwyGwH3hd1NqA.json', feeReceiver: new PublicKey(receiver),
    quoteMint: new PublicKey(WSOL_MINT), quoteTokenProgram: new PublicKey(TOKEN_PROGRAM_ID),
    tier: 0, mintNonce: 1287779982042431197n
  });
  assert.deepEqual(built.accounts.map(account => account.pubkey), expected);
  assert.equal(built.accounts[0].isSigner, true);
  assert.equal(built.data.length, 120);
  assert.equal(decodeLaunchData(built.data).feeReceiver.toBase58(), receiver);
  assert.equal(built.mint, mint);
  assert.equal(launchAddress(mint), built.launch);
  assert.throws(() => launchAccounts({ ...builtInput(), feeReceiver: new PublicKey(creator) }), /separate/);
});

function builtInput() {
  return {
    creator: new PublicKey(creator), ticker: 'SoLMiNeR', name: 'José', uri: 'https://floatmine.xyz/a.json',
    feeReceiver: new PublicKey(receiver), quoteMint: new PublicKey(WSOL_MINT),
    quoteTokenProgram: new PublicKey(TOKEN_PROGRAM_ID), tier: 0, mintNonce: 1n
  };
}

test('config pin and launch-state provenance fail closed', () => {
  assert.equal(configMatchesPin(configFixture()).split.creator, 500);
  assert.throws(() => configMatchesPin(configFixture(true)), /paused/);
  const data = Buffer.alloc(210);
  LAUNCH_STATE_DISCRIMINATOR.copy(data, 0);
  new PublicKey(creator).toBuffer().copy(data, 8);
  new PublicKey(receiver).toBuffer().copy(data, 40);
  new PublicKey(mint).toBuffer().copy(data, 72);
  assert.equal(decodeLaunchState(data).feeReceiver, receiver);
  assert.equal(decodeLaunchState(data).coinMint, mint);
  data[0] = 0;
  assert.throws(() => decodeLaunchState(data), /Not a Float launch account/);
});

test('creator share is 5% of the Float fee, with dust excluded', () => {
  assert.equal(splitFloatFee(10_000n).creator, 500n);
  assert.equal(splitFloatFee(1n).creator, 0n);
  assert.equal(splitFloatFee(1n).dust, 1n);
  const view = disclose({ quoteUnits: 10_000n, convertedUsdc: null, bridgeFeeUsdc: null, deliveredUsdMicros: 1_000_000n, pendingUsdc: 1n, fiatVerified: true });
  assert.equal(view.paymentComplete, false);
  assert.equal(view.lpDiscountBps, 0);
  assert.equal(view.deliveredUsdMicros, '0');
});

test('Peer fixture does partial, full, refund, and duplicate flows without submitting', () => {
  assert.throws(livePeerOrder, /disabled/);
  const facts = localSdkFacts();
  assert.equal(facts.ordersEnabled, false);
  assert.equal(facts.spreadBps, 0);
  assert.equal(facts.senderDisplay, 'matched_buyer');
  assert.equal(facts.partnerApprovalRequired, false);
  assert.equal(facts.paymentNoteBranding, '@fundedonfloat');
  assert.equal(OPEN_QUESTIONS.length, 2);
  assert.deepEqual(xmoneyReceive('@Creator'), { platform: 'xmoney', currency: 'USD', payee: '@creator' });
  const cash = new FixtureCash();
  const first = cash.deposit('fixture:order-1', 2_000_000n, '@Creator');
  assert.equal(first.submits, false);
  assert.equal(first.paymentVerified, false);
  assert.equal(cash.deposit('fixture:order-1', 2_000_000n, '@creator').duplicate, true);
  assert.throws(() => cash.deposit('fixture:order-1', 2_000_000n, '@other'), /Conflicting/);
  assert.equal(cash.expireIntent(first.order.id).fundsMoved, false);
  const partial = cash.prove(first.order.id, 1_000_000n, 900_000n, 9_000n);
  assert.equal(partial.status, 'partially_paid');
  assert.equal(partial.paymentVerified, true);
  assert.equal(cash.withdraw(first.order.id).remainder, 1_000_000n);
  assert.throws(() => cash.prove(first.order.id, 1n, 1n, 1n), /not open/);
});

test('ledger pause blocks submission and expiry moves no funds', () => {
  const store = new Store(':memory:');
  const { id } = store.recordReceipt({ mint, asset: SOLANA_USDC, units: '5000000', originRef: 'solana:test:1' });
  store.apply(id, { id: 'bridge-submit', kind: 'bridge_submitted', ref: 'bridge:1' });
  store.apply(id, { id: 'bridge-final', kind: 'bridge_finalized', ref: 'bridge:1:out', units: '4900000' });
  store.apply(id, { id: 'peer-submit', kind: 'peer_submitted', ref: 'peer:1' });
  store.apply(id, { id: 'peer-deposit', kind: 'peer_deposit_finalized', ref: 'peer:1:dep', units: '4900000', minFiatBps: '9000', peerId: 'fixture-deposit:fixture:order-1' });
  store.apply(id, { id: 'expire', kind: 'intent_expired', ref: 'peer:1:expire', peerId: 'fixture-deposit:fixture:order-1' });
  assert.equal(store.batch(id)?.status, 'awaiting_buyer');
  assert.equal(store.batch(id)?.units, '4900000');
  store.apply(id, { id: 'fill', kind: 'fiat_proven', ref: 'pay:1', units: '1000000', usdMicros: '900000', peerId: 'fixture-deposit:fixture:order-1' });
  assert.equal(store.batch(id)?.status, 'partially_paid');
  assert.equal(store.batch(id)?.paid_usd, '900000');
  store.pause('incident');
  assert.throws(() => store.apply(id, { id: 'peer-again', kind: 'peer_submitted', ref: 'peer:2' }), /Paused/);
  store.apply(id, { id: 'back', kind: 'peer_return_finalized', ref: 'peer:1:return', units: '3900000', peerId: 'fixture-deposit:fixture:order-1' });
  assert.equal(store.batch(id)?.status, 'returned');
  store.apply(id, { id: 'resume', kind: 'resume_returned', ref: 'peer:1:resume' });
  assert.equal(store.batch(id)?.status, 'base_usdc');
  assert.equal(store.balanced(), true);
  assert.equal(store.recordReceipt({ mint, asset: SOLANA_USDC, units: '5000000', originRef: 'solana:test:1' }).duplicate, true);
  assert.deepEqual(alerts({ paused: true, unbalanced: false, oldestAwaitingBuyerMs: 10, maxWaitMs: 5 }).map(item => item.kind), ['paused', 'stale_peer_order']);
});

test('job leases fence out a stale worker', () => {
  const queue = new JobQueue(new Store(':memory:'));
  const job = queue.enqueue('batch', 'peer', 0);
  assert.equal(queue.enqueue('batch', 'peer', 0).duplicate, true);
  const first = queue.lease('worker-a', 10, 5);
  assert.equal(first?.id, job.id);
  assert.equal(queue.lease('worker-b', 10, 5), null);
  assert.throws(() => queue.complete(first!.id, 0), /Stale/);
  const second = queue.lease('worker-b', 15, 5);
  assert.notEqual(second?.fence, first?.fence);
  assert.throws(() => queue.complete(first!.id, first!.fence), /Stale/);
  queue.complete(second!.id, second!.fence);
});

test('preview and pages stay unsigned, and the schema names the payout tables', async () => {
  const schema = await readFile(new URL('../db/postgres.sql', import.meta.url), 'utf8');
  for (const table of ['launches', 'receipts', 'journal', 'peer_orders', 'fills', 'jobs', 'pauses']) assert.match(schema, new RegExp('CREATE TABLE ' + table));
  const receiptSchema = await readFile(new URL('../db/migrations/003_xmoney_receipts.sql', import.meta.url), 'utf8');
  for (const table of ['xmoney_receipt_bindings', 'xmoney_receipt_references']) assert.match(receiptSchema, new RegExp('CREATE TABLE ' + table));
  assert.doesNotMatch(receiptSchema, /payment_id|receipt_url/);
  const store = new Store(':memory:');
  const reader = new SolanaReader(['https://ok.example'], async () => Response.json({ id: 1, result: { value: { data: [configFixture().toString('base64'), 'base64'], owner: '3KguFi7YYzLgttG46fRism16CfcuNCkDh6U7td9JTqxX' } } }));
  const body = { name: 'José', ticker: 'solminer', description: '', pair: 'native:sol', feeBps: 100, recipient: '@creator', payoutRail: 'xmoney', firstBuyBaseUnits: '0', creatorWallet: creator, website: '', x: '', telegram: '', metadataUri: 'https://example.com/coin.json', mintNonce: '4' };
  await assert.rejects(previewLaunch(body, {}), /not configured/);
  const offline = await previewLaunch(body, { feeReceiver: receiver });
  assert.equal(offline.submit, false);
  assert.equal(offline.signature, null);
  assert.equal(offline.blockhash, null);
  assert.equal(offline.firstBuyEncoded, false);
  assert.equal(offline.chainPinChecked, false);
  assert.equal(offline.accounts[17].pubkey, 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj');
  const checked = await previewLaunch(body, { feeReceiver: receiver, reader });
  assert.equal(checked.chainPinChecked, true);
  assert.equal(checked.status, 'encoded_matches_pin');
  process.env.FUNDED_FEE_RECEIVER = receiver;
  const server = app(store, reader);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  try {
    const page = await fetch(origin + '/');
    const html = await page.text();
    assert.match(html, /FUNDED/);
    assert.match(html, /@fundedonfloat/);
    assert.match(html, /matched buyer/);
    const status = await (await fetch(origin + '/api/status')).json();
    assert.equal(status.launchEnabled, false);
    assert.equal(status.peerOrdersEnabled, false);
    assert.equal(status.senderDisplay, 'matched_buyer');
    assert.equal(status.paymentNoteBranding, '@fundedonfloat');
    assert.equal(status.partnerApprovalRequired, false);
    assert.equal(status.openQuestions.length, 2);
    assert.equal(status.peer.marketDiscountBps, 0);
    assert.equal(status.peer.claimlessEligibility, 'unverified');
    assert.equal(status.payoutReadiness.status, 'blocked_recipient');
    assert.equal(status.payoutReadiness.claimRequired, false);
    const how = await (await fetch(origin + '/how')).text();
    assert.match(how, /Payout architecture/);
    const denied = await fetch(origin + '/api/launch-preview', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://elsewhere.example' }, body: '{}' });
    assert.equal(denied.status, 403);
    const preview = await fetch(origin + '/api/launch-preview', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });
    const encoded = await preview.json();
    assert.equal(preview.status, 200);
    assert.equal(encoded.submit, false);
    assert.equal(encoded.feeReceiver, receiver);
    const quiet = await (await fetch(origin + '/api/alerts')).json();
    assert.deepEqual(quiet.alerts, []);
    const account = await (await fetch(origin + '/api/float-account?mint=' + mint)).json();
    assert.equal(account.launch, 'AZxc1mZKAsFkr8KFYW8rzsAjuwTC5RtmwoVYDEsvqAv');
    assert.equal(account.verifiedFundedLaunch, false);
    store.pause('hold');
    assert.equal((await fetch(origin + '/api/launch-preview', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) })).status, 423);
    assert.deepEqual((await (await fetch(origin + '/api/alerts')).json()).alerts, [{ kind: 'paused', severity: 'info' }]);
  } finally {
    delete process.env.FUNDED_FEE_RECEIVER;
    await new Promise(resolve => server.close(resolve));
    store.db.close();
  }
});
