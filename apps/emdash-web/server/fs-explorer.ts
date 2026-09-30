import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, stat, statfs, unlink } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

/**
 * File explorer for the web app: browse any folder on the machine, create
 * folders, download files, and upload files of any size.
 *
 * The web app already grants terminal access with the same token, so the
 * explorer is not confined to a root; the server's OS user bounds it.
 * Uploads arrive in chunks because the Cloudflare tunnel rejects request
 * bodies over 100 MB; a partial file lives next to its target so an
 * interrupted upload resumes from the bytes already on disk.
 */

export type FsEntry = {
  name: string;
  path: string;
  kind: 'directory' | 'file' | 'other';
  sizeBytes: number;
  modifiedAt: number;
  symlink: boolean;
};

export type FsListing = { path: string; parent: string | null; entries: FsEntry[] };

export class FsHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/** Chunks must stay well under Cloudflare's 100 MB request body limit. */
export const MAX_UPLOAD_CHUNK_BYTES = 64 * 1024 * 1024;
const PARTIAL_SUFFIX = '.emdash-upload';
const DOWNLOAD_TICKET_TTL_MS = 60_000;

export function absolutePath(raw: string | null): string {
  if (!raw || !isAbsolute(raw)) throw new FsHttpError(400, 'an absolute path is required');
  if (raw.includes('\0')) throw new FsHttpError(400, 'invalid path');
  return resolve(raw);
}

export function entryName(raw: string | null): string {
  const name = raw ?? '';
  if (!name || name !== basename(name) || name === '.' || name === '..' || name.includes('\0')) {
    throw new FsHttpError(400, 'invalid file name');
  }
  if (name.endsWith(PARTIAL_SUFFIX)) throw new FsHttpError(400, 'reserved file name');
  return name;
}

function partialPath(dir: string, name: string): string {
  return join(dir, `.${name}${PARTIAL_SUFFIX}`);
}

function fsError(error: unknown): never {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') throw new FsHttpError(404, 'not found');
  if (code === 'EACCES' || code === 'EPERM') throw new FsHttpError(403, 'permission denied');
  if (code === 'ENOTDIR') throw new FsHttpError(400, 'not a directory');
  if (code === 'EEXIST') throw new FsHttpError(409, 'already exists');
  if (code === 'ENOSPC') throw new FsHttpError(507, 'no space left on device');
  throw error;
}

export async function listDirectory(path: string): Promise<FsListing> {
  const dirents = await readdir(path, { withFileTypes: true }).catch(fsError);
  const entries = await Promise.all(
    dirents
      .filter((dirent) => !dirent.name.endsWith(PARTIAL_SUFFIX))
      .map(async (dirent): Promise<FsEntry> => {
        const entryPath = join(path, dirent.name);
        // Follow symlinks so a linked folder can be opened; a broken link stays 'other'.
        const info = await stat(entryPath).catch(() => null);
        const kind = info?.isDirectory() ? 'directory' : info?.isFile() ? 'file' : 'other';
        return {
          name: dirent.name,
          path: entryPath,
          kind,
          sizeBytes: info?.isFile() ? info.size : 0,
          modifiedAt: info?.mtimeMs ?? 0,
          symlink: dirent.isSymbolicLink(),
        };
      })
  );
  entries.sort(
    (a, b) =>
      Number(b.kind === 'directory') - Number(a.kind === 'directory') ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
  return { path, parent: path === '/' ? null : dirname(path), entries };
}

export async function makeDirectory(parent: string, name: string): Promise<string> {
  const target = join(parent, name);
  await mkdir(target).catch(fsError);
  return target;
}

export type UploadChunk = {
  dir: string;
  name: string;
  offset: number;
  totalBytes: number;
  overwrite: boolean;
};

export type UploadProgress = { receivedBytes: number; complete: boolean; path: string };

async function assertWritableTarget(dir: string, name: string, overwrite: boolean) {
  const dirInfo = await stat(dir).catch(fsError);
  if (!dirInfo.isDirectory()) throw new FsHttpError(400, 'destination is not a directory');
  const existing = await lstat(join(dir, name)).catch(() => null);
  if (!existing) return;
  if (existing.isSymbolicLink() || !existing.isFile()) {
    throw new FsHttpError(409, `${name} exists and is not a regular file`);
  }
  if (!overwrite) throw new FsHttpError(409, `file already exists: ${name}`);
}

/** Bytes already received for an interrupted upload, so the client can resume. */
export async function uploadStatus(dir: string, name: string): Promise<number> {
  const partial = await lstat(partialPath(dir, name)).catch(() => null);
  return partial?.isFile() ? partial.size : 0;
}

export async function abortUpload(dir: string, name: string): Promise<void> {
  await unlink(partialPath(dir, name)).catch(() => undefined);
}

export async function receiveChunk(
  chunk: UploadChunk,
  body: AsyncIterable<Buffer | string>
): Promise<UploadProgress> {
  const { dir, name, offset, totalBytes, overwrite } = chunk;
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 0) {
    throw new FsHttpError(400, 'invalid total size');
  }
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > totalBytes) {
    throw new FsHttpError(400, 'invalid offset');
  }
  await assertWritableTarget(dir, name, overwrite);
  const partial = partialPath(dir, name);
  const received = await uploadStatus(dir, name);
  if (offset !== received) {
    throw new FsHttpError(409, `upload offset mismatch: server has ${received} bytes`);
  }
  if (offset === 0) {
    const disk = await statfs(dir).catch(fsError);
    if (disk.bavail * disk.bsize < totalBytes) {
      throw new FsHttpError(507, 'not enough free disk space for this file');
    }
  }

  const handle = await open(partial, offset === 0 ? 'w' : 'r+', 0o600).catch(fsError);
  let position = offset;
  try {
    for await (const piece of body) {
      const buffer = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
      if (position - offset + buffer.length > MAX_UPLOAD_CHUNK_BYTES) {
        throw new FsHttpError(413, 'upload chunk too large');
      }
      if (position + buffer.length > totalBytes) {
        throw new FsHttpError(400, 'upload exceeds declared size');
      }
      await handle.write(buffer, 0, buffer.length, position).catch(fsError);
      position += buffer.length;
    }
    await handle.truncate(position);
  } finally {
    await handle.close();
  }

  const target = join(dir, name);
  if (position < totalBytes) return { receivedBytes: position, complete: false, path: target };
  await assertWritableTarget(dir, name, overwrite);
  await rename(partial, target).catch(fsError);
  return { receivedBytes: position, complete: true, path: target };
}

