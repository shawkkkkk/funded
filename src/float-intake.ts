import { readFile } from 'node:fs/promises';
import { address, amount, FLOAT, NATIVE } from './domain.ts';
import type { FinalizedTrace } from './float-evidence.ts';
import { reviewFloatFeeCycle } from './float-fee-review.ts';
import { SolanaReader, validSignature } from './solana.ts';
import { Store } from './store.ts';

const FLOAT_CREATE = 'https://www.floatlaunch.xyz/create';
type Trace = FinalizedTrace & {meta: (NonNullable<FinalizedTrace['meta']> & {preBalances?:unknown[]; postBalances?:unknown[]}) | null};
type Enrollment = {draft:string; wallet:string; creator:string; asset:string; genesis:string; mint:string|null; launch:string|null; launch_slot:number|null; destination:string|null; handoff_ref:string|null};

function finalized(signature: string, tx: Trace) {
  if (!validSignature(signature) || !Number.isSafeInteger(tx?.slot) || tx.slot < 0 || tx.meta?.err !== null ||
      tx.transaction?.signatures?.[0] !== signature) throw Error('Matching finalized successful transaction required');
  const keys = tx.transaction.message.accountKeys;
  if (!Array.isArray(keys) || !keys.length || new Set(keys.map(k => address(k.pubkey))).size !== keys.length ||
      !keys.every(k => typeof k.signer === 'boolean' && typeof k.writable === 'boolean')) throw Error('Invalid or ambiguous account keys');
  return {keys, meta:tx.meta, slot:tx.slot};
}

