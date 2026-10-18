/**
 * Adapts an ACP permission request's typed tool call into what the mobile
 * approval sheet shows: the kind of action and the exact input being approved.
 * Display-only; the options the agent returned are passed through untouched.
 */

import type { AcpPermissionRequest } from '@emdash/core/runtimes/acp/api/client';
import type { ComposerPermissionRequest } from '@emdash/ui/react/components';

type ToolCall = AcpPermissionRequest['toolCall'];
type PermissionActionKind = NonNullable<ComposerPermissionRequest['actionKind']>;

export type PermissionDetail = {
  actionKind: PermissionActionKind;
  /** Exact command, path, query, URL or tool input; undefined when the provider sent none. */
  command: string | undefined;
};

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? value : undefined;
}

export function permissionDetailFor(toolCall: ToolCall): PermissionDetail {
  switch (toolCall.kind) {
    case 'execute-tool-call':
      return {
        actionKind: 'execute',
        command: nonEmpty(toolCall.command) ?? nonEmpty(toolCall.inputSummary),
      };
    case 'create-file-tool-call':
    case 'modify-file-tool-call':
      return { actionKind: 'edit', command: nonEmpty(toolCall.path) };
    case 'delete-file-tool-call':
      return { actionKind: 'delete', command: nonEmpty(toolCall.path) };
    case 'read-tool-call':
      return {
        actionKind: 'read',
        command:
          nonEmpty(toolCall.locations?.map((l) => l.path).join('\n')) ??
          nonEmpty(toolCall.inputSummary),
      };
    case 'search-tool-call':
      return { actionKind: 'search', command: nonEmpty(toolCall.query) };
    case 'web-fetch-tool-call':
      return { actionKind: 'fetch', command: nonEmpty(toolCall.url) };
    case 'mcp-tool-call':
      return {
        actionKind: 'other',
        command:
          nonEmpty([toolCall.server, toolCall.tool].filter(Boolean).join('.')) ??
          nonEmpty(toolCall.inputSummary),
      };
    default:
      return {
        actionKind: 'other',
        command: nonEmpty(toolCall.inputSummary) ?? nonEmpty(toolCall.title),
      };
  }
}
