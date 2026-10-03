import { BrailleSpinner } from '@emdash/ui/react/components';
import { Button } from '@emdash/ui/react/primitives';
import { Check, ChevronDown, ChevronUp, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';
import { AcpAgentDetailSheet } from './acp-agent-detail-sheet';
import {
  deriveAgentsTray,
  findAgentRow,
  formatElapsed,
  type AgentTrayRow,
} from './acp-agents-tray-model';
import type { AcpChatStore } from './acp-chat-store';

const TICK_MS = 1_000;

/**
 * Mirrors `makeToolId` from `@emdash/core/runtimes/acp/api/reducer/ids`
 * (`${turnId}:tool:${toolCallId}`) without importing the reducer module —
 * that module also pulls in transcript parsing, which the renderer bundle
 * does not otherwise need.
 */
export function toolCallItemId(launchTurnId: string, toolCallId: string): string {
  return `${launchTurnId}:tool:${toolCallId}`;
}

function CollapsedSummary({
  counts,
}: {
  counts: { running: number; completed: number; failed: number };
}) {
  const parts: React.ReactNode[] = [];
  if (counts.running > 0) {
    parts.push(
      <span key="running" className="inline-flex items-center gap-1">
        <BrailleSpinner />
        {counts.running} running
      </span>
    );
  }
  if (counts.completed > 0) {
    parts.push(
      <span key="completed" className="text-success inline-flex items-center gap-1">
        <Check className="size-3" />
        {counts.completed}
      </span>
    );
  }
  if (counts.failed > 0) {
    parts.push(
      <span key="failed" className="text-destructive inline-flex items-center gap-1">
        <X className="size-3" />
        {counts.failed}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2 text-xs text-foreground-muted">
      {parts.map((part, index) => (
        <span key={index} className="flex items-center gap-2">
          {index > 0 && <span aria-hidden>·</span>}
          {part}
        </span>
      ))}
    </span>
  );
}

function RowStatusGlyph({ status }: { status: AgentTrayRow['status'] }) {
  if (status === 'running') return <BrailleSpinner />;
  if (status === 'completed') return <Check className="text-success size-3" />;
  return <X className="text-destructive size-3" />;
}

function AgentRow({
  row,
  onActivate,
}: {
  row: AgentTrayRow;
  onActivate: ((row: AgentTrayRow) => void) | null;
}) {
  const content = (
    <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
      <span className="shrink-0">
        <RowStatusGlyph status={row.status} />
      </span>
      <span className="min-w-0 flex-1 truncate" title={row.name}>
        {row.name}
        {row.background && <span className="text-foreground-muted"> (background)</span>}
      </span>
      {row.summary && (
        <span className="max-w-[16ch] min-w-0 truncate text-foreground-muted" title={row.summary}>
          {row.summary}
        </span>
      )}
      <span className="shrink-0 text-foreground-muted tabular-nums">
        {formatElapsed(row.elapsedMs)}
      </span>
    </div>
  );

  if (!onActivate) {
    return <div className="flex items-center gap-2 px-2 py-1 text-xs">{content}</div>;
  }

  return (
    <Button
      variant="ghost"
      className="w-full justify-start gap-2 px-2 py-1 text-xs"
      onClick={() => onActivate(row)}
    >
      {content}
    </Button>
  );
}

/**
 * Compact tray pinned above the composer summarizing in-flight and recently
 * finished subagent launches for the active turn. Collapsed by default to a
 * single status line; expands to a running-first, newest-first list.
 */
export const AcpAgentsTray = observer(function AcpAgentsTray({ store }: { store: AcpChatStore }) {
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const agents = store.agentRuns;
  const hasRunning = agents.some((agent) => agent.status === 'running');

  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [hasRunning]);

  const snapshot = useMemo(() => deriveAgentsTray(agents, now), [agents, now]);
  // Looked up from the full agent list (not just the visible snapshot rows) so
  // the detail sheet stays open and current even once the agent drops out of
  // the tray's visible set (e.g. a newer batch launches while it's open).
  const selectedRow = findAgentRow(agents, selectedAgentId, now);

  if (!snapshot.visible) return null;

  return (
    <>
      <div className="mx-3 mb-1 overflow-hidden rounded-md border border-border">
        <Button
          variant="ghost"
          className="flex w-full items-center justify-between gap-2 px-2 py-1 text-xs"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="flex items-center gap-2">
            <span className="text-foreground-muted">Agents</span>
            <CollapsedSummary counts={snapshot.counts} />
          </span>
          {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        </Button>
        {expanded && (
          <div className="max-h-48 overflow-y-auto border-t border-border">
            {snapshot.rows.map((row) => (
              <AgentRow
                key={row.agentId}
                row={row}
                onActivate={() => setSelectedAgentId(row.agentId)}
              />
            ))}
          </div>
        )}
      </div>
      <AcpAgentDetailSheet
        row={selectedRow}
        store={store}
        onClose={() => setSelectedAgentId(null)}
      />
    </>
  );
});
