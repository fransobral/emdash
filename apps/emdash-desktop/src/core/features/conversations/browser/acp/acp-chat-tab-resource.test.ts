import { formatHostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { conversationRegistry } from '@core/features/conversations/api/browser/stores/conversation-registry';
import type { Conversation } from '@core/primitives/conversations/api';
import { createTabRegistry } from '@core/primitives/workbench-shell/browser/tabs/core/tab-provider-registry';
import { PaneLayoutStore } from '@core/primitives/workbench-shell/browser/tabs/pane-layout-store';
import { PaneStore } from '@core/primitives/workbench-shell/browser/tabs/pane-store';
import { releaseAcpChatResourceManager } from './acp-chat-resource-manager';
import { acpChatTabProvider } from './acp-chat-tab-provider';

const markConversationSeen = vi.hoisted(() => vi.fn());
const deleteConversation = vi.hoisted(() => vi.fn(async () => undefined));
const openModal = vi.hoisted(() => vi.fn());
const viewport = vi.hoisted(() => ({ mobile: true }));

vi.mock('@core/primitives/styling/browser/use-mobile-viewport', () => ({
  isMobileViewport: () => viewport.mobile,
}));
vi.mock('@core/manifests/browser/modal-api', () => ({ openModal }));

vi.mock('@core/features/projects/api/browser/stores/project-selectors', () => ({
  getProjectHostAccess: () => undefined,
}));
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
  getConversationsClient: async () => ({ markConversationSeen, deleteConversation }),
}));
// Exercise the real provider, tab lifecycle and conversation stores without booting an agent or DOM.
vi.mock('./acp-chat-store', () => ({
  AcpChatStore: class {
    constructor(
      readonly conversationId: string,
      readonly projectId: string,
      readonly taskId: string
    ) {}
    bootstrap() {}
    dispose() {}
  },
}));
vi.mock('./acp-chat-panel', () => ({ AcpChatPanel: () => null }));
vi.mock('../conversation-agent-icon', () => ({ ConversationAgentIcon: () => null }));
vi.mock('@core/primitives/workbench-shell/browser/tabs/tab-bar/generic-tab-item', () => ({
  GenericTabDragPreview: () => null,
  GenericTabItem: () => null,
}));

afterEach(() => {
  viewport.mobile = true;
  releaseAcpChatResourceManager('task-1');
  conversationRegistry.release('task-1');
  vi.clearAllMocks();
});

function acquireConversations(ids: string[]) {
  const records: Conversation[] = ids.map((id) => ({
    id,
    projectId: 'project-1',
    taskId: 'task-1',
    providerId: 'codex',
    title: id,
    type: 'acp',
    lastInteractedAt: null,
    isInitialConversation: false,
  }));
  return conversationRegistry.acquire(
    'task-1',
    'project-1',
    () => formatHostRef(LOCAL_HOST_REF),
    records
  );
}

function createPane() {
  const context = { viewId: 'task-1', projectId: 'project-1', taskId: 'task-1' };
  return new PaneStore(createTabRegistry([acpChatTabProvider]), context, {
    isViewActive: () => true,
  });
}

describe('desktop chat tab close', () => {
  it('keeps the tab and the chat when the delete confirmation is cancelled', async () => {
    viewport.mobile = false;
    openModal.mockResolvedValue({ success: false });
    const manager = acquireConversations(['conversation-1']);
    const pane = createPane();
    try {
      pane.open('acp-chat', { conversationId: 'conversation-1' });
      pane.closeActiveTab();

      await vi.waitFor(() => expect(openModal).toHaveBeenCalledTimes(1));
      await Promise.resolve();
      expect(pane.resolvedTabs).toHaveLength(1);
      expect(manager.conversations.has('conversation-1')).toBe(true);
      expect(deleteConversation).not.toHaveBeenCalled();
    } finally {
      pane.dispose();
    }
  });

  it('deletes the chat and closes the tab once the user confirms', async () => {
    viewport.mobile = false;
    openModal.mockResolvedValue({ success: true });
    const manager = acquireConversations(['conversation-1']);
    const pane = createPane();
    try {
      pane.open('acp-chat', { conversationId: 'conversation-1' });
      pane.closeActiveTab();

      await vi.waitFor(() => expect(pane.resolvedTabs).toHaveLength(0));
      expect(deleteConversation).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: 'conversation-1' })
      );
      expect(manager.conversations.has('conversation-1')).toBe(false);
    } finally {
      pane.dispose();
    }
  });
});

