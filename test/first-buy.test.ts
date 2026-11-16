import assert from 'node:assert/strict';
import test from 'node:test';
import { PublicKey } from '@solana/web3.js';
import { encodeFirstBuy, TOKEN_PROGRAM_ID, WSOL_MINT } from '../src/float-program.ts';
import { previewLaunch } from '../src/launch-preview.ts';

const expected = [
  '2P2t5CLzTQmCVoLsQkJAftaQEJbM64yvnHTWXXLSkD9y',
  'WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh',
  '6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX',
  '2TDPJJPV6nvTEqXABxrqno6Uzpipxxvh1zjLN3SMYn69',
  '2uZ1pUXhdLLUfqCAvHQPWmUZd28XRAMZtmavntnQUMJF',
  'GsSmwXuQDz6aromaVvb1sAsYPtMTHEiYcZ8soXsU6giU',
  '8QEinG67pwJcA9kE479rmCUSBWSXzhegs4MbL4pbN3Sa',
  '6iKuy9uaiKL22XD8LAD7hbsRua3BCa9UHkj1f861JqtY',
  '5XyTN8riYZD8obMBsDNSkK5mCYJJ1X65ezpvkpPZvS6W',
  'BRc25BBvJLeFiec6v6q8o1mDWQfFGiF1vEYjKzsbnzYg',
  WSOL_MINT,
  TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  '2DPAtwB8L12vrMRExbLuyGnC7n2J5LNoZQSejeQGpwkr',
  'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj',
  '11111111111111111111111111111111',
  'G4K4noi9xKmNXP7MhKnZbJXUQpzo6qMPwR1HRzmxkWhm',
  'G4CQopzFzuTr6dMBCKSd7zfuBdhGV2PpZWrSbdHR7fd2'
];

test('first buy matches the BuyExactIn inside finalized TOEY and NIXO launches', () => {
  const buy = encodeFirstBuy({
    user: new PublicKey(expected[0]),
    mint: new PublicKey(expected[9]),
    quoteMint: new PublicKey(WSOL_MINT),
    quoteTokenProgram: new PublicKey(TOKEN_PROGRAM_ID),
    tier: 0,
    quoteAmount: 500_000_000n
  });
  assert.deepEqual(buy.accounts.map(account => account.pubkey), expected);
  assert.equal(buy.data.toString('hex'), 'faea0d7bd59c13ec0065cd1d0000000001000000000000000000000000000000');
  assert.equal(buy.accounts[0].isSigner, true);
  const smaller = encodeFirstBuy({
    user: new PublicKey('Fo42xMiufWHgy99uDE8ux8tTJBn7H6R3zGyouuxnXGpk'),
    mint: new PublicKey(expected[9]),
    quoteMint: new PublicKey(WSOL_MINT),
    quoteTokenProgram: new PublicKey(TOKEN_PROGRAM_ID),
    tier: 0,
    quoteAmount: 1_000_000n
  });
  assert.equal(smaller.data.readBigUInt64LE(8), 1_000_000n);
  assert.equal(smaller.data.readBigUInt64LE(16), 1n);
});

test('preview includes the unsigned first buy and still cannot be submitted', async () => {
  const preview = await previewLaunch({
    name: 'Toey', ticker: 'TOEY', description: '', pair: 'native:sol', feeBps: 100, recipient: '@creator',
    payoutRail: 'xmoney', firstBuyBaseUnits: '500000000', creatorWallet: expected[0], website: '', x: '', telegram: '',
    metadataUri: 'https://example.com/toey.json', mintNonce: '9'
  }, { feeReceiver: 'C2C4ASTqWHaYx74EkZZ9AqKc4FnTpqnGJGy5d3aG1kRB' });
  assert.equal(preview.submit, false);
  assert.equal(preview.signature, null);
  assert.equal(preview.firstBuyEncoded, true);
  assert.equal(preview.firstBuy?.executionAuthorized, false);
  assert.equal(preview.firstBuy?.minimumOut, '1');
  assert.equal(preview.firstBuy?.accounts.length, 18);
});
