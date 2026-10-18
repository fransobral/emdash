import { describe, expect, it } from 'vitest';
import { permissionDetailFor } from './acp-permission-detail';

const base = { id: 'x', seq: 0, toolCallId: 'x', title: 'Tool title', status: 'running' as const };

describe('permissionDetailFor', () => {
  it('shows the exact command for execute calls', () => {
    expect(
      permissionDetailFor({ ...base, kind: 'execute-tool-call', command: 'git push origin main' })
    ).toEqual({ actionKind: 'execute', command: 'git push origin main' });
  });

  it('falls back to the input summary when an execute call has no command yet', () => {
    expect(
      permissionDetailFor({ ...base, kind: 'execute-tool-call', inputSummary: 'Run tests' })
    ).toEqual({ actionKind: 'execute', command: 'Run tests' });
  });

  it('shows the target path for file edits and deletes', () => {
    expect(
      permissionDetailFor({
        ...base,
        kind: 'modify-file-tool-call',
        path: 'src/a.ts',
        oldText: '',
        newText: '',
      })
    ).toEqual({ actionKind: 'edit', command: 'src/a.ts' });
    expect(
      permissionDetailFor({ ...base, kind: 'delete-file-tool-call', path: 'src/old.ts' })
    ).toEqual({ actionKind: 'delete', command: 'src/old.ts' });
  });

  it('lists read locations, one per line', () => {
    expect(
      permissionDetailFor({
        ...base,
        kind: 'read-tool-call',
        locations: [{ path: 'a.ts' }, { path: 'b.ts' }],
      })
    ).toEqual({ actionKind: 'read', command: 'a.ts\nb.ts' });
  });

  it('shows the URL for fetches and server.tool for MCP calls', () => {
    expect(
      permissionDetailFor({ ...base, kind: 'web-fetch-tool-call', url: 'https://example.com' })
    ).toEqual({ actionKind: 'fetch', command: 'https://example.com' });
    expect(
      permissionDetailFor({ ...base, kind: 'mcp-tool-call', server: 'github', tool: 'create_pr' })
    ).toEqual({ actionKind: 'other', command: 'github.create_pr' });
  });

  it('returns no command when the provider sent nothing to show', () => {
    expect(
      permissionDetailFor({ ...base, kind: 'execute-tool-call', title: '', command: '  ' })
    ).toEqual({ actionKind: 'execute', command: undefined });
  });
});
