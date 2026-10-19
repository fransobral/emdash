import { hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { err, ok } from '@emdash/shared';
import type { WireFile, LiveSource } from '@emdash/wire/rpc';
import { encodeTopic } from '@emdash/wire/rpc';
import { describe, expect, it, vi } from 'vitest';
import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';
import { terminalsContract } from '../api';
import type { TerminalsRuntimeBroker } from '../api/runtime-adapter';
import { createTerminalsWireController } from './wire-controller';

const identity = {
  projectId: 'project-1',
  workspaceId: 'workspace-1',
  host: LOCAL_HOST_REF,
  path: '/repo/worktree',
} as const;
const controllerDeps = {
  terminalFileSources: { prepare: vi.fn() },
  db: {} as never,
  logger: { warn: vi.fn() } as never,
  projects: { requireAttached: vi.fn(() => ok({} as never)) },
  settings: { get: vi.fn(async () => ({ defaultShell: 'default' })) } as never,
  telemetry: { capture: vi.fn() } as never,
  terminalShell: {
    getColorEnv: vi.fn(async () => ({})),
  } as never,
  sessionLaunchContexts: {
    resolve: vi.fn(async () =>
      ok({
        workspace: identity,
        tmux: false,
        env: {},
      })
    ),
    resolveProjectRoot: vi.fn(),
  },
  resolveSessionGitCredentials: vi.fn(async () => undefined),
};

describe('createTerminalsWireController', () => {
  it.each([LOCAL_HOST_REF, hostRef('remote', 'remote-1')])(
    'routes shell attachments to their workspace host $type',
    async (host) => {
      const ref = {
        id: 'upload-1',
        name: 'notes.txt',
        mimeType: 'text/plain',
        pathStyle: 'posix' as const,
        targetPath: '/host/attachments/notes.txt',
      };
      const upload = vi.fn(async () => ok(ref));
      const remove = vi.fn(async () => ok(undefined));
      const client = vi.fn(async () =>
        ok({ workspaceRegistry: { attachments: { upload, delete: remove } } })
      );
      const controller = createTerminalsWireController({
        ...controllerDeps,
        runtimes: { client } as unknown as TerminalsRuntimeBroker,
        workspaceIdentity: {
          resolve: async () => ({ ...identity, host }),
          resolveProject: vi.fn(),
        },
      });
      const file: WireFile = {
        name: ref.name,
        mimeType: ref.mimeType,
        size: 3,
        stream: async function* () {
          yield new Uint8Array([1, 2, 3]);
        },
        bytes: async () => new Uint8Array([1, 2, 3]),
        file: async () => ({
          name: ref.name,
          mimeType: ref.mimeType,
          stream: async function* () {
            yield new Uint8Array([1, 2, 3]);
          },
        }),
        cancel: vi.fn(),
      };
      const abort = new AbortController();
      await expect(
        controller.call(
          'attachments.upload',
          { workspaceId: identity.workspaceId },
          { uploadFile: file, signal: abort.signal }
        )
      ).resolves.toEqual(ok(ref));
      expect(client).toHaveBeenCalledWith(host);
      expect(upload).toHaveBeenCalledWith(
        { workspaceId: identity.workspaceId },
        expect.objectContaining({ name: 'notes.txt' }),
        { signal: abort.signal }
      );
      await controller.call('attachments.delete', {
        workspaceId: identity.workspaceId,
        attachmentId: ref.id,
      });
      expect(remove).toHaveBeenCalledWith(
        { workspaceId: identity.workspaceId, attachmentId: ref.id },
        {}
      );
    }
  );

  it('translates terminal ids through the resolved client', async () => {
    const sendInput = vi.fn(async () => ok(undefined));
    const client = vi.fn(async () => ok({ terminals: { sendInput } }));
    const controller = createTerminalsWireController({
      ...controllerDeps,
      runtimes: { client } as unknown as TerminalsRuntimeBroker,
      workspaceIdentity: { resolve: vi.fn(async () => identity), resolveProject: vi.fn() },
    });

    await expect(
      controller.call('sendInput', {
        workspaceId: identity.workspaceId,
        terminalId: 'pty:project-1:task-1:terminal-1',
        data: 'echo ready\r',
      })
    ).resolves.toEqual(ok(undefined));

    expect(sendInput).toHaveBeenCalledWith(
      {
        key: {
          workspace: hostFileRefFromNativePath(identity.path),
          id: 'pty:project-1:task-1:terminal-1',
        },
        data: 'echo ready\r',
      },
      {}
    );
    expect(client).toHaveBeenCalledOnce();
  });

  it('returns RuntimeResolveError from fallible terminal procedures', async () => {
    const remoteHost = hostRef('remote', 'ssh-1');
    const resolveError = {
      type: 'host-unavailable' as const,
      host: remoteHost,
      reason: 'runtime-unavailable' as const,
      message: 'Remote runtime sessions are not enabled',
    };
    const controller = createTerminalsWireController({
      ...controllerDeps,
      runtimes: {
        client: async () => err(resolveError),
      } as unknown as TerminalsRuntimeBroker,
      workspaceIdentity: {
        resolve: vi.fn(async () => ({ ...identity, host: remoteHost })),
        resolveProject: vi.fn(),
      },
    });

    await expect(
      controller.call('sendInput', {
        workspaceId: identity.workspaceId,
        terminalId: 'pty:project-1:task-1:terminal-1',
        data: 'echo ready\r',
      })
    ).resolves.toEqual(err(resolveError));
  });

  it('resolves shell availability against the requested host runtime', async () => {
    const availability = [
      { id: 'system' as const, label: 'zsh', isSystemDefault: true, available: true },
    ];
    const getShellAvailability = vi.fn(async () => ok(availability));
    const remoteHost = hostRef('remote', 'ssh-1');
    const client = vi.fn(async () => ok({ terminals: { getShellAvailability } }));
    const controller = createTerminalsWireController({
      ...controllerDeps,
      runtimes: { client } as unknown as TerminalsRuntimeBroker,
      workspaceIdentity: { resolve: vi.fn(), resolveProject: vi.fn() },
    });

    await expect(controller.call('getShellAvailability', { host: remoteHost })).resolves.toEqual(
      ok(availability)
    );
    expect(client).toHaveBeenCalledWith(remoteHost);
    expect(getShellAvailability).toHaveBeenCalledWith(undefined);
  });

  it('surfaces RuntimeResolveError when the availability host is unreachable', async () => {
    const remoteHost = hostRef('remote', 'ssh-1');
    const resolveError = {
      type: 'host-unavailable' as const,
      host: remoteHost,
      reason: 'runtime-unavailable' as const,
      message: 'Remote runtime sessions are not enabled',
    };
    const controller = createTerminalsWireController({
      ...controllerDeps,
      runtimes: {
        client: async () => err(resolveError),
      } as unknown as TerminalsRuntimeBroker,
      workspaceIdentity: { resolve: vi.fn(), resolveProject: vi.fn() },
    });

    await expect(controller.call('getShellAvailability', { host: remoteHost })).resolves.toEqual(
      err(resolveError)
    );
  });

  it('starts terminals with registry shell setup and DB placement tmux', async () => {
    const terminalRow = {
      id: 'terminal-1',
      projectId: identity.projectId,
      taskId: 'task-1',
      name: 'Terminal',
      shellId: 'default',
      ssh: 0,
    };
    const select = vi.fn().mockReturnValueOnce(selecting(terminalRow));
    const resolveLaunchContext = vi.fn(async () =>
      ok({
        workspace: identity,
        tmux: true,
        shellSetup: 'source .workspace-env',
        env: { EMDASH_DEFAULT_BRANCH: 'main' },
      })
    );
    const start = vi.fn(async () => ok(undefined));
    const runtime = {
      terminals: { start },
    };
    const requireAttached = vi.fn(() => ok({} as never));
    const controller = createTerminalsWireController({
      ...controllerDeps,
      db: { select } as never,
      projects: { requireAttached } as never,
      sessionLaunchContexts: { resolve: resolveLaunchContext, resolveProjectRoot: vi.fn() },
      runtimes: {
        client: vi.fn(async () => ok(runtime)),
      } as unknown as TerminalsRuntimeBroker,
      workspaceIdentity: { resolve: vi.fn(async () => identity), resolveProject: vi.fn() },
    });

    await expect(
      controller.call('hydrate', {
        projectId: identity.projectId,
        taskId: terminalRow.taskId,
        terminalId: terminalRow.id,
      })
    ).resolves.toEqual(
      ok({
        key: {
          workspaceId: identity.workspaceId,
          terminalId: `${identity.projectId}:${terminalRow.taskId}:${terminalRow.id}`,
        },
      })
    );
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        spec: expect.objectContaining({
          shellSetup: 'source .workspace-env',
          tmux: true,
          env: expect.objectContaining({ EMDASH_DEFAULT_BRANCH: 'main' }),
        }),
      })
    );
    expect(resolveLaunchContext).toHaveBeenCalledWith({
      projectId: identity.projectId,
      taskId: terminalRow.taskId,
    });
    expect(requireAttached).toHaveBeenCalledWith(identity.projectId);
  });

  describe('projectRoot', () => {
    const rootIdentity = { ...identity, workspaceId: 'root-1', path: '/repo' } as const;
    const rootRow = {
      id: 'terminal-1',
      projectId: identity.projectId,
      taskId: null,
      workspaceId: rootIdentity.workspaceId,
      name: 'Terminal',
      shellId: 'system',
      ssh: 0,
    };
    const rootLaunchContext = {
      workspace: rootIdentity,
      tmux: false,
      shellSetup: 'source .root-env',
      env: { EMDASH_ROOT_PATH: '/repo' },
    };

    function rootController(overrides: Record<string, unknown> = {}) {
      const start = vi.fn(async () => ok(undefined));
      const kill = vi.fn(async () => ok(undefined));
      const resolveProjectRoot = vi.fn(async () => ok(rootLaunchContext));
      const controller = createTerminalsWireController({
        ...controllerDeps,
        sessionLaunchContexts: { resolve: vi.fn(), resolveProjectRoot },
        runtimes: {
          client: vi.fn(async () => ok({ terminals: { start, kill } })),
        } as unknown as TerminalsRuntimeBroker,
        workspaceIdentity: {
          resolve: vi.fn(async () => rootIdentity),
          resolveProject: vi.fn(async () => rootIdentity),
        },
        ...overrides,
      });
      return { controller, start, kill, resolveProjectRoot };
    }

    it('scopes the PTY session id to the root workspace and omits task env vars', async () => {
      const values = vi.fn(() => ({ returning: async () => [rootRow] }));
      const { controller, start } = rootController({
        db: { insert: vi.fn(() => ({ values })) } as never,
      });

      const result = await controller.call('projectRoot.create', {
        id: rootRow.id,
        projectId: identity.projectId,
        name: rootRow.name,
        shell: 'system',
      });

      const ptyId = `${identity.projectId}:${rootIdentity.workspaceId}:${rootRow.id}`;
      expect(result).toEqual(
        ok({
          terminal: {
            id: rootRow.id,
            projectId: identity.projectId,
            workspaceId: rootIdentity.workspaceId,
            shellId: 'system',
            name: 'Terminal',
          },
          key: { workspaceId: rootIdentity.workspaceId, terminalId: ptyId },
        })
      );
      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: null, workspaceId: rootIdentity.workspaceId })
      );
      expect(start).toHaveBeenCalledWith(
        expect.objectContaining({
          key: { workspace: hostFileRefFromNativePath('/repo'), id: ptyId },
          spec: expect.objectContaining({
            cwd: '/repo',
            shellSetup: 'source .root-env',
            env: expect.not.objectContaining({ EMDASH_TASK_ID: expect.anything() }),
          }),
        })
      );
    });

    it('returns missing-workspace when the project has no root workspace', async () => {
      const error = { type: 'missing-workspace', message: 'no root' } as const;
      const insert = vi.fn();
      const { controller } = rootController({
        db: { insert } as never,
        sessionLaunchContexts: {
          resolve: vi.fn(),
          resolveProjectRoot: vi.fn(async () => err(error)),
        },
        workspaceIdentity: { resolve: vi.fn(), resolveProject: vi.fn(async () => null) },
      });

      await expect(
        controller.call('projectRoot.create', {
          id: 'terminal-1',
          projectId: identity.projectId,
          name: 'Terminal',
        })
      ).resolves.toEqual(err(error));
      await expect(
        controller.call('projectRoot.list', { projectId: identity.projectId })
      ).resolves.toMatchObject({ success: false, error: { type: 'missing-workspace' } });
      expect(insert).not.toHaveBeenCalled();
    });

    it('lists only workspace-scoped rows, dropping rows without a workspace', async () => {
      const where = vi.fn(async () => [rootRow, { ...rootRow, id: 'legacy', workspaceId: null }]);
      const { controller } = rootController({
        db: { select: () => ({ from: () => ({ where }) }) } as never,
      });

      await expect(
        controller.call('projectRoot.list', { projectId: identity.projectId })
      ).resolves.toEqual(
        ok([
          {
            id: rootRow.id,
            projectId: identity.projectId,
            workspaceId: rootIdentity.workspaceId,
            shellId: 'system',
            name: 'Terminal',
          },
        ])
      );
      expect(where).toHaveBeenCalledOnce();
    });

    it('hydrates a root terminal with the scoped PTY id', async () => {
      const { controller, start } = rootController({
        db: { select: vi.fn().mockReturnValueOnce(selecting(rootRow)) } as never,
      });

      await expect(
        controller.call('projectRoot.hydrate', {
          projectId: identity.projectId,
          terminalId: rootRow.id,
        })
      ).resolves.toEqual(
        ok({
          key: {
            workspaceId: rootIdentity.workspaceId,
            terminalId: `${identity.projectId}:${rootIdentity.workspaceId}:${rootRow.id}`,
          },
        })
      );
      expect(start).toHaveBeenCalledOnce();
    });

    it('reports missing-terminal when hydrating an unknown root terminal', async () => {
      const { controller } = rootController({
        db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) },
      });

      await expect(
        controller.call('projectRoot.hydrate', {
          projectId: identity.projectId,
          terminalId: 'nope',
        })
      ).resolves.toMatchObject({ success: false, error: { type: 'missing-terminal' } });
    });

    it('deletes the row and kills the scoped PTY session', async () => {
      const deleteWhere = vi.fn(async () => undefined);
      const { controller, kill } = rootController({
        db: {
          select: vi.fn().mockReturnValueOnce(selecting(rootRow)),
          delete: vi.fn(() => ({ where: deleteWhere })),
        } as never,
      });

      await expect(
        controller.call('projectRoot.delete', {
          projectId: identity.projectId,
          terminalId: rootRow.id,
        })
      ).resolves.toEqual(ok(undefined));

      expect(deleteWhere).toHaveBeenCalledOnce();
      expect(kill).toHaveBeenCalledWith({
        key: {
          workspace: hostFileRefFromNativePath('/repo'),
          id: `${identity.projectId}:${rootIdentity.workspaceId}:${rootRow.id}`,
        },
      });
    });
  });

  it('keeps project-root rows out of the task terminal list', async () => {
    const taskRow = {
      id: 'terminal-task',
      projectId: identity.projectId,
      taskId: 'task-1',
      workspaceId: null,
      name: 'Task terminal',
      shellId: 'system',
      ssh: 0,
    };
    const rootRow = { ...taskRow, id: 'terminal-root', taskId: null, workspaceId: 'root-1' };
    const where = vi.fn(async () => [taskRow, rootRow]);
    const controller = createTerminalsWireController({
      ...controllerDeps,
      db: { select: () => ({ from: () => ({ where }) }) } as never,
      runtimes: { client: vi.fn() } as unknown as TerminalsRuntimeBroker,
      workspaceIdentity: { resolve: vi.fn(), resolveProject: vi.fn() },
    });

    const result = await controller.call('list', {
      projectId: identity.projectId,
      taskId: 'task-1',
    });

    expect(result).toEqual(
      ok([
        {
          id: 'terminal-task',
          projectId: identity.projectId,
          taskId: 'task-1',
          ssh: false,
          shellId: 'system',
          name: 'Task terminal',
        },
      ])
    );
  });

  it('resolves the output source for the workspace host', async () => {
    const source = liveSource();
    const handle = vi.fn(() => ({ asLiveSource: () => source }));
    const controller = createTerminalsWireController({
      ...controllerDeps,
      runtimes: {
        client: async () => ok({ terminals: { output: { handle } } }),
      } as unknown as TerminalsRuntimeBroker,
      workspaceIdentity: { resolve: vi.fn(async () => identity), resolveProject: vi.fn() },
    });
    const key = {
      workspaceId: identity.workspaceId,
      terminalId: 'pty:project-1:task-1:terminal-1',
    };
    const lease = controller.acquireLive(encodeTopic(terminalsContract.output.id, key));

    const output = await lease?.ready();
    const unsubscribe = await output?.subscribe(vi.fn());
    expect(handle).toHaveBeenCalledWith({
      workspace: hostFileRefFromNativePath(identity.path),
      id: key.terminalId,
    });

    unsubscribe?.();
    await lease?.release();
  });
});

function liveSource(): LiveSource {
  return {
    snapshot: async () => ({
      generation: 1,
      sequence: 0,
      timestamp: 0,
      data: { baseOffset: 0, text: '', truncated: false },
    }),
    subscribe: () => () => {},
  };
}

function selecting<T>(row: T) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => [row],
      }),
    }),
  };
}
