import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Store } from './store.ts';
import { SolanaReader } from './solana.ts';

const pages = new Set(['/','/launch','/explore','/earnings','/payouts','/liquidity']);
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

export function app(store: Store, reader?: SolanaReader) {
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
      if (req.method === 'GET' && path === '/api/status') return json(200,{mode:'local_draft_only',launchEnabled:false,payoutEnabled:false,rpcConfigured:!!reader});
      if (req.method === 'GET' && path === '/api/payouts') return json(200,{mode:'local_draft_only',items:[]});
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
function send(res: ServerResponse,status:number,type:string,bytes:string|Buffer) {
  res.writeHead(status,{'Content-Type':type.startsWith('image') ? type : type+'; charset=utf-8'});
  res.end(bytes);
}
if (import.meta.main) {
  const urls = (process.env.FUNDED_READ_RPC ?? '').split(',').map(v=>v.trim()).filter(Boolean);
  const store = new Store(process.env.FUNDED_DB ?? 'funded.sqlite');
  const port = Number(process.env.PORT ?? '3100');
  app(store,urls.length ? new SolanaReader(urls) : undefined).listen(port,'127.0.0.1',()=>console.log('Funded draft-only: http://127.0.0.1:'+port));
}
