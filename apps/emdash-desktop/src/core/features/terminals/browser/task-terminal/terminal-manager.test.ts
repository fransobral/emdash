import { observable, runInAction } from 'mobx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ProjectHostAccess,
  ProjectHostAccessState,
} from '@core/features/projects/api/browser/stores/project-context';
import { TerminalManagerStore } from '@core/features/terminals/api/browser/task-terminal/terminal-manager';
import { createProjectRootTerminalScope } from '@core/features/terminals/api/browser/task-terminal/terminal-scope';

const createTerminal = vi.hoisted(() => vi.fn());
const listTerminals = vi.hoisted(() => vi.fn());
const hydrateTerminal = vi.hoisted(() => vi.fn());
const renameTerminal = vi.hoisted(() => vi.fn());
const deleteTerminal = vi.hoisted(() => vi.fn());
const frontendConnect = vi.hoisted(() => vi.fn());
const frontendDispose = vi.hoisted(() => vi.fn());
const getAppSettingValueSnapshot = vi.hoisted(() => vi.fn());
const projectRoot = vi.hoisted(() => ({
  create: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
  hydrate: vi.fn(),
}));

vi.mock('@core/features/editor/api/browser/open-file-in-file-editor', () => ({
  makeFileLinkHandlers: () => ({}),
}));

vi.mock('@core/features/settings/api/browser/app-settings-client', () => ({
  getAppSettingValueSnapshot,
}));

vi.mock('@core/features/terminals/api/browser/client', () => ({
  getTerminalsClient: async () => ({
    create: createTerminal,
    delete: deleteTerminal,
    list: listTerminals,
    hydrate: hydrateTerminal,
    rename: renameTerminal,
    projectRoot,
  }),
}));

vi.mock('@core/features/terminals/api/browser/pty/pty', () => ({
  FrontendPty: class {
    constructor(readonly sessionId: string) {}

    connect = frontendConnect;
    dispose = frontendDispose;
  },
}));

vi.mock('@core/features/conversations/browser/acp/acp-chat-store', () => ({
  AcpChatStore: class {
    conversationId = '';
    dispose() {}
    bootstrap() {}
  },
}));

vi.mock('@core/features/conversations/browser/acp/acp-chat-panel', () => ({
  AcpChatPanel: () => null,
}));

describe('TerminalManagerStore session hydration', () => {
  beforeEach(() => {
    createTerminal.mockReset();
    listTerminals.mockReset();
    hydrateTerminal.mockReset();
    renameTerminal.mockReset();
    deleteTerminal.mockReset();
    frontendConnect.mockReset();
    frontendDispose.mockReset();
    getAppSettingValueSnapshot.mockReset();

    createTerminal.mockImplementation(async (input) => ({
      success: true,
      data: {
        terminal: { ...input, shellId: input.shell ?? 'system' },
        key: { workspaceId: 'workspace-1', terminalId: input.id },
      },
    }));
    listTerminals.mockResolvedValue({ success: true, data: [] });
    hydrateTerminal.mockResolvedValue({
      success: true,
      data: {
        key: { workspaceId: 'workspace-1', terminalId: 'terminal-1' },
      },
    });
    renameTerminal.mockResolvedValue({ success: true, data: undefined });
    deleteTerminal.mockResolvedValue({ success: true, data: undefined });
    frontendConnect.mockResolvedValue(undefined);
    getAppSettingValueSnapshot.mockReturnValue(undefined);
  });

  it('creates terminal sessions from records without hydrating until the session connects', async () => {
    listTerminals.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'terminal-1',
          projectId: 'project-1',
          taskId: 'task-1',
          shellId: 'system',
          name: 'Terminal 1',
        },
      ],
    });
    const store = new TerminalManagerStore('project-1', 'task-1');

    store.list.setValue([
      {
        id: 'terminal-1',
        projectId: 'project-1',
        taskId: 'task-1',
        shellId: 'system',
        name: 'Terminal 1',
      },
    ]);

    expect(hydrateTerminal).not.toHaveBeenCalled();

    const session = store.sessions.get('terminal-1');
    expect(session).toBeDefined();

    await session?.connect();

    expect(hydrateTerminal).toHaveBeenCalledTimes(1);
    expect(hydrateTerminal).toHaveBeenCalledWith({
      projectId: 'project-1',
      taskId: 'task-1',
      terminalId: 'terminal-1',
    });
    expect(frontendConnect).toHaveBeenCalledTimes(1);

    await session?.connect();

    expect(hydrateTerminal).toHaveBeenCalledTimes(1);
    expect(frontendConnect).toHaveBeenCalledTimes(1);

    store.dispose();
  });

  it('uses the cached default shell for optimistic terminals when no shell is specified', async () => {
    getAppSettingValueSnapshot.mockReturnValue({ defaultShell: 'fish' });
    createTerminal.mockResolvedValue({
      success: true,
      data: {
        terminal: {
          id: 'terminal-1',
          projectId: 'project-1',
          taskId: 'task-1',
          shellId: 'fish',
          name: 'Terminal 1',
        },
        key: { workspaceId: 'workspace-1', terminalId: 'terminal-1' },
      },
    });
    const store = new TerminalManagerStore('project-1', 'task-1');

    const promise = store.createTerminal({
      id: 'terminal-1',
      projectId: 'project-1',
      taskId: 'task-1',
      name: 'Terminal 1',
    });

    expect(store.terminals.get('terminal-1')?.data.shellId).toBe('fish');
    await promise;
    store.dispose();
  });

  it('keeps observed terminal records stale and blocks live creation while offline', async () => {
    const host = {
      state: {
        kind: 'degraded',
        situation: 'offline',
        recovery: 'automatic',
      },
      liveAction: {
        kind: 'disabled',
        state: {
          kind: 'degraded',
          situation: 'offline',
          recovery: 'automatic',
        },
      },
    } as ProjectHostAccess;
    const store = new TerminalManagerStore('project-1', 'task-1', host);
    store.list.setValue([]);

    expect(store.observation).toEqual({ kind: 'stale', value: [] });
    await expect(
      store.createTerminal({
        id: 'terminal-offline',
        projectId: 'project-1',
        taskId: 'task-1',
        name: 'Terminal 1',
      })
    ).rejects.toThrow('Live actions are unavailable');
    expect(createTerminal).not.toHaveBeenCalled();
    expect(store.terminals.has('terminal-offline')).toBe(false);
    store.dispose();
  });

  it('keeps a requested session disconnected offline and reconnects it after recovery', async () => {
    listTerminals.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'terminal-1',
          projectId: 'project-1',
          taskId: 'task-1',
          shellId: 'system',
          name: 'Terminal 1',
        },
      ],
    });
    const state = observable.box<ProjectHostAccessState>({
      kind: 'degraded',
      situation: 'offline',
      recovery: 'automatic',
    });
    const hostAccess = {
      get state() {
        return state.get();
      },
      get liveAction() {
        const current = state.get();
        return current.kind === 'ready'
          ? ({ kind: 'enabled' } as const)
          : ({ kind: 'disabled', state: current } as const);
      },
    } as ProjectHostAccess;
    const store = new TerminalManagerStore('project-1', 'task-1', hostAccess);
    store.list.setValue([
      {
        id: 'terminal-1',
        projectId: 'project-1',
        taskId: 'task-1',
        shellId: 'system',
        name: 'Terminal 1',
      },
    ]);
    const session = store.sessions.get('terminal-1');

    await session?.connect();

    expect(session?.status).toBe('disconnected');
    expect(hydrateTerminal).not.toHaveBeenCalled();

    runInAction(() => state.set({ kind: 'ready', hostGeneration: 2 }));
    await vi.waitFor(() => expect(session?.status).toBe('ready'));
    expect(hydrateTerminal).toHaveBeenCalledTimes(1);
    expect(frontendConnect).toHaveBeenCalledTimes(1);
    store.dispose();
  });
});

