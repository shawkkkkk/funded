import { address, FLOAT, LAUNCHLAB } from './domain.ts';

export const READ_METHODS = ['getTransaction','getAccountInfo','getSignaturesForAddress','getGenesisHash'] as const;
type ReadMethod = typeof READ_METHODS[number];
type Fetch = typeof fetch;
export class SolanaReader {
  urls: URL[];
  transport: Fetch;
  constructor(urls: string[], transport: Fetch = fetch) {
    this.urls = urls.map(v => {
      const url = new URL(v);
      if (url.protocol !== 'https:') throw Error('RPC must use HTTPS');
      return url;
    });
    if (!this.urls.length) throw Error('RPC required');
    this.transport = transport;
  }
  async read(method: ReadMethod, params: unknown[]) {
    if (!READ_METHODS.includes(method)) throw Error('Mutating RPC disabled');
    for (const url of this.urls) {
      try {
        const res = await this.transport(url, {
          method:'POST', headers:{'content-type':'application/json'},
          body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),
          redirect:'error', signal:AbortSignal.timeout(4500)
        });
        if (!res.ok) continue;
        const data = await res.json();
        if (data.id === 1 && 'result' in data && !data.error) return data.result;
      } catch { /* Read-only requests can safely fail over. */ }
    }
    throw Error('Solana RPC unavailable');
  }
  async recentFloatSignatures() {
    return this.read('getSignaturesForAddress',[FLOAT,{commitment:'finalized',limit:15}]);
  }
  async finalizedTransaction(signature: string) {
    if (!/^[1-9A-HJ-NP-Za-km-z]{80,88}$/.test(signature)) throw Error('Invalid signature');
    return this.read('getTransaction',[signature,{encoding:'jsonParsed',commitment:'finalized',maxSupportedTransactionVersion:0}]);
  }
  async inspect(signature: string) {
    const tx = await this.finalizedTransaction(signature);
    if (!tx) return { signature, status:'not_found' };
    const outer = tx.transaction?.message?.instructions ?? [];
    const calls = (tx.meta?.innerInstructions ?? []) as {index:number;instructions:{programId:string}[]}[];
    return {
      signature, status:tx.meta?.err === null ? 'finalized_success' : 'failed_or_incomplete', slot:tx.slot,
      floatOuterInstruction:outer.some((i:{programId:string}) => i.programId === FLOAT),
      launchLabUnderFloat:calls.some(c => outer[c.index]?.programId === FLOAT && c.instructions.some(i => i.programId === LAUNCHLAB)),
      verifiedFundedLaunch:false
    };
  }
  async mintOwner(mint: string) {
    const result = await this.read('getAccountInfo',[address(mint),{commitment:'finalized',encoding:'jsonParsed'}]);
    const acc = result?.value;
    if (!acc || acc.data?.parsed?.type !== 'mint') return null;
    return { mint, tokenProgram:acc.owner, info:acc.data.parsed.info };
  }
}
