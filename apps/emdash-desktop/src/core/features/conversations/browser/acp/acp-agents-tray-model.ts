import type { AgentState, AgentStatus } from '@emdash/core/runtimes/acp/api/client';

/**
 * One row in the agents tray — a flattened, display-ready projection of an
 * `AgentState` plus its elapsed duration at the snapshot's `now`.
 */
export type AgentTrayRow = {
  agentId: string;
  toolCallId: string;
  launchTurnId: string | null;
  name: string;
  status: AgentStatus;
  background: boolean;
  elapsedMs: number;
  summary?: string;
};

export type AgentsTrayCounts = {
  running: number;
  completed: number;
  failed: number;
};

export type AgentsTraySnapshot = {
  /** False only when there are no agents at all; hide the tray in that case. */
  visible: boolean;
  counts: AgentsTrayCounts;
  /** Running-first, newest-first within each group. */
  rows: AgentTrayRow[];
};

/**
 * Derives the agents tray's visibility, counts, and ordered rows from the raw
 * live `agents` array.
 *
 * The visible row set is: every currently-running agent (from any turn, so a
 * still-running background agent from an older turn stays visible), plus
 * every agent launched in the most recently launched turn — so the user also
 * sees the results of the last batch once it finishes. When no agent shares a
 * `launchTurnId` (orphan updates whose launch was never observed), only the
 * single most recently started one qualifies as "the last batch".
 */
export function deriveAgentsTray(agents: readonly AgentState[], now: number): AgentsTraySnapshot {
  if (agents.length === 0) {
    return { visible: false, counts: { running: 0, completed: 0, failed: 0 }, rows: [] };
  }

  const mostRecent = agents.reduce((latest, candidate) =>
    candidate.startedAt > latest.startedAt ? candidate : latest
  );
  const lastTurnId = mostRecent.launchTurnId;

  const visibleAgents = agents.filter((candidate) => {
    if (candidate.status === 'running') return true;
    if (lastTurnId !== null) return candidate.launchTurnId === lastTurnId;
    return candidate === mostRecent;
  });

  const rows = [...visibleAgents]
    .sort((a, b) => {
      const aRunning = a.status === 'running' ? 0 : 1;
      const bRunning = b.status === 'running' ? 0 : 1;
      if (aRunning !== bRunning) return aRunning - bRunning;
      return b.startedAt - a.startedAt;
    })
    .map((candidate) => toAgentTrayRow(candidate, now));

  const counts = visibleAgents.reduce<AgentsTrayCounts>(
    (acc, candidate) => {
      if (candidate.status === 'running') return { ...acc, running: acc.running + 1 };
      if (candidate.status === 'completed') return { ...acc, completed: acc.completed + 1 };
      return { ...acc, failed: acc.failed + 1 };
    },
    { running: 0, completed: 0, failed: 0 }
  );

  return { visible: true, counts, rows };
}

/** Projects a single `AgentState` into its display-ready tray row at `now`. */
export function toAgentTrayRow(agent: AgentState, now: number): AgentTrayRow {
  return {
    agentId: agent.agentId,
    toolCallId: agent.toolCallId,
    launchTurnId: agent.launchTurnId,
    name: agent.name,
    status: agent.status,
    background: agent.background ?? false,
    elapsedMs: Math.max(
      0,
      (agent.status === 'running' ? now : (agent.completedAt ?? now)) - agent.startedAt
    ),
    summary: agent.summary,
  };
}

/**
 * Looks up one agent's row by id regardless of tray visibility rules — used
 * by the agent detail sheet, which stays open for an agent even after it
 * drops out of the tray's visible set.
 */
export function findAgentRow(
  agents: readonly AgentState[],
  agentId: string | null,
  now: number
): AgentTrayRow | null {
  if (!agentId) return null;
  const agent = agents.find((candidate) => candidate.agentId === agentId);
  return agent ? toAgentTrayRow(agent, now) : null;
}

/** Formats a duration as `{minutes}m{seconds}s`, e.g. `1m12s`, `0m22s`. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${String(seconds).padStart(2, '0')}s`;
}
