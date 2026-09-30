import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteEntry, isProtectedPath, readTextFile, renameEntry, writeTextFile } from './fs-edit';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fs-edit-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('file explorer edits', () => {
  it('protects the root, top-level folders, and the home folder and its ancestors', () => {
    const home = '/home/ubuntu';
    for (const path of ['/', '/etc', '/home', '/home/ubuntu']) {
      expect(isProtectedPath(path, home)).toBe(true);
    }
    for (const path of ['/home/ubuntu/uploads', '/etc/nginx', '/home/other']) {
      expect(isProtectedPath(path, home)).toBe(false);
    }
  });

  it('renames within the same folder and refuses to clobber', async () => {
    await writeFile(join(dir, 'a.txt'), 'a');
    await writeFile(join(dir, 'b.txt'), 'b');

    expect(await renameEntry(join(dir, 'a.txt'), 'c.txt')).toBe(join(dir, 'c.txt'));
    await expect(renameEntry(join(dir, 'c.txt'), 'b.txt')).rejects.toMatchObject({ status: 409 });
    await expect(renameEntry(join(dir, 'c.txt'), '../x')).rejects.toMatchObject({ status: 400 });
  });

  it('deletes folders recursively but only the link for a symlink', async () => {
    const target = join(dir, 'target');
    await mkdir(join(target, 'nested'), { recursive: true });
    await writeFile(join(target, 'nested', 'f.txt'), 'x');
    await symlink(target, join(dir, 'link'));

    await deleteEntry(join(dir, 'link'));
    expect((await stat(target)).isDirectory()).toBe(true);

    await deleteEntry(target);
    await expect(stat(target)).rejects.toThrow();
  });

  it('edits text files and detects changes made on disk meanwhile', async () => {
    const path = join(dir, 'notes.md');
    await writeFile(path, '# hi', { mode: 0o644 });

    const opened = await readTextFile(path);
    expect(opened.content).toBe('# hi');

    const saved = await writeTextFile(path, '# hello', opened.modifiedAt);
    expect(await readFile(path, 'utf8')).toBe('# hello');
    expect((await stat(path)).mode & 0o777).toBe(0o644);

    await expect(writeTextFile(path, 'stale', opened.modifiedAt - 1)).rejects.toMatchObject({
      status: 409,
    });
    expect(saved.modifiedAt).toBeGreaterThan(0);
  });

  it('refuses to open binary files as text', async () => {
    const path = join(dir, 'image.bin');
    await writeFile(path, Buffer.from([0x89, 0x50, 0x00, 0x47]));
    await expect(readTextFile(path)).rejects.toMatchObject({ status: 415 });
  });
});
