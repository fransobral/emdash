import { Check, ChevronRight } from 'lucide-react';
import { cn } from '@core/primitives/styling/browser/cn';
import {
  formatRelativeTime,
  type MobileHomeGroupId,
  type MobileHomeRow,
} from './mobile-home-model';

type RowProps = {
  row: MobileHomeRow;
  now: number;
  onOpen: (row: MobileHomeRow) => void;
};

function DiffCounts({ row }: { row: MobileHomeRow }) {
  if (row.linesAdded + row.linesDeleted === 0) return null;
  return (
    <span className="font-mono">
      <span className="text-foreground-diff-added">+{row.linesAdded}</span>{' '}
      <span className="text-foreground-diff-deleted">−{row.linesDeleted}</span>
    </span>
  );
}

function AttentionCard({ row, now, onOpen }: RowProps) {
  return (
    <button
      type="button"
      onClick={() => onOpen(row)}
      className="flex min-h-11 w-full items-start gap-3 rounded-2xl border border-foreground-warning/40 bg-background-warning p-3.5 text-left focus-visible:outline-2 focus-visible:outline-foreground-warning"
    >
      <span
        aria-hidden="true"
        className="mt-1.5 size-2 shrink-0 rounded-full bg-foreground-warning"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-xs text-foreground-muted">{row.projectName}</span>
        <span className="text-[15px] leading-snug font-medium text-foreground">{row.title}</span>
        <span className="text-sm text-foreground-warning">{row.activity}</span>
        <span className="text-xs text-foreground-passive">
          {[row.agentLabel, formatRelativeTime(row.timestamp, now)].filter(Boolean).join(' · ')}
        </span>
      </span>
      <span className="self-center rounded-full bg-foreground-warning px-3 py-1.5 text-[13px] font-medium text-background">
        Revisar
      </span>
    </button>
  );
}

function CompactRow({
  row,
  now,
  onOpen,
  group,
}: RowProps & { group: Exclude<MobileHomeGroupId, 'attention'> }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(row)}
      className="flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-foreground-muted active:bg-background-1"
    >
      {group === 'working' ? (
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-full bg-foreground-info shadow-[0_0_0_4px_color-mix(in_srgb,var(--em-foreground-info)_18%,transparent)]"
        />
      ) : (
        <Check aria-hidden="true" className="size-4 shrink-0 text-foreground-success" />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[15px] font-medium text-foreground">{row.title}</span>
        <span className="truncate text-[13px] text-foreground-muted">
          {row.projectName} · {group === 'review' ? <DiffOrActivity row={row} /> : row.activity}
          {row.agentLabel ? ` · ${row.agentLabel}` : ''}
        </span>
      </span>
      {group === 'working' ? (
        <span className="shrink-0 font-mono text-xs text-foreground-passive">
          {formatRelativeTime(row.timestamp, now, 'short')}
        </span>
      ) : (
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-foreground-passive" />
      )}
    </button>
  );
}

function DiffOrActivity({ row }: { row: MobileHomeRow }) {
  return row.linesAdded + row.linesDeleted > 0 ? <DiffCounts row={row} /> : <>{row.activity}</>;
}

export function MobileHomeSection({
  id,
  label,
  rows,
  now,
  onOpen,
}: {
  id: MobileHomeGroupId;
  label: string;
  rows: readonly MobileHomeRow[];
  now: number;
  onOpen: (row: MobileHomeRow) => void;
}) {
  const headingId = `mobile-home-${id}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h2
        id={headingId}
        className={cn(
          'px-2 pb-1 text-xs font-medium tracking-[0.08em] uppercase',
          id === 'attention' ? 'text-foreground-warning' : 'text-foreground-muted'
        )}
      >
        {label} · {rows.length}
      </h2>
      <ul className={cn('flex flex-col', id === 'attention' ? 'gap-2' : 'gap-0.5')}>
        {rows.map((row) => (
          <li key={row.taskId}>
            {id === 'attention' ? (
              <AttentionCard row={row} now={now} onOpen={onOpen} />
            ) : (
              <CompactRow row={row} now={now} onOpen={onOpen} group={id} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
