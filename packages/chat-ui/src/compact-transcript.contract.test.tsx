import { afterEach, describe, expect, it } from 'vitest';
import { createChatContext } from '@/chat-context';
import { createChatView } from '@/chat-view';
import type { ChatCommands } from '@/commands';
import type { ToolNode, ToolStatus, TranscriptTurn } from '@/model';
import { createChatState } from '@/state/chat-state';

const nextPaint = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const base = (id: string, status: ToolStatus = 'done') => ({
  id,
  seq: 0,
  toolCallId: id,
  title: id,
  status,
});

const read = (id: string, path: string): ToolNode => ({
  ...base(id),
  kind: 'read-tool-call',
  locations: [{ path }],
});
const exec = (id: string, command: string): ToolNode => ({
  ...base(id),
  kind: 'execute-tool-call',
  command,
});
const modify = (id: string, path: string): ToolNode => ({
  ...base(id),
  kind: 'modify-file-tool-call',
  path,
  oldText: 'a\nb',
  newText: 'a\nB\nc',
});

async function mount(
  items: TranscriptTurn['items'],
  opts: { compact: boolean; commands?: ChatCommands }
) {
  const context = createChatContext();
  const state = createChatState(context);
  state.transcript.history.seed([
    {
      id: 'user-turn',
      seq: 0,
      initiator: 'user',
      items: [{ kind: 'message', id: 'u1', seq: 0, role: 'user', text: 'hola' }],
    },
    { id: 'agent-turn', seq: 1, initiator: 'agent', items },
  ] as TranscriptTurn[]);

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:0;left:0;width:390px;height:700px;';
  document.body.appendChild(host);
  const view = createChatView({
    context,
    state,
    parent: host,
    compact: opts.compact,
    commands: opts.commands,
  });
  cleanups.push(() => {
    view.dispose();
    state.dispose();
    context.dispose();
    host.remove();
  });
  await nextPaint();
  return { host };
}

const lineLabels = (host: HTMLElement): string[] =>
  [...host.querySelectorAll<HTMLElement>('button[data-collapse-id]')].map(
    (el) => el.textContent?.trim() ?? ''
  );

describe('compact transcript', () => {
  it('renders contiguous tool calls as one-line summaries and expands on tap', async () => {
    const { host } = await mount(
      [read('r1', 'src/a.ts'), read('r2', 'src/b.ts'), exec('e1', 'pnpm build')] as never,
      { compact: true }
    );

    expect(lineLabels(host)).toEqual(['Leyó 2 archivos', 'pnpm build']);

    const first = host.querySelector<HTMLElement>('button[data-collapse-id]');
    expect(first?.getAttribute('aria-expanded')).toBe('false');
    first?.click();
    await nextPaint();
    expect(
      host.querySelector<HTMLElement>('button[data-collapse-id]')?.getAttribute('aria-expanded')
    ).toBe('true');
  });

  it('shows the files-changed card and reports taps to the host', async () => {
    const taps: string[] = [];
    const { host } = await mount([modify('m1', 'src/hero.tsx')] as never, {
      compact: true,
      commands: { onViewChanges: ({ itemId }) => taps.push(itemId) },
    });

    const card = [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('archivo cambiado')
    );
    expect(card?.textContent).toContain('+2');
    expect(card?.textContent).toContain('−1');
    expect(card?.textContent).toContain('src/hero.tsx');
    card?.click();
    expect(taps).toEqual(['agent-turn:changes']);
  });

  it('leaves the desktop rendering untouched', async () => {
    const { host } = await mount([read('r1', 'src/a.ts'), exec('e1', 'pnpm build')] as never, {
      compact: false,
    });
    expect(host.textContent).not.toContain('Leyó');
    expect(host.textContent).not.toContain('archivo cambiado');
  });
});
