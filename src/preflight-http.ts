export class ProviderReadError extends Error {
  readonly status?: number;
  constructor(provider: string, status?: number) {
    super(status === undefined ? `${provider} read unavailable` : `${provider} returned HTTP ${status}`);
    this.status = status;
  }
}

export function object(input: unknown): Record<string,unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid object');
  return input as Record<string,unknown>;
}

export async function providerJson(provider: string, url: URL, transport: typeof fetch, headers: Record<string,string> = {}) {
  let response: Response;
  try {
    response = await transport(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(6000),headers:{accept:'application/json',...headers}});
  } catch { throw new ProviderReadError(provider); }
  if (!response.ok) {
    await response.body?.cancel().catch(()=>{});
    throw new ProviderReadError(provider,response.status);
  }
  if (!response.body) throw new ProviderReadError(provider);
  const stream = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const {done,value} = await stream.read();
      if (done) break;
      total += value.length;
      if (total > 256_000) throw Error('Response too large');
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,total))) as unknown;
  } catch {
    void stream.cancel().catch(()=>{});
    throw new ProviderReadError(provider);
  } finally { stream.releaseLock(); }
}
