import { toast } from '@emdash/ui/react/primitives';
import { formatConversationTitleForDisplay } from '@core/features/conversations/api/browser/conversation-title-utils';
import { conversationRegistry } from '@core/features/conversations/api/browser/stores/conversation-registry';
import { openModal } from '@core/manifests/browser/modal-api';
import { isMobileViewport } from '@core/primitives/styling/browser/use-mobile-viewport';

/**
 * Close veto for conversation tabs. On desktop every conversation lives in a tab
 * (there is no conversations list), so closing the tab deletes the conversation
 * after confirmation. Resolves true when the tab may close.
 *
 * The phone layout keeps its grouped chats list, so there a close only hides the tab.
 * Closes of an already-deleted conversation (the tab auto-closing) pass straight through.
 */
export async function confirmConversationTabClose(
  taskId: string,
  conversationId: string
): Promise<boolean> {
  if (isMobileViewport()) return true;
  const conversations = conversationRegistry.get(taskId);
  const conversation = conversations?.conversations.get(conversationId);
  if (!conversations || !conversation) return true;

  const title = formatConversationTitleForDisplay(
    conversation.data.providerId,
    conversation.data.title
  );
  const outcome = await openModal('confirmActionModal', {
    title: 'Cerrar y borrar chat',
    description: `"${title}" se va a borrar con todo su historial. No se puede deshacer.`,
    confirmLabel: 'Borrar',
    variant: 'destructive',
  });
  if (!outcome.success) return false;

  try {
    await conversations.deleteConversation(conversationId);
    return true;
  } catch (error) {
    toast.error('No se pudo borrar el chat', {
      description: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
