import { chmod, lstat, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, sep } from 'node:path';
import { absolutePath, entryName, FsHttpError, type FsRouteContext } from './fs-explorer';

/** Rename, delete, and edit for the file explorer (see fs-explorer.ts for browsing and uploads). */

/** The browser editor is a plain textarea; larger files are downloaded instead. */
export const MAX_EDITABLE_BYTES = 2 * 1024 * 1024;

function fsError(error: unknown): never {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') throw new FsHttpError(404, 'not found');
  if (code === 'EACCES' || code === 'EPERM') throw new FsHttpError(403, 'permission denied');
  if (code === 'EEXIST' || code === 'ENOTEMPTY') throw new FsHttpError(409, 'already exists');
  throw error;
}

/**
 * The root, top-level system folders, and the home folder or anything above
 * it stay undeletable, so a mistap can't wipe the machine or every project.
 */
export function isProtectedPath(path: string, home: string = homedir()): boolean {
  const depth = path.split(sep).filter(Boolean).length;
  if (depth <= 1) return true;
  const fromPathToHome = relative(path, home);
  return fromPathToHome === '' || !fromPathToHome.startsWith('..');
}

export async function renameEntry(path: string, newName: string): Promise<string> {
  const name = entryName(newName);
  if (isProtectedPath(path)) throw new FsHttpError(403, 'this folder cannot be renamed');
  const target = join(dirname(path), name);
  if (target === path) return path;
  await lstat(path).catch(fsError);
  const existing = await lstat(target).catch(() => null);
  if (existing) throw new FsHttpError(409, `${name} already exists`);
  await rename(path, target).catch(fsError);
  return target;
}

export async function deleteEntry(path: string): Promise<void> {
  if (isProtectedPath(path)) throw new FsHttpError(403, 'this folder cannot be deleted');
  await lstat(path).catch(fsError);
  // rm removes a symlink itself, never the folder it points to.
  await rm(path, { recursive: true, force: false }).catch(fsError);
}

export type TextFile = { path: string; content: string; modifiedAt: number };

export async function readTextFile(path: string): Promise<TextFile> {
  const info = await stat(path).catch(fsError);
  if (!info.isFile()) throw new FsHttpError(400, 'not a file');
  if (info.size > MAX_EDITABLE_BYTES) throw new FsHttpError(413, 'file is too large to edit here');
  const bytes = await readFile(path).catch(fsError);
  if (bytes.includes(0)) throw new FsHttpError(415, 'binary files cannot be edited');
  return { path, content: bytes.toString('utf8'), modifiedAt: info.mtimeMs };
}

/**
 * Saves through a temp file and rename so a crash never leaves half a file,
 * and refuses when the file changed on disk since it was opened.
 */
export async function writeTextFile(
  path: string,
  content: string,
  expectedModifiedAt: number | null
): Promise<TextFile> {
  const bytes = Buffer.from(content, 'utf8');
  if (bytes.length > MAX_EDITABLE_BYTES) throw new FsHttpError(413, 'content is too large');
  const current = await stat(path).catch(() => null);
  if (current && !current.isFile()) throw new FsHttpError(400, 'not a file');
  if (current && expectedModifiedAt !== null && current.mtimeMs !== expectedModifiedAt) {
    throw new FsHttpError(409, 'the file changed on disk since you opened it');
  }
  const temp = join(dirname(path), `.${basename(path)}.emdash-save`);
  const handle = await open(temp, 'w', 0o600).catch(fsError);
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
  if (current) await chmod(temp, current.mode & 0o7777);
  await rename(temp, path).catch(fsError);
  const saved = await stat(path);
  return { path, content, modifiedAt: saved.mtimeMs };
}

async function readTextBody(body: AsyncIterable<Buffer | string>): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const piece of body) {
    const buffer = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
    size += buffer.length;
    if (size > MAX_EDITABLE_BYTES) throw new FsHttpError(413, 'content is too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Authenticated edit routes under /api/bridge/fs/. Returns false when the route is not ours. */
export async function handleFsEditRoute(ctx: FsRouteContext): Promise<boolean> {
  const { req, url, json } = ctx;
  const route = url.pathname.slice('/api/bridge/fs/'.length);
  if (req.method === 'POST' && route === 'rename') {
    const body = (await ctx.readJson()) as { path?: string; newName?: string };
    const path = await renameEntry(absolutePath(body.path ?? null), body.newName ?? '');
    json(200, { path });
    return true;
  }
  if (req.method === 'POST' && route === 'delete') {
    const body = (await ctx.readJson()) as { path?: string };
    await deleteEntry(absolutePath(body.path ?? null));
    json(200, { deleted: true });
    return true;
  }
  if (req.method === 'GET' && route === 'read') {
    json(200, await readTextFile(absolutePath(url.searchParams.get('path'))));
    return true;
  }
  if (req.method === 'PUT' && route === 'write') {
    const expected = url.searchParams.get('expectedModifiedAt');
    const saved = await writeTextFile(
      absolutePath(url.searchParams.get('path')),
      await readTextBody(req),
      expected === null ? null : Number(expected)
    );
    json(200, { path: saved.path, modifiedAt: saved.modifiedAt });
    return true;
  }
  return false;
}
