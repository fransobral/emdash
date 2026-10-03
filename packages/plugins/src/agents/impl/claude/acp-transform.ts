import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { NormalizedEvent } from '@emdash/core/runtimes/acp/api';

/**
 * Claude-specific enrichment of a baseline `NormalizedEvent`.
 *
 * The Claude ACP adapter stamps subagent child updates with
 * `_meta.claudeCode.parentToolUseId` to indicate that a tool call was produced
 * by a nested agent (Task/Agent tool). This function promotes that value to the
 * first-class `parentToolCallId` field so downstream consumers never need to
 * know about `claudeCode`.
 *
 * Returns the original update object unchanged when:
 * - The update is not a `tool_call` or `tool_update`.
 * - The vendor field is absent or not a string.
 */
export function enrichClaudeUpdate(update: NormalizedEvent, raw: SessionUpdate): NormalizedEvent {
  const asyncTaskEvent = parseAsyncTaskSessionUpdate(raw);
  if (asyncTaskEvent) return asyncTaskEvent;

  if (update.kind === 'message' && update.role === 'user') {
    const text = update.text.trim();
    if (isLocalCommandChunk(text)) return { kind: 'ignored' };
    const notification = parseTaskNotification(text);
    if (notification) {
      return {
        kind: 'subagent_update',
        agentId: notification.taskId,
        toolCallId: notification.toolUseId,
        status: notification.status,
        summary: notification.summary,
        outputFile: notification.outputFile,
      };
    }
    return update;
  }

  if (update.kind !== 'tool_call' && update.kind !== 'tool_update') return update;
  const normalizedUpdate =
    update.kind === 'tool_update' && isCommandDescriptionEcho(update, raw)
      ? withoutOutputText(update)
      : update;

  const parentToolUseId = (
    raw._meta as { claudeCode?: { parentToolUseId?: unknown } } | null | undefined
  )?.claudeCode?.parentToolUseId;

  const parentPatch =
    typeof parentToolUseId === 'string' ? { parentToolCallId: parentToolUseId } : {};
  const outputPatch =
    normalizedUpdate.outputText === undefined && rawOutputText(raw) !== undefined
      ? { outputText: rawOutputText(raw)! }
      : {};

  if (claudeToolName(raw) === 'Agent') {
    const asyncLaunch = parseAsyncLaunch(raw);
    return {
      kind: 'subagent',
      operation: normalizedUpdate.kind === 'tool_call' ? 'start' : 'update',
      toolCallId: normalizedUpdate.toolCallId,
      title: asyncLaunch?.description ?? normalizedUpdate.title ?? 'Agent',
      status: asyncLaunch ? 'in_progress' : (normalizedUpdate.status ?? null),
      parentToolCallId: parentPatch.parentToolCallId ?? normalizedUpdate.parentToolCallId,
      inputSummary: agentInputSummary(raw),
      ...(asyncLaunch ? { background: true } : {}),
      ...(asyncLaunch?.agentId !== undefined ? { agentId: asyncLaunch.agentId } : {}),
      ...(asyncLaunch?.outputFile !== undefined ? { outputFile: asyncLaunch.outputFile } : {}),
    };
  }

  if (!parentPatch.parentToolCallId && outputPatch.outputText === undefined)
    return normalizedUpdate;
  return { ...normalizedUpdate, ...parentPatch, ...outputPatch };
}

type ClaudeMeta = {
  claudeCode?: {
    parentToolUseId?: unknown;
    toolName?: unknown;
    toolResponse?: unknown;
  };
};

type AsyncLaunch = {
  agentId: string;
  outputFile?: string;
  description?: string;
};

type TaskNotification = {
  taskId: string;
  toolUseId: string;
  outputFile?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  summary?: string;
};

function claudeMeta(raw: SessionUpdate): ClaudeMeta['claudeCode'] | undefined {
  return (raw._meta as ClaudeMeta | null | undefined)?.claudeCode;
}

function claudeToolName(raw: SessionUpdate): string | null {
  const toolName = claudeMeta(raw)?.toolName;
  return typeof toolName === 'string' ? toolName : null;
}

function agentInputSummary(raw: SessionUpdate): string | undefined {
  const input = (raw as { rawInput?: { description?: unknown } }).rawInput;
  return typeof input?.description === 'string' ? input.description : undefined;
}

