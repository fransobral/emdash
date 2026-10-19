import { makeFileLinkHandlers } from '@core/features/editor/api/browser/open-file-in-file-editor';
import type { TerminalRuntimeKey } from '@core/features/terminals/api';
import { getTerminalsClient } from '@core/features/terminals/api/browser/client';
import { type CreateTerminalParams, type Terminal } from '@core/primitives/terminals/api';

/** The terminal fields every scope shares; `taskId` is absent for project-root terminals. */
export type ManagedTerminal = Pick<Terminal, 'id' | 'projectId' | 'shellId' | 'name' | 'ssh'> & {
  taskId?: string;
};

export type ManagedTerminalCreateParams = Pick<CreateTerminalParams, 'id' | 'name'> &
  Partial<Pick<CreateTerminalParams, 'projectId' | 'taskId' | 'shell' | 'initialSize'>>;

export type TerminalFileLinkHandlers = Partial<ReturnType<typeof makeFileLinkHandlers>>;

/** Where a TerminalManagerStore's terminals live and how the main process addresses them. */
export interface TerminalScopeApi {
  list(): Promise<ManagedTerminal[]>;
  create(
    params: ManagedTerminalCreateParams
  ): Promise<{ terminal: ManagedTerminal; key: TerminalRuntimeKey }>;
  delete(terminalId: string): Promise<void>;
  hydrate(terminalId: string): Promise<TerminalRuntimeKey>;
  /** Frontend PTY session id; mirrors the main-process `makePtySessionId` scoping. */
  sessionScopeId(): string;
  fileLinkHandlers(terminal: ManagedTerminal): TerminalFileLinkHandlers;
}

export function terminalErrorMessage(error: { type: string; message?: string }): string {
  return error.message ?? `Terminal operation failed: ${error.type}`;
}

export function createTaskTerminalScope(projectId: string, taskId: string): TerminalScopeApi {
  return {
    async list() {
      const result = await (await getTerminalsClient()).list({ projectId, taskId });
      if (!result.success) throw new Error(terminalErrorMessage(result.error));
      return result.data;
    },
    async create(params) {
      const result = await (await getTerminalsClient()).create({ ...params, projectId, taskId });
      if (!result.success) throw new Error(terminalErrorMessage(result.error));
      return result.data;
    },
    async delete(terminalId) {
      const result = await (await getTerminalsClient()).delete({ projectId, taskId, terminalId });
      if (!result.success) throw new Error(terminalErrorMessage(result.error));
    },
    async hydrate(terminalId) {
      const result = await (await getTerminalsClient()).hydrate({ projectId, taskId, terminalId });
      if (!result.success) throw new Error(terminalErrorMessage(result.error));
      return result.data.key;
    },
    sessionScopeId: () => taskId,
    fileLinkHandlers: () => makeFileLinkHandlers(projectId, taskId),
  };
}

/** Terminals bound to a project's root workspace; there is no task to anchor them to. */
export function createProjectRootTerminalScope(
  projectId: string,
  workspaceId: string
): TerminalScopeApi {
  return {
    async list() {
      const result = await (await getTerminalsClient()).projectRoot.list({ projectId });
      if (!result.success) throw new Error(terminalErrorMessage(result.error));
      return result.data;
    },
    async create({ id, name, shell, initialSize }) {
      const result = await (
        await getTerminalsClient()
      ).projectRoot.create({ id, projectId, name, shell, initialSize });
      if (!result.success) throw new Error(terminalErrorMessage(result.error));
      return result.data;
    },
    async delete(terminalId) {
      const result = await (
        await getTerminalsClient()
      ).projectRoot.delete({ projectId, terminalId });
      if (!result.success) throw new Error(terminalErrorMessage(result.error));
    },
    async hydrate(terminalId) {
      const result = await (
        await getTerminalsClient()
      ).projectRoot.hydrate({ projectId, terminalId });
      if (!result.success) throw new Error(terminalErrorMessage(result.error));
      return result.data.key;
    },
    sessionScopeId: () => workspaceId,
    // File links open through task editor helpers, which need a task; a no-op is the safe default.
    fileLinkHandlers: () => ({}),
  };
}
