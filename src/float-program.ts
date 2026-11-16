import { PublicKey } from '@solana/web3.js';

export const FLOAT_PROGRAM_ID = '3KguFi7YYzLgttG46fRism16CfcuNCkDh6U7td9JTqxX';
export const LAUNCHLAB_PROGRAM_ID = 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj';
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const METADATA_PROGRAM_ID = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
export const RENT_SYSVAR = 'SysvarRent111111111111111111111111111111111';

const FLOAT = new PublicKey(FLOAT_PROGRAM_ID);
const LAUNCHLAB = new PublicKey(LAUNCHLAB_PROGRAM_ID);
const TOKEN = new PublicKey(TOKEN_PROGRAM_ID);
const TOKEN_2022 = new PublicKey(TOKEN_2022_PROGRAM_ID);
const METADATA = new PublicKey(METADATA_PROGRAM_ID);

export const LAUNCH_DISCRIMINATOR = Buffer.from('99f15de116454a3d', 'hex');
export const LAUNCH_STATE_DISCRIMINATOR = Buffer.from('be958e9713c48564', 'hex');
export const CONFIG_DISCRIMINATOR = Buffer.from('9b0caae01efacc82', 'hex');

/** Finalized mainnet pin from 9 November 2026. Not a live subscription. */
export const CONFIG_PIN = Object.freeze({
  observed: '2026-11-09',
  genesis: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  config: 'AgaKFP4SfEeeM4r4GcSWBwpEAbfHh7wLkJGHqpWrLBQV',
  treasury: '2LMWFmbGBfw78ZEas2NFmAYfo4bhyBqYboYh9nk3mDFQ',
  admin: '2gJuHVeXf8x3VGLfWeDNkrGdReZomtNb635jf3ohSCTU',
  split: Object.freeze({ holders: 1500, creator: 500, flagship: 3500, traders: 3500, treasury: 1000 }),
  tierRates: Object.freeze([7500n, 17500n, 22500n]),
  tierCount: 3,
  platforms: Object.freeze([
    '2TDPJJPV6nvTEqXABxrqno6Uzpipxxvh1zjLN3SMYn69',
    '7paQR4MLZcGdG8ZYAyj9Qu2UsJgXmNVQGha7g1gim1sG',
    'CKpEUk5SRk8CUNhhxaVPKtzKUKLgQe2tQHPH2eXWtaGR'
  ]),
  supply: 1_000_000_000_000_000n,
  curveSellBps: 7325,
  evidenceTx: '3zqQfDYM3SwvY15NfxURfMiCduGSUYdXigB4x8JxRGF4rAaFpTGsRyCHZPhUmnkgUMEZbQY1FVsNJsygULjvw4s2'
});

const pda = (seeds: Buffer[], program: PublicKey) => PublicKey.findProgramAddressSync(seeds, program)[0];
function u64(value: bigint) {
  if (value < 0n || value > 0xffffffffffffffffn) throw Error('u64 out of range');
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes;
}
function text(value: string, label: string) {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length < 1 || bytes.length > 200) throw Error(label + ' length is not supported');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length);
  return Buffer.concat([len, bytes]);
}

export type LaunchInput = {
  creator: PublicKey;
  ticker: string;
  name: string;
  uri: string;
  feeReceiver: PublicKey;
  quoteMint: PublicKey;
  quoteTokenProgram: PublicKey;
  tier: number;
  mintNonce: bigint;
};

export function encodeLaunchData(input: LaunchInput) {
  if (![0, 1, 2].includes(input.tier)) throw Error('Invalid fee tier');
  if (!/^[A-Za-z0-9]{1,10}$/.test(input.ticker)) throw Error('Invalid ticker');
  if (input.feeReceiver.equals(input.creator)) throw Error('Fee receiver must be a separate wallet');
  return Buffer.concat([
    LAUNCH_DISCRIMINATOR,
    text(input.name, 'Name'),
    text(input.ticker, 'Ticker'),
    text(input.uri, 'Metadata URI'),
    input.feeReceiver.toBuffer(),
    Buffer.from([input.tier]),
    u64(input.mintNonce)
  ]);
}

