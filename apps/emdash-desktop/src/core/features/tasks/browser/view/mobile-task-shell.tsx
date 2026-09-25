import { observer } from 'mobx-react-lite';
import { TerminalsPanel } from '@core/features/terminals/contributions/browser/task-terminal/terminal-panel';
import { useTaskComposition } from '@core/features/workbench/api/browser/task-composition-context';
import { MobileTaskSurfaceSwitcher } from './mobile-task-surface-switcher';
import {
  mobileSurfaceFromChrome,
  sidebarTabForMobileSurface,
  type MobileTaskSurface,
} from './mobile-task-surfaces';
import { TaskMainColumn } from './task-main-column';
import { TaskSidebar } from './task-sidebar';

export const MobileTaskShell = observer(function MobileTaskShell() {
  const taskView = useTaskComposition();
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
      <main className="min-h-0 flex-1 overflow-hidden" aria-label={`${surface} surface`}>
        {surface === 'workspace' && <TaskMainColumn mobileWorkspace />}
        {surface === 'sessions' && <TerminalsPanel />}
        {(surface === 'files' || surface === 'changes') && <TaskSidebar />}
      </main>
      <MobileTaskSurfaceSwitcher active={surface} onSelect={selectSurface} />
    </div>
  );
});
