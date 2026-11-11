import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Store } from './store.ts';
import { SolanaReader } from './solana.ts';
import { loadConfig } from './config.ts';
import { PgLedger } from './pg-ledger.ts';
import { previewLaunch } from './launch-preview.ts';
import { disclose } from './disclosure.ts';
import { handle as xhandle } from './domain.ts';
import { CLAIMLESS_NOTICE, localSdkFacts, MARKETPLACE_NOTICE, OPEN_QUESTIONS, SENDER_NOTICE } from './peer-cash.ts';
import { alerts } from './alerts.ts';
import { screenerFromEnv } from './screening.ts';
import { isFloatCoin, launchAddress } from './float-program.ts';
import { watchReceiver } from './fee-monitor.ts';
import { NATIVE } from './domain.ts';
import { PublicKey } from '@solana/web3.js';
import { payoutReadiness } from './payout-readiness.ts';

const pages = new Set(['/','/launch','/how','/explore','/earnings','/payouts','/liquidity']);
const assets = new Map([['/app.js','text/javascript'],['/style.css','text/css'],['/funded-mark.webp','image/webp']]);
const png = Buffer.from('89504e470d0a1a0a','hex');
function isImage(bytes: Buffer, type: string) {
  if (type === 'image/png') return bytes.length > 24 && bytes.subarray(0,8).equals(png);
  if (type === 'image/jpeg') return bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/webp') return bytes.length > 12 && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
  return false;
}
const limit = 1_500_000;
async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Error('Request too large');
    chunks.push(chunk);
  }
  const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('Invalid draft');
  return data as Record<string, unknown>;
}

