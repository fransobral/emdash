import { describe, expect, it } from 'vitest';
import { formatBytes, pathCrumbs, uploadInChunks } from './files-api';

/** A fake server that stores uploaded bytes and can drop chosen requests. */
function fakeServer(options: { failPutNumbers?: number[] } = {}) {
  let stored = '';
  let puts = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://x');
    if (!init?.method) return Response.json({ receivedBytes: stored.length });
    puts += 1;
    if (options.failPutNumbers?.includes(puts)) throw new TypeError('network down');
    const offset = Number(url.searchParams.get('offset'));
    const total = Number(url.searchParams.get('total'));
    if (offset !== stored.length) {
      return Response.json(
        { error: `upload offset mismatch: server has ${stored.length} bytes` },
        { status: 409 }
      );
    }
    stored += await (init.body as Blob).text();
    return Response.json({
      receivedBytes: stored.length,
      complete: stored.length === total,
      path: `${url.searchParams.get('dir')}/${url.searchParams.get('name')}`,
    });
  }) as typeof fetch;
  return { fetchImpl, stored: () => stored, puts: () => puts };
}

const file = (text: string) => Object.assign(new Blob([text]), { name: 'data.bin' });

describe('chunked uploads', () => {
  it('sends the file in chunks and reports progress', async () => {
    const server = fakeServer();
    const progress: number[] = [];

    const path = await uploadInChunks({
      file: file('abcdefghij'),
      dir: '/home/ubuntu',
      token: 't',
      fetchImpl: server.fetchImpl,
      chunkBytes: 4,
      onProgress: (bytes) => progress.push(bytes),
    });

    expect(path).toBe('/home/ubuntu/data.bin');
    expect(server.stored()).toBe('abcdefghij');
    expect(progress).toEqual([0, 4, 8, 10]);
  });

  it('resumes from what the server has after a dropped connection', async () => {
    const server = fakeServer({ failPutNumbers: [2] });

    await uploadInChunks({
      file: file('abcdefghij'),
      dir: '/tmp',
      token: 't',
      fetchImpl: server.fetchImpl,
      chunkBytes: 4,
      retryDelayMs: () => 0,
    });

    expect(server.stored()).toBe('abcdefghij');
    expect(server.puts()).toBe(4);
  });

  it('uploads empty files', async () => {
    const server = fakeServer();
    await uploadInChunks({ file: file(''), dir: '/tmp', token: 't', fetchImpl: server.fetchImpl });
    expect(server.puts()).toBe(1);
  });
});

describe('explorer formatting', () => {
  it('builds breadcrumbs from the root', () => {
    expect(pathCrumbs('/home/ubuntu/uploads')).toEqual([
      { name: '/', path: '/' },
      { name: 'home', path: '/home' },
      { name: 'ubuntu', path: '/home/ubuntu' },
      { name: 'uploads', path: '/home/ubuntu/uploads' },
    ]);
    expect(pathCrumbs('/')).toEqual([{ name: '/', path: '/' }]);
  });

  it('formats sizes up to terabytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(3.5 * 1024 ** 3)).toBe('3.5 GB');
  });
});
