import type { AgentState } from '@emdash/core/runtimes/acp/api/client';
import { describe, expect, it } from 'vitest';
import { deriveAgentsTray, formatElapsed } from './acp-agents-tray-model';

function agent(overrides: Partial<AgentState> & Pick<AgentState, 'agentId'>): AgentState {
  return {
    toolCallId: `tc-${overrides.agentId}`,
    launchTurnId: 'turn-1',
    name: overrides.agentId,
    status: 'running',
    startedAt: 0,
    ...overrides,
  };
}

describe('deriveAgentsTray', () => {
  it('is not visible with no agents', () => {
    const snapshot = deriveAgentsTray([], 0);
    expect(snapshot.visible).toBe(false);
    expect(snapshot.rows).toEqual([]);
    expect(snapshot.counts).toEqual({ running: 0, completed: 0, failed: 0 });
  });

  it('is visible and includes a single running agent', () => {
    const agents = [agent({ agentId: 'a1', status: 'running', startedAt: 1_000 })];
    const snapshot = deriveAgentsTray(agents, 4_000);
    expect(snapshot.visible).toBe(true);
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0]?.elapsedMs).toBe(3_000);
    expect(snapshot.counts).toEqual({ running: 1, completed: 0, failed: 0 });
  });

  it('includes every agent from the most recently launched turn', () => {
    const agents = [
      agent({
        agentId: 'a1',
        launchTurnId: 'turn-1',
        status: 'completed',
        startedAt: 0,
        completedAt: 1_000,
      }),
      agent({
        agentId: 'a2',
        launchTurnId: 'turn-1',
        status: 'failed',
        startedAt: 500,
        completedAt: 1_500,
      }),
    ];
    const snapshot = deriveAgentsTray(agents, 10_000);
    expect(snapshot.visible).toBe(true);
    expect(snapshot.rows.map((r) => r.agentId)).toEqual(['a2', 'a1']);
    expect(snapshot.counts).toEqual({ running: 0, completed: 1, failed: 1 });
  });

  it('excludes finished agents from an older turn once a newer turn has launched', () => {
    const agents = [
      agent({
        agentId: 'old',
        launchTurnId: 'turn-1',
        status: 'completed',
        startedAt: 0,
        completedAt: 1_000,
      }),
      agent({
        agentId: 'new',
        launchTurnId: 'turn-2',
        status: 'completed',
        startedAt: 2_000,
        completedAt: 2_500,
      }),
    ];
    const snapshot = deriveAgentsTray(agents, 10_000);
    expect(snapshot.rows.map((r) => r.agentId)).toEqual(['new']);
    expect(snapshot.counts).toEqual({ running: 0, completed: 1, failed: 0 });
  });

  it('keeps a still-running background agent from an older turn visible', () => {
    const agents = [
      agent({
        agentId: 'bg',
        launchTurnId: 'turn-1',
        status: 'running',
        startedAt: 0,
        background: true,
      }),
      agent({
        agentId: 'new',
        launchTurnId: 'turn-2',
        status: 'completed',
        startedAt: 2_000,
        completedAt: 2_500,
      }),
    ];
    const snapshot = deriveAgentsTray(agents, 10_000);
    expect(snapshot.rows.map((r) => r.agentId).sort()).toEqual(['bg', 'new']);
    expect(snapshot.counts).toEqual({ running: 1, completed: 1, failed: 0 });
  });

  it('orders running rows before finished rows, newest first within each group', () => {
    const agents = [
      agent({
        agentId: 'done-old',
        launchTurnId: 't',
        status: 'completed',
        startedAt: 0,
        completedAt: 100,
      }),
      agent({ agentId: 'running-new', launchTurnId: 't', status: 'running', startedAt: 500 }),
      agent({ agentId: 'running-old', launchTurnId: 't', status: 'running', startedAt: 200 }),
      agent({
        agentId: 'done-new',
        launchTurnId: 't',
        status: 'failed',
        startedAt: 300,
        completedAt: 400,
      }),
    ];
    const snapshot = deriveAgentsTray(agents, 1_000);
    expect(snapshot.rows.map((r) => r.agentId)).toEqual([
      'running-new',
      'running-old',
      'done-new',
      'done-old',
    ]);
  });

  it('computes elapsed from completedAt for finished rows, ignoring now', () => {
    const agents = [
      agent({ agentId: 'a1', status: 'completed', startedAt: 1_000, completedAt: 1_500 }),
    ];
    const snapshot = deriveAgentsTray(agents, 999_999);
    expect(snapshot.rows[0]?.elapsedMs).toBe(500);
  });

  it('carries through background flag and summary', () => {
    const agents = [
      agent({
        agentId: 'a1',
        status: 'completed',
        startedAt: 0,
        completedAt: 1_000,
        background: true,
        summary: 'found 3 tables',
      }),
    ];
    const snapshot = deriveAgentsTray(agents, 1_000);
    expect(snapshot.rows[0]?.background).toBe(true);
    expect(snapshot.rows[0]?.summary).toBe('found 3 tables');
  });

  it('falls back to the single most recent orphan launch when no turn id is shared', () => {
    const agents = [
      agent({
        agentId: 'old-orphan',
        launchTurnId: null,
        status: 'completed',
        startedAt: 0,
        completedAt: 100,
      }),
      agent({
        agentId: 'new-orphan',
        launchTurnId: null,
        status: 'completed',
        startedAt: 500,
        completedAt: 600,
      }),
    ];
    const snapshot = deriveAgentsTray(agents, 1_000);
    expect(snapshot.rows.map((r) => r.agentId)).toEqual(['new-orphan']);
  });
});

describe('formatElapsed', () => {
  it('formats sub-minute durations with a leading 0m', () => {
    expect(formatElapsed(22_000)).toBe('0m22s');
  });

  it('formats minutes and zero-pads seconds', () => {
    expect(formatElapsed(72_000)).toBe('1m12s');
    expect(formatElapsed(243_000)).toBe('4m03s');
  });

  it('clamps negative durations to zero', () => {
    expect(formatElapsed(-500)).toBe('0m00s');
  });
});
