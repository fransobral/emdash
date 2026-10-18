import { observer } from 'mobx-react-lite';
import { getGitCheckoutStore } from '@core/features/source-control/api/browser/stores/source-control-selectors';
import { getTaskStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { useTaskViewContext } from '@core/features/tasks/contributions/browser/task-view-context';
import { TerminalsPanel } from '@core/features/terminals/contributions/browser/task-terminal/terminal-panel';
import { useTaskComposition } from '@core/features/workbench/api/browser/task-composition-context';
import { MobileTaskHeader } from './mobile-task-header';
import { MobileTaskSegments } from './mobile-task-segments';
import {
  mobileSurfaceFromChrome,
  sidebarTabForMobileSurface,
  type MobileTaskSurface,
} from './mobile-task-surfaces';
import { TaskMainColumn } from './task-main-column';
import { TaskSidebar } from './task-sidebar';

export const MobileTaskShell = observer(function MobileTaskShell() {
  const taskView = useTaskComposition();
  const { projectId, taskId } = useTaskViewContext();
  const workspaceId = getTaskStore(projectId, taskId)?.workspaceId;
  const checkout = workspaceId ? getGitCheckoutStore(workspaceId) : undefined;
  const linesAdded = checkout?.hasData ? checkout.totalLinesAdded : 0;
  const surface = mobileSurfaceFromChrome({
    focusedRegion: taskView.focusedRegion,
    sidebarCollapsed: taskView.isSidebarCollapsed,
    sidebarTab: taskView.sidebarTab,
  });

  const selectSurface = (next: MobileTaskSurface) => {
    const sidebarTab = sidebarTabForMobileSurface(next);
    if (sidebarTab) {
      taskView.chrome.commands.closeTerminalDrawer();
      taskView.chrome.commands.openSidebarTab(sidebarTab);
    } else if (next === 'sessions') {
      taskView.chrome.commands.openTerminalDrawer();
    } else {
      taskView.chrome.commands.closeTerminalDrawer();
      taskView.chrome.commands.collapseSidebar();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <MobileTaskHeader onSelectSurface={selectSurface} />
      <MobileTaskSegments active={surface} onSelect={selectSurface} linesAdded={linesAdded} />
      <main className="min-h-0 flex-1 overflow-hidden" aria-label={`${surface} surface`}>
        {surface === 'workspace' && <TaskMainColumn mobileWorkspace />}
        {surface === 'sessions' && <TerminalsPanel />}
        {(surface === 'files' || surface === 'changes') && <TaskSidebar />}
        {surface === 'chats' && (
          // Picking a conversation opens its tab; return to the workspace so the
          // chat is actually visible instead of leaving the list on screen.
          <div
            className="h-full"
            onClick={(event) => {
              if ((event.target as HTMLElement).closest('[data-conversation-id]')) {
                taskView.chrome.commands.collapseSidebar();
              }
            }}
          >
            <TaskSidebar />
          </div>
        )}
      </main>
    </div>
  );
});
