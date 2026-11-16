export function alerts(input: { paused: boolean; unbalanced: boolean; oldestAwaitingBuyerMs: number | null; maxWaitMs: number }) {
  const rows: { kind: string; severity: 'info' | 'ticket' | 'page' }[] = [];
  if (input.paused) rows.push({ kind: 'paused', severity: 'info' });
  if (input.unbalanced) rows.push({ kind: 'journal_imbalance', severity: 'page' });
  if (input.oldestAwaitingBuyerMs !== null && input.oldestAwaitingBuyerMs > input.maxWaitMs) rows.push({ kind: 'stale_peer_order', severity: 'ticket' });
  return rows;
}
