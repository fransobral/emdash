import '@emdash/ui/style.css';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileTaskSegments } from './mobile-task-segments';
import type { MobileTaskSurface } from './mobile-task-surfaces';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('MobileTaskSegments', () => {
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

  async function render(active: MobileTaskSurface, onSelect = vi.fn(), linesAdded = 0) {
    await act(async () => {
      root.render(
        <MobileTaskSegments active={active} onSelect={onSelect} linesAdded={linesAdded} />
      );
    });
    return onSelect;
  }

  it('offers Chat, Cambios and Terminal as 44px touch targets', async () => {
    await render('workspace');

    const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      'Chat',
      'Cambios',
      'Terminal',
    ]);
    // Tailwind utilities are not compiled in browser tests; min-h-11 is the 44px touch target.
    expect(buttons.every((button) => button.classList.contains('min-h-11'))).toBe(true);
  });

  it('announces the selected segment and requests the mapped surface on tap', async () => {
    const onSelect = await render('sessions');
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')];
    const terminal = buttons.find((b) => b.textContent?.includes('Terminal'))!;
    const changes = buttons.find((b) => b.textContent?.includes('Cambios'))!;

    expect(terminal.getAttribute('aria-pressed')).toBe('true');
    expect(changes.getAttribute('aria-pressed')).toBe('false');

    await act(async () => changes.click());
    expect(onSelect).toHaveBeenCalledWith('changes');
  });

  it('selects no segment while an overflow surface is open', async () => {
    await render('files');
    const pressed = host.querySelectorAll('button[aria-pressed="true"]');
    expect(pressed).toHaveLength(0);
  });

  it('shows the added-lines badge only when there are additions', async () => {
    await render('workspace', vi.fn(), 42);
    expect(host.textContent).toContain('+42');
    await render('workspace', vi.fn(), 0);
    expect(host.textContent).not.toContain('+');
  });
});
