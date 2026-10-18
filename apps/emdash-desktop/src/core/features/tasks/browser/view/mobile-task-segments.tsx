import { cn } from '@core/primitives/styling/browser/cn';
import {
  mobileTaskSegmentItems,
  segmentForMobileSurface,
  type MobileTaskSurface,
} from './mobile-task-surfaces';

export type { MobileTaskSurface } from './mobile-task-surfaces';

/** Three-segment control (Chat · Cambios · Terminal) under the mobile task header. */
export function MobileTaskSegments({
  active,
  onSelect,
  linesAdded = 0,
}: {
  active: MobileTaskSurface;
  onSelect: (surface: MobileTaskSurface) => void;
  /** Added lines in the working tree; shown as a badge on "Cambios" when positive. */
  linesAdded?: number;
}) {
  const activeSegment = segmentForMobileSurface(active);
  return (
    <nav
      aria-label="Secciones de la tarea"
      className="mx-3 mb-2 grid shrink-0 grid-cols-3 gap-1 rounded-xl border border-border bg-background-1 p-1"
    >
      {mobileTaskSegmentItems.map(({ id, label, surface }) => {
        const selected = activeSegment === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(surface)}
            className={cn(
              'flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-foreground-muted',
              selected
                ? 'bg-background-2 text-foreground'
                : 'text-foreground-muted active:bg-background-2/70 active:text-foreground'
            )}
          >
            <span className="truncate">{label}</span>
            {id === 'changes' && linesAdded > 0 && (
              <span className="rounded-full bg-background-success px-1.5 font-mono text-[11px] text-foreground-diff-added">
                <span className="sr-only">{linesAdded} líneas agregadas</span>
                <span aria-hidden="true">+{linesAdded}</span>
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
