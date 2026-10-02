import { describe, expect, it } from 'vitest';
import type { ConversationStore } from '@core/features/conversations/api/browser/conversation-manager';
import { unseenConversationTabs } from './task-composition';

function conversation(
  id: string,
  type: 'acp' | 'pty',
  indicatorStatus: ConversationStore['indicatorStatus']
): ConversationStore {
  return { data: { id, type }, indicatorStatus } as unknown as ConversationStore;
}

describe('unseenConversationTabs', () => {
  it('opens chats with unseen results, not working or already seen ones', () => {
    const tabs = unseenConversationTabs([
      conversation('done', 'acp', 'completed'),
      conversation('failed', 'pty', 'error'),
      conversation('busy', 'acp', 'working'),
      conversation('seen', 'acp', null),
    ]);

    expect(tabs).toEqual([
      { kind: 'acp-chat', conversationId: 'done' },
      { kind: 'conversation', conversationId: 'failed' },
    ]);
  });
});
