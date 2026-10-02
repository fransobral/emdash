import type { AgentStatus } from '@core/primitives/agents/api';
import type { UsageSessionRow, UsageSnapshot } from '../api/contract';

export type TodayConversationInput = Readonly<{
  id: string;
  title: string;
  providerId: string;
  status: AgentStatus;
}>;

export type TodayTaskInput = Readonly<{
  id: string;
  name: string;
  status: string;
  lastInteractedAt?: string | null;
  /** The task's worktree path, used to join local usage sessions by `cwd`. */
  workspacePath?: string | null;
  conversations: readonly TodayConversationInput[];
}>;

export type TodayProjectInput = Readonly<{
  id: string;
  name: string;
  tasks: readonly TodayTaskInput[];
}>;

export type TodayAgent = TodayConversationInput &
  Readonly<{
    projectId: string;
    projectName: string;
    taskId: string;
    taskName: string;
  }>;

export type TodayTask = Omit<TodayTaskInput, 'conversations'> &
  Readonly<{
    projectId: string;
    projectName: string;
    timestamp: number;
  }>;

/** A usage session row enriched with the emdash task it was run from, when one matches by cwd. */
export type DashboardSessionRow = UsageSessionRow &
  Readonly<{
    taskId: string | null;
    taskName: string | null;
    taskStatus: string | null;
  }>;

export type DashboardUsage =
  | { availability: 'unavailable' }
  | {
      availability: 'exact' | 'partial';
      generatedAt: number;
      providers: UsageSnapshot['providers'];
      sessionsToday: DashboardSessionRow[];
    };

export type TodayDashboard = Readonly<{
  agents: { working: number; attention: number; error: number };
  activity: { completedTasks: number };
  activeAgents: TodayAgent[];
  recentTasks: TodayTask[];
  projects: Array<{ id: string; name: string; todayTasks: number; activeAgents: number }>;
  usage: DashboardUsage;
}>;

export function buildTodayDashboard(
  projects: readonly TodayProjectInput[],
  now = Date.now(),
  usageSnapshot?: UsageSnapshot
): TodayDashboard {
  const start = startOfLocalDay(now);
  const activeAgents: TodayAgent[] = [];
  const recentTasks: TodayTask[] = [];
  const projectSummaries: TodayDashboard['projects'] = [];
  const taskByWorkspacePath = new Map<
    string,
    { taskId: string; taskName: string; taskStatus: string }
  >();

  for (const project of projects) {
    let todayTasks = 0;
    let projectActiveAgents = 0;

    for (const task of project.tasks) {
      if (task.workspacePath) {
        taskByWorkspacePath.set(task.workspacePath, {
          taskId: task.id,
          taskName: task.name,
          taskStatus: task.status,
        });
      }

      const timestamp = parseTimestamp(task.lastInteractedAt);
      if (timestamp !== null && timestamp >= start && timestamp <= now) {
        todayTasks += 1;
        recentTasks.push({
          id: task.id,
          name: task.name,
          status: task.status,
          lastInteractedAt: task.lastInteractedAt,
          projectId: project.id,
          projectName: project.name,
          timestamp,
        });
      }

      for (const conversation of task.conversations) {
        if (!isActiveStatus(conversation.status)) continue;
        projectActiveAgents += 1;
        activeAgents.push({
          ...conversation,
          projectId: project.id,
          projectName: project.name,
          taskId: task.id,
          taskName: task.name,
        });
      }
    }

    if (todayTasks > 0 || projectActiveAgents > 0) {
      projectSummaries.push({
        id: project.id,
        name: project.name,
        todayTasks,
        activeAgents: projectActiveAgents,
      });
    }
  }

  recentTasks.sort((a, b) => b.timestamp - a.timestamp);
  projectSummaries.sort((a, b) => b.todayTasks - a.todayTasks || b.activeAgents - a.activeAgents);

  return {
    agents: {
      working: activeAgents.filter((agent) => agent.status === 'working').length,
      attention: activeAgents.filter((agent) => agent.status === 'awaiting-input').length,
      error: activeAgents.filter((agent) => agent.status === 'error').length,
    },
    activity: {
      completedTasks: recentTasks.filter((task) => isCompletedStatus(task.status)).length,
    },
    activeAgents,
    recentTasks: recentTasks.slice(0, 8),
    projects: projectSummaries,
    usage: toDashboardUsage(usageSnapshot, taskByWorkspacePath),
  };
}

function toDashboardUsage(
  snapshot: UsageSnapshot | undefined,
  taskByWorkspacePath: ReadonlyMap<string, { taskId: string; taskName: string; taskStatus: string }>
): DashboardUsage {
  if (!snapshot || snapshot.availability === 'unavailable') return { availability: 'unavailable' };
  return {
    availability: snapshot.availability,
    generatedAt: snapshot.generatedAt,
    providers: snapshot.providers,
    sessionsToday: snapshot.sessionsToday.map((session) => {
      const task = session.cwd ? taskByWorkspacePath.get(session.cwd) : undefined;
      return {
        ...session,
        taskId: task?.taskId ?? null,
        taskName: task?.taskName ?? null,
        taskStatus: task?.taskStatus ?? null,
      };
    }),
  };
}

function isCompletedStatus(status: string): boolean {
  return status === 'done' || status === 'completed';
}

function isActiveStatus(status: AgentStatus): boolean {
  return status === 'working' || status === 'awaiting-input' || status === 'error';
}

function parseTimestamp(value?: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function startOfLocalDay(now: number): number {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
