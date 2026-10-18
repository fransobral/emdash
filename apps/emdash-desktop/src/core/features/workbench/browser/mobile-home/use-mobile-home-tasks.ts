import {
  getConversationsForTask,
  taskAgentStatus,
} from '@core/features/conversations/api/browser/conversation-selectors';
import { getProjectManagerStore } from '@core/features/projects/api/browser/stores/project-selectors';
import { getGitCheckoutStore } from '@core/features/source-control/api/browser/stores/source-control-selectors';
import { getTaskManagerStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { registeredTaskData } from '@core/primitives/task-state/browser/task-state';
import type { MobileHomeTaskInput } from './mobile-home-model';

/**
 * Flattens every registered task into plain inputs for the grouping model.
 * Reads MobX stores, so call it only inside `observer` components.
 */
export function collectMobileHomeTasks(): MobileHomeTaskInput[] {
  const inputs: MobileHomeTaskInput[] = [];
  for (const project of getProjectManagerStore().projects.values()) {
    const manager = getTaskManagerStore(project.id);
    if (!manager) continue;
    const projectName = project.name ?? project.id;
    for (const task of manager.tasks.values()) {
      const data = registeredTaskData(task);
      if (!data) continue;
      const checkout = task.workspaceId ? getGitCheckoutStore(task.workspaceId) : undefined;
      const firstConversation = getConversationsForTask(data.id)?.conversations.values().next();
      inputs.push({
        taskId: data.id,
        projectId: project.id,
        projectName,
        name: data.name,
        lifecycle: data.status,
        agentStatus: taskAgentStatus(task),
        providerId: firstConversation?.value?.data.providerId ?? null,
        lastInteractedAt: data.lastInteractedAt ?? data.updatedAt,
        archivedAt: data.archivedAt,
        linesAdded: checkout?.hasData ? checkout.totalLinesAdded : undefined,
        linesDeleted: checkout?.hasData ? checkout.totalLinesDeleted : undefined,
      });
    }
  }
  return inputs;
}
