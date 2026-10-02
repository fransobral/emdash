import { Badge } from '@emdash/ui/react/primitives';

const AMBER_THRESHOLD = 80;
const RED_THRESHOLD = 95;

function toneFor(usedPercent: number): 'success' | 'warning' | 'error' {
  if (usedPercent >= RED_THRESHOLD) return 'error';
  if (usedPercent >= AMBER_THRESHOLD) return 'warning';
  return 'success';
}

function fillColor(tone: 'success' | 'warning' | 'error'): string {
  if (tone === 'error') return 'var(--em-foreground-error)';
  if (tone === 'warning') return 'var(--em-foreground-warning)';
  return 'var(--em-foreground-success)';
}

function formatResetTime(resetsAt: number | null): string | null {
  if (resetsAt === null) return null;
  return new Date(resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** One rate-limit window bar (5h or weekly), or a "no disponible" placeholder. */
export function UsageLimitBar({
  label,
  usedPercent,
  resetsAt,
}: {
  label: string;
  usedPercent: number | null;
  resetsAt?: number | null;
}) {
  if (usedPercent === null) {
    return (
      <div className="flex items-center justify-between gap-2 text-xs text-foreground-muted">
        <span>{label}</span>
        <span>no disponible</span>
      </div>
    );
  }

  const clamped = Math.min(100, Math.max(0, usedPercent));
  const tone = toneFor(clamped);
  const resetLabel = formatResetTime(resetsAt ?? null);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-xs text-foreground-muted">
        <span>{label}</span>
        <span className="flex items-center gap-1.5">
          {resetLabel ? <span>reinicia {resetLabel}</span> : null}
          {tone !== 'success' && <Badge tone={tone}>{Math.round(clamped)}%</Badge>}
          {tone === 'success' && (
            <span className="text-foreground tabular-nums">{Math.round(clamped)}%</span>
          )}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 w-full overflow-hidden rounded-full bg-background-2"
      >
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${clamped}%`, backgroundColor: fillColor(tone) }}
        />
      </div>
      {tone === 'error' && (
        <p className="text-xs text-foreground-error">
          {Math.round(clamped)}% de la ventana {label.toLowerCase()}
          {resetLabel ? ` — reinicia a las ${resetLabel}.` : '.'}
        </p>
      )}
    </div>
  );
}
