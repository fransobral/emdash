/** Client for the web server's file explorer routes (/api/bridge/fs/*). */

export type FsEntry = {
  name: string;
  path: string;
  kind: 'directory' | 'file' | 'other';
  sizeBytes: number;
  modifiedAt: number;
  symlink: boolean;
};

export type FsListing = { path: string; parent: string | null; entries: FsEntry[] };

export type TextFile = { path: string; content: string; modifiedAt: number };

export type FsApi = ReturnType<typeof createFsApi>;

export type PreviewKind = 'image' | 'pdf' | 'video';

const PREVIEW_KINDS: Record<string, PreviewKind> = {
  avif: 'image',
  bmp: 'image',
  gif: 'image',
  jpeg: 'image',
  jpg: 'image',
  png: 'image',
  webp: 'image',
  pdf: 'pdf',
  m4v: 'video',
  mov: 'video',
  mp4: 'video',
  webm: 'video',
};

/** Mirrors the server's previewable types (fs-view.ts); SVG and HTML open as text. */
export function previewKindForName(name: string): PreviewKind | null {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return PREVIEW_KINDS[name.slice(dot + 1).toLowerCase()] ?? null;
}

/** Keeps each request far below the Cloudflare tunnel's 100 MB body limit and its timeouts. */
export const UPLOAD_CHUNK_BYTES = 16 * 1024 * 1024;
const MAX_CONSECUTIVE_FAILURES = 6;

type Fetch = typeof fetch;

export class FsApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

async function failure(response: Response): Promise<FsApiError> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return new FsApiError(response.status, body?.error ?? `HTTP ${response.status}`);
}

export function createFsApi(token: string, fetchImpl: Fetch = (...args) => fetch(...args)) {
  const auth = `Bearer ${token}`;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', auth);
    const response = await fetchImpl(`/api/bridge/fs/${path}`, { ...init, headers });
    if (!response.ok) throw await failure(response);
    return (await response.json()) as T;
  }

  const postJson = <T>(path: string, body: unknown) =>
    request<T>(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  return {
    list: (path: string) => request<FsListing>(`list?${new URLSearchParams({ path })}`),
    mkdir: (parent: string, name: string) => postJson<{ path: string }>('mkdir', { parent, name }),
    downloadUrl: async (path: string) =>
      (await postJson<{ url: string }>('download-link', { path })).url,
    /** Reusable inline link for images, PDFs, and videos (supports range requests). */
    viewUrl: async (path: string) => (await postJson<{ url: string }>('view-link', { path })).url,
    rename: (path: string, newName: string) =>
      postJson<{ path: string }>('rename', { path, newName }),
    remove: (path: string) => postJson<{ deleted: true }>('delete', { path }),
    read: (path: string) => request<TextFile>(`read?${new URLSearchParams({ path })}`),
    write: (path: string, content: string, expectedModifiedAt: number | null) => {
      const query = new URLSearchParams({ path });
      if (expectedModifiedAt !== null) query.set('expectedModifiedAt', String(expectedModifiedAt));
      return request<{ path: string; modifiedAt: number }>(`write?${query}`, {
        method: 'PUT',
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        body: content,
      });
    },
    upload: (options: Omit<ChunkedUploadOptions, 'token' | 'fetchImpl'>) =>
      uploadInChunks({ ...options, token, fetchImpl }),
  };
}

export type ChunkedUploadOptions = {
  file: Blob & { name: string };
  dir: string;
  token: string;
  overwrite?: boolean;
  onProgress?: (receivedBytes: number) => void;
  signal?: AbortSignal;
  fetchImpl?: Fetch;
  chunkBytes?: number;
  retryDelayMs?: (attempt: number) => number;
};

/** Server errors are worth retrying, except a full disk. */
function isRetryable(status: number): boolean {
  return status >= 500 && status !== 507;
}

function isOffsetMismatch(error: FsApiError): boolean {
  return error.status === 409 && error.message.startsWith('upload offset mismatch');
}

/**
 * Uploads a file in chunks, resuming from what the server already has after a
 * dropped connection, so large files survive flaky mobile networks.
 */
export async function uploadInChunks(options: ChunkedUploadOptions): Promise<string> {
  const {
    file,
    dir,
    token,
    overwrite = false,
    onProgress,
    signal,
    fetchImpl = (...args) => fetch(...args),
    chunkBytes = UPLOAD_CHUNK_BYTES,
    retryDelayMs = (attempt) => Math.min(30_000, 1_000 * 2 ** attempt),
  } = options;
  const headers = { Authorization: `Bearer ${token}` };
  const target = new URLSearchParams({ dir, name: file.name });

  const serverOffset = async (): Promise<number> => {
    const response = await fetchImpl(`/api/bridge/fs/upload?${target}`, { headers, signal });
    if (!response.ok) throw await failure(response);
    const { receivedBytes } = (await response.json()) as { receivedBytes: number };
    return receivedBytes <= file.size ? receivedBytes : 0;
  };

  let offset = await serverOffset();
  onProgress?.(offset);
  let failures = 0;
  for (;;) {
    signal?.throwIfAborted();
    const query = new URLSearchParams(target);
    query.set('offset', String(offset));
    query.set('total', String(file.size));
    if (overwrite) query.set('overwrite', '1');
    try {
      const response = await fetchImpl(`/api/bridge/fs/upload?${query}`, {
        method: 'PUT',
        headers: { ...headers, 'content-type': 'application/octet-stream' },
        body: file.slice(offset, Math.min(file.size, offset + chunkBytes)),
        signal,
      });
      if (!response.ok) {
        const error = await failure(response);
        if (!isOffsetMismatch(error)) throw error;
        offset = await serverOffset();
        continue;
      }
      const progress = (await response.json()) as {
        receivedBytes: number;
        complete: boolean;
        path: string;
      };
      failures = 0;
      offset = progress.receivedBytes;
      onProgress?.(offset);
      if (progress.complete) return progress.path;
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof FsApiError && !isRetryable(error.status)) throw error;
      failures += 1;
      if (failures >= MAX_CONSECUTIVE_FAILURES) throw error;
      await delay(retryDelayMs(failures), signal);
      offset = await serverOffset().catch(() => offset);
      onProgress?.(offset);
    }
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** Breadcrumb segments for an absolute POSIX path, root first. */
export function pathCrumbs(path: string): Array<{ name: string; path: string }> {
  const parts = path.split('/').filter(Boolean);
  return [
    { name: '/', path: '/' },
    ...parts.map((name, index) => ({ name, path: `/${parts.slice(0, index + 1).join('/')}` })),
  ];
}
