import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveAgentsList } from './active-agents-list';
import type { TodayAgent } from './cockpit-model';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const agent = (overrides: Partial<TodayAgent> = {}): TodayAgent => ({
  id: 'conv-1',
  title: 'Codex (1)',
  providerId: 'codex',
  status: 'working',
  projectId: 'project-1',
  projectName: 'Zent OS',
  taskId: 'task-1',
  taskName: 'Fix login',
  ...overrides,
});

describe('ActiveAgentsList', () => {
  let dom: JSDOM;
  let root: Root;
  let host: HTMLElement;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    globalThis.window = dom.window as unknown as typeof globalThis.window;
    globalThis.document = dom.window.document;
    host = dom.window.document.getElementById('root') as HTMLElement;
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    // @ts-expect-error test cleanup of the jsdom globals installed above
    delete globalThis.window;
    // @ts-expect-error test cleanup of the jsdom globals installed above
    delete globalThis.document;
    dom.window.close();
  });

  it('opens the tapped agent in its task conversation', () => {
    const onOpen = vi.fn();
    act(() => root.render(React.createElement(ActiveAgentsList, { agents: [agent()], onOpen })));

    const button = host.querySelector<HTMLButtonElement>('button');
    expect(button?.textContent).toContain('Fix login');
    expect(button?.textContent).toContain('Zent OS');
    act(() => button?.click());

    expect(onOpen).toHaveBeenCalledWith(agent());
  });

  it('explains when no agent is running', () => {
    act(() => root.render(React.createElement(ActiveAgentsList, { agents: [], onOpen: vi.fn() })));

    expect(host.querySelector('button')).toBeNull();
    expect(host.textContent).toContain('Ningún agente');
  });
});
