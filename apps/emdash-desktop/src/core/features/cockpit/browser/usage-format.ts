const tokenFormatter = new Intl.NumberFormat('es-AR', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const usdFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

export function formatTokens(count: number): string {
  return tokenFormatter.format(count);
}

export function formatUsd(amount: number): string {
  return usdFormatter.format(amount);
}

export function formatDurationMinutes(startedAt: number | null, endedAt: number | null): string {
  if (startedAt === null || endedAt === null) return '—';
  const minutes = Math.max(0, Math.round((endedAt - startedAt) / 60_000));
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
