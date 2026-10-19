import type { TerminalShellId } from '@emdash/core/primitives/terminal-shell/api';
import type { Disposable } from '@emdash/shared/concurrency';
import { ReplicaLog } from '@emdash/wire/live';
import type { Terminal as XtermTerminal } from '@xterm/xterm';
import { computed, makeObservable, observable, reaction, runInAction } from 'mobx';
import {
  classifyLiveRuntimeObservation,
  type LiveRuntimeObservation,
} from '@core/features/projects/api/browser/live-runtime-observation';
import type { ProjectHostAccess } from '@core/features/projects/api/browser/stores/project-context';
import { getAppSettingValueSnapshot } from '@core/features/settings/api/browser/app-settings-client';
import type { TerminalRuntimeKey } from '@core/features/terminals/api';
import {
  getTerminalsClient,
  type TerminalsClient,
} from '@core/features/terminals/api/browser/client';
import type { FrontendPtyConnector } from '@core/features/terminals/api/browser/pty/pty';
import { PtySession } from '@core/features/terminals/api/browser/pty/pty-session';
import { createXtermLogSink } from '@core/features/terminals/api/browser/pty/xterm-log-sink';
import {
  createTaskTerminalScope,
  terminalErrorMessage,
  type ManagedTerminal,
  type ManagedTerminalCreateParams,
  type TerminalScopeApi,
} from '@core/features/terminals/api/browser/task-terminal/terminal-scope';
import { Resource } from '@core/primitives/async-resource/browser/resource';
import { log } from '@core/primitives/logging/browser/logger';
import { makePtySessionId } from '@core/primitives/pty/api';
import { nextTerminalName } from '../../../browser/task-terminal/terminal-tabs';

export class TerminalManagerStore implements Disposable {
  readonly projectId: string;
  /** Scope key the manager is registered under: a task id, or the project id for project-root terminals. */
  readonly taskId: string;
  /** Data layer: plain Terminal records loaded from the main process. */
  readonly list: Resource<ManagedTerminal[]>;
  /** Data stores keyed by terminal id — populated by reaction on list.data. */
  terminals = observable.map<string, TerminalStore>();
  /** Session layer keyed by terminal id — created alongside data, connected lazily. */
  sessions = observable.map<string, PtySession>();
  // Shallow: TerminalKey values must stay plain objects so they can be
  // structured-cloned when posted over the wire (MobX proxies cannot).
  runtimeKeys = observable.map<string, TerminalRuntimeKey>({}, { deep: false });
  private readonly _disposeReaction: () => void;
  private readonly _disposeHostReaction: () => void;

  constructor(
    projectId: string,
    taskId: string,
    readonly hostAccess?: ProjectHostAccess,
    private readonly scope: TerminalScopeApi = createTaskTerminalScope(projectId, taskId)
  ) {
    this.projectId = projectId;
    this.taskId = taskId;

    this.list = new Resource<ManagedTerminal[]>(() => this.scope.list(), [{ kind: 'demand' }]);

    makeObservable(this, {
      terminals: observable,
      sessions: observable,
      runtimeKeys: observable,
      isLoaded: computed,
      observation: computed,
    });

    // Sync terminals and sessions maps whenever the resource data changes.
    // fireImmediately ensures the reaction runs once on construction to establish
    // the dependency on list.data, which triggers the demand-strategy load.
    this._disposeReaction = reaction(
      () => this.list.data,
      (data) => {
        if (!data) return;
        runInAction(() => {
          const incomingIds = new Set(data.map((t) => t.id));

          // Add new entries (no connect()).
          for (const terminal of data) {
            if (!this.terminals.has(terminal.id)) {
              this.terminals.set(terminal.id, new TerminalStore(terminal));
            }
            if (!this.sessions.has(terminal.id)) {
              this.sessions.set(terminal.id, this.createSession(terminal));
            }
          }

          // Remove stale entries.
          const staleIds = Array.from(this.terminals.keys()).filter((id) => !incomingIds.has(id));
          for (const id of staleIds) {
            this.sessions.get(id)?.destroy();
            this.sessions.delete(id);
            this.terminals.delete(id);
          }
        });
      },
      { fireImmediately: true }
    );
    const initialHost = this.hostAccess?.state;
    let lastHostGeneration = initialHost?.kind === 'ready' ? initialHost.hostGeneration : undefined;
    this._disposeHostReaction = reaction(
      () => this.hostAccess?.state,
      (state) => {
        if (state?.kind !== 'ready') return;
        this.list.invalidate();
        const changed = lastHostGeneration !== state.hostGeneration;
        lastHostGeneration = state.hostGeneration;
        for (const session of this.sessions.values()) {
          if (!changed) {
            session.resumeIfRequested();
            continue;
          }
          void session.refreshAttachment().catch((error) => {
            log.warn('Terminal attachment recovery failed', { error });
          });
        }
      }
    );
  }

