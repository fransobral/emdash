import type { AgentStatus } from '@core/primitives/agents/api';

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

export type TodayDashboard = Readonly<{
  agents: { working: number; attention: number; error: number };
  activity: { completedTasks: number };
  activeAgents: TodayAgent[];
  recentTasks: TodayTask[];
  projects: Array<{ id: string; name: string; todayTasks: number; activeAgents: number }>;
  usage: { availability: 'unavailable' };
}>;

export function buildTodayDashboard(
  projects: readonly TodayProjectInput[],
  now = Date.now()
): TodayDashboard {
  const start = startOfLocalDay(now);
  const activeAgents: TodayAgent[] = [];
  const recentTasks: TodayTask[] = [];
  const projectSummaries: TodayDashboard['projects'] = [];

  for (const project of projects) {
    let todayTasks = 0;
    let projectActiveAgents = 0;

    for (const task of project.tasks) {
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
    usage: { availability: 'unavailable' },
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
