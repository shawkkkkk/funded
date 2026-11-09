import { jupiterPreflight } from './jupiter-preflight.ts';

type Policy = Parameters<typeof jupiterPreflight>[1];

/** Quote inspection only. The returned plan cannot be executed. */
export async function planConversion(input: { asset: string; units: string; taker: string }, policy: Policy, options: Parameters<typeof jupiterPreflight>[2] = {}) {
  const quote = await jupiterPreflight(input, policy, options);
  return { ...quote, swaps: false, executionAuthorized: false as const };
}
