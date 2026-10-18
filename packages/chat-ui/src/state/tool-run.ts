/**
 * tool-run — pure helpers behind the compact (mobile) transcript.
 *
 *   - `collectRunnableTools`   which turn items can join a run of tool calls
 *   - `summarizeToolRun`       one-line summaries per category ("Leyó 4 archivos")
 *   - `summarizeTurnChanges`   "N archivos cambiados +A −D" data for a turn
 *
 * Everything here is data in, data out: no Solid, no DOM, no measurement.
 * Copy lives in `TOOL_RUN_COPY` so a future i18n pass touches a single table.
 */

import { basename } from '@/lib/path';
import type { ToolNode, ToolStatus, TurnChangeFile } from '@/model';

// ── Copy ──────────────────────────────────────────────────────────────────────

export const TOOL_RUN_COPY = {
  read: (n: number, name: string | undefined) =>
    n === 1 && name ? `Leyó ${name}` : `Leyó ${n} archivos`,
  edit: (names: string) => `Editó ${names}`,
  create: (names: string) => `Creó ${names}`,
  delete: (names: string) => `Eliminó ${names}`,
  search: (n: number, query: string | undefined) =>
    n === 1 && query ? `Buscó “${query}”` : `Hizo ${n} búsquedas`,
  fetch: (n: number, target: string | undefined) =>
    n === 1 && target ? `Consultó ${target}` : `Consultó ${n} páginas`,
  other: (n: number, title: string | undefined) =>
    n === 1 && title ? title : `Usó ${n} herramientas`,
  more: (n: number) => `y ${n} más`,
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export type LeafToolNode = Exclude<ToolNode, { kind: 'tool-group' }>;

export type ToolRunLineKind = 'read' | 'edit' | 'delete' | 'search' | 'fetch' | 'execute' | 'other';

export type ToolRunLine = {
  /** Stable while the line grows (derived from its first member). */
  id: string;
  kind: ToolRunLineKind;
  label: string;
  /** running beats error beats done. */
  status: ToolStatus;
  awaitingPermission: boolean;
  members: readonly LeafToolNode[];
};

// ── Run membership ────────────────────────────────────────────────────────────

/** Leaf kinds that collapse into summary rows. Plans and subagents keep their own cards. */
function isRunnableLeaf(node: ToolNode): node is LeafToolNode {
  switch (node.kind) {
    case 'execute-tool-call':
    case 'read-tool-call':
    case 'create-file-tool-call':
    case 'modify-file-tool-call':
    case 'delete-file-tool-call':
    case 'search-tool-call':
    case 'mcp-tool-call':
    case 'web-fetch-tool-call':
    case 'unknown-tool-call':
      return !node.children || node.children.length === 0;
    default:
      return false;
  }
}

/**
 * Leaf tools a turn item contributes to a run, or null when the item cannot
 * join one. A core `tool-group` is folded away (its children join the run) as
 * long as every descendant is itself a runnable leaf.
 */
export function collectRunnableTools(item: { kind: string }): LeafToolNode[] | null {
  const node = item as ToolNode;
  if (node.kind === 'tool-group') {
    const out: LeafToolNode[] = [];
    for (const child of node.children) {
      const leaves = collectRunnableTools(child);
      if (!leaves) return null;
      out.push(...leaves);
    }
    return out.length > 0 ? out : null;
  }
  return isRunnableLeaf(node) ? [node] : null;
}

// ── Summaries ─────────────────────────────────────────────────────────────────

function lineKindOf(node: LeafToolNode): ToolRunLineKind {
  switch (node.kind) {
    case 'execute-tool-call':
      return 'execute';
    case 'read-tool-call':
      return 'read';
    case 'create-file-tool-call':
    case 'modify-file-tool-call':
      return 'edit';
    case 'delete-file-tool-call':
      return 'delete';
    case 'search-tool-call':
      return 'search';
    case 'web-fetch-tool-call':
      return 'fetch';
    default:
      return 'other';
  }
}

export function aggregateStatus(nodes: readonly { status: ToolStatus }[]): ToolStatus {
  if (nodes.some((n) => n.status === 'running')) return 'running';
  if (nodes.some((n) => n.status === 'error')) return 'error';
  return 'done';
}

function uniq<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/** "a.tsx", "a.tsx, b.css" or "a.tsx, b.css y 2 más". */
export function joinNames(names: readonly string[], limit = 2): string {
  const shown = names.slice(0, limit).join(', ');
  const rest = names.length - limit;
  return rest > 0 ? `${shown} ${TOOL_RUN_COPY.more(rest)}` : shown;
}

function firstLine(text: string, max = 80): string {
  const line = text.split('\n', 1)[0].trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function labelFor(kind: ToolRunLineKind, members: readonly LeafToolNode[]): string {
  const n = members.length;
  const first = members[0];
  switch (kind) {
    case 'read': {
      const paths = uniq(
        members
          .flatMap((m) => (m.kind === 'read-tool-call' ? (m.locations ?? []) : []))
          .map((l) => l.path)
      );
      const count = paths.length > 0 ? paths.length : n;
      return TOOL_RUN_COPY.read(count, paths.length === 1 ? basename(paths[0]) : undefined);
    }
    case 'edit': {
      const files = members.filter(
        (m): m is Extract<LeafToolNode, { path: string }> =>
          m.kind === 'create-file-tool-call' || m.kind === 'modify-file-tool-call'
      );
      const names = uniq(files.map((m) => basename(m.path)));
      const allCreates = files.every((m) => m.kind === 'create-file-tool-call');
      return allCreates
        ? TOOL_RUN_COPY.create(joinNames(names))
        : TOOL_RUN_COPY.edit(joinNames(names));
    }
    case 'delete': {
      const names = uniq(
        members.map((m) => (m.kind === 'delete-file-tool-call' ? basename(m.path) : m.title))
      );
      return TOOL_RUN_COPY.delete(joinNames(names));
    }
    case 'search':
      return TOOL_RUN_COPY.search(n, first.kind === 'search-tool-call' ? first.query : undefined);
    case 'fetch':
      return TOOL_RUN_COPY.fetch(
        n,
        first.kind === 'web-fetch-tool-call' ? (first.pageTitle ?? hostOf(first.url)) : undefined
      );
    case 'execute':
      return first.kind === 'execute-tool-call'
        ? firstLine(first.inputSummary ?? first.command ?? first.title)
        : first.title;
    default: {
      const title =
        first.kind === 'mcp-tool-call'
          ? [first.server, first.tool].filter(Boolean).join('.')
          : first.title;
      return TOOL_RUN_COPY.other(n, title);
    }
  }
}

/**
 * Summarize a run of leaf tools into one line per category.
 *
 * Contiguous tools of the same category merge ("Leyó 4 archivos"); commands
 * never merge, so each keeps its own "✓ cmd" line. Order follows the protocol.
 */
export function summarizeToolRun(
  tools: readonly LeafToolNode[],
  pendingToolCallIds: ReadonlySet<string>
): ToolRunLine[] {
  const buckets: { kind: ToolRunLineKind; members: LeafToolNode[] }[] = [];
  for (const tool of tools) {
    const kind = lineKindOf(tool);
    const last = buckets[buckets.length - 1];
    if (last && last.kind === kind && kind !== 'execute') last.members.push(tool);
    else buckets.push({ kind, members: [tool] });
  }
  return buckets.map(({ kind, members }) => ({
    id: `${members[0].id}:line`,
    kind,
    label: labelFor(kind, members),
    status: aggregateStatus(members),
    awaitingPermission: members.some((m) => pendingToolCallIds.has(m.toolCallId)),
    members,
  }));
}

// ── Turn change summary ───────────────────────────────────────────────────────

const LCS_CELL_LIMIT = 4_000_000;

function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Added/removed line counts between two texts (line LCS; coarse fallback when huge). */
export function countLineDiff(
  oldText: string,
  newText: string
): { added: number; removed: number } {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  if (x.length === 0 || y.length === 0) return { added: y.length, removed: x.length };
  if (x.length * y.length > LCS_CELL_LIMIT) return { added: y.length, removed: x.length };

  let prev = new Uint32Array(y.length + 1);
  let cur = new Uint32Array(y.length + 1);
  for (let i = 1; i <= x.length; i += 1) {
    for (let j = 1; j <= y.length; j += 1) {
      cur[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  const common = prev[y.length];
  return { added: y.length - common, removed: x.length - common };
}

export type TurnChangeSummary = {
  files: TurnChangeFile[];
  added: number;
  removed: number;
};

/**
 * Files a turn changed, from settled create/modify/delete tool calls.
 * Returns null when the turn changed nothing. Repeated edits to a path merge.
 */
export function summarizeTurnChanges(items: readonly { kind: string }[]): TurnChangeSummary | null {
  const byPath = new Map<string, TurnChangeFile>();
  const bump = (path: string, added: number, removed: number) => {
    const prev = byPath.get(path);
    byPath.set(path, {
      path,
      added: (prev?.added ?? 0) + added,
      removed: (prev?.removed ?? 0) + removed,
    });
  };
  for (const item of items) {
    for (const tool of collectRunnableTools(item) ?? []) {
      if (tool.status !== 'done') continue;
      if (tool.kind === 'create-file-tool-call') {
        bump(tool.path, splitLines(tool.content).length, 0);
      } else if (tool.kind === 'modify-file-tool-call') {
        const { added, removed } = countLineDiff(tool.oldText, tool.newText);
        bump(tool.path, added, removed);
      } else if (tool.kind === 'delete-file-tool-call') {
        bump(tool.path, 0, 0);
      }
    }
  }
  if (byPath.size === 0) return null;
  const files = [...byPath.values()];
  return {
    files,
    added: files.reduce((sum, f) => sum + f.added, 0),
    removed: files.reduce((sum, f) => sum + f.removed, 0),
  };
}
