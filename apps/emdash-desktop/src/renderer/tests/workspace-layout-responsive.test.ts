import { JSDOM } from 'jsdom';
import React, { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const layoutState = vi.hoisted(() => ({
  isLeftOpen: true,
  toggleLeftSidebar: vi.fn(),
  layoutStorage: {},
}));

const responsiveState = vi.hoisted(() => ({ isMobile: false }));

vi.mock('@core/features/workbench/contributions/browser/layout-provider', () => ({
  useWorkspaceLayoutContext: () => layoutState,
}));

vi.mock('@renderer/lib/layout/use-mobile-workspace', () => ({
  useMobileWorkspace: () => responsiveState.isMobile,
}));

vi.mock('@emdash/ui/react/primitives', () => ({
  Resizable: {
    Group: ({ children }: { children: ReactNode }) =>
      React.createElement('div', { 'data-testid': 'resizable-group' }, children),
    Panel: ({ children, id }: { children: ReactNode; id?: string }) =>
      React.createElement('div', { 'data-testid': id }, children),
    Handle: () => React.createElement('div', { 'data-testid': 'resizable-handle' }),
  },
  useCollapsiblePanelBinding: () => ({
    groupProps: {},
    collapsiblePanelProps: { id: 'workspace-left' },
  }),
}));

import { WorkspaceLayout } from '@renderer/lib/layout/workspace-layout';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('WorkspaceLayout responsive navigation', () => {
  let dom: JSDOM;
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    globalThis.window = dom.window as unknown as typeof globalThis.window;
    globalThis.document = dom.window.document;
    host = dom.window.document.getElementById('root') as HTMLDivElement;
    root = createRoot(host);
    layoutState.isLeftOpen = true;
    layoutState.toggleLeftSidebar.mockReset();
    responsiveState.isMobile = false;
  });

  afterEach(() => {
    act(() => root.unmount());
    // @ts-expect-error test cleanup of the jsdom globals installed above
    delete globalThis.window;
    // @ts-expect-error test cleanup of the jsdom globals installed above
    delete globalThis.document;
    dom.window.close();
  });

  function renderLayout() {
    act(() => {
      root.render(
        React.createElement(WorkspaceLayout, {
          leftSidebar: React.createElement('nav', {}, 'Projects'),
          mainContent: React.createElement('main', {}, 'Current project'),
        })
      );
    });
  }

  it('preserves the resizable panel layout on desktop', () => {
    renderLayout();

    expect(host.querySelector('[data-testid="resizable-group"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="resizable-handle"]')).not.toBeNull();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders the open sidebar as a modal drawer over mobile content', () => {
    responsiveState.isMobile = true;
    renderLayout();

    expect(host.querySelector('[data-testid="resizable-group"]')).toBeNull();
    expect(host.querySelector('main')?.textContent).toBe('Current project');
    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(
      'Workspace navigation'
    );
    expect(host.querySelector('[aria-label="Close navigation"]')).not.toBeNull();
  });

  it('closes the mobile drawer from either the backdrop or Escape', () => {
    responsiveState.isMobile = true;
    renderLayout();

    const backdrop = host.querySelector<HTMLButtonElement>('[aria-label="Close navigation"]');
    act(() => backdrop?.click());
    expect(layoutState.toggleLeftSidebar).toHaveBeenCalledOnce();

    act(() => {
      window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(layoutState.toggleLeftSidebar).toHaveBeenCalledTimes(2);
  });
});