// Operator-only evidence store. It has no path to the payout ledger or signer.
export class FloatIntake {
  constructor(privateStore: Store) {
    this.store = privateStore;
    this.store.db.exec(`
      CREATE TABLE IF NOT EXISTS float_enrollments (
        draft TEXT PRIMARY KEY REFERENCES drafts(id), wallet TEXT NOT NULL UNIQUE, creator TEXT NOT NULL,
        asset TEXT NOT NULL, genesis TEXT NOT NULL, mint TEXT UNIQUE, launch TEXT UNIQUE,
        launch_slot INTEGER, destination TEXT UNIQUE, handoff_ref TEXT);
      CREATE TABLE IF NOT EXISTS float_observations (
        ref TEXT PRIMARY KEY, draft TEXT NOT NULL REFERENCES float_enrollments(draft),
        evidence TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS float_attribution_reviews (
        ref TEXT PRIMARY KEY REFERENCES float_observations(ref), source_ref TEXT NOT NULL UNIQUE,
        evidence TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
  }
  private store: Store;

  enrollment(draft: string) {
    return this.store.db.prepare('SELECT * FROM float_enrollments WHERE draft=?').get(draft) as Enrollment|undefined;
  }

  audit(draft: string) {
    const enrollment = this.enrollment(draft);
    if (!enrollment) throw Error('Unknown intake enrollment');
    const rows = this.store.db.prepare(`SELECT o.evidence, a.evidence AS review FROM float_observations o
      LEFT JOIN float_attribution_reviews a ON a.ref=o.ref WHERE o.draft=? ORDER BY o.rowid DESC LIMIT 50`).all(draft);
    return {enrollment,latestObservations:rows.map(row=>({observation:JSON.parse(String(row.evidence)),
      review:row.review === null ? null : JSON.parse(String(row.review))})),payoutAuthorized:false};
  }

  reserve(draft: string, feeWallet: string, genesisHash: string) {
    const wallet = address(feeWallet), genesis = address(genesisHash);
    return this.store.atomic(() => {
      const row = this.store.db.prepare('SELECT payload FROM drafts WHERE id=?').get(draft);
      if (!row) throw Error('Unknown launch draft');
      const v = JSON.parse(String(row.payload));
      const creator = address(v.creatorWallet), asset = v.pair === NATIVE ? NATIVE : address(v.pair);
      if ([creator, asset, FLOAT, '11111111111111111111111111111111'].includes(wallet)) throw Error('Use a separate operator-approved fee wallet');
      const old = this.enrollment(draft);
      if (old && (old.wallet !== wallet || old.genesis !== genesis)) throw Error('Conflicting wallet reservation');
      if (!old) {
        if (this.store.db.prepare('SELECT 1 FROM float_enrollments WHERE wallet=?').get(wallet)) throw Error('Fee wallet already reserved');
        this.store.db.prepare('INSERT INTO float_enrollments(draft,wallet,creator,asset,genesis) VALUES(?,?,?,?,?)').run(draft,wallet,creator,asset,genesis);
      }
      return {draft,wallet,asset,createUrl:FLOAT_CREATE,feeSetting:'Other wallet',duplicate:!!old,payoutAuthorized:false};
    });
  }

  confirm(draft: string, genesis: string, signature: string, tx: Trace, launchedMint: string, feeAccount: string, handoffRef: string) {
    const mint = address(launchedMint), destination = address(feeAccount);
    if (typeof handoffRef !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/.test(handoffRef)) throw Error('Operator handoff evidence reference required');
    const {keys,slot} = finalized(signature,tx);
    return this.store.atomic(() => {
      const row = this.enrollment(draft);
      if (!row || row.genesis !== genesis) throw Error('Missing enrollment or wrong RPC cluster');
      if ([row.creator,row.wallet,row.asset,destination,FLOAT].includes(mint) ||
          (row.asset === NATIVE ? destination !== row.wallet : [row.wallet,row.creator,row.asset,FLOAT].includes(destination))) throw Error('Incorrect receiving account for the enrolled asset');
      if (!keys.some(k => k.pubkey === mint && k.writable) || !keys.some(k => k.pubkey === row.creator && k.signer) ||
          !tx.transaction.message.instructions.some(ix => ix.programId === FLOAT)) throw Error('Launch does not match the reserved creator, mint and Float program');
      if (row.launch && (row.mint !== mint || row.launch !== signature || row.launch_slot !== slot || row.destination !== destination || row.handoff_ref !== handoffRef)) throw Error('Conflicting launch confirmation');
      if (!row.launch) this.store.db.prepare('UPDATE float_enrollments SET mint=?, launch=?, launch_slot=?, destination=?, handoff_ref=? WHERE draft=?').run(mint,signature,slot,destination,handoffRef,draft);
      return {draft,mint,wallet:row.wallet,destination,signature,slot,duplicate:!!row.launch,walletSelection:'operator_attested',payoutAuthorized:false};
    });
  }

  observe(draft: string, genesis: string, signature: string, tx: Trace) {
    const {keys,meta,slot} = finalized(signature,tx);
    return this.store.atomic(() => {
      const row = this.enrollment(draft);
      if (!row?.mint || !row.destination || row.launch_slot === null || row.genesis !== genesis) throw Error('Missing confirmed enrollment or wrong RPC cluster');
      if (slot <= row.launch_slot) throw Error('Observation must follow the launch slot');
      const i = keys.findIndex(k => k.pubkey === row.destination && k.writable);
      if (i === -1) throw Error('Enrolled destination is not writable in this transaction');
      let delta: bigint;
      if (row.asset === NATIVE) {
        const pre = meta.preBalances?.[i], post = meta.postBalances?.[i];
        if (typeof pre !== 'number' || !Number.isSafeInteger(pre) || pre < 0 || typeof post !== 'number' || !Number.isSafeInteger(post) || post < 0) throw Error('Exact native balance metadata unavailable');
        delta = BigInt(post) - BigInt(pre);
      } else {
        const pre = meta.preTokenBalances?.filter(b => b.accountIndex === i);
        const post = meta.postTokenBalances?.filter(b => b.accountIndex === i);
        if (pre?.length !== 1 || post?.length !== 1 || pre[0].programId !== post[0].programId ||
            !pre[0].programId || pre[0].uiTokenAmount.decimals !== post[0].uiTokenAmount.decimals ||
            [pre[0],post[0]].some(b => b.owner !== row.wallet || b.mint !== row.asset)) throw Error('Token balance metadata does not match the enrolled owner and mint');
        address(pre[0].programId);
        delta = amount(post[0].uiTokenAmount.amount) - amount(pre[0].uiTokenAmount.amount);
      }
      if (delta <= 0n) throw Error('No positive net increase in the enrolled destination');
      const ref = `solana:${genesis}:${signature}:${row.destination}`;
      const evidence = {draft,ref,signature,slot,mint:row.mint,asset:row.asset,destination:row.destination,netUnits:delta.toString(),
        status:'held_pending_attribution',creditAuthorized:false,payoutAuthorized:false};
      const encoded = JSON.stringify(evidence);
      const old = this.store.db.prepare('SELECT evidence FROM float_observations WHERE ref=?').get(ref);
      if (old && old.evidence !== encoded) throw Error('Conflicting observation replay');
      if (!old) this.store.db.prepare('INSERT INTO float_observations(ref,draft,evidence) VALUES(?,?,?)').run(ref,draft,encoded);
      return {...evidence,duplicate:!!old};
    });
  }

  review(draft: string, genesis: string, signature: string, tx: Trace, policy: unknown, sourceVault: string) {
    return this.store.atomic(() => {
      const row = this.enrollment(draft);
      if (!row?.mint || !row.destination || row.genesis !== genesis) throw Error('Missing confirmed enrollment or wrong RPC cluster');
      if (row.asset === NATIVE) throw Error('Native SOL attribution is not supported by this reviewer');
      const match = reviewFloatFeeCycle(genesis,signature,tx,policy,{launchMint:row.mint,feeMint:row.asset,
        feeReceiver:row.wallet,destination:row.destination,sourceVault});
      const {ref,netUnits} = this.observe(draft,genesis,signature,tx);
      if (match.units !== netUnits) throw Error('Reviewed transfer does not reconcile with observation');
      const evidence = {...match,observationRef:ref};
      const encoded = JSON.stringify(evidence);
      const old = this.store.db.prepare('SELECT evidence FROM float_attribution_reviews WHERE ref=?').get(ref);
      if (old && old.evidence !== encoded) throw Error('Conflicting attribution review');
      if (!old) this.store.db.prepare('INSERT INTO float_attribution_reviews(ref,source_ref,evidence) VALUES(?,?,?)').run(ref,match.sourceRef,encoded);
      return {...evidence,duplicate:!!old};
    });
  }
}

if (import.meta.main) {
  let store: Store|undefined;
  try {
    const [mode,draft,...args] = process.argv.slice(2);
    if (!draft || !((mode === 'reserve' && args.length === 1) || (mode === 'confirm' && args.length === 4) ||
        (mode === 'observe' && args.length === 1) || (mode === 'review' && args.length === 3) || (mode === 'audit' && args.length === 0))) {
      throw Error('Usage: intake:float -- reserve <draft> <wallet> | confirm <draft> <signature> <mint> <fee-account> <operator-evidence-ref> | observe <draft> <signature> | review <draft> <signature> <policy.json> <source-vault> | audit <draft>');
    }
    const genesis = mode === 'audit' ? null : address(process.env.FUNDED_EXPECT_GENESIS);
    store = new Store(process.env.FUNDED_DB ?? 'funded.sqlite');
    const intake = new FloatIntake(store);
    if (genesis === null) console.log(JSON.stringify(intake.audit(draft),null,2));
    else if (mode === 'reserve') console.log(JSON.stringify(intake.reserve(draft,args[0],genesis),null,2));
    else {
      const urls = (process.env.FUNDED_READ_RPC ?? '').split(',').map(v => v.trim()).filter(Boolean);
      if (urls.length !== 1) throw Error('Use exactly one trusted FUNDED_READ_RPC endpoint');
      const rpc = new SolanaReader(urls);
      if (await rpc.read('getGenesisHash',[]) !== genesis) throw Error('RPC cluster does not match expected genesis hash');
      const tx = await rpc.finalizedTransaction(args[0]);
      if (!tx) throw Error('Finalized transaction unavailable');
      if (mode === 'confirm' && !await rpc.mintOwner(args[1])) throw Error('Launched mint is not visible to the finalized RPC');
      const result = mode === 'confirm' ? intake.confirm(draft,genesis,args[0],tx,args[1],args[2],args[3]) :
        mode === 'review' ? intake.review(draft,genesis,args[0],tx,JSON.parse(await readFile(args[1],'utf8')),args[2]) : intake.observe(draft,genesis,args[0],tx);
      console.log(JSON.stringify(result,null,2));
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : 'Float intake failed');
    process.exitCode = 1;
  } finally { store?.db.close(); }
}
