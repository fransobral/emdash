import type { IncomingMessage, ServerResponse } from 'node:http';
import { projectsWireContract } from '@core/features/projects/api';
import { buildCreateTaskParams } from '@core/features/tasks/api/build-create-task-params';
import { tasksWireContract } from '@core/features/tasks/api';
import type { Conversation } from '@core/primitives/conversations/api';
import type { Project } from '@core/primitives/projects/api';
import type { CreateTaskSuccess, TaskListData } from '@core/primitives/tasks/api';
import { encodeTopic, type Controller, type LiveSource } from '@emdash/wire/rpc';

type BridgeOptions = {
  token: string;
  controllers: Record<string, Controller>;
};

type BridgeTaskInput = {
  projectId: string;
  prompt: string;
  provider?: string;
  model?: string;
  name?: string;
  baseBranch?: string;
  agentAutoApprove?: boolean;
};

export function createBridgeHandler(options: BridgeOptions) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/bridge/')) return false;

    applyCors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return true;
    }
    if (req.headers.authorization !== `Bearer ${options.token}`) {
      json(res, 401, { error: 'unauthorized' });
      return true;
    }

    try {
      if (req.method === 'GET' && url.pathname === '/api/bridge/health') {
        json(res, 200, { ok: true });
        return true;
      }
      if (req.method === 'GET' && url.pathname === '/api/bridge/state') {
        json(res, 200, await readState(options.controllers));
        return true;
      }
      if (req.method === 'POST' && url.pathname === '/api/bridge/tasks') {
        const input = validateTaskInput(await readJson(req));
        const params = buildCreateTaskParams(input);
        const result = (await controller(options.controllers, 'tasks').call(
          'createTask',
          params,
          {}
        )) as { success: boolean; data?: CreateTaskSuccess; error?: unknown };
        if (!result.success || !result.data) {
          json(res, 422, { error: result.error ?? 'task creation failed' });
          return true;
        }
        json(res, 201, {
          taskId: result.data.task.id,
          conversationId: result.data.initialConversation?.id ?? null,
        });
        return true;
      }
      const promptMatch = /^\/api\/bridge\/tasks\/([^/]+)\/prompt$/.exec(url.pathname);
      if (req.method === 'POST' && promptMatch) {
        const body = (await readJson(req)) as { prompt?: unknown };
        if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
          throw new HttpError(400, 'prompt is required');
        }
        const conversations = (await controller(options.controllers, 'conversations').call(
          'getConversations',
          undefined,
          {}
        )) as Conversation[];
        const conversation = conversations.find(
          (item) => item.taskId === decodeURIComponent(promptMatch[1]) && item.isInitialConversation
        );
        if (!conversation) throw new HttpError(404, 'initial conversation not found');
        if (conversation.type !== 'acp') {
          throw new HttpError(409, 'prompt bridge currently requires an ACP conversation');
        }
        const result = await controller(options.controllers, 'conversations').call(
          'acp.sendPrompt',
          {
            conversationId: conversation.id,
            promptId: crypto.randomUUID(),
            prompt: { text: body.prompt },
            placement: 'auto',
          },
          {}
        );
        json(res, 202, { conversationId: conversation.id, result });
        return true;
      }

      json(res, 404, { error: 'not found' });
      return true;
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : String(error);
      json(res, status, { error: message });
      return true;
    }
  };
}

async function readState(controllers: Record<string, Controller>) {
  const projectsState = await liveSnapshot<{ projects: Project[] }>(
    controller(controllers, 'projects'),
    projectsWireContract.projectList.states.list.id,
    undefined
  );
  const projects = projectsState.projects;
  const taskEntries = await Promise.all(
    projects.map(async (project) => {
      const state = await liveSnapshot<TaskListData>(
        controller(controllers, 'tasks'),
        tasksWireContract.taskList.states.list.id,
        { projectId: project.id }
      );
      return [
        project.id,
        state.tasks.map((task) => ({
          id: task.id,
          name: task.name,
          status: task.status,
          conversations: task.conversations,
          workspacePath: task.activeWorkspace?.path ?? null,
          lastInteractedAt: task.lastInteractedAt ?? null,
        })),
      ] as const;
    })
  );
  const conversations = (await controller(controllers, 'conversations').call(
    'getConversations',
    undefined,
    {}
  )) as Conversation[];
  const providers = await controller(controllers, 'agents').call('listMetadata', undefined, {});
  return {
    projects,
    tasksByProject: Object.fromEntries(taskEntries),
    activeConversations: conversations.filter((item) => item.agentStatus != null),
    providers,
  };
}

async function liveSnapshot<T>(
  owner: Controller,
  refId: string,
  key: unknown
): Promise<T> {
  const lease = owner.acquireLive(encodeTopic(refId, key));
  if (!lease) throw new Error(`live source unavailable: ${refId}`);
  try {
    const source: LiveSource = await lease.ready();
    const snapshot = await source.snapshot();
    return snapshot.data as T;
  } finally {
    await lease.release();
  }
}

function controller(controllers: Record<string, Controller>, domain: string): Controller {
  const value = controllers[domain];
  if (!value) throw new Error(`controller unavailable: ${domain}`);
  return value;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new HttpError(413, 'request body too large');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

function validateTaskInput(value: unknown): BridgeTaskInput {
  if (!value || typeof value !== 'object') throw new HttpError(400, 'invalid task body');
  const input = value as Record<string, unknown>;
  if (typeof input.projectId !== 'string' || !input.projectId) {
    throw new HttpError(400, 'projectId is required');
  }
  if (typeof input.prompt !== 'string' || !input.prompt.trim()) {
    throw new HttpError(400, 'prompt is required');
  }
  for (const key of ['provider', 'model', 'name', 'baseBranch'] as const) {
    if (input[key] !== undefined && typeof input[key] !== 'string') {
      throw new HttpError(400, `${key} must be a string`);
    }
  }
  if (input.agentAutoApprove !== undefined && typeof input.agentAutoApprove !== 'boolean') {
    throw new HttpError(400, 'agentAutoApprove must be a boolean');
  }
  return input as BridgeTaskInput;
}

function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (origin && isLoopbackOrigin(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
    res.setHeader('access-control-allow-headers', 'Authorization, Content-Type');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  }
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}
