import { address, amount, SOLANA_USDC } from './domain.ts';
import { validSignature } from './solana.ts';
import { object, providerJson, ProviderReadError } from './preflight-http.ts';

const SOLANA_DOMAIN=5, BASE_DOMAIN=6, FINALIZED=2000, CCTP_V2=1;
const ZERO=Buffer.alloc(32), U64_MAX=(1n<<64n)-1n;
type Intent = { signature:string; senderProgram:string; baseMessenger:string; sourceWallet:string;
  baseRecipient:string; burnUnits:string; maxFeeUnits:string; minimumNetUnits:string };

function solanaBytes(value: string) {
  const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n=0n;
  for (const c of address(value)) n=n*58n+BigInt(alphabet.indexOf(c));
  return Buffer.from(n.toString(16).padStart(64,'0'),'hex');
}
function evmBytes(value: string) {
  if (typeof value!=='string' || !/^0x[0-9a-f]{40}$/i.test(value)) throw Error('Invalid EVM address');
  const bytes=Buffer.from(value.slice(2).padStart(64,'0'),'hex');
  if (bytes.equals(ZERO)) throw Error('Zero EVM address');
  return bytes;
}
const u256=(b:Buffer)=>BigInt('0x'+b.toString('hex'));

// Reads an existing burn only. A match is not signature verification or Base delivery.
export async function cctpPreflight(intent: Intent, transport: typeof fetch = fetch) {
  if (!validSignature(intent.signature)) throw Error('Invalid Solana burn signature');
  const sender=solanaBytes(intent.senderProgram), messenger=evmBytes(intent.baseMessenger), wallet=solanaBytes(intent.sourceWallet), recipient=evmBytes(intent.baseRecipient);
  const burn=amount(intent.burnUnits), maxFee=amount(intent.maxFeeUnits), minimum=amount(intent.minimumNetUnits);
  if (sender.equals(ZERO)||wallet.equals(ZERO)||burn<=0n||burn>U64_MAX||minimum<=0n||minimum>burn||maxFee>burn-minimum) throw Error('Invalid burn amount or fee policy');
  const url=new URL(`https://iris-api.circle.com/v2/messages/${SOLANA_DOMAIN}`);
  url.searchParams.set('transactionHash',intent.signature);
  let response: unknown;
  try { response=await providerJson('Circle Iris',url,transport); }
  catch(e) {
    if (!(e instanceof ProviderReadError)) throw e;
    return {status:e.status===404?'awaiting_attestation':'held_provider_unavailable',httpStatus:e.status??null,baseSettlementVerified:false};
  }
  try {
    const payload=object(response);
    if (payload.sourceTxHash!==intent.signature || !Array.isArray(payload.messages) || payload.messages.length>1) throw Error('Unrelated or ambiguous burn response');
    if (payload.messages.length===0) return {status:'awaiting_attestation',baseSettlementVerified:false};
    const row=object(payload.messages[0]);
    if (row.cctpVersion!==2) throw Error('Unexpected CCTP version');
    if (row.status==='pending' || row.status==='pending_confirmations') return {status:'awaiting_attestation',baseSettlementVerified:false};
    if (row.status!=='complete' || typeof row.attestation!=='string' || !/^0x(?:[0-9a-f]{130}){1,20}$/i.test(row.attestation) ||
        typeof row.message!=='string' || !/^0x[0-9a-f]{752}$/i.test(row.message)) throw Error('Missing attestation or unsupported message shape');
    const b=Buffer.from(row.message.slice(2),'hex');
    const nonce=b.subarray(12,44);
    if (b.readUInt32BE(0)!==CCTP_V2||b.readUInt32BE(4)!==SOLANA_DOMAIN||b.readUInt32BE(8)!==BASE_DOMAIN||nonce.equals(ZERO)||
        !b.subarray(44,76).equals(sender)||!b.subarray(76,108).equals(messenger)||!b.subarray(108,140).equals(ZERO)||
        b.readUInt32BE(140)!==FINALIZED||b.readUInt32BE(144)!==FINALIZED||b.readUInt32BE(148)!==CCTP_V2||
        !b.subarray(152,184).equals(solanaBytes(SOLANA_USDC))||!b.subarray(184,216).equals(recipient)||
        u256(b.subarray(216,248))!==burn||!b.subarray(248,280).equals(wallet)||u256(b.subarray(280,312))!==maxFee) throw Error('Message does not match the pinned standard transfer');
    const fee=u256(b.subarray(312,344));
    if (fee>maxFee||burn-fee<minimum) throw Error('Bridge fee exceeds policy');
    return {status:'attestation_reported',signature:intent.signature,nonce:'0x'+nonce.toString('hex'),
      expectedNetUnits:(burn-fee).toString(),feeUnits:fee.toString(),signatureVerified:false,baseSettlementVerified:false};
  } catch(e) { return {status:'held_attestation_rejected',reason:e instanceof Error?e.message:'Invalid provider response',baseSettlementVerified:false}; }
}
