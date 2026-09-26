import { describe, expect, it } from 'vitest';
import { conversationTabKind } from './notification-open-handlers';

describe('conversationTabKind', () => {
  it('opens ACP conversations in the chat tab', () => {
    expect(conversationTabKind('acp')).toBe('acp-chat');
  });

  it('opens terminal conversations in the terminal tab', () => {
    expect(conversationTabKind('pty')).toBe('conversation');
  });
});
