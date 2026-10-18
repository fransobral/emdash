import { useCompact } from '@components/contexts/CompactContext';
import { ROW_H } from '@components/engine/row-metrics';
import { defineUnit } from '@core/units';
import { formatElapsed } from '@state/format-elapsed';
import { Show, createSignal, onCleanup } from 'solid-js';
import type { WorkingItem } from '@/model';
import { workingDot, workingElapsed, workingRow } from './working.css';
import { vars } from '@styles/theme.css';

/** First time this client saw each running turn; survives row remounts and virtualization. */
const firstSeenAt = new Map<string, number>();

function startOf(id: string): number {
  const known = firstSeenAt.get(id);
  if (known !== undefined) return known;
  const now = Date.now();
  firstSeenAt.set(id, now);
  return now;
}

/** Compact only: pulsing dot, label and elapsed time while the agent works. */
function CompactWorking(props: { item: WorkingItem; rowH: number }) {
  const start = startOf(props.item.id);
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(timer));
  return (
    <div class={workingRow} style={{ height: `${props.rowH}px` }} role="status">
      <span class={workingDot} aria-hidden="true" />
      <span>Trabajando…</span>
      <span class={workingElapsed}>{formatElapsed(now() - start)}</span>
    </div>
  );
}

export const workingUnitDef = defineUnit<WorkingItem, { rowH: number }>({
  kind: 'working',
  margin: { top: 2, bottom: 2 },
  vars: { rowH: ROW_H },

  measure(_data, _ctx, vars_) {
    return vars_.rowH;
  },

  Render(props) {
    const compact = useCompact();
    return (
      <Show
        when={compact()}
        fallback={
          <div
            style={{
              height: `${props.vars.rowH}px`,
              display: 'flex',
              'align-items': 'center',
              color: vars.fgMuted,
              'font-size': '13px',
            }}
          >
            Working…
          </div>
        }
      >
        <CompactWorking item={props.data} rowH={props.vars.rowH} />
      </Show>
    );
  },
});
