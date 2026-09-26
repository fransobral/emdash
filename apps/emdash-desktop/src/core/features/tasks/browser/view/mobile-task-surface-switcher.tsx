import { FileDiff, FolderOpen, MessagesSquare, SquareTerminal } from 'lucide-react';
import { cn } from '@core/primitives/styling/browser/cn';
import { mobileTaskSurfaceItems, type MobileTaskSurface } from './mobile-task-surfaces';

export type { MobileTaskSurface } from './mobile-task-surfaces';

const icons = {
  workspace: MessagesSquare,
  sessions: SquareTerminal,
  files: FolderOpen,
  changes: FileDiff,
} satisfies Record<MobileTaskSurface, typeof MessagesSquare>;

export function MobileTaskSurfaceSwitcher({
  active,
  onSelect,
}: {
  active: MobileTaskSurface;
  onSelect: (surface: MobileTaskSurface) => void;
}) {
  return (
    <nav
      aria-label="Task surfaces"
      className="grid shrink-0 grid-cols-4 gap-1 border-t border-border bg-background px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]"
    >
      {mobileTaskSurfaceItems.map(({ id, label }) => {
        const Icon = icons[id];
        const selected = active === id;
        return (
          <button
            key={id}
            type="button"
            aria-label={label}
            aria-pressed={selected}
            onClick={() => onSelect(id)}
            className={cn(
              'flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[11px] font-medium transition-colors',
              selected
                ? 'bg-surface-raised text-foreground'
                : 'text-foreground-muted active:bg-surface-raised/70 active:text-foreground'
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            <span className="truncate">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
