import { EmptyState } from '@emdash/ui/react/components';
import { Badge } from '@emdash/ui/react/primitives';
import { Activity, AlertCircle, Bot, CheckCircle2, Coins } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Fragment } from 'react';
import { cockpitViewDef } from '@core/features/cockpit/contributions/views';
import { getConversationsForTask } from '@core/features/conversations/api/browser/conversation-selectors';
import { getProjectManagerStore } from '@core/features/projects/api/browser/stores/project-selectors';
import { getTaskManagerStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { Titlebar } from '@core/features/workbench/contributions/browser/Titlebar';
import { registeredTaskData } from '@core/primitives/task-state/browser/task-state';
import { defineViewRuntime } from '@core/primitives/views/react';
import { buildTodayDashboard, type TodayProjectInput } from './cockpit-model';

export const CockpitMainPanel = observer(function CockpitMainPanel() {
  const projects = [...getProjectManagerStore().projects.values()];
  const dashboardProjects: TodayProjectInput[] = projects.map((project) => {
    const manager = getTaskManagerStore(project.id);
    return {
      id: project.id,
      name: project.name ?? project.id,
      tasks: manager
        ? [...manager.tasks.values()].flatMap((task) => {
            const data = registeredTaskData(task);
            if (!data) return [];
            const conversations = getConversationsForTask(data.id);
            return [
              {
                id: data.id,
                name: data.name,
                status: data.status,
                lastInteractedAt: data.lastInteractedAt,
                conversations: conversations
                  ? [...conversations.conversations.values()].map((conversation) => ({
                      id: conversation.data.id,
                      title: conversation.data.title,
                      providerId: conversation.data.providerId,
                      status: conversation.status,
                    }))
                  : [],
              },
            ];
          })
        : [],
    };
  });
  const dashboard = buildTodayDashboard(dashboardProjects);

  return (
    <main className="h-full overflow-y-auto bg-background px-4 py-4 text-foreground sm:px-6 sm:py-5">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Hoy</h1>
            <p className="text-sm text-foreground-muted">
              Qué están haciendo tus agentes y qué necesita tu atención.
            </p>
          </div>
          <Badge tone="success">
            <Activity className="size-3" /> Actualizando en vivo
          </Badge>
        </header>

        <section aria-label="Resumen de hoy" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard
            icon={<Bot className="size-4" />}
            label="Trabajando"
            value={dashboard.agents.working}
          />
          <SummaryCard
            icon={<AlertCircle className="size-4" />}
            label="Requieren atención"
            value={dashboard.agents.attention + dashboard.agents.error}
          />
          <SummaryCard
            icon={<CheckCircle2 className="size-4" />}
            label="Finalizadas hoy"
            value={dashboard.activity.completedTasks}
          />
          <SummaryCard
            icon={<Activity className="size-4" />}
            label="Proyectos activos"
            value={dashboard.projects.length}
          />
        </section>

        <section className="rounded-lg border border-border bg-background-1 p-4">
          <div className="flex items-start gap-3">
            <Coins className="mt-0.5 size-5 text-foreground-muted" />
            <div>
              <h2 className="font-medium">Tokens no disponibles</h2>
              <p className="text-sm text-foreground-muted">
                Los proveedores todavía no reportan un total exacto y comparable. No mostramos
                estimaciones como consumo real.
              </p>
            </div>
          </div>
        </section>

        {projects.length === 0 ? (
          <EmptyState
            bare
            label="No hay proyectos"
            description="Agregá un proyecto para empezar a verlo en el cockpit."
          />
        ) : (
          projects.map((project) => {
            const taskManager = getTaskManagerStore(project.id);
            const tasks = taskManager ? [...taskManager.tasks.values()] : [];
            return (
              <section
                key={project.id}
                className="overflow-hidden rounded-lg border border-border bg-background-1"
              >
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-medium">{project.name ?? project.id}</h2>
                    <p className="truncate text-xs text-foreground-passive">
                      {project.data?.path ?? project.id}
                    </p>
                  </div>
                  <Badge>{tasks.length} tareas</Badge>
                </div>
                {tasks.length === 0 ? (
                  <p className="px-4 py-5 text-sm text-foreground-muted">Sin tareas activas.</p>
                ) : (
                  <div className="divide-y divide-border">
                    {tasks.map((task) => {
                      const data = registeredTaskData(task);
                      if (!data) return null;
                      const conversations = Object.entries(data.conversations);
                      const totalConversations = conversations.reduce(
                        (total, [, count]) => total + count,
                        0
                      );
                      return (
                        <article key={data.id} className="flex flex-col gap-2 px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{data.name}</span>
                            <Badge tone={statusTone(data.status)}>{data.status}</Badge>
                            {totalConversations > 0 && (
                              <Badge tone="info">
                                <Bot className="size-3" /> {totalConversations}
                              </Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-muted">
                            <span>{task.workspacePath ?? 'Workspace todavía no creado'}</span>
                            <span>
                              Última actividad:{' '}
                              {data.lastInteractedAt
                                ? new Date(data.lastInteractedAt).toLocaleString()
                                : 'sin actividad'}
                            </span>
                          </div>
                          {conversations.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {conversations.map(([provider, count]) => (
                                <Badge key={provider} variant="outline">
                                  {provider}: {count}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>
    </main>
  );
});

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <article className="flex min-h-28 flex-col justify-between rounded-lg border border-border bg-background-1 p-4">
      <span className="flex items-center gap-2 text-xs text-foreground-muted">
        {icon}
        {label}
      </span>
      <strong className="text-3xl font-semibold tabular-nums">{value}</strong>
    </article>
  );
}

function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'info' {
  if (status === 'done') return 'success';
  if (status === 'in_progress' || status === 'review') return 'info';
  if (status === 'cancelled') return 'warning';
  return 'neutral';
}

export const cockpitViewRuntime = defineViewRuntime(cockpitViewDef, {
  slots: {
    wrap: Fragment,
    titlebar: () => <Titlebar leftSlot={<span className="px-2 text-sm">Hoy</span>} />,
    main: CockpitMainPanel,
  },
});
