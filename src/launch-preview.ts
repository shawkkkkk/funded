import { PublicKey } from '@solana/web3.js';
import { launchDraft, NATIVE, SOLANA_USDC } from './domain.ts';
import { configMatchesPin, encodeFirstBuy, FLOAT_PROGRAM_ID, launchAccounts, LAUNCHLAB_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, WSOL_MINT } from './float-program.ts';

type Reader = { read(method: 'getAccountInfo', params: unknown[]): Promise<{ value?: { data?: [string, string] } } | null> };
const tiers: Record<number, number> = { 100: 0, 200: 1, 250: 2 };

export async function previewLaunch(body: Record<string, unknown>, opts: { feeReceiver?: string; reader?: Reader }) {
  const draft = launchDraft(body);
  if (!opts.feeReceiver) throw Error('Operator fee receiver is not configured');
  const uri = body.metadataUri;
  if (typeof uri !== 'string' || !uri.startsWith('https://') || uri.length > 200) throw Error('HTTPS metadata URI required');
  const nonceText = body.mintNonce ?? '1';
  if (typeof nonceText !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(nonceText)) throw Error('Invalid mint nonce');
  const quoteTokenProgram = draft.pair === NATIVE || draft.pair === SOLANA_USDC ? TOKEN_PROGRAM_ID : body.quoteTokenProgram;
  if (quoteTokenProgram !== TOKEN_PROGRAM_ID && quoteTokenProgram !== TOKEN_2022_PROGRAM_ID) throw Error('Quote token program must be Token or Token-2022');
  const built = launchAccounts({
    creator: new PublicKey(draft.creatorWallet),
    ticker: draft.ticker,
    name: draft.name,
    uri,
    feeReceiver: new PublicKey(opts.feeReceiver),
    quoteMint: new PublicKey(draft.pair === NATIVE ? WSOL_MINT : draft.pair),
    quoteTokenProgram: new PublicKey(quoteTokenProgram),
    tier: tiers[draft.feeBps],
    mintNonce: BigInt(nonceText)
  });
  const firstBuyUnits = BigInt(draft.firstBuyBaseUnits);
  const firstBuy = firstBuyUnits === 0n ? null : encodeFirstBuy({
    user: new PublicKey(draft.creatorWallet),
    mint: new PublicKey(built.mint),
    quoteMint: new PublicKey(draft.pair === NATIVE ? WSOL_MINT : draft.pair),
    quoteTokenProgram: new PublicKey(quoteTokenProgram),
    tier: tiers[draft.feeBps],
    quoteAmount: firstBuyUnits
  });
  let chainPinChecked = false;
  if (opts.reader) {
    const result = await opts.reader.read('getAccountInfo', [built.accounts[1].pubkey, { commitment: 'finalized', encoding: 'base64' }]);
    const encoded = result?.value?.data?.[0];
    if (typeof encoded !== 'string') throw Error('Float config unavailable');
    configMatchesPin(Buffer.from(encoded, 'base64'));
    chainPinChecked = true;
  }
  return {
    status: chainPinChecked ? 'encoded_matches_pin' : 'encoded_offline',
    program: FLOAT_PROGRAM_ID,
    launchlab: LAUNCHLAB_PROGRAM_ID,
    mint: built.mint,
    launch: built.launch,
    feeReceiver: opts.feeReceiver,
    accounts: built.accounts,
    dataBase64: built.data.toString('base64'),
    firstBuyEncoded: firstBuy !== null,
    firstBuy: firstBuy ? { program: LAUNCHLAB_PROGRAM_ID, accounts: firstBuy.accounts, dataBase64: firstBuy.data.toString('base64'), minimumOut: '1', executionAuthorized: false } : null,
    chainPinChecked,
    submit: false,
    blockhash: null,
    signature: null
  };
}
