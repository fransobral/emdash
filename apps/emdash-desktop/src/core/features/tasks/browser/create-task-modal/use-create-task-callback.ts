import { useCallback } from 'react';
import { getTaskManagerStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { buildCreateTaskParams } from '@core/features/tasks/api/build-create-task-params';
import type { InitialConversationState } from '@core/features/tasks/contributions/browser/task-config/initial-conversation-section';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { log } from '@core/primitives/logging/browser/logger';
import type { NavigateFnTyped } from '@core/primitives/navigation/browser/navigation-hooks';
import { buildInitialConversation, deriveInitialStatus } from './build-create-task-params';
import type { CreateTaskState } from './use-create-task-state';

interface UseCreateTaskCallbackParams {
  selectedProjectId: string | undefined;
  state: CreateTaskState;
  initialConversation: InitialConversationState;
  navigate: NavigateFnTyped;
  onCreated: () => void;
}

export function useCreateTaskCallback({
  selectedProjectId,
  state,
  initialConversation,
  navigate,
  onCreated,
}: UseCreateTaskCallbackParams): { handleCreateTask: () => void; canCreate: boolean } {
  const canCreate = !!selectedProjectId && state.isValid;

  const handleCreateTask = useCallback(() => {
    if (!selectedProjectId) return;
    const taskManager = getTaskManagerStore(selectedProjectId);
    if (!taskManager) return;

    const id = crypto.randomUUID();
    const initial = buildInitialConversation(initialConversation);
    void taskManager
      .createTask(
        buildCreateTaskParams({
          id,
          projectId: selectedProjectId,
          prompt: initialConversation.prompt,
          provider: initial?.provider,
          model: initial?.model,
          name: state.taskName.effectiveTaskName,
          agentAutoApprove: initial?.autoApprove,
          workspaceConfig: state.workspaceConfig.resolvedConfig,
          taskConfig: {
            linkedIssue:
              state.linkedType === 'issue' ? (state.linkedIssue ?? undefined) : undefined,
            initialStatus: deriveInitialStatus(state.linkedType, state.linkedPR),
            initialConversation: initial,
          },
        })
      )
      .catch((e) => log.error('create task failed', e));

    navigate(taskViewDef({ projectId: selectedProjectId, taskId: id }));
    onCreated();
  }, [selectedProjectId, state, initialConversation, navigate, onCreated]);

  return { handleCreateTask, canCreate };
}
