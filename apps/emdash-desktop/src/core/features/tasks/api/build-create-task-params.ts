import { buildWorkspaceConfigFromPreset, type WorkspaceConfig } from '@core/primitives/workspaces/api';
import type { CreateTaskParams, TaskConfig } from '@core/primitives/tasks/api';

export type BuildCreateTaskParamsInput = {
  id?: string;
  projectId: string;
  prompt: string;
  provider?: string;
  model?: string;
  name?: string;
  baseBranch?: string;
  agentAutoApprove?: boolean;
  workspaceConfig?: WorkspaceConfig;
  taskConfig?: Partial<Omit<TaskConfig, 'version' | 'name'>>;
};

/** Pure task payload builder shared by browser and headless control surfaces. */
export function buildCreateTaskParams(input: BuildCreateTaskParamsInput): CreateTaskParams {
  const id = input.id ?? crypto.randomUUID();
  const name = input.name?.trim() || taskNameFromPrompt(input.prompt);
  const provider = input.provider ?? 'codex';
  const conversationId = crypto.randomUUID();
  const taskConfig: TaskConfig = {
    version: '1',
    name,
    initialConversation: {
      id: conversationId,
      provider,
      title: `${provider} 1`,
      type: 'acp',
      initialQueue: [{ text: input.prompt }],
      autoApprove: input.agentAutoApprove,
      model: input.model,
    },
    ...input.taskConfig,
  };
  const branchName = `emdash/${slug(name)}-${id.slice(0, 8)}`;
  const workspaceConfig =
    input.workspaceConfig ??
    (input.baseBranch
      ? buildWorkspaceConfigFromPreset(
          'new-worktree',
          { defaultBranch: { type: 'local', branch: input.baseBranch } },
          { branchName }
        )
      : {
          version: '2',
          git: { kind: 'none' },
          workspace: { kind: 'new-worktree' },
        });

  return { id, projectId: input.projectId, taskConfig, workspaceConfig };
}

function taskNameFromPrompt(prompt: string): string {
  const compact = prompt.trim().replaceAll(/\s+/g, ' ');
  return compact.slice(0, 80) || 'Nueva tarea';
}

function slug(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replaceAll(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/^-|-$/g, '')
      .slice(0, 40) || 'task'
  );
}
