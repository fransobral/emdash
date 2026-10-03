import type {
  ToolCallItem,
  ToolNode,
  ToolStatus,
  TranscriptItem,
  TranscriptTurn,
} from '@emdash/core/runtimes/acp/api/client';

/**
 * One row of a background agent's own activity, flattened from the launch
 * tool call's `children` tree (its own nested tool calls).
 */
export type AgentActivityRow = {
  id: string;
  title: string;
  status: ToolStatus;
  kindLabel: string;
};

export type AgentActivitySnapshot = {
  /**
   * False when the agent's launch node can no longer be located in the live
   * active turn — most commonly because its launch turn already committed
   * (the user started a new turn and the agent's own turn is not held open).
   * The detail view falls back to showing only the agent's own status and
   * summary in that case; it is not a loading or error state.
   */
  available: boolean;
  rows: AgentActivityRow[];
};

/**
 * Derives a background agent's recent activity from the live active turn.
 *
 * Only the active turn is searched: the ACP session holds a turn open while
 * any subagent it spawned is still running (see `isHeldOpen` in the adapter),
 * so a running agent's launch node is reliably found here. Once that turn
 * commits, further per-agent activity is no longer live-observable from the
 * renderer (committed history is not a live Wire state), so `available` goes
 * false rather than silently showing a stale list.
 */
export function deriveAgentActivity(
  activeTurn: TranscriptTurn | null,
  launchTurnId: string | null,
  toolCallId: string
): AgentActivitySnapshot {
  if (!activeTurn || !launchTurnId || activeTurn.id !== launchTurnId) {
    return { available: false, rows: [] };
  }
  const launchNode = findToolCallItem(activeTurn.items, toolCallId);
  const children = launchNode?.children;
  if (!children?.length) return { available: true, rows: [] };
  return { available: true, rows: flattenToolNodes(children).map(toActivityRow) };
}

function isToolCallItem(item: TranscriptItem | ToolNode): item is ToolCallItem {
  return 'toolCallId' in item;
}

function itemChildren(item: TranscriptItem | ToolNode): readonly ToolNode[] | undefined {
  return 'children' in item ? item.children : undefined;
}

function findToolCallItem(
  items: readonly (TranscriptItem | ToolNode)[],
  toolCallId: string
): ToolCallItem | undefined {
  for (const item of items) {
    if (isToolCallItem(item) && item.toolCallId === toolCallId) return item;
    const children = itemChildren(item);
    if (children?.length) {
      const found = findToolCallItem(children, toolCallId);
      if (found) return found;
    }
  }
  return undefined;
}

/** Flattens tool-group wrappers and nested children into seq-ordered leaves. */
function flattenToolNodes(nodes: readonly ToolNode[]): ToolCallItem[] {
  const result: ToolCallItem[] = [];
  for (const node of nodes) {
    if (node.kind === 'tool-group') {
      result.push(...flattenToolNodes(node.children));
      continue;
    }
    result.push(node);
    if (node.children?.length) result.push(...flattenToolNodes(node.children));
  }
  return result.sort((a, b) => a.seq - b.seq);
}

function toActivityRow(item: ToolCallItem): AgentActivityRow {
  return { id: item.id, title: item.title, status: item.status, kindLabel: kindLabelFor(item) };
}

function kindLabelFor(item: ToolCallItem): string {
  switch (item.kind) {
    case 'execute-tool-call':
      return 'Shell';
    case 'read-tool-call':
      return 'Read';
    case 'create-file-tool-call':
      return 'Create file';
    case 'modify-file-tool-call':
      return 'Edit file';
    case 'delete-file-tool-call':
      return 'Delete file';
    case 'search-tool-call':
      return 'Search';
    case 'mcp-tool-call':
      return 'MCP tool';
    case 'web-fetch-tool-call':
      return 'Web fetch';
    case 'spawn-subagent-tool-call':
      return 'Agent';
    case 'create-plan-tool-call':
      return 'Plan';
    case 'unknown-tool-call':
      return item.name || 'Tool';
  }
}
