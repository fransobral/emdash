/** Elapsed time as m:ss, e.g. 24_000 → "0:24", 125_000 → "2:05". Negative input clamps to 0. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
