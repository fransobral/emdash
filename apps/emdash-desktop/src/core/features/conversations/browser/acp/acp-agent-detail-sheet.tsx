import { BrailleSpinner } from '@emdash/ui/react/components';
import { Button, Sheet } from '@emdash/ui/react/primitives';
import { Check, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { deriveAgentActivity, type AgentActivityRow } from './acp-agent-detail-model';
import { toolCallItemId } from './acp-agents-tray';
import { formatElapsed, type AgentTrayRow } from './acp-agents-tray-model';
import type { AcpChatStore } from './acp-chat-store';

function RowStatusGlyph({ status }: { status: AgentTrayRow['status'] }) {
  if (status === 'running') return <BrailleSpinner />;
  if (status === 'completed') return <Check className="text-success size-3" />;
  return <X className="text-destructive size-3" />;
}

function ActivityStatusGlyph({ status }: { status: AgentActivityRow['status'] }) {
  if (status === 'running') return <BrailleSpinner />;
  if (status === 'error') return <X className="text-destructive size-3" />;
  return <Check className="text-success size-3" />;
}

function ActivityRow({ row }: { row: AgentActivityRow }) {
  return (
    <div className="flex items-center gap-2 border-b border-border py-1.5 text-xs last:border-b-0">
      <span className="shrink-0">
        <ActivityStatusGlyph status={row.status} />
      </span>
      <span className="shrink-0 text-foreground-muted">{row.kindLabel}</span>
      <span className="min-w-0 flex-1 truncate" title={row.title}>
        {row.title}
      </span>
    </div>
  );
}

const AcpAgentDetailSheetContent = observer(function AcpAgentDetailSheetContent({
  row,
  store,
  onViewInTranscript,
}: {
  row: AgentTrayRow;
  store: AcpChatStore;
  onViewInTranscript: (() => void) | null;
}) {
  // `row` is recomputed by the tray on its own tick and re-passed down, so
  // `row.elapsedMs` stays current without a second ticking interval here.
  const activity = deriveAgentActivity(store.activeAgentTurn, row.launchTurnId, row.toolCallId);

  return (
    <>
      <Sheet.Header>
        <Sheet.Title>{row.name}</Sheet.Title>
      </Sheet.Header>
      <Sheet.Body>
        <div className="flex items-center gap-2 text-xs text-foreground-muted">
          <RowStatusGlyph status={row.status} />
          <span className="capitalize">{row.status}</span>
          {row.background && <span>· background</span>}
          <span className="tabular-nums">{formatElapsed(row.elapsedMs)}</span>
        </div>
        {row.summary && <p className="mt-2 text-xs text-foreground-muted">{row.summary}</p>}
        <div className="mt-4">
          <p className="mb-1 text-xs font-medium text-foreground-muted">Activity</p>
          {activity.rows.length > 0 ? (
            <div className="rounded-md border border-border px-2">
              {activity.rows.map((activityRow) => (
                <ActivityRow key={activityRow.id} row={activityRow} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-foreground-muted">
              {activity.available
                ? 'No activity recorded for this agent yet.'
                : 'Live activity for this agent is no longer available — it finished in an earlier turn.'}
            </p>
          )}
        </div>
      </Sheet.Body>
      {onViewInTranscript && (
        <Sheet.Footer>
          <Button variant="ghost" onClick={onViewInTranscript}>
            View in transcript
          </Button>
        </Sheet.Footer>
      )}
    </>
  );
});

/**
 * Detail view for a single agents-tray row: status, elapsed time, final
 * summary, and the agent's own recent tool-call activity (newest at the
 * bottom), read live from the active turn so it keeps updating while the
 * agent runs — no polling needed.
 */
export function AcpAgentDetailSheet({
  row,
  store,
  onClose,
}: {
  row: AgentTrayRow | null;
  store: AcpChatStore;
  onClose: () => void;
}) {
  const launchTurnId = row?.launchTurnId ?? null;
  const toolCallId = row?.toolCallId;
  const handleViewInTranscript =
    launchTurnId !== null && toolCallId !== undefined
      ? () => {
          store.scrollToItem(toolCallItemId(launchTurnId, toolCallId));
          onClose();
        }
      : null;

  return (
    <Sheet.Root open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <Sheet.Content side="right" className="flex flex-col gap-0">
        {row && (
          <AcpAgentDetailSheetContent
            row={row}
            store={store}
            onViewInTranscript={handleViewInTranscript}
          />
        )}
      </Sheet.Content>
    </Sheet.Root>
  );
}