describe('ACP tab notification acknowledgement', () => {
  it('acknowledges a closed background tab while allowing later attention with no open tabs', async () => {
    const records: Conversation[] = ['conversation-1', 'conversation-2'].map((id) => ({
      id,
      projectId: 'project-1',
      taskId: 'task-1',
      providerId: 'codex',
      title: id,
      type: 'acp',
      lastInteractedAt: null,
      isInitialConversation: false,
    }));
    const manager = conversationRegistry.acquire(
      'task-1',
      'project-1',
      () => formatHostRef(LOCAL_HOST_REF),
      records
    );
    const context = { viewId: 'task-1', projectId: 'project-1', taskId: 'task-1' };
    const pane = new PaneStore(createTabRegistry([acpChatTabProvider]), context, {
      isViewActive: () => true,
    });
    try {
      pane.open('acp-chat', { conversationId: 'conversation-1' });
      const firstTabId = pane.activeTabId;
      const first = manager.conversations.get('conversation-1');
      if (!firstTabId || !first) throw new Error('Missing conversation fixture');
      pane.open('acp-chat', { conversationId: 'conversation-2' });
      first.setAwaitingInput('permission_prompt');
      expect(manager.taskStatus).toBe('awaiting-input');

      pane.requestCloseTab(firstTabId);
      pane.closeActiveTab();

      // Conversation tabs have a close veto, so even a plain close settles asynchronously.
      await vi.waitFor(() => expect(pane.resolvedTabs).toHaveLength(0));
      expect(manager.taskStatus).toBeNull();
      expect(first.status).toBe('awaiting-input');
      await vi.waitFor(() =>
        expect(markConversationSeen).toHaveBeenCalledWith({
          conversationId: 'conversation-1',
        })
      );

      first.setAwaitingInput('permission_prompt');
      expect(manager.taskStatus).toBe('awaiting-input');
    } finally {
      pane.dispose();
    }
  });

  it.each([
    'restore',
    'retarget',
    'pane disposal',
    'layout disposal',
    'programmatic close',
  ] as const)('preserves unseen notifications during %s', async (operation) => {
    const records: Conversation[] = ['conversation-1', 'conversation-2'].map((id) => ({
      id,
      projectId: 'project-1',
      taskId: 'task-1',
      providerId: 'codex',
      title: id,
      type: 'acp',
      lastInteractedAt: null,
      isInitialConversation: false,
      agentStatus: 'awaiting-input',
      agentStatusSeen: false,
    }));
    const manager = conversationRegistry.acquire(
      'task-1',
      'project-1',
      () => formatHostRef(LOCAL_HOST_REF),
      records
    );
    const context = { viewId: 'task-1', projectId: 'project-1', taskId: 'task-1' };
    const layout = new PaneLayoutStore(createTabRegistry([acpChatTabProvider]), context);
    const pane = layout.focusedPane;
    try {
      pane.open('acp-chat', { conversationId: 'conversation-1' });
      const first = manager.conversations.get('conversation-1');
      const tabId = pane.activeTabId;
      if (!first || !tabId) throw new Error('Missing conversation fixture');
      expect(first.seen).toBe(false);

      if (operation === 'restore') pane.restoreSnapshot(pane.snapshot);
      else if (operation === 'retarget') {
        pane.retargetEntry(tabId, { state: { conversationId: 'conversation-2' } });
      } else if (operation === 'pane disposal') pane.dispose();
      else if (operation === 'layout disposal') layout.dispose();
      else pane.closeTab(tabId);

      expect(first.seen).toBe(false);
      expect(manager.taskStatus).toBe('awaiting-input');
      await Promise.resolve();
      expect(markConversationSeen).not.toHaveBeenCalled();
    } finally {
      layout.dispose();
    }
  });
});
