import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname } from 'node:path';
import { absolutePath, FsHttpError, type FsRouteContext } from './fs-explorer';

/**
 * Inline previews (images, PDFs, videos) for the file explorer. A video player
 * issues many range requests for one file, so view links are reusable until
 * they expire instead of single-use like download links.
 */

const VIEW_TICKET_TTL_MS = 30 * 60_000;

// SVG and HTML are left out on purpose: served inline from the bridge origin they could run script.
const MEDIA_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

export function mediaTypeForPath(path: string): string | null {
  return MEDIA_TYPES[extname(path).toLowerCase()] ?? null;
}

export function createViewTickets(secret: string, now: () => number = Date.now) {
  function sign(payload: string): string {
    return createHmac('sha256', secret).update(payload).digest('base64url');
  }

  function issue(path: string): string {
    const payload = Buffer.from(
      JSON.stringify({
        path,
        exp: now() + VIEW_TICKET_TTL_MS,
        nonce: randomBytes(6).toString('base64url'),
      })
    ).toString('base64url');
    return `${payload}.${sign(payload)}`;
  }

  function redeem(ticket: string | null): string {
    const [payload, signature] = (ticket ?? '').split('.');
    const expected = payload ? Buffer.from(sign(payload)) : null;
    const given = Buffer.from(signature ?? '');
    if (!expected || expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new FsHttpError(401, 'invalid view link');
    }
    const { path, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      path: string;
      exp: number;
    };
    if (exp < now()) throw new FsHttpError(401, 'view link expired');
    return path;
  }

  return { issue, redeem };
}

export type ByteRange = { start: number; end: number };

/** Parses a single `bytes=` range; null means serve the whole file, 'invalid' means 416. */
export function parseRange(header: string | undefined, size: number): ByteRange | null | 'invalid' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return 'invalid';
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (suffix === 0 || size === 0) return 'invalid';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start >= size || end < start) return 'invalid';
  return { start, end };
}

async function previewableFile(path: string): Promise<{ mediaType: string; size: number }> {
  const mediaType = mediaTypeForPath(path);
  if (!mediaType) throw new FsHttpError(415, 'no preview for this file type');
  const info = await stat(path).catch(() => {
    throw new FsHttpError(404, 'not found');
  });
  if (!info.isFile()) throw new FsHttpError(400, 'not a file');
  return { mediaType, size: info.size };
}

export async function streamInline(
  path: string,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const { mediaType, size } = await previewableFile(path);
  const headers = {
    'content-type': mediaType,
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=300',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "sandbox; default-src 'none'",
  };
  const range = parseRange(req.headers.range, size);
  if (range === 'invalid') {
    res.writeHead(416, { ...headers, 'content-range': `bytes */${size}` });
    res.end();
    return;
  }
  res.writeHead(range ? 206 : 200, {
    ...headers,
    'content-length': String(range ? range.end - range.start + 1 : size),
    ...(range ? { 'content-range': `bytes ${range.start}-${range.end}/${size}` } : {}),
  });
  if (req.method === 'HEAD' || size === 0) {
    res.end();
    return;
  }
  await new Promise<void>((done, fail) => {
    const stream = createReadStream(path, range ?? {});
    stream.on('error', fail);
    res.on('close', () => {
      stream.destroy();
      done();
    });
    stream.pipe(res);
  });
}

/** Authenticated route that hands out a view link for a previewable file. */
export async function handleFsViewRoute(
  ctx: FsRouteContext,
  viewTickets: ReturnType<typeof createViewTickets>
): Promise<boolean> {
  const route = ctx.url.pathname.slice('/api/bridge/fs/'.length);
  if (ctx.req.method !== 'POST' || route !== 'view-link') return false;
  const body = (await ctx.readJson()) as { path?: string };
  const path = absolutePath(body.path ?? null);
  const { mediaType } = await previewableFile(path);
  ctx.json(200, { url: `/api/bridge/fs/view?ticket=${viewTickets.issue(path)}`, mediaType });
  return true;
}
