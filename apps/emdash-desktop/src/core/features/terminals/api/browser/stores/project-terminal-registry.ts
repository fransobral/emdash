import { observable } from 'mobx';
import {
  getProjectHostAccess,
  getProjectStore,
  projectData,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { TerminalManagerStore } from '@core/features/terminals/api/browser/task-terminal/terminal-manager';
import { createProjectRootTerminalScope } from '@core/features/terminals/api/browser/task-terminal/terminal-scope';

/** Terminal managers for project-root terminals, keyed by project id. */
export class ProjectTerminalRegistry {
  private readonly entries = observable.map<string, TerminalManagerStore>();

  /** Null when the project has no root workspace to run terminals in. */
  acquire(projectId: string): TerminalManagerStore | null {
    const existing = this.entries.get(projectId);
    if (existing) return existing;
    const workspaceId = projectData(getProjectStore(projectId))?.repositoryWorkspaceId;
    if (!workspaceId) return null;
    const store = new TerminalManagerStore(
      projectId,
      projectId,
      getProjectHostAccess(projectId),
      createProjectRootTerminalScope(projectId, workspaceId)
    );
    this.entries.set(projectId, store);
    return store;
  }

  get(projectId: string): TerminalManagerStore | undefined {
    return this.entries.get(projectId);
  }

  release(projectId: string): void {
    const store = this.entries.get(projectId);
    if (!store) return;
    store.dispose();
    this.entries.delete(projectId);
  }
}

export const projectTerminalRegistry = new ProjectTerminalRegistry();
