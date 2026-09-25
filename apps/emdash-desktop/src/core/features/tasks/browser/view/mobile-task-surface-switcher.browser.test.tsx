import '@emdash/ui/style.css';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileTaskSurfaceSwitcher, type MobileTaskSurface } from './mobile-task-surface-switcher';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('MobileTaskSurfaceSwitcher', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  async function render(active: MobileTaskSurface, onSelect = vi.fn()) {
    await act(async () => {
      root.render(<MobileTaskSurfaceSwitcher active={active} onSelect={onSelect} />);
    });
    return onSelect;
  }

  it('offers one touch target for each mutually exclusive task surface', async () => {
    await render('workspace');

    const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      'Workspace',
      'Sessions',
      'Files',
      'Changes',
    ]);
    expect(buttons.every((button) => getComputedStyle(button).minHeight === '44px')).toBe(true);
  });

  it('announces the selected surface and requests a switch on tap', async () => {
    const onSelect = await render('sessions');
    const sessions = host.querySelector<HTMLButtonElement>('button[aria-label="Sessions"]')!;
    const files = host.querySelector<HTMLButtonElement>('button[aria-label="Files"]')!;

    expect(sessions.getAttribute('aria-pressed')).toBe('true');
    expect(files.getAttribute('aria-pressed')).toBe('false');

    await act(async () => files.click());
    expect(onSelect).toHaveBeenCalledWith('files');
  });
});
