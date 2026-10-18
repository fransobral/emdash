import { describe, expect, it } from 'vitest';
import type { ToolNode, ToolStatus } from '@/model';
import {
  collectRunnableTools,
  countLineDiff,
  joinNames,
  summarizeToolRun,
  summarizeTurnChanges,
  type LeafToolNode,
} from './tool-run';

const base = (id: string, status: ToolStatus = 'done') => ({
  id,
  seq: 0,
  toolCallId: id,
  title: id,
  status,
});

const read = (id: string, path?: string, status: ToolStatus = 'done'): LeafToolNode => ({
  ...base(id, status),
  kind: 'read-tool-call',
  ...(path ? { locations: [{ path }] } : {}),
});
const exec = (id: string, command: string, status: ToolStatus = 'done'): LeafToolNode => ({
  ...base(id, status),
  kind: 'execute-tool-call',
  command,
});
const modify = (id: string, path: string, oldText: string, newText: string): LeafToolNode => ({
  ...base(id),
  kind: 'modify-file-tool-call',
  path,
  oldText,
  newText,
});
const create = (id: string, path: string, content: string): LeafToolNode => ({
  ...base(id),
  kind: 'create-file-tool-call',
  path,
  content,
});
const search = (id: string, query: string): LeafToolNode => ({
  ...base(id),
  kind: 'search-tool-call',
  query,
});

const NONE = new Set<string>();

describe('summarizeToolRun', () => {
  it('merges contiguous reads into one "Leyó N archivos" line', () => {
    const lines = summarizeToolRun(
      [read('a', 'src/a.ts'), read('b', 'src/b.ts'), read('c', 'src/c.ts'), read('d', 'src/d.ts')],
      NONE
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].label).toBe('Leyó 4 archivos');
    expect(lines[0].members).toHaveLength(4);
  });

  it('names a single read file', () => {
    expect(summarizeToolRun([read('a', 'src/deep/hero.tsx')], NONE)[0].label).toBe('Leyó hero.tsx');
  });

  it('falls back to the call count when reads have no locations', () => {
    expect(summarizeToolRun([read('a'), read('b')], NONE)[0].label).toBe('Leyó 2 archivos');
  });

  it('lists edited file names and de-duplicates repeated edits', () => {
    const lines = summarizeToolRun(
      [
        modify('a', 'src/hero.tsx', 'x', 'y'),
        modify('b', 'src/Hero.module.css', 'x', 'y'),
        modify('c', 'src/hero.tsx', 'y', 'z'),
      ],
      NONE
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].label).toBe('Editó hero.tsx, Hero.module.css');
  });

  it('folds extra edited names into "y N más"', () => {
    const lines = summarizeToolRun(
      ['a', 'b', 'c', 'd'].map((n) => modify(n, `src/${n}.ts`, '1', '2')),
      NONE
    );
    expect(lines[0].label).toBe('Editó a.ts, b.ts y 2 más');
  });

  it('says "Creó" when every file call creates', () => {
    expect(summarizeToolRun([create('a', 'src/new.ts', 'x')], NONE)[0].label).toBe('Creó new.ts');
  });

  it('keeps each command on its own line, in protocol order', () => {
    const lines = summarizeToolRun(
      [read('r', 'a.ts'), exec('e1', 'pnpm build'), exec('e2', 'pnpm test'), search('s', 'hero')],
      NONE
    );
    expect(lines.map((l) => [l.kind, l.label])).toEqual([
      ['read', 'Leyó a.ts'],
      ['execute', 'pnpm build'],
      ['execute', 'pnpm test'],
      ['search', 'Buscó “hero”'],
    ]);
  });

  it('uses the first command line, truncated', () => {
    const long = `${'x'.repeat(120)}\nsecond`;
    const label = summarizeToolRun([exec('e', long)], NONE)[0].label;
    expect(label).toHaveLength(80);
    expect(label.endsWith('…')).toBe(true);
  });

  it('aggregates status: running beats error beats done', () => {
    expect(summarizeToolRun([read('a', 'a'), read('b', 'b', 'error')], NONE)[0].status).toBe(
      'error'
    );
    expect(
      summarizeToolRun([read('a', 'a', 'running'), read('b', 'b', 'error')], NONE)[0].status
    ).toBe('running');
    expect(summarizeToolRun([exec('e', 'ls')], NONE)[0].status).toBe('done');
  });

  it('flags lines that wait on a permission request', () => {
    const lines = summarizeToolRun(
      [read('a', 'a'), exec('e', 'git push', 'running')],
      new Set(['e'])
    );
    expect(lines.map((l) => l.awaitingPermission)).toEqual([false, true]);
  });

  it('derives a stable line id from the first member', () => {
    const first = summarizeToolRun([read('a', 'a')], NONE)[0].id;
    const grown = summarizeToolRun([read('a', 'a'), read('b', 'b')], NONE)[0].id;
    expect(grown).toBe(first);
  });
});

