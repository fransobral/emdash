import type { Logger } from '@emdash/shared/logger';
import type { PromptAttachment, QueuedPrompt } from '#runtimes/acp/api';
import type { AcpAgentApi } from '#services/agent-plugins/api/plugins';

export interface ResolvedPromptAttachment {
  data: string;
  mimeType: string;
}

export type ResolvePromptAttachment = (
  conversationId: string,
  attachment: PromptAttachment
) => Promise<ResolvedPromptAttachment>;

/** Reported when a Codex prompt fails on usage-limit exhaustion and this session is
 * eligible to fail over to the fallback `CODEX_HOME` (see `SessionCellDeps.codexFailoverEligible`). */
export interface UsageLimitFailoverInfo {
  /** Epoch ms when the provider said the limit resets. */
  resetAt: number;
  /** The prompt that failed. */
  prompt: QueuedPrompt;
  /** Prompts that were still queued behind the failed one, drained before the turn settled
   * so they are not dispatched into the now-limited process. */
  queuedPrompts: QueuedPrompt[];
}

export interface SessionCellCallbacks {
  onSessionStateChanged?: () => void;
  onTranscriptChanged?: () => void;
  onClosed?: (exitCode: number | null) => void;
  onAgentEvent?: (phase: 'start' | 'stop' | 'error') => void;
  onSendQueuedPrompt?: (prompt: QueuedPrompt) => void;
  onUsageLimitExceeded?: (info: UsageLimitFailoverInfo) => void;
}

export interface SessionCellDeps {
  conversationId: string;
  providerId: string;
  acpSessionId: string;
  agent: AcpAgentApi;
  resolveAttachment: ResolvePromptAttachment;
  logger: Logger;
  callbacks?: SessionCellCallbacks;
  /** True when a Codex usage-limit failure on this session should drain its queue and
   * report `onUsageLimitExceeded` instead of letting the turn fail normally. Only ever
   * true for the `codex` provider, and only while a fallback home is configured and this
   * session is not already running against it. */
  codexFailoverEligible?: boolean;
}

export interface SessionPromptResult {
  queued: boolean;
}

export interface PromptAcceptance {
  id: string;
  onAccepted(result: SessionPromptResult): void;
  resolvedAttachments: readonly ResolvedPromptAttachment[];
}