export function decodeLaunchData(data: Buffer) {
  if (data.length < 8 || !data.subarray(0, 8).equals(LAUNCH_DISCRIMINATOR)) throw Error('Not a Float launch instruction');
  let offset = 8;
  const read = () => {
    const length = data.readUInt32LE(offset);
    offset += 4;
    const value = data.subarray(offset, offset + length).toString('utf8');
    offset += length;
    return value;
  };
  const name = read();
  const ticker = read();
  const uri = read();
  const feeReceiver = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const tier = data[offset];
  offset += 1;
  const mintNonce = data.readBigUInt64LE(offset);
  return { name, ticker, uri, feeReceiver, tier, mintNonce };
}

export type LaunchAccount = { name: string; pubkey: string; isSigner: boolean; isWritable: boolean };

export function launchAccounts(input: LaunchInput) {
  if (!input.quoteTokenProgram.equals(TOKEN) && !input.quoteTokenProgram.equals(TOKEN_2022)) throw Error('Unsupported quote token program');
  const mint = pda([Buffer.from('mint'), input.creator.toBuffer(), u64(input.mintNonce)], FLOAT);
  const pool = pda([Buffer.from('pool'), mint.toBuffer(), input.quoteMint.toBuffer()], LAUNCHLAB);
  const platform = pda([Buffer.from('platform'), Buffer.from([input.tier])], FLOAT);
  const rows: [string, PublicKey, boolean, boolean][] = [
    ['creator', input.creator, true, true],
    ['config', new PublicKey(CONFIG_PIN.config), false, false],
    ['treasury', new PublicKey(CONFIG_PIN.treasury), false, true],
    ['quote_asset', pda([Buffer.from('quote'), input.quoteMint.toBuffer()], FLOAT), false, false],
    ['quote_mint', input.quoteMint, false, false],
    ['ticker_record', pda([Buffer.from('ticker'), Buffer.from(input.ticker.toUpperCase())], FLOAT), false, true],
    ['coin_mint', mint, false, true],
    ['launch', pda([Buffer.from('launch'), mint.toBuffer()], FLOAT), false, true],
    ['coin_vault', pda([Buffer.from('coin'), mint.toBuffer()], FLOAT), false, false],
    ['global_config', pda([Buffer.from('global_config'), input.quoteMint.toBuffer(), Buffer.from([0]), Buffer.from([0, 0])], LAUNCHLAB), false, false],
    ['platform_config', pda([Buffer.from('platform_config'), platform.toBuffer()], LAUNCHLAB), false, false],
    ['launchlab_authority', pda([Buffer.from('vault_auth_seed')], LAUNCHLAB), false, false],
    ['pool_state', pool, false, true],
    ['base_vault', pda([Buffer.from('pool_vault'), pool.toBuffer(), mint.toBuffer()], LAUNCHLAB), false, true],
    ['quote_vault', pda([Buffer.from('pool_vault'), pool.toBuffer(), input.quoteMint.toBuffer()], LAUNCHLAB), false, true],
    ['metadata', pda([Buffer.from('metadata'), METADATA.toBuffer(), mint.toBuffer()], METADATA), false, true],
    ['event_authority', pda([Buffer.from('__event_authority')], LAUNCHLAB), false, false],
    ['launchlab_program', LAUNCHLAB, false, false],
    ['token_program', TOKEN, false, false],
    ['quote_token_program', input.quoteTokenProgram, false, false],
    ['metadata_program', METADATA, false, false],
    ['system_program', new PublicKey(SYSTEM_PROGRAM_ID), false, false],
    ['rent', new PublicKey(RENT_SYSVAR), false, false]
  ];
  const accounts: LaunchAccount[] = rows.map(([name, pubkey, isSigner, isWritable]) => ({ name, pubkey: pubkey.toBase58(), isSigner, isWritable }));
  if (accounts.length !== 23 || accounts[17].pubkey !== LAUNCHLAB_PROGRAM_ID) throw Error('Launch account layout drifted');
  return { accounts, mint: mint.toBase58(), launch: accounts[7].pubkey, data: encodeLaunchData(input) };
}

