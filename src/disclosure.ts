import { CONFIG_PIN } from './float-program.ts';

/** Reporting split of Float's own fee. Dust stays out of the creator figure. This is not a decode of the program's rounding. */
export function splitFloatFee(units: bigint) {
  if (units < 0n) throw Error('Negative fee');
  const take = (bps: number) => units * BigInt(bps) / 10_000n;
  const holders = take(CONFIG_PIN.split.holders);
  const creator = take(CONFIG_PIN.split.creator);
  const flagship = take(CONFIG_PIN.split.flagship);
  const traders = take(CONFIG_PIN.split.traders);
  const treasuryFloor = take(CONFIG_PIN.split.treasury);
  const dust = units - (holders + creator + flagship + traders + treasuryFloor);
  return { holders, creator, flagship, traders, treasury: treasuryFloor + dust, dust };
}

export function disclose(input: {
  quoteUnits: bigint;
  convertedUsdc: bigint | null;
  bridgeFeeUsdc: bigint | null;
  deliveredUsdMicros: bigint;
  pendingUsdc: bigint;
  fiatVerified: boolean;
}) {
  if (input.deliveredUsdMicros < 0n || input.pendingUsdc < 0n) throw Error('Negative settlement');
  if (input.bridgeFeeUsdc !== null && input.bridgeFeeUsdc < 0n) throw Error('Negative bridge fee');
  const split = splitFloatFee(input.quoteUnits);
  const verified = input.fiatVerified && input.pendingUsdc === 0n && input.deliveredUsdMicros > 0n && input.convertedUsdc !== null;
  return {
    originalQuoteUnits: input.quoteUnits.toString(),
    creatorUnits: split.creator.toString(),
    roundingDustUnits: split.dust.toString(),
    convertedUsdc: input.convertedUsdc === null ? null : input.convertedUsdc.toString(),
    bridgeFeeUsdc: input.bridgeFeeUsdc === null ? null : input.bridgeFeeUsdc.toString(),
    lpDiscountBps: null,
    spreadBps: 0,
    deliveredUsdMicros: verified ? input.deliveredUsdMicros.toString() : '0',
    pendingUsdc: input.pendingUsdc.toString(),
    paymentComplete: verified
  };
}
