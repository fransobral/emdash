import type { AgentStatus } from '@core/primitives/agents/api';
import type { TaskLifecycleStatus } from '@core/primitives/tasks/api';

export type MobileHomeTaskInput = Readonly<{
  taskId: string;
  projectId: string;
  projectName: string;
  name: string;
  lifecycle: TaskLifecycleStatus;
  /** Aggregated agent status of the task's conversations (same source as the desktop sidebar). */
  agentStatus: AgentStatus | null;
  providerId: string | null;
  /** ISO instant of the last interaction. */
  lastInteractedAt: string;
  archivedAt?: string | null;
  linesAdded?: number;
  linesDeleted?: number;
}>;

export type MobileHomeGroupId = 'attention' | 'working' | 'review';

export type MobileHomeRow = Readonly<{
  taskId: string;
  projectId: string;
  title: string;
  projectName: string;
  /** Short human description of what the agent is doing / waiting for. */
  activity: string;
  agentLabel: string | null;
  timestamp: number;
  linesAdded: number;
  linesDeleted: number;
}>;

export type MobileHomeGroup = Readonly<{
  id: MobileHomeGroupId;
  label: string;
  rows: readonly MobileHomeRow[];
}>;

export const MOBILE_HOME_GROUP_LABELS: Record<MobileHomeGroupId, string> = {
  attention: 'Necesita tu atención',
  working: 'Trabajando',
  review: 'Listas para revisar',
};

/** Review is a convenience list; keep it short so the composer stays reachable. */
export const MOBILE_HOME_REVIEW_LIMIT = 12;

const FINISHED_LIFECYCLES: ReadonlySet<TaskLifecycleStatus> = new Set([
  'done',
  'cancelled',
  'duplicate',
]);

export function classifyMobileHomeTask(task: MobileHomeTaskInput): MobileHomeGroupId | null {
  if (task.archivedAt) return null;
  if (task.agentStatus === 'awaiting-input' || task.agentStatus === 'error') return 'attention';
  if (task.agentStatus === 'working') return 'working';
  if (FINISHED_LIFECYCLES.has(task.lifecycle)) return null;
  const hasChanges = (task.linesAdded ?? 0) + (task.linesDeleted ?? 0) > 0;
  if (task.agentStatus === 'completed' || task.lifecycle === 'review' || hasChanges) {
    return 'review';
  }
  return null;
}

export function activityLabel(task: MobileHomeTaskInput, group: MobileHomeGroupId): string {
  if (group === 'attention') {
    return task.agentStatus === 'error' ? 'Hubo un error' : 'Espera tu respuesta';
  }
  if (group === 'working') return 'Trabajando';
  return 'Listo para revisar';
}

const AGENT_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  opencode: 'OpenCode',
  cursor: 'Cursor',
};

export function agentLabel(providerId: string | null): string | null {
  if (!providerId) return null;
  const known = AGENT_LABELS[providerId];
  if (known) return known;
  return providerId.charAt(0).toUpperCase() + providerId.slice(1);
}

function parseInstant(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Spanish relative time. `short` => "12m"; `long` => "hace 12 min". */
export function formatRelativeTime(
  timestamp: number,
  now: number,
  style: 'short' | 'long' = 'long'
): string {
  if (timestamp <= 0) return '';
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return 'ahora';
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (minutes < 60) return style === 'short' ? `${minutes}m` : `hace ${minutes} min`;
  if (hours < 24) return style === 'short' ? `${hours}h` : `hace ${hours} h`;
  return style === 'short' ? `${days}d` : `hace ${days} d`;
}

export function groupMobileHomeTasks(
  tasks: readonly MobileHomeTaskInput[]
): readonly MobileHomeGroup[] {
  const buckets: Record<MobileHomeGroupId, MobileHomeRow[]> = {
    attention: [],
    working: [],
    review: [],
  };
  for (const task of tasks) {
    const group = classifyMobileHomeTask(task);
    if (!group) continue;
    buckets[group].push({
      taskId: task.taskId,
      projectId: task.projectId,
      title: task.name,
      projectName: task.projectName,
      activity: activityLabel(task, group),
      agentLabel: agentLabel(task.providerId),
      timestamp: parseInstant(task.lastInteractedAt),
      linesAdded: task.linesAdded ?? 0,
      linesDeleted: task.linesDeleted ?? 0,
    });
  }
  const byRecency = (a: MobileHomeRow, b: MobileHomeRow) =>
    b.timestamp - a.timestamp || a.taskId.localeCompare(b.taskId);
  const ids: MobileHomeGroupId[] = ['attention', 'working', 'review'];
  return ids
    .map((id) => {
      const sorted = [...buckets[id]].sort(byRecency);
      const rows = id === 'review' ? sorted.slice(0, MOBILE_HOME_REVIEW_LIMIT) : sorted;
      return { id, label: MOBILE_HOME_GROUP_LABELS[id], rows };
    })
    .filter((group) => group.rows.length > 0);
}