export function decodeLaunchState(data: Buffer) {
  if (data.length < 210 || !data.subarray(0, 8).equals(LAUNCH_STATE_DISCRIMINATOR)) throw Error('Not a Float launch account');
  let offset = 8;
  const pub = () => {
    const key = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;
    return key.toBase58();
  };
  const creator = pub();
  const feeReceiver = pub();
  const coinMint = pub();
  const quoteMint = pub();
  const pool = pub();
  const feeTier = data[offset];
  offset += 1;
  const createdAt = data.readBigInt64LE(offset).toString();
  offset += 8;
  const num = () => {
    const value = data.readBigUInt64LE(offset).toString();
    offset += 8;
    return value;
  };
  return {
    creator, feeReceiver, coinMint, quoteMint, pool, feeTier, createdAt,
    coinFeesClaimed: num(), holderRewards: num(), holderRewardsPaid: num(), devOwed: num(), bump: data[offset]
  };
}

export function launchAddress(mint: string) {
  return PublicKey.findProgramAddressSync([Buffer.from('launch'), new PublicKey(mint).toBuffer()], FLOAT)[0].toBase58();
}

export function isFloatCoin(owner: string, data: Buffer, mint: string) {
  if (owner !== FLOAT_PROGRAM_ID) return false;
  try { return decodeLaunchState(data).coinMint === mint; }
  catch { return false; }
}

export function decodeConfigPrefix(data: Buffer) {
  if (data.length < 272 || !data.subarray(0, 8).equals(CONFIG_DISCRIMINATOR)) throw Error('Not the Float config');
  let offset = 8;
  const pub = () => {
    const key = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
    offset += 32;
    return key;
  };
  const admin = pub();
  const treasury = pub();
  const split = {
    holders: data.readUInt16LE(offset), creator: data.readUInt16LE(offset + 2), flagship: data.readUInt16LE(offset + 4),
    traders: data.readUInt16LE(offset + 6), treasury: data.readUInt16LE(offset + 8)
  };
  offset += 10;
  const tierRates = [0, 1, 2].map(i => data.readBigUInt64LE(offset + i * 8));
  offset += 24;
  const tierCount = data[offset];
  offset += 1;
  const platforms = [0, 1, 2].map(i => new PublicKey(data.subarray(offset + i * 32, offset + (i + 1) * 32)).toBase58());
  offset += 96;
  const flagship = pub();
  offset += 10 + 8 + 8;
  const coinSupply = data.readBigUInt64LE(offset);
  offset += 8;
  const curveSellBps = data.readUInt16LE(offset);
  offset += 2;
  return { admin, treasury, split, tierRates, tierCount, platforms, flagship, coinSupply, curveSellBps, launchesPaused: data[offset] === 1 };
}

export function configMatchesPin(data: Buffer) {
  const config = decodeConfigPrefix(data);
  if (config.launchesPaused) throw Error('Float launches are paused');
  if (config.treasury !== CONFIG_PIN.treasury || config.admin !== CONFIG_PIN.admin) throw Error('Config admin or treasury drifted');
  const split = CONFIG_PIN.split;
  if (config.split.holders !== split.holders || config.split.creator !== split.creator || config.split.flagship !== split.flagship ||
      config.split.traders !== split.traders || config.split.treasury !== split.treasury) throw Error('Fee split drifted');
  if (config.tierCount !== 3 || config.tierRates.some((rate, i) => rate !== CONFIG_PIN.tierRates[i])) throw Error('Fee tiers drifted');
  if (config.platforms.some((key, i) => key !== CONFIG_PIN.platforms[i])) throw Error('Platform config drifted');
  if (config.coinSupply !== CONFIG_PIN.supply || config.curveSellBps !== CONFIG_PIN.curveSellBps) throw Error('Curve pin drifted');
  return config;
}

export function configFixture(paused = false) {
  const data = Buffer.alloc(272);
  CONFIG_DISCRIMINATOR.copy(data, 0);
  new PublicKey(CONFIG_PIN.admin).toBuffer().copy(data, 8);
  new PublicKey(CONFIG_PIN.treasury).toBuffer().copy(data, 40);
  const split = [1500, 500, 3500, 3500, 1000];
  split.forEach((value, i) => data.writeUInt16LE(value, 72 + i * 2));
  CONFIG_PIN.tierRates.forEach((value, i) => data.writeBigUInt64LE(value, 82 + i * 8));
  data[106] = 3;
  CONFIG_PIN.platforms.forEach((key, i) => new PublicKey(key).toBuffer().copy(data, 107 + i * 32));
  data.writeBigUInt64LE(CONFIG_PIN.supply, 261);
  data.writeUInt16LE(CONFIG_PIN.curveSellBps, 269);
  data[271] = paused ? 1 : 0;
  return data;
}
