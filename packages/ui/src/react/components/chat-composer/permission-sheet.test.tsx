/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComposerPermissionRequest } from './permission-band';
import { PermissionSheet } from './permission-sheet';

afterEach(cleanup);

const request: ComposerPermissionRequest = {
  requestId: 'req-1',
  title: 'Execute',
  actionKind: 'execute',
  agentName: 'Codex',
  projectName: 'aurora-mcp',
  command: 'git push origin feat/f5-consultas-lectura',
  reason: 'Subir la rama para abrir el PR.',
  options: [
    { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
    { optionId: 'allow-always', name: 'Always allow git push', kind: 'allow_always' },
    { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
  ],
};

function renderSheet(overrides: Partial<React.ComponentProps<typeof PermissionSheet>> = {}) {
  const props = {
    request,
    open: true,
    onDismiss: vi.fn(),
    onResolve: vi.fn(),
    ...overrides,
  };
  render(<PermissionSheet {...props} />);
  return props;
}

describe('PermissionSheet', () => {
  it('is a labelled dialog showing agent, project, exact command and reason', () => {
    renderSheet();
    const dialog = screen.getByRole('dialog', { name: 'Codex quiere ejecutar un comando' });
    expect(dialog.textContent).toContain('aurora-mcp');
    expect(dialog.textContent).toContain('git push origin feat/f5-consultas-lectura');
    expect(dialog.textContent).toContain('Subir la rama para abrir el PR.');
  });

  it('resolves each button with the optionId the agent offered', () => {
    const { onResolve } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }));
    expect(onResolve).toHaveBeenLastCalledWith('allow-once');
    fireEvent.click(screen.getByRole('button', { name: /Aprobar siempre/ }));
    expect(onResolve).toHaveBeenLastCalledWith('allow-always');
    fireEvent.click(screen.getByRole('button', { name: 'Rechazar y explicar' }));
    expect(onResolve).toHaveBeenLastCalledWith('reject-once');
  });

  it('hides "Aprobar siempre" when the agent did not offer allow_always', () => {
    renderSheet({
      request: { ...request, options: request.options.filter((o) => o.kind !== 'allow_always') },
    });
    expect(screen.queryByRole('button', { name: /Aprobar siempre/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Aprobar' })).toBeTruthy();
  });

  it('shows extra agent options under their own name, never as approve/reject', () => {
    const { onResolve } = renderSheet({
      request: {
        ...request,
        options: [
          { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'deny-forever', name: 'Never allow', kind: 'reject_always' },
        ],
      },
    });
    expect(screen.queryByRole('button', { name: 'Rechazar y explicar' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Never allow' }));
    expect(onResolve).toHaveBeenLastCalledWith('deny-forever');
  });

  it('notifies the host after rejecting so it can focus the composer', () => {
    const onRejectAndExplain = vi.fn();
    renderSheet({ onRejectAndExplain });
    fireEvent.click(screen.getByRole('button', { name: 'Rechazar y explicar' }));
    expect(onRejectAndExplain).toHaveBeenCalledTimes(1);
  });

  it('moves focus into the sheet on open and reports dismissal on Escape', async () => {
    const { onDismiss } = renderSheet();
    const approve = await screen.findByRole('button', { name: 'Aprobar' });
    await vi.waitFor(() => expect(document.activeElement).toBe(approve));
    fireEvent.keyDown(approve, { key: 'Escape' });
    await vi.waitFor(() => expect(onDismiss).toHaveBeenCalled());
  });

  it('renders nothing while closed', () => {
    renderSheet({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
