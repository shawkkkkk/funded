export function reconcile(input: { credited: bigint; attributed: bigint; paidUsdMicros: bigint }) {
  if (input.credited < 0n || input.attributed < 0n || input.paidUsdMicros < 0n) throw Error('Negative reconciliation');
  const drift = input.credited - input.attributed;
  return {
    drift: drift.toString(),
    balanced: drift === 0n,
    paidUsdMicros: input.paidUsdMicros.toString(),
    paymentComplete: false,
    alerts: drift === 0n ? [] : ['attribution_drift']
  };
}
