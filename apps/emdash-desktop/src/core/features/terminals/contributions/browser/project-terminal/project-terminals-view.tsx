import { EmptyState } from '@emdash/ui/react/components';
import { Button, Tooltip } from '@emdash/ui/react/primitives';
import { Plus, Terminal, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import {
  getProjectStore,
  projectData,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { projectTerminalRegistry } from '@core/features/terminals/api/browser/stores/project-terminal-registry';
import type { TerminalManagerStore } from '@core/features/terminals/api/browser/task-terminal/terminal-manager';
import { TerminalPtyContent } from '@core/features/terminals/browser/task-terminal/terminal-pty-content';
import { projectAvailabilityUi } from '@core/manifests/browser/project-availability-ui';
import { log } from '@core/primitives/logging/browser/logger';
import { cn } from '@core/primitives/styling/browser/cn';

export const ProjectTerminalsView = observer(function ProjectTerminalsView({
  projectId,
}: {
  projectId: string;
}) {
  const project = projectData(getProjectStore(projectId));
  const workspaceId = project?.repositoryWorkspaceId ?? null;

  if (!project || !workspaceId) {
    return (
      <EmptyState
        bare
        label="Terminal unavailable"
        description="This project has no root workspace to run terminals in."
      />
    );
  }
  return (
    <ProjectTerminalsBody projectId={projectId} workspaceId={workspaceId} rootPath={project.path} />
  );
});

const ProjectTerminalsBody = observer(function ProjectTerminalsBody({
  projectId,
  workspaceId,
  rootPath,
}: {
  projectId: string;
  workspaceId: string;
  rootPath: string;
}) {
  const [manager, setManager] = useState<TerminalManagerStore | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    setManager(projectTerminalRegistry.acquire(projectId));
    return () => {
      projectTerminalRegistry.release(projectId);
      setManager(null);
    };
  }, [projectId, workspaceId]);

  if (!manager) return null;

  const terminals = Array.from(manager.terminals.values());
  const activeTerminal = terminals.find((t) => t.data.id === activeId) ?? terminals[0];
  const activeSession = activeTerminal
    ? (manager.sessions.get(activeTerminal.data.id) ?? null)
    : null;
  const allSessionIds = Array.from(manager.sessions.values()).map((s) => s.sessionId);
  const liveActionsDisabled = manager.hostAccess?.liveAction.kind === 'disabled';
  const disabledReason = liveActionsDisabled
    ? (projectAvailabilityUi.getLiveActionDisabledReason(projectId) ??
      'Live actions are unavailable.')
    : null;

  const handleCreate = async () => {
    try {
      const terminal = await manager.createDefaultTerminal();
      setActiveId(terminal.id);
    } catch (error) {
      log.warn('ProjectTerminalsView: failed to create terminal', { error });
    }
  };

  const handleClose = (id: string) => {
    manager.deleteTerminal(id).catch((error) => {
      log.warn('ProjectTerminalsView: failed to close terminal', { error });
    });
  };

  const handleRename = (id: string, name: string) => {
    manager.renameTerminal(id, name).catch((error) => {
      log.warn('ProjectTerminalsView: failed to rename terminal', { error });
    });
  };

  return (
    <div className="surface-paper flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-(--em-surface)">
      <div className="flex h-9 shrink-0 items-center gap-1 pr-2 text-sm">
        <div
          className="flex h-full min-w-0 flex-1 items-center overflow-x-auto"
          role="tablist"
          aria-label="Project terminals"
        >
          {terminals.map((terminal) => (
            <ProjectTerminalTab
              key={terminal.data.id}
              label={terminal.data.name}
              isActive={terminal.data.id === activeTerminal?.data.id}
              onSelect={() => setActiveId(terminal.data.id)}
              onRename={(name) => handleRename(terminal.data.id, name)}
              onClose={() => handleClose(terminal.data.id)}
            />
          ))}
          <projectAvailabilityUi.LiveActionGuard projectId={projectId}>
            <Tooltip.Root>
              <Tooltip.Trigger
                render={
                  <Button
                    disabled={liveActionsDisabled}
                    variant="ghost"
                    size="xs"
                    icon
                    className="size-6 shrink-0 px-0"
                    aria-label="New terminal"
                    onClick={() => void handleCreate()}
                  />
                }
              >
                <Plus className="size-3" />
              </Tooltip.Trigger>
              <Tooltip.Content>New terminal</Tooltip.Content>
            </Tooltip.Root>
          </projectAvailabilityUi.LiveActionGuard>
        </div>
      </div>
      <TerminalPtyContent
        className="min-h-0 flex-1"
        activeSession={activeSession}
        allSessionIds={allSessionIds}
        autoFocus={activeSession !== null}
        workspaceId={workspaceId}
        terminalPaddingBottom={0}
        disabledReason={disabledReason}
        emptyState={
          <EmptyState
            bare
            label="No terminals yet"
            description={`Runs in ${rootPath}`}
            action={
              <projectAvailabilityUi.LiveActionGuard projectId={projectId}>
                <Button
                  disabled={liveActionsDisabled}
                  size="sm"
                  variant="secondary"
                  onClick={() => void handleCreate()}
                >
                  Open terminal
                </Button>
              </projectAvailabilityUi.LiveActionGuard>
            }
          />
        }
        unavailableState={
          <EmptyState
            bare
            label="Terminal unavailable"
            description={disabledReason ?? 'Live actions are unavailable.'}
          />
        }
      />
    </div>
  );
});

function ProjectTerminalTab({
  label,
  isActive,
  onSelect,
  onRename,
  onClose,
}: {
  label: string;
  isActive: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onClose: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div
      className={cn(
        'group relative flex h-full max-w-48 shrink-0 items-center text-xs transition-colors',
        isActive ? 'text-foreground' : 'text-foreground-muted hover:text-foreground'
      )}
    >
      {isActive && (
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-(--primary-button-background)" />
      )}
      {isEditing ? (
        <div className="flex min-w-0 flex-1 items-center gap-1.5 px-3">
          <Terminal className="size-3 shrink-0" />
          <RenameInput
            initialValue={label}
            onConfirm={(name) => {
              setIsEditing(false);
              if (name && name !== label) onRename(name);
            }}
            onCancel={() => setIsEditing(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          role="tab"
          aria-selected={isActive}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-3 outline-none"
          onClick={onSelect}
          onDoubleClick={() => setIsEditing(true)}
        >
          <Terminal className="size-3 shrink-0" />
          <span className="truncate">{label}</span>
        </button>
      )}
      {!isEditing && (
        <button
          type="button"
          aria-label={`Close ${label}`}
          className="mr-1 flex size-4 shrink-0 items-center justify-center rounded text-foreground-muted hover:bg-background hover:text-foreground focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
          onClick={onClose}
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

function RenameInput({
  initialValue,
  onConfirm,
  onCancel,
}: {
  initialValue: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      className="min-w-0 flex-1 rounded border border-border bg-transparent px-1 py-0.5 text-xs text-foreground outline-none"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => onConfirm(value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onConfirm(value);
        if (event.key === 'Escape') onCancel();
        event.stopPropagation();
      }}
    />
  );
}