function isCommandDescriptionEcho(
  update: Extract<NormalizedEvent, { kind: 'tool_update' }>,
  raw: SessionUpdate
): boolean {
  if (raw.sessionUpdate !== 'tool_call_update') return false;
  const rawUpdate = raw as unknown as {
    title?: unknown;
    kind?: unknown;
    content?: unknown;
    rawInput?: { command?: unknown; description?: unknown } | null;
    rawOutput?: unknown;
  };
  const command = rawUpdate.rawInput?.command;
  const description = rawUpdate.rawInput?.description;
  return (
    rawUpdate.kind === 'execute' &&
    typeof command === 'string' &&
    typeof description === 'string' &&
    rawUpdate.title === command &&
    rawUpdate.rawOutput == null &&
    singleTextContent(rawUpdate.content) === description &&
    update.inputSummary === description &&
    update.outputText === description
  );
}

function singleTextContent(content: unknown): string | undefined {
  if (!Array.isArray(content) || content.length !== 1) return undefined;
  const block = content[0] as { type?: unknown; content?: unknown };
  if (block.type !== 'content' || !block.content || typeof block.content !== 'object')
    return undefined;
  const payload = block.content as { type?: unknown; text?: unknown };
  return payload.type === 'text' && typeof payload.text === 'string' ? payload.text : undefined;
}

function withoutOutputText(
  update: Extract<NormalizedEvent, { kind: 'tool_update' }>
): Extract<NormalizedEvent, { kind: 'tool_update' }> {
  const result = { ...update };
  delete result.outputText;
  return result;
}

function parseAsyncLaunch(raw: SessionUpdate): AsyncLaunch | null {
  const response = claudeMeta(raw)?.toolResponse as
    | {
        isAsync?: unknown;
        status?: unknown;
        agentId?: unknown;
        outputFile?: unknown;
        description?: unknown;
      }
    | null
    | undefined;
  if (
    response?.isAsync === true &&
    response.status === 'async_launched' &&
    typeof response.agentId === 'string'
  ) {
    return {
      agentId: response.agentId,
      ...(typeof response.outputFile === 'string' ? { outputFile: response.outputFile } : {}),
      ...(typeof response.description === 'string' ? { description: response.description } : {}),
    };
  }

  const text = rawText(raw);
  if (!text.includes('Async agent launched successfully.')) return null;
  const agentId = /^agentId:\s+([^\s]+)/m.exec(text)?.[1];
  if (!agentId) return null;
  const outputFile = /^output_file:\s+(.+)$/m.exec(text)?.[1]?.trim();
  return {
    agentId,
    ...(outputFile ? { outputFile } : {}),
  };
}

type AsyncTaskStateUpdateRaw = {
  sessionUpdate: 'async_task_spawned' | 'async_task_progress' | 'async_task_state_update';
  asyncTaskId?: unknown;
  toolCallId?: unknown;
  outputFilePath?: unknown;
  name?: unknown;
  description?: unknown;
  summary?: unknown;
  state?: unknown;
};

function asyncTaskSessionUpdate(raw: SessionUpdate): AsyncTaskStateUpdateRaw | null {
  const kind = (raw as { sessionUpdate?: unknown }).sessionUpdate;
  if (
    kind !== 'async_task_spawned' &&
    kind !== 'async_task_progress' &&
    kind !== 'async_task_state_update'
  ) {
    return null;
  }
  return raw as unknown as AsyncTaskStateUpdateRaw;
}

/**
 * The installed Claude ACP adapter (`@agentclientprotocol/claude-agent-acp`)
 * reports background task lifecycle through dedicated `async_task_spawned` /
 * `async_task_progress` / `async_task_state_update` session updates keyed by
 * `asyncTaskId`, instead of the legacy `<task-notification>` text chunk.
 * These kinds are unknown to the baseline decoder (`decodeSessionUpdate`
 * returns `{ kind: 'ignored' }` for them), so Claude-specific enrichment must
 * read the raw update directly to recover them.
 *
 * `asyncTaskId` lines up with the `agentId` the Agent-tool launch reported
 * via `parseAsyncLaunch`, and `toolCallId` (when present) lines up with the
 * tool call that launched the task — either is enough for the reducer's
 * agent slice to match this update to the existing `AgentState`.
 */
