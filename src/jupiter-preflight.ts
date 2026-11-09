import { address, amount, guardQuote, NATIVE, SOLANA_USDC } from './domain.ts';
import { object, providerJson, ProviderReadError } from './preflight-http.ts';

export const WRAPPED_SOL = 'So11111111111111111111111111111111111111112';
const U64_MAX = (1n<<64n)-1n;
type Policy = {
  assets: ReadonlySet<string>; pools: ReadonlySet<string>; topLevelPrograms: ReadonlySet<string>;
  slippageBps: number; maxImpactBps: number; maxAgeMs: number; referenceMinNet: string;
};

// Quote inspection only. Provider instruction bodies are neither returned nor executed.
export async function jupiterPreflight(input: {asset:string; units:string; taker:string}, policy: Policy,
    options: {transport?:typeof fetch; apiKey?:string; clock?:()=>number} = {}) {
  const taker = address(input.taker), units = amount(input.units);
  const mint = input.asset === NATIVE ? WRAPPED_SOL : address(input.asset);
  if (!policy.assets.has(input.asset) || units <= 0n || units > U64_MAX) return {status:'held_unapproved_asset_or_amount',executionAuthorized:false};
  if (input.asset === SOLANA_USDC) return {status:'already_solana_usdc',units:input.units,executionAuthorized:false};
  const {slippageBps,maxImpactBps,maxAgeMs} = policy;
  const min = amount(policy.referenceMinNet);
  if (![slippageBps,maxImpactBps].every(n=>Number.isInteger(n)&&n>=0&&n<=500) ||
      !Number.isInteger(maxAgeMs) || maxAgeMs<1 || maxAgeMs>6000 || min<=0n || !policy.pools.size || !policy.topLevelPrograms.size) throw Error('Invalid swap preflight policy');
  const clock = options.clock ?? Date.now;
  const url = new URL('https://api.jup.ag/swap/v2/build');
  url.search = new URLSearchParams({inputMint:mint,outputMint:SOLANA_USDC,amount:input.units,taker,slippageBps:String(slippageBps),
    wrapAndUnwrapSol:String(input.asset===NATIVE),platformFeeBps:'0'}).toString();
  const started = clock();
  let response: unknown;
  try {
    response = await providerJson('Jupiter',url,options.transport ?? fetch,options.apiKey ? {'x-api-key':options.apiKey} : {});
  } catch (e) {
    if (e instanceof ProviderReadError) return {status:'held_provider_unavailable',httpStatus:e.status ?? null,executionAuthorized:false};
    throw e;
  }
  try {
    const q = object(response);
    if (q.swapMode !== 'ExactIn' || q.slippageBps !== slippageBps || q.inputMint !== mint || q.outputMint !== SOLANA_USDC ||
        q.inAmount !== input.units || typeof q.outAmount !== 'string' || typeof q.otherAmountThreshold !== 'string' ||
        amount(q.outAmount)>U64_MAX) throw Error('Quote does not match exact input');
    if (typeof q.priceImpactPct !== 'string' || !/^\d{1,3}(?:\.\d{1,64})?$/.test(q.priceImpactPct)) throw Error('Missing price impact');
    const [whole,fraction=''] = q.priceImpactPct.split('.');
    const scale = 10n**BigInt(fraction.length);
    if (BigInt(whole+fraction)*10_000n > BigInt(maxImpactBps)*scale) throw Error('Price impact exceeds policy');
    if (!Array.isArray(q.routePlan) || q.routePlan.length!==1) throw Error('Only single-hop routes are supported');
    const hop = object(q.routePlan[0]), pool = object(hop.swapInfo);
    if (hop.bps!==10_000 || (hop.percent!==undefined && hop.percent!==100) ||
        pool.inputMint!==mint || pool.outputMint!==SOLANA_USDC || pool.inAmount!==q.inAmount || pool.outAmount!==q.outAmount ||
        !policy.pools.has(address(pool.ammKey))) throw Error('Route does not match an approved pool');
    const programIds = [address(object(q.swapInstruction).programId)];
    for (const field of ['setupInstructions','computeBudgetInstructions','otherInstructions']) {
      const instructions = q[field];
      if (!Array.isArray(instructions) || instructions.length>32) throw Error('Invalid instruction list');
      for (const ix of instructions) programIds.push(address(object(ix).programId));
    }
    if (q.tipInstruction != null) throw Error('Unexpected tip instruction');
    if (q.cleanupInstruction != null) programIds.push(address(object(q.cleanupInstruction).programId));
    const floor = guardQuote({inputMint:mint,outputMint:SOLANA_USDC,inAmount:input.units,outAmount:q.outAmount,
      otherAmountThreshold:q.otherAmountThreshold,routeProgramIds:programIds,quotedAt:started},{inputMint:mint,units,slippageBps,
      referenceMinNet:min,allowedPrograms:new Set(policy.topLevelPrograms),now:clock(),maxAgeMs,mintApproved:true});
    return {status:'quote_only',expectedUsdcUnits:q.outAmount,minimumUsdcUnits:floor.toString(),pool:pool.ammKey,executionAuthorized:false};
  } catch(e) { return {status:'held_quote_rejected',reason:e instanceof Error?e.message:'Invalid provider response',executionAuthorized:false}; }
}