export function app(store: Store, reader?: SolanaReader, ledger?: PgLedger) {
  return createServer(async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; img-src 'self' blob:; form-action 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com");
    const json = (status: number, data: unknown) => send(res,status,'application/json',JSON.stringify(data));
    try {
      // This build is intentionally local-only. Reject DNS rebinding and cross-origin writes.
      if (!/^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/.test(req.headers.host ?? '')) return json(403,{error:'Local use only'});
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;
      if (req.method === 'GET' && (pages.has(path) || /^\/token\/[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(path))) {
        return send(res,200,'text/html',await readFile(new URL('../public/index.html',import.meta.url)));
      }
      if (req.method === 'GET' && assets.has(path)) {
        return send(res,200,assets.get(path)!,await readFile(new URL('../public'+path,import.meta.url)));
      }
      if (req.method === 'GET' && path === '/api/status') {
        const peer = localSdkFacts();
        const readiness = payoutReadiness({rail:'xmoney',xMoneyEligibility:peer.claimlessEligibility,integrationReady:false,baseUsdcUnits:0n,minimumBaseUsdcUnits:BigInt(peer.minBaseUnits)});
        const config = loadConfig();
        const paused = ledger ? await ledger.pauseReason() : store.pauseReason();
        return json(200,{mode:'local_draft_only',product:'Funded',launchEnabled:false,payoutEnabled:false,peerOrdersEnabled:false,launchSigner:config.launchSigner,custody:config.custody,pricing:config.pricing,database:ledger?'postgres':'sqlite',rpcConfigured:!!reader,paused:paused??null,senderDisplay:peer.senderDisplay,paymentNoteBranding:peer.paymentNoteBranding,partnerApprovalRequired:peer.partnerApprovalRequired,senderNotice:SENDER_NOTICE,claimlessNotice:CLAIMLESS_NOTICE,marketplaceNotice:MARKETPLACE_NOTICE,payoutReadiness:readiness,openQuestions:OPEN_QUESTIONS,peer:{spreadBps:peer.spreadBps,marketDiscountBps:null,minBaseUnits:peer.minBaseUnits,ordersEnabled:false,claimlessEligibility:'unverified',partnerApprovalRequired:false,senderDisplay:peer.senderDisplay,paymentNoteBranding:peer.paymentNoteBranding}});
      }
      if (req.method === 'GET' && path === '/api/alerts') {
        let unbalanced = false;
        try { if (ledger) await ledger.balanced(); else store.balanced(); } catch { unbalanced = true; }
        const paused = ledger ? await ledger.pauseReason() : store.pauseReason();
        return json(200,{alerts:alerts({paused:!!paused,unbalanced,oldestAwaitingBuyerMs:null,maxWaitMs:86_400_000})});
      }
      if (req.method === 'GET' && path === '/api/screen') {
        const kind = url.searchParams.get('kind');
        const value = url.searchParams.get('value') ?? '';
        if (kind !== 'handle' && kind !== 'mint' && kind !== 'address') return json(400,{error:'Screening subject required'});
        return json(200, await screenerFromEnv().screen({ kind, value }));
      }
      if (req.method === 'GET' && path === '/api/disclosure') {
        const sample = disclose({quoteUnits:10_000n,convertedUsdc:null,bridgeFeeUsdc:null,deliveredUsdMicros:0n,pendingUsdc:0n,fiatVerified:false});
        return json(200,{senderNotice:SENDER_NOTICE,claimlessNotice:CLAIMLESS_NOTICE,marketplaceNotice:MARKETPLACE_NOTICE,openQuestions:OPEN_QUESTIONS,lpDiscountBps:null,spreadBps:0,sample,paymentComplete:false});
      }
      if (req.method === 'GET' && path === '/api/earnings') {
        let creator = '';
        try { creator = xhandle(url.searchParams.get('handle') ?? ''); }
        catch (e) { return json(400,{error:e instanceof Error ? e.message : 'Invalid handle'}); }
        const rows = ledger ? await ledger.creatorBatches(creator) : [];
        const items = rows.map(row => ({ ...row, cost: costFor(row) }));
        return json(200,{handle:creator,items,senderNotice:SENDER_NOTICE,claimlessNotice:CLAIMLESS_NOTICE,marketplaceNotice:MARKETPLACE_NOTICE,lpDiscountBps:null,spreadBps:0,paymentComplete:false,database:ledger?'postgres':'sqlite'});
      }
      if (req.method === 'GET' && path === '/api/liquidity') {
        const items = ledger ? await ledger.liquidityActivity() : [];
        return json(200,{items,senderNotice:SENDER_NOTICE,marketplaceNotice:MARKETPLACE_NOTICE,spreadBps:0,marketDiscountBps:null,ordersEnabled:false,partnerApprovalRequired:false,senderDisplay:'matched_buyer',paymentNoteBranding:'@fundedonfloat'});
      }
      if (req.method === 'GET' && path === '/api/payouts') {
        const rows = ledger ? await ledger.publicBatches() : store.publicBatches();
        return json(200,{mode:'local_draft_only',senderNotice:SENDER_NOTICE,claimlessNotice:CLAIMLESS_NOTICE,marketplaceNotice:MARKETPLACE_NOTICE,lpDiscountBps:null,spreadBps:0,items:rows.map(row => ({...row, cost:costFor(row)}))});
      }
      if (req.method === 'GET' && path === '/api/float-account') {
        let mint: PublicKey;
        try { mint = new PublicKey(url.searchParams.get('mint') ?? ''); }
        catch { return json(400,{error:'Invalid mint'}); }
        const launch = launchAddress(mint.toBase58());
        if (!reader) return json(200,{mint:mint.toBase58(),launch,checked:false,isFloatCoin:false,verifiedFundedLaunch:false});
        try {
          const result = await reader.read('getAccountInfo',[launch,{commitment:'finalized',encoding:'base64'}]);
          const value = result?.value;
          const raw = value?.data?.[0];
          const data = typeof raw === 'string' ? Buffer.from(raw,'base64') : Buffer.alloc(0);
          return json(200,{mint:mint.toBase58(),launch,checked:true,owner:value?.owner??null,isFloatCoin:isFloatCoin(value?.owner??'',data,mint.toBase58()),verifiedFundedLaunch:false});
        } catch { return json(502,{error:'Unable to read Float launch account'}); }
      }
      if (req.method === 'GET' && path === '/api/deposits') {
        if (!reader) return json(503,{error:'Read-only Solana RPC not configured'});
        const account = url.searchParams.get('account') ?? '';
        const asset = url.searchParams.get('asset') ?? NATIVE;
        const expectedOwner = url.searchParams.get('owner') ?? '';
        try {
          return json(200, await watchReceiver(reader, { account, asset, expectedOwner }));
        } catch (e) { return json(400,{error:e instanceof Error ? e.message : 'Unable to read deposits'}); }
      }
      if (req.method === 'GET' && path === '/api/transactions') {
        if (!reader) return json(503,{error:'Read-only Solana RPC not configured'});
        try {
          const signature = url.searchParams.get('signature');
          return json(200,signature ? await reader.inspect(signature) : await reader.recentFloatSignatures());
        } catch { return json(502,{error:'Unable to inspect Solana transaction'}); }
      }
      if (req.method === 'GET' && path === '/api/mint') {
        if (!reader) return json(503,{error:'Read-only Solana RPC not configured'});
        try {
          const info = await reader.mintOwner(url.searchParams.get('mint') ?? '');
          return json(info ? 200 : 404,info ?? {error:'Mint not found'});
        } catch { return json(502,{error:'Unable to inspect mint'}); }
      }
      if (req.method === 'POST' && path === '/api/launch-preview') {
        if (req.headers.origin !== 'http://'+req.headers.host || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) return json(403,{error:'Same-origin JSON required'});
        if (store.pauseReason() || (ledger && await ledger.pauseReason())) return json(423,{error:'Paused'});
        try {
          const preview = await previewLaunch(await body(req), { feeReceiver: process.env.FUNDED_FEE_RECEIVER, reader });
          return json(200, preview);
        } catch (e) { return json(400,{error:e instanceof Error && !(e instanceof SyntaxError) ? e.message : 'Invalid JSON'}); }
      }
      if (req.method === 'POST' && path === '/api/drafts') {
        if (req.headers.origin !== 'http://'+req.headers.host || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) return json(403,{error:'Same-origin JSON required'});
        if (Number(req.headers['content-length']) > limit) return json(413,{error:'Request too large'});
        try {
          const v = await body(req);
          let img: {bytes:Buffer;type:string}|undefined;
          if (v.image != null) {
            if (typeof v.image !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(v.image) || typeof v.imageType !== 'string') throw Error('Invalid image encoding');
            const bytes = Buffer.from(v.image,'base64');
            if (bytes.length > 1_000_000 || !isImage(bytes,v.imageType)) throw Error('Use a PNG, JPEG or WebP up to 1 MB');
            img = {bytes,type:v.imageType};
          }
          return json(201,store.saveDraft(v,img));
        } catch(e) { return json(400,{error:e instanceof Error && !(e instanceof SyntaxError) ? e.message : 'Invalid JSON'}); }
      }
      return json(404,{error:'Not found'});
    } catch { return json(500,{error:'Internal error'}); }
  });
}
function costFor(row: { units?: string; paid_usd?: string; status?: string }) {
  const units = BigInt(row.units ?? '0');
  const paid = BigInt(row.paid_usd ?? '0');
  const verified = row.status === 'paid' && paid > 0n;
  return disclose({ quoteUnits: units, convertedUsdc: null, bridgeFeeUsdc: null, deliveredUsdMicros: verified ? paid : 0n, pendingUsdc: verified ? 0n : units, fiatVerified: verified });
}
function send(res: ServerResponse,status:number,type:string,bytes:string|Buffer) {
  res.writeHead(status,{'Content-Type':type.startsWith('image') ? type : type+'; charset=utf-8'});
  res.end(bytes);
}
if (import.meta.main) {
  const config = loadConfig();
  const urls = (process.env.FUNDED_READ_RPC ?? '').split(',').map(v=>v.trim()).filter(Boolean);
  const store = new Store(process.env.FUNDED_DB ?? 'funded.sqlite');
  const ledger = config.databaseUrl ? await PgLedger.connect(config.databaseUrl) : undefined;
  if (ledger) await ledger.migrate();
  const port = Number(process.env.PORT ?? '3100');
  app(store,urls.length ? new SolanaReader(urls) : undefined, ledger).listen(port,'127.0.0.1',()=>console.log('Funded local: http://127.0.0.1:'+port));
}