describe('TerminalManagerStore project-root scope', () => {
  beforeEach(() => {
    projectRoot.create.mockReset();
    projectRoot.delete.mockReset();
    projectRoot.list.mockReset();
    projectRoot.hydrate.mockReset();
    createTerminal.mockReset();
    getAppSettingValueSnapshot.mockReset();
    projectRoot.list.mockResolvedValue({ success: true, data: [] });
  });

  function projectRootStore() {
    return new TerminalManagerStore(
      'project-1',
      'project-1',
      undefined,
      createProjectRootTerminalScope('project-1', 'root-1')
    );
  }

  it('creates terminals through the projectRoot procedures and scopes sessions by workspace', async () => {
    projectRoot.create.mockImplementation(async (input) => ({
      success: true,
      data: {
        terminal: {
          id: input.id,
          projectId: 'project-1',
          workspaceId: 'root-1',
          shellId: 'system',
          name: input.name,
        },
        key: { workspaceId: 'root-1', terminalId: `project-1:root-1:${input.id}` },
      },
    }));
    const store = projectRootStore();
    await vi.waitFor(() => expect(store.isLoaded).toBe(true));

    const terminal = await store.createDefaultTerminal();

    expect(projectRoot.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: terminal.id, projectId: 'project-1' })
    );
    expect(projectRoot.create.mock.calls[0][0]).not.toHaveProperty('taskId');
    expect(createTerminal).not.toHaveBeenCalled();
    expect(store.sessions.get(terminal.id)?.sessionId).toBe(`project-1:root-1:${terminal.id}`);

    store.dispose();
  });

  it('hydrates and deletes through the projectRoot procedures', async () => {
    projectRoot.hydrate.mockResolvedValue({
      success: true,
      data: { key: { workspaceId: 'root-1', terminalId: 'project-1:root-1:terminal-1' } },
    });
    projectRoot.delete.mockResolvedValue({ success: true, data: undefined });
    const store = projectRootStore();
    await vi.waitFor(() => expect(store.isLoaded).toBe(true));
    store.list.setValue([
      { id: 'terminal-1', projectId: 'project-1', shellId: 'system', name: 'Terminal 1' },
    ]);

    await store.hydrateTerminal('terminal-1');
    expect(projectRoot.hydrate).toHaveBeenCalledWith({
      projectId: 'project-1',
      terminalId: 'terminal-1',
    });

    await store.deleteTerminal('terminal-1');
    expect(projectRoot.delete).toHaveBeenCalledWith({
      projectId: 'project-1',
      terminalId: 'terminal-1',
    });
    expect(store.terminals.has('terminal-1')).toBe(false);

    store.dispose();
  });
});
