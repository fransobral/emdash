import { createScope } from '@emdash/shared/concurrency';
import { when } from 'mobx';
import { useEffect } from 'react';
import { getConversationsForTask } from '@core/features/conversations/api/browser/conversation-selectors';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { getUpdateStore } from '@core/features/updates/contributions/app-stores';
import { getTaskComposition } from '@core/features/workbench/api/browser/task-composition-selectors';
import type { ConversationType } from '@core/primitives/conversations/api/conversations';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { registerNotificationOpenHandler } from '@core/primitives/notifications/browser/open-handlers';

/** Chat (ACP) conversations render in the chat tab; the rest in a terminal tab. */
export function conversationTabKind(
  type: ConversationType | undefined
): 'acp-chat' | 'conversation' {
  return type === 'acp' ? 'acp-chat' : 'conversation';
}

export function useRegisterNotificationOpenHandlers(): void {
  const { navigate } = useNavigate();

  useEffect(() => {
    // Disposal registry, not event dispatch: `when` disposers accumulate per
    // handled notification and are only torn down together on unmount.
    const scope = createScope({ label: 'notification-open-handlers' });
    scope.add(
      registerNotificationOpenHandler('task', (target) => {
        navigate(taskViewDef({ projectId: target.projectId, taskId: target.taskId }));
        const { conversationId } = target;
        if (!conversationId) return;

        // Wait for the conversation too: its type decides between the chat and
        // terminal tab, and guessing wrong opens a stray terminal for a chat.
        const conversation = () =>
          getConversationsForTask(target.taskId)?.conversations.get(conversationId);
        const dispose = when(
          () => !!getTaskComposition(target.projectId, target.taskId) && !!conversation(),
          () => {
            getTaskComposition(target.projectId, target.taskId)?.paneLayout.open(
              conversationTabKind(conversation()?.data.type),
              { conversationId },
              { preview: false }
            );
          },
          { timeout: 10_000 }
        );
        scope.add(dispose);
      })
    );

    scope.add(
      registerNotificationOpenHandler('update', () => {
        void getUpdateStore().install();
      })
    );
    scope.add(registerNotificationOpenHandler('none', () => {}));

    return () => {
      void scope.dispose();
    };
  }, [navigate]);
}