/** Single-use, short-lived links let the browser download without putting the token in a URL. */
export function createDownloadTickets(secret: string, now: () => number = Date.now) {
  const used = new Map<string, number>();

  function sign(payload: string): string {
    return createHmac('sha256', secret).update(payload).digest('base64url');
  }

  function issue(path: string): string {
    const nonce = randomBytes(9).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ path, exp: now() + DOWNLOAD_TICKET_TTL_MS, nonce })
    ).toString('base64url');
    return `${payload}.${sign(payload)}`;
  }

  function redeem(ticket: string | null): string {
    const [payload, signature] = (ticket ?? '').split('.');
    const expected = payload ? Buffer.from(sign(payload)) : null;
    const given = Buffer.from(signature ?? '');
    if (!expected || expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new FsHttpError(401, 'invalid download link');
    }
    const { path, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      path: string;
      exp: number;
    };
    const time = now();
    for (const [key, expiry] of used) if (expiry < time) used.delete(key);
    if (exp < time || used.has(payload)) throw new FsHttpError(401, 'download link expired');
    used.set(payload, exp);
    return path;
  }

  return { issue, redeem };
}

export async function streamFile(path: string, res: ServerResponse): Promise<void> {
  const info = await stat(path).catch(fsError);
  if (!info.isFile()) throw new FsHttpError(400, 'not a file');
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': String(info.size),
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(basename(path))}`,
    'cache-control': 'no-store',
  });
  await new Promise<void>((done, fail) => {
    const stream = createReadStream(path);
    stream.on('error', fail);
    res.on('close', () => {
      stream.destroy();
      done();
    });
    stream.pipe(res);
  });
}

export type FsRouteContext = {
  req: IncomingMessage;
  url: URL;
  json: (status: number, body: unknown) => void;
  readJson: () => Promise<unknown>;
  tickets: ReturnType<typeof createDownloadTickets>;
};

/** Authenticated explorer routes under /api/bridge/fs/. Returns false when the route is not ours. */
export async function handleFsRoute(ctx: FsRouteContext): Promise<boolean> {
  const { req, url, json } = ctx;
  const route = url.pathname.slice('/api/bridge/fs/'.length);
  const params = url.searchParams;

  if (req.method === 'GET' && route === 'list') {
    json(200, await listDirectory(absolutePath(params.get('path'))));
    return true;
  }
  if (req.method === 'POST' && route === 'mkdir') {
    const body = (await ctx.readJson()) as { parent?: string; name?: string };
    const parent = absolutePath(body.parent ?? null);
    json(201, { path: await makeDirectory(parent, entryName(body.name ?? null)) });
    return true;
  }
  if (route === 'upload') {
    const dir = absolutePath(params.get('dir'));
    const name = entryName(params.get('name'));
    if (req.method === 'GET') {
      json(200, { receivedBytes: await uploadStatus(dir, name) });
      return true;
    }
    if (req.method === 'DELETE') {
      await abortUpload(dir, name);
      json(200, { aborted: true });
      return true;
    }
    if (req.method === 'PUT') {
      const progress = await receiveChunk(
        {
          dir,
          name,
          offset: Number(params.get('offset')),
          totalBytes: Number(params.get('total')),
          overwrite: params.get('overwrite') === '1',
        },
        req
      );
      json(progress.complete ? 201 : 200, progress);
      return true;
    }
  }
  if (req.method === 'POST' && route === 'download-link') {
    const body = (await ctx.readJson()) as { path?: string };
    const path = absolutePath(body.path ?? null);
    const info = await stat(path).catch(fsError);
    if (!info.isFile()) throw new FsHttpError(400, 'not a file');
    json(200, { url: `/api/bridge/fs/download?ticket=${ctx.tickets.issue(path)}` });
    return true;
  }
  return false;
}