  get isLoaded(): boolean {
    return this.list.data !== null;
  }

  get observation(): LiveRuntimeObservation<ManagedTerminal[]> {
    return classifyLiveRuntimeObservation(
      this.hostAccess?.state ?? { kind: 'ready', hostGeneration: 0 },
      this.list.data ?? undefined
    );
  }

  async createTerminal(params: ManagedTerminalCreateParams): Promise<ManagedTerminal> {
    if (this.hostAccess?.liveAction.kind === 'disabled') {
      throw new Error('Live actions are unavailable for this Project.');
    }
    const defaultShell = getAppSettingValueSnapshot('terminal')?.defaultShell ?? 'system';
    const optimistic: ManagedTerminal = {
      id: params.id,
      projectId: this.projectId,
      shellId: params.shell ?? defaultShell,
      name: params.name,
    };

    runInAction(() => {
      this.terminals.set(params.id, new TerminalStore(optimistic));
      this.sessions.set(params.id, this.createSession(optimistic));
    });

    try {
      const { terminal, key } = await this.scope.create(params);
      runInAction(() => {
        const store = this.terminals.get(params.id);
        if (store) {
          Object.assign(store.data, terminal);
        }
        this.runtimeKeys.set(params.id, key);
      });
      return terminal;
    } catch (err) {
      runInAction(() => {
        this.sessions.get(params.id)?.destroy();
        this.sessions.delete(params.id);
        this.terminals.delete(params.id);
      });
      throw err;
    }
  }

  async createDefaultTerminal(shell?: TerminalShellId): Promise<ManagedTerminal> {
    const names = Array.from(this.terminals.values()).map((t) => t.data.name);
    const name = nextTerminalName(names);
    const id = crypto.randomUUID();
    const params: ManagedTerminalCreateParams = { id, name };
    if (shell !== undefined) params.shell = shell;
    return this.createTerminal(params);
  }

  async deleteTerminal(terminalId: string): Promise<void> {
    const store = this.terminals.get(terminalId);
    const session = this.sessions.get(terminalId);
    if (!store) return;

    runInAction(() => {
      this.terminals.delete(terminalId);
      this.sessions.delete(terminalId);
    });

    try {
      await this.scope.delete(terminalId);
      session?.destroy();
    } catch (err) {
      runInAction(() => {
        this.terminals.set(terminalId, store);
        if (session) this.sessions.set(terminalId, session);
      });
      throw err;
    }
  }

  async hydrateTerminal(terminalId: string): Promise<void> {
    const store = this.terminals.get(terminalId);
    if (!store) return;
    if (this.hostAccess?.liveAction.kind === 'disabled') {
      throw new Error('Live actions are unavailable for this Project.');
    }
    const key = await this.scope.hydrate(terminalId);
    runInAction(() => {
      this.runtimeKeys.set(terminalId, key);
    });
  }

