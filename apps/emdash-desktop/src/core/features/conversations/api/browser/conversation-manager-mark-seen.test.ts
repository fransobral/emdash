import { formatHostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationManagerStore } from '@core/features/conversations/api/browser/conversation-manager';

const localSessionHost = () => formatHostRef(LOCAL_HOST_REF);

const markConversationSeen = vi.hoisted(() => vi.fn());
const logWarn = vi.hoisted(() => vi.fn());

vi.mock('@core/features/editor/api/browser/open-file-in-file-editor', () => ({
  makeFileLinkHandlers: () => ({ onOpenExternal: vi.fn(), onOpenFile: vi.fn() }),
}));
vi.mock('@core/features/terminals/api/browser/pty/pty', () => ({
  FrontendPty: class {
    connect = vi.fn();
    dispose = vi.fn();
  },
}));
vi.mock('@core/features/conversations/api/browser/client', () => ({
  getConversationsClient: async () => ({ markConversationSeen }),
}));
vi.mock('@core/primitives/logging/browser/logger', () => ({
  log: { warn: logWarn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Covers the fix for a stuck "unseen" indicator in the emdash-web browser build:
// markSeen() previously fired the markConversationSeen wire call without a
// .catch(), so a dropped network request silently left the server-persisted
// agentStatusSeen flag at 0 while the local store optimistically showed seen.
// On the next reload the task's status indicator would reappear even though
// the user had already viewed the conversation.
describe('ConversationStore.markSeen', () => {
  beforeEach(() => {
    markConversationSeen.mockReset();
    logWarn.mockReset();
  });

  it('logs a warning instead of throwing when the wire call fails', async () => {
    markConversationSeen.mockRejectedValue(new Error('network error'));
    const store = new ConversationManagerStore(
      'project-1',
      'task-1',
      [
        {
          id: 'conversation-1',
          projectId: 'project-1',
          taskId: 'task-1',
          providerId: 'codex',
          title: 'Conversation 1',
          type: 'acp',
          lastInteractedAt: null,
          isInitialConversation: false,
          agentStatus: 'completed',
          agentStatusSeen: false,
        },
      ],
      localSessionHost
    );

    const conversation = store.conversations.get('conversation-1');
    expect(conversation?.seen).toBe(false);

    conversation?.markSeen();

    // Optimistic local update happens synchronously.
    expect(conversation?.seen).toBe(true);

    await vi.waitFor(() => {
      expect(logWarn).toHaveBeenCalledWith(
        'ConversationStore: failed to mark conversation seen',
        expect.objectContaining({ conversationId: 'conversation-1' })
      );
    });

    store.dispose();
  });

  it('does not warn when the wire call succeeds', async () => {
    markConversationSeen.mockResolvedValue(undefined);
    const store = new ConversationManagerStore(
      'project-1',
      'task-1',
      [
        {
          id: 'conversation-1',
          projectId: 'project-1',
          taskId: 'task-1',
          providerId: 'codex',
          title: 'Conversation 1',
          type: 'acp',
          lastInteractedAt: null,
          isInitialConversation: false,
          agentStatus: 'completed',
          agentStatusSeen: false,
        },
      ],
      localSessionHost
    );

    const conversation = store.conversations.get('conversation-1');
    conversation?.markSeen();

    await vi.waitFor(() =>
      expect(markConversationSeen).toHaveBeenCalledWith({
        conversationId: 'conversation-1',
      })
    );
    expect(logWarn).not.toHaveBeenCalled();

    store.dispose();
  });
});
