/**
 * Compact (phone) transcript — tool-call summary rows, plain assistant prose,
 * a right-aligned user bubble, the files-changed card and the running indicator.
 * Mirrors the approved mobile chat mockup at 390px.
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import type { TranscriptTurn } from '@/model';
import { ChatHost } from '@/stories/_harness/chat-host';

const meta: Meta = {
  title: 'Rows/Compact/Transcript',
  component: ChatHost,
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj<typeof ChatHost>;

const done = (id: string) => ({ id, seq: 0, toolCallId: id, title: id, status: 'done' as const });

const turns: TranscriptTurn[] = [
  {
    id: 'u',
    seq: 0,
    initiator: 'user',
    items: [
      {
        kind: 'message',
        id: 'u1',
        seq: 0,
        role: 'user',
        text: 'Rehacé el hero con el copy nuevo y que cargue rápido en mobile.',
      },
    ],
  },
  {
    id: 'a',
    seq: 1,
    initiator: 'agent',
    items: [
      {
        kind: 'message',
        id: 'a1',
        seq: 0,
        role: 'assistant',
        text: 'Reviso el hero actual y cómo se cargan las imágenes y las fuentes.',
      },
      ...['hero.tsx', 'Hero.module.css', 'layout.tsx', 'fonts.ts'].map((name, i) => ({
        ...done(`r${i}`),
        seq: i + 1,
        kind: 'read-tool-call' as const,
        locations: [{ path: `src/components/${name}` }],
      })),
      {
        ...done('m1'),
        seq: 5,
        kind: 'modify-file-tool-call' as const,
        path: 'src/components/hero.tsx',
        oldText: 'a\nb\nc',
        newText: 'a\nB\nc\nd\ne',
      },
      {
        ...done('m2'),
        seq: 6,
        kind: 'modify-file-tool-call' as const,
        path: 'src/components/Hero.module.css',
        oldText: '.hero { color: red }',
        newText: '.hero { color: blue }',
      },
      { ...done('e1'), seq: 7, kind: 'execute-tool-call' as const, command: 'pnpm build' },
      {
        kind: 'message',
        id: 'a2',
        seq: 8,
        role: 'assistant',
        text: 'Listo el hero nuevo. Bajé la imagen principal de 1,2 MB a 140 KB y saqué la fuente que bloqueaba el primer render.',
      },
    ],
  },
];

export const Settled: Story = {
  render: () => (
    <ChatHost
      compact
      items={turns}
      width={390}
      height={720}
      commands={{ onViewChanges: () => console.log('[story] onViewChanges') }}
    />
  ),
};

export const DesktopForComparison: Story = {
  render: () => <ChatHost items={turns} width={390} height={720} />,
};