describe('collectRunnableTools', () => {
  it('flattens core tool-group wrappers into their leaves', () => {
    const group: ToolNode = {
      kind: 'tool-group',
      id: 'g',
      seq: 0,
      label: 'x',
      groupKind: 'tool-run',
      status: 'done',
      children: [read('a', 'a'), exec('b', 'ls')],
    };
    expect(collectRunnableTools(group)?.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('rejects messages, plans and subagents', () => {
    expect(collectRunnableTools({ kind: 'message' })).toBeNull();
    expect(
      collectRunnableTools({ ...base('p'), kind: 'create-plan-tool-call', planId: 'p' } as ToolNode)
    ).toBeNull();
    expect(
      collectRunnableTools({
        ...base('s'),
        kind: 'spawn-subagent-tool-call',
        name: 'n',
      } as ToolNode)
    ).toBeNull();
  });

  it('rejects tools that own nested children', () => {
    expect(
      collectRunnableTools({ ...exec('e', 'ls'), children: [read('c', 'c')] } as ToolNode)
    ).toBeNull();
  });
});

describe('countLineDiff', () => {
  it('counts pure additions and removals', () => {
    expect(countLineDiff('', 'a\nb\n')).toEqual({ added: 2, removed: 0 });
    expect(countLineDiff('a\nb\n', '')).toEqual({ added: 0, removed: 2 });
  });

  it('counts a changed line as one removal and one addition', () => {
    expect(countLineDiff('a\nb\nc', 'a\nB\nc')).toEqual({ added: 1, removed: 1 });
  });

  it('ignores unchanged text and CRLF differences', () => {
    expect(countLineDiff('a\r\nb', 'a\nb')).toEqual({ added: 0, removed: 0 });
  });
});

describe('summarizeTurnChanges', () => {
  it('returns null when the turn changed no files', () => {
    expect(summarizeTurnChanges([read('a', 'a'), exec('e', 'ls')])).toBeNull();
  });

  it('totals added/removed per file, merging repeated edits', () => {
    const summary = summarizeTurnChanges([
      modify('a', 'src/hero.tsx', 'a\nb', 'a\nB\nc'),
      modify('b', 'src/hero.tsx', 'c', 'd'),
      create('c', 'src/new.ts', '1\n2\n3\n'),
    ]);
    expect(summary).toEqual({
      files: [
        { path: 'src/hero.tsx', added: 3, removed: 2 },
        { path: 'src/new.ts', added: 3, removed: 0 },
      ],
      added: 6,
      removed: 2,
    });
  });

  it('ignores edits that have not finished', () => {
    const running: LeafToolNode = { ...modify('a', 'a.ts', 'x', 'y'), status: 'running' };
    expect(summarizeTurnChanges([running])).toBeNull();
  });
});

describe('joinNames', () => {
  it('caps the visible names', () => {
    expect(joinNames(['a'])).toBe('a');
    expect(joinNames(['a', 'b'])).toBe('a, b');
    expect(joinNames(['a', 'b', 'c'])).toBe('a, b y 1 más');
  });
});
