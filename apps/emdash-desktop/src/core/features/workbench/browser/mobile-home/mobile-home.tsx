import { Menu, Settings } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { settingsViewDef } from '@core/features/settings/contributions/views';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { useWorkspaceLayoutContext } from '@core/features/workbench/contributions/browser/layout-provider';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { groupMobileHomeTasks, type MobileHomeRow } from './mobile-home-model';
import { MobileHomeSection } from './mobile-home-rows';
import { MobileNewTaskComposer } from './mobile-new-task-composer';
import { collectMobileHomeTasks } from './use-mobile-home-tasks';

const CLOCK_TICK_MS = 30_000;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}

const ICON_BUTTON =
  'flex size-11 items-center justify-center rounded-xl text-foreground-muted active:bg-background-1 focus-visible:outline-2 focus-visible:outline-foreground-muted';

export const MobileHome = observer(function MobileHome() {
  const { navigate } = useNavigate();
  const { toggleLeftSidebar } = useWorkspaceLayoutContext();
  const now = useNow();
  const groups = groupMobileHomeTasks(collectMobileHomeTasks());

  const openTask = (row: MobileHomeRow) =>
    navigate(taskViewDef({ projectId: row.projectId, taskId: row.taskId }));

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex items-center justify-between px-4 pt-3 pb-1">
        <h1 className="text-[17px] font-semibold tracking-tight">Emdash</h1>
        <div className="flex gap-1">
          <button
            type="button"
            aria-label="Abrir proyectos y navegación"
            className={ICON_BUTTON}
            onClick={toggleLeftSidebar}
          >
            <Menu aria-hidden="true" className="size-5" />
          </button>
          <button
            type="button"
            aria-label="Ajustes"
            className={ICON_BUTTON}
            onClick={() => navigate(settingsViewDef())}
          >
            <Settings aria-hidden="true" className="size-5" />
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pt-2 pb-3">
        {groups.length === 0 ? (
          <p className="px-2 py-6 text-sm text-foreground-muted">
            Nada pendiente. Escribí abajo qué querés que haga un agente.
          </p>
        ) : (
          groups.map((group) => (
            <MobileHomeSection
              key={group.id}
              id={group.id}
              label={group.label}
              rows={group.rows}
              now={now}
              onOpen={openTask}
            />
          ))
        )}
      </div>
      <div className="shrink-0 bg-background px-3 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <MobileNewTaskComposer />
      </div>
    </div>
  );
});
