import { readFile } from 'node:fs/promises';
import { address, NATIVE } from './domain.ts';
import { jupiterPreflight } from './jupiter-preflight.ts';
import { cctpPreflight } from './cctp-preflight.ts';
import { object } from './preflight-http.ts';

function addresses(input: unknown, allowNative=false) {
  if (!Array.isArray(input) || input.length>200) throw Error('Expected a bounded policy list');
  return new Set(input.map(v=>allowNative && v===NATIVE ? NATIVE : address(v)));
}
function required(input: unknown) {
  if (typeof input!=='string'||!input) throw Error('Missing preflight input');
  return input;
}
function integer(input: unknown) {
  if (typeof input!=='number'||!Number.isSafeInteger(input)) throw Error('Expected integer policy value');
  return input;
}
if (import.meta.main) {
  try {
    const [mode,path,...more]=process.argv.slice(2);
    if ((mode!=='swap' && mode!=='bridge')||!path||more.length) throw Error('Usage: npm run preflight -- swap|bridge <private-input.json>');
    const v=object(JSON.parse(await readFile(path,'utf8')));
    let result;
    if (mode==='swap') {
      const p=object(v.policy);
      result=await jupiterPreflight({asset:required(v.asset),units:required(v.units),taker:required(v.taker)},
        {assets:addresses(p.assets,true),pools:addresses(p.pools),topLevelPrograms:addresses(p.topLevelPrograms),
          slippageBps:integer(p.slippageBps),maxImpactBps:integer(p.maxImpactBps),maxAgeMs:integer(p.maxAgeMs),referenceMinNet:required(p.referenceMinNet)},
        {apiKey:process.env.FUNDED_JUPITER_API_KEY});
    } else {
      result=await cctpPreflight({signature:required(v.signature),senderProgram:required(v.senderProgram),baseMessenger:required(v.baseMessenger),
        sourceWallet:required(v.sourceWallet),baseRecipient:required(v.baseRecipient),burnUnits:required(v.burnUnits),
        maxFeeUnits:required(v.maxFeeUnits),minimumNetUnits:required(v.minimumNetUnits)});
    }
    console.log(JSON.stringify(result,null,2));
    if (!['quote_only','already_solana_usdc','attestation_reported'].includes(result.status)) process.exitCode=2;
  } catch(e) {
    // JSON parse errors can echo private input; do not print them.
    console.error(e instanceof Error && !(e instanceof SyntaxError) ? e.message : 'Invalid preflight input');
    process.exitCode=1;
  }
}