  dispose(): void {
    this._disposeReaction();
    this._disposeHostReaction();
    for (const session of this.sessions.values()) {
      session.destroy();
    }
    this.list.dispose();
  }

  async renameTerminal(terminalId: string, name: string): Promise<void> {
    const store = this.terminals.get(terminalId);
    if (!store) return;

    const previousName = store.data.name;

    runInAction(() => {
      store.data.name = name;
    });

    try {
      const result = await (await getTerminalsClient()).rename({ terminalId, name });
      if (!result.success) throw new Error(terminalErrorMessage(result.error));
    } catch (err) {
      runInAction(() => {
        store.data.name = previousName;
      });
      throw err;
    }
  }

  private createSession(terminal: ManagedTerminal): PtySession {
    const handlers = this.scope.fileLinkHandlers(terminal);
    return new PtySession(
      makePtySessionId(terminal.projectId, this.scope.sessionScopeId(), terminal.id),
      () => this.hydrateTerminal(terminal.id),
      handlers.onOpenFile,
      handlers.onOpenExternal,
      createTerminalsConnector(
        () => this.ensureRuntimeKey(terminal.id),
        () => {
          const state = this.hostAccess?.state;
          return !state ? 0 : state.kind === 'ready' ? state.hostGeneration : undefined;
        }
      ),
      () => this.hostAccess?.liveAction.kind !== 'disabled'
    );
  }

  private async ensureRuntimeKey(terminalId: string): Promise<TerminalRuntimeKey> {
    const existing = this.runtimeKeys.get(terminalId);
    if (existing) return existing;
    await this.hydrateTerminal(terminalId);
    const key = this.runtimeKeys.get(terminalId);
    if (!key) throw new Error(`Terminal ${terminalId} did not hydrate`);
    return key;
  }
}

export class TerminalStore {
  data: ManagedTerminal;

  constructor(terminal: ManagedTerminal) {
    this.data = terminal;
    makeObservable(this, { data: observable });
  }
}

function createTerminalsConnector(
  key: () => Promise<TerminalRuntimeKey>,
  generation: () => number | undefined
): FrontendPtyConnector {
  let logBinding: ReplicaLog | null = null;
  let runtimePromise: Promise<TerminalsClient> | null = null;
  const runtime = () => {
    runtimePromise ??= getTerminalsClient();
    return runtimePromise;
  };

  return {
    async connect(terminal: XtermTerminal) {
      const [terminalsRuntime, terminalKey] = await Promise.all([runtime(), key()]);
      logBinding = new ReplicaLog(terminalsRuntime.output.handle(terminalKey), {
        store: createXtermLogSink(terminal),
      });
      await logBinding.ready;
      return () => {
        void logBinding?.dispose();
        logBinding = null;
      };
    },
    sendInput(data: string) {
      const sentGeneration = generation();
      if (sentGeneration === undefined) return;
      void Promise.all([runtime(), key()])
        .then(async ([terminalsRuntime, terminalKey]) => {
          if (generation() !== sentGeneration) return;
          const result = await terminalsRuntime.sendInput({ ...terminalKey, data });
          if (!result.success) {
            log.warn('TerminalManagerStore: terminal input failed', {
              terminalId: terminalKey.terminalId,
              error: result.error,
            });
          }
        })
        .catch((error) => {
          log.warn('TerminalManagerStore: failed to send terminal input', { error });
        });
    },
    resize(cols: number, rows: number) {
      void Promise.all([runtime(), key()])
        .then(async ([terminalsRuntime, terminalKey]) => {
          const result = await terminalsRuntime.resize({ ...terminalKey, cols, rows });
          if (!result.success) {
            log.warn('TerminalManagerStore: terminal resize failed', {
              terminalId: terminalKey.terminalId,
              error: result.error,
            });
          }
        })
        .catch((error) => {
          log.warn('TerminalManagerStore: failed to resize terminal', { error });
        });
    },
  };
}
