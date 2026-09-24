import { lstat, mkdir, open, readdir, realpath, unlink } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { projectsWireContract } from '@core/features/projects/api';
import { tasksWireContract } from '@core/features/tasks/api';
import { buildCreateTaskParams } from '@core/features/tasks/api/build-create-task-params';
import type { Conversation } from '@core/primitives/conversations/api';
import type { Project } from '@core/primitives/projects/api';
import type { CreateTaskSuccess, TaskListData } from '@core/primitives/tasks/api';
import { encodeTopic, type Controller, type LiveSource } from '@emdash/wire/rpc';

type BridgeOptions = {
  token: string;
  controllers: Record<string, Controller>;
};

type UploadedFile = { name: string; path: string; sizeBytes: number };
const GENERAL_UPLOAD_ROOT = '/home/ubuntu/uploads';

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
        const projectsState = await liveSnapshot<{ projects: Project[] }>(
          controller(options.controllers, 'projects'),
          projectsWireContract.projectList.states.list.id,
          undefined
        );
        const project = projectsState.projects.find((item) => item.id === input.projectId);
        if (!project) throw new HttpError(404, 'project not found');
        const params = buildCreateTaskParams({
          ...input,
          repositoryWorkspaceId: project.repositoryWorkspaceId ?? undefined,
        });
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
      if (req.method === 'POST' && url.pathname === '/api/bridge/upload') {
        const files = await receiveUpload(req, options.controllers);
        json(res, 201, files);
        return true;
      }
      if (req.method === 'GET' && url.pathname === '/api/bridge/uploads') {
        const root = await resolveUploadRoot(options.controllers, {
          destType: url.searchParams.get('destType'),
          projectId: url.searchParams.get('projectId'),
          subPath: url.searchParams.get('subPath'),
        });
        json(res, 200, await listUploads(root));
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

async function receiveUpload(
  req: IncomingMessage,
  controllers: Record<string, Controller>
): Promise<UploadedFile[]> {
  const boundary = multipartBoundary(req.headers['content-type']);
  const parser = new MultipartParser(boundary, controllers);
  try {
    for await (const chunk of req) {
      await parser.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return await parser.finish();
  } catch (error) {
    await parser.abort();
    throw error;
  }
}

class MultipartParser {
  private readonly marker: Buffer;
  private readonly delimiter: Buffer;
  private buffer = Buffer.alloc(0);
  private started = false;
  private done = false;
  private headers: Record<string, string> | null = null;
  private fieldName = '';
  private filename: string | null = null;
  private fieldChunks: Buffer[] = [];
  private fileHandle: Awaited<ReturnType<typeof open>> | null = null;
  private filePath = '';
  private fileSize = 0;
  private readonly fields = new Map<string, string>();
  private readonly files: UploadedFile[] = [];
  private uploadRoot: string | null = null;
  private readonly maxBytes =
    Math.max(1, Number(process.env.EMDASH_WEB_UPLOAD_MAX_MB ?? 200)) * 1024 * 1024;

  constructor(
    boundary: string,
    private readonly controllers: Record<string, Controller>
  ) {
    this.marker = Buffer.from(`--${boundary}`);
    this.delimiter = Buffer.from(`\r\n--${boundary}`);
  }

  async push(chunk: Buffer): Promise<void> {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    await this.process(false);
  }

  async finish(): Promise<UploadedFile[]> {
    await this.process(true);
    if (!this.done) throw new HttpError(400, 'incomplete multipart body');
    return this.files;
  }

  async abort(): Promise<void> {
    await this.fileHandle?.close().catch(() => undefined);
    this.fileHandle = null;
    if (this.filePath) await unlink(this.filePath).catch(() => undefined);
    await Promise.all(this.files.map((file) => unlink(file.path).catch(() => undefined)));
  }

  private async process(final: boolean): Promise<void> {
    for (;;) {
      if (!this.started) {
        if (this.buffer.length < this.marker.length + 2) return;
        if (!this.buffer.subarray(0, this.marker.length).equals(this.marker)) {
          throw new HttpError(400, 'invalid multipart boundary');
        }
        this.buffer = this.buffer.subarray(this.marker.length + 2);
        this.started = true;
      }
      if (this.done) return;
      if (!this.headers) {
        const headerEnd = this.buffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) {
          if (this.buffer.length > 16_384) throw new HttpError(400, 'multipart headers too large');
          return;
        }
        this.startPart(this.buffer.subarray(0, headerEnd).toString('utf8'));
        this.buffer = this.buffer.subarray(headerEnd + 4);
      }
      const boundaryIndex = this.buffer.indexOf(this.delimiter);
      if (boundaryIndex >= 0) {
        await this.writePart(this.buffer.subarray(0, boundaryIndex));
        await this.endPart();
        this.buffer = this.buffer.subarray(boundaryIndex + this.delimiter.length);
        if (this.buffer.length < 2) return;
        if (this.buffer.subarray(0, 2).toString() === '--') {
          this.done = true;
          return;
        }
        if (this.buffer.subarray(0, 2).toString() !== '\r\n') {
          throw new HttpError(400, 'invalid multipart separator');
        }
        this.buffer = this.buffer.subarray(2);
        continue;
      }
      const retained = this.delimiter.length + 4;
      if (this.buffer.length > retained) {
        const writableLength = this.buffer.length - retained;
        await this.writePart(this.buffer.subarray(0, writableLength));
        this.buffer = this.buffer.subarray(writableLength);
      }
      if (final && this.buffer.length > 0) throw new HttpError(400, 'missing final boundary');
      return;
    }
  }

  private startPart(rawHeaders: string): void {
    this.headers = Object.fromEntries(
      rawHeaders.split('\r\n').map((line) => {
        const colon = line.indexOf(':');
        if (colon < 1) throw new HttpError(400, 'invalid multipart header');
        return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
      })
    );
    const disposition = this.headers['content-disposition'] ?? '';
    this.fieldName = dispositionParam(disposition, 'name') ?? '';
    this.filename = dispositionParam(disposition, 'filename');
    this.fieldChunks = [];
    this.fileSize = 0;
  }

  private async writePart(chunk: Buffer): Promise<void> {
    if (!this.filename) {
      const currentSize = this.fieldChunks.reduce((total, item) => total + item.length, 0);
      if (currentSize + chunk.length > 65_536) throw new HttpError(413, 'form field too large');
      this.fieldChunks.push(chunk);
      return;
    }
    if (!this.fileHandle) await this.openFile();
    this.fileSize += chunk.length;
    if (this.fileSize > this.maxBytes) throw new HttpError(413, 'file exceeds upload limit');
    await this.fileHandle!.write(chunk);
  }

  private async openFile(): Promise<void> {
    if (!this.uploadRoot) {
      this.uploadRoot = await resolveUploadRoot(this.controllers, {
        destType: this.fields.get('destType') ?? null,
        projectId: this.fields.get('projectId') ?? null,
        subPath: this.fields.get('subPath') ?? null,
      });
    }
    const safeName = basename(this.filename ?? '');
    if (!safeName || safeName === '.' || safeName === '..') {
      throw new HttpError(400, 'invalid filename');
    }
    this.filePath = resolve(this.uploadRoot, safeName);
    assertInside(this.uploadRoot, this.filePath);
    try {
      const existing = await lstat(this.filePath);
      if (existing.isSymbolicLink()) throw new HttpError(400, 'symlink upload target rejected');
      throw new HttpError(409, `file already exists: ${safeName}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    this.fileHandle = await open(this.filePath, 'wx', 0o600);
  }

  private async endPart(): Promise<void> {
    if (this.filename) {
      if (!this.fileHandle) await this.openFile();
      await this.fileHandle!.close();
      this.fileHandle = null;
      this.files.push({
        name: basename(this.filename),
        path: this.filePath,
        sizeBytes: this.fileSize,
      });
    } else if (this.fieldName) {
      this.fields.set(this.fieldName, Buffer.concat(this.fieldChunks).toString('utf8'));
    }
    this.headers = null;
    this.filename = null;
  }
}

async function resolveUploadRoot(
  controllers: Record<string, Controller>,
  input: { destType: string | null; projectId: string | null; subPath: string | null }
): Promise<string> {
  let base: string;
  if (input.destType === 'general') {
    base = GENERAL_UPLOAD_ROOT;
  } else if (input.destType === 'project') {
    if (!input.projectId) throw new HttpError(400, 'projectId is required');
    const state = await liveSnapshot<{ projects: Project[] }>(
      controller(controllers, 'projects'),
      projectsWireContract.projectList.states.list.id,
      undefined
    );
    const project = state.projects.find((item) => item.id === input.projectId);
    if (!project) throw new HttpError(404, 'project not found');
    if (project.type !== 'local') throw new HttpError(400, 'uploads require a local project');
    base = project.path;
  } else {
    throw new HttpError(400, "destType must be 'general' or 'project'");
  }
  const baseResolved = resolve(base);
  assertInside('/home/ubuntu', baseResolved);
  await mkdir(baseResolved, { recursive: true });
  const baseReal = await realpath(baseResolved);
  assertInside('/home/ubuntu', baseReal);
  return await safeSubdirectory(baseReal, input.subPath ?? '');
}

async function safeSubdirectory(root: string, subPath: string): Promise<string> {
  if (isAbsolute(subPath)) throw new HttpError(400, 'subPath must be relative');
  const parts = subPath.split(/[\\/]+/).filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new HttpError(400, 'path traversal rejected');
  }
  let current = root;
  for (const part of parts) {
    current = resolve(current, part);
    assertInside(root, current);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) throw new HttpError(400, 'symlink path rejected');
      if (!entry.isDirectory()) throw new HttpError(400, 'upload path is not a directory');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await mkdir(current, { mode: 0o700 });
    }
  }
  const result = await realpath(current);
  assertInside(root, result);
  return result;
}

async function listUploads(root: string): Promise<UploadedFile[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const path = resolve(root, entry.name);
        const stat = await lstat(path);
        return { name: entry.name, path, sizeBytes: stat.size };
      })
  );
}

function assertInside(root: string, target: string): void {
  const rel = relative(root, target);
  if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) return;
  throw new HttpError(400, 'path escapes allowed root');
}

function multipartBoundary(contentType: string | undefined): string {
  const match = /multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType ?? '');
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary) throw new HttpError(400, 'multipart boundary is required');
  return boundary;
}

function dispositionParam(value: string, name: string): string | null {
  const match = new RegExp(`(?:^|;)\\s*${name}="([^"]*)"`, 'i').exec(value);
  return match?.[1] ?? null;
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

async function liveSnapshot<T>(owner: Controller, refId: string, key: unknown): Promise<T> {
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
