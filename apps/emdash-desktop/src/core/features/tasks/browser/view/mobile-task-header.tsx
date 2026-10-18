import { DropdownMenu } from '@emdash/ui/react/primitives';
import { ChevronLeft, FolderOpen, MessagesSquare, MoreHorizontal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import {
  getProjectStore,
  projectDisplayName,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { getGitCheckoutStore } from '@core/features/source-control/api/browser/stores/source-control-selectors';
import {
  getTaskStore,
  taskDisplayName,
} from '@core/features/tasks/api/browser/task-state/task-selectors';
import { useTaskViewContext } from '@core/features/tasks/contributions/browser/task-view-context';
import { homeViewDef } from '@core/features/workbench/contributions/views';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { mobileTaskOverflowItems, type MobileTaskSurface } from './mobile-task-surfaces';

const OVERFLOW_ICONS = {
  files: FolderOpen,
  chats: MessagesSquare,
} as const satisfies Partial<Record<MobileTaskSurface, typeof FolderOpen>>;

const ICON_BUTTON =
  'flex size-11 shrink-0 items-center justify-center rounded-xl text-foreground-muted active:bg-background-1 focus-visible:outline-2 focus-visible:outline-foreground-muted';

/** Mobile task header: back, title, `project · branch` and the overflow menu. */
export const MobileTaskHeader = observer(function MobileTaskHeader({
  onSelectSurface,
}: {
  onSelectSurface: (surface: MobileTaskSurface) => void;
}) {
  const { navigate } = useNavigate();
  const { projectId, taskId } = useTaskViewContext();
  const task = getTaskStore(projectId, taskId);
  const checkout = task?.workspaceId ? getGitCheckoutStore(task.workspaceId) : undefined;
  const projectName = projectDisplayName(getProjectStore(projectId)) ?? projectId;
  const subtitle = [projectName, checkout?.branchName].filter(Boolean).join(' · ');

  return (
    <header className="flex shrink-0 items-center gap-1 pt-2 pr-2 pb-1 pl-1">
      <button
        type="button"
        aria-label="Volver a tareas"
        className={ICON_BUTTON}
        onClick={() => navigate(homeViewDef())}
      >
        <ChevronLeft aria-hidden="true" className="size-6" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h1 className="truncate text-base font-semibold text-foreground">
          {taskDisplayName(task) ?? 'Tarea'}
        </h1>
        <p className="truncate font-mono text-xs text-foreground-muted">{subtitle}</p>
      </div>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          render={<button type="button" aria-label="Más opciones" className={ICON_BUTTON} />}
        >
          <MoreHorizontal aria-hidden="true" className="size-5" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" className="min-w-48">
          {mobileTaskOverflowItems.map(({ surface, label }) => {
            const Icon = OVERFLOW_ICONS[surface];
            return (
              <DropdownMenu.Item
                key={surface}
                className="min-h-11"
                onClick={() => onSelectSurface(surface)}
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </header>
  );
});