function parseAsyncTaskSessionUpdate(raw: SessionUpdate): NormalizedEvent | null {
  const task = asyncTaskSessionUpdate(raw);
  if (!task) return null;
  const agentId = typeof task.asyncTaskId === 'string' ? task.asyncTaskId : undefined;
  if (!agentId) return null;

  const toolCallId = typeof task.toolCallId === 'string' ? task.toolCallId : undefined;
  const outputFile = typeof task.outputFilePath === 'string' ? task.outputFilePath : undefined;

  if (task.sessionUpdate === 'async_task_spawned') {
    const title =
      (typeof task.description === 'string' && task.description) ||
      (typeof task.name === 'string' && task.name) ||
      'Agent';
    return {
      kind: 'subagent',
      operation: 'start',
      toolCallId: toolCallId ?? agentId,
      title,
      status: 'in_progress',
      parentToolCallId: null,
      background: true,
      agentId,
      ...(outputFile !== undefined ? { outputFile } : {}),
    };
  }

  const summary = typeof task.summary === 'string' ? task.summary : undefined;
  return {
    kind: 'subagent_update',
    agentId,
    ...(toolCallId !== undefined ? { toolCallId } : {}),
    status: toAsyncTaskStatus(
      task.sessionUpdate === 'async_task_state_update' ? task.state : undefined
    ),
    ...(summary !== undefined ? { summary } : {}),
    ...(outputFile !== undefined ? { outputFile } : {}),
  };
}

/**
 * `async_task_progress` never carries a terminal state (the adapter routes
 * terminal transitions through `async_task_state_update` instead), so it
 * always normalizes to `in_progress`. For `async_task_state_update`, the
 * adapter's own `killed` / `cancelled` / `stopped` states already collapse
 * to its "stopped" tri-state (see `isTerminal` in `async-tasks.js`); emdash's
 * `AgentStatus` has no equivalent, so a user-stopped task is reported as
 * `failed` rather than `completed`.
 */
function toAsyncTaskStatus(state: unknown): 'completed' | 'failed' | 'in_progress' {
  switch (state) {
    case 'completed':
      return 'completed';
    case 'failed':
    case 'stopped':
      return 'failed';
    default:
      return 'in_progress';
  }
}

function rawText(raw: SessionUpdate): string {
  const parts: string[] = [];
  const content = (raw as { content?: unknown; rawOutput?: unknown }).content;
  collectText(content, parts);
  collectText((raw as { rawOutput?: unknown }).rawOutput, parts);
  return parts.join('\n');
}

function rawOutputText(raw: SessionUpdate): string | undefined {
  const rawOutput = (raw as { rawOutput?: unknown }).rawOutput;
  return typeof rawOutput === 'string' && rawOutput.length > 0 ? rawOutput : undefined;
}

function collectText(value: unknown, parts: string[]): void {
  if (typeof value === 'string') {
    parts.push(value);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, parts);
    return;
  }
  const maybeText = (value as { text?: unknown }).text;
  if (typeof maybeText === 'string') parts.push(maybeText);
  collectText((value as { content?: unknown }).content, parts);
}

function isLocalCommandChunk(text: string): boolean {
  return text.startsWith('<local-command-') || text.includes('<command-name>');
}

export function parseTaskNotification(text: string): TaskNotification | null {
  if (!text.trimStart().startsWith('<task-notification>')) return null;
  const taskId = getTag(text, 'task-id');
  const toolUseId = getTag(text, 'tool-use-id');
  if (!taskId || !toolUseId) return null;
  return {
    taskId,
    toolUseId,
    status: toNotificationStatus(getTag(text, 'status')),
    ...(getTag(text, 'output-file') ? { outputFile: getTag(text, 'output-file')! } : {}),
    ...(getTag(text, 'summary') ? { summary: getTag(text, 'summary')! } : {}),
  };
}

function getTag(text: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text);
  return match?.[1]?.trim() ?? null;
}

function toNotificationStatus(
  status: string | null
): 'pending' | 'in_progress' | 'completed' | 'failed' {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'pending':
      return 'pending';
    default:
      return 'in_progress';
  }
}
