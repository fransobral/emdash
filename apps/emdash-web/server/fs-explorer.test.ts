import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  absolutePath,
  createDownloadTickets,
  entryName,
  listDirectory,
  makeDirectory,
  receiveChunk,
  uploadStatus,
} from './fs-explorer';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fs-explorer-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function* body(...parts: string[]): AsyncIterable<Buffer> {
  for (const part of parts) yield Buffer.from(part);
}

describe('file explorer', () => {
  it('lists folders first and hides partial uploads', async () => {
    await writeFile(join(dir, 'b.txt'), 'hi');
    await makeDirectory(dir, 'a-folder');
    await symlink(join(dir, 'a-folder'), join(dir, 'link'));
    await writeFile(join(dir, '.big.iso.emdash-upload'), 'partial');

    const listing = await listDirectory(dir);

    expect(listing.parent).not.toBeNull();
    expect(listing.entries.map((entry) => [entry.name, entry.kind, entry.symlink])).toEqual([
      ['a-folder', 'directory', false],
      ['link', 'directory', true],
      ['b.txt', 'file', false],
    ]);
    expect(listing.entries[2].sizeBytes).toBe(2);
  });

  it('rejects relative paths and names that are not a single path segment', () => {
    expect(() => absolutePath('home/ubuntu')).toThrow('absolute path');
    expect(() => entryName('../etc/passwd')).toThrow('invalid file name');
    expect(() => entryName('..')).toThrow('invalid file name');
    expect(entryName('video final.mp4')).toBe('video final.mp4');
  });

  it('assembles a file from chunks and resumes after an interruption', async () => {
    const chunk = { dir, name: 'movie.bin', totalBytes: 10, overwrite: false };

    const first = await receiveChunk({ ...chunk, offset: 0 }, body('01234'));
    expect(first).toMatchObject({ receivedBytes: 5, complete: false });
    expect(await uploadStatus(dir, 'movie.bin')).toBe(5);

    await expect(receiveChunk({ ...chunk, offset: 2 }, body('xx'))).rejects.toMatchObject({
      status: 409,
    });

    const last = await receiveChunk({ ...chunk, offset: 5 }, body('567', '89'));
    expect(last).toMatchObject({ receivedBytes: 10, complete: true, path: join(dir, 'movie.bin') });
    expect(await readFile(join(dir, 'movie.bin'), 'utf8')).toBe('0123456789');
    expect(await uploadStatus(dir, 'movie.bin')).toBe(0);
  });

  it('refuses to overwrite an existing file unless asked', async () => {
    await writeFile(join(dir, 'notes.txt'), 'old');
    const chunk = { dir, name: 'notes.txt', offset: 0, totalBytes: 3 };

    await expect(receiveChunk({ ...chunk, overwrite: false }, body('new'))).rejects.toMatchObject({
      status: 409,
    });
    await receiveChunk({ ...chunk, overwrite: true }, body('new'));
    expect(await readFile(join(dir, 'notes.txt'), 'utf8')).toBe('new');
  });

  it('rejects bodies larger than the declared size', async () => {
    await expect(
      receiveChunk({ dir, name: 'x', offset: 0, totalBytes: 2, overwrite: false }, body('abc'))
    ).rejects.toMatchObject({ status: 400 });
  });

  it('issues download links that work once and expire', () => {
    let now = 1_000;
    const tickets = createDownloadTickets('secret', () => now);

    const ticket = tickets.issue('/home/ubuntu/a.zip');
    expect(tickets.redeem(ticket)).toBe('/home/ubuntu/a.zip');
    expect(() => tickets.redeem(ticket)).toThrow('expired');

    const late = tickets.issue('/home/ubuntu/b.zip');
    now += 61_000;
    expect(() => tickets.redeem(late)).toThrow('expired');
    expect(() => tickets.redeem(`${late.split('.')[0]}.forged`)).toThrow('invalid');
  });
});
