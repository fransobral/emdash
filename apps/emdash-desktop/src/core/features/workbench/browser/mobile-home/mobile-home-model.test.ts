import { describe, expect, it } from 'vitest';
import {
  classifyMobileHomeTask,
  formatRelativeTime,
  groupMobileHomeTasks,
  MOBILE_HOME_REVIEW_LIMIT,
  type MobileHomeTaskInput,
} from './mobile-home-model';

const NOW = Date.parse('2026-10-18T12:00:00Z');

function task(overrides: Partial<MobileHomeTaskInput> = {}): MobileHomeTaskInput {
  return {
    taskId: 't1',
    projectId: 'p1',
    projectName: 'Aurora',
    name: 'Tarea',
    lifecycle: 'in_progress',
    agentStatus: null,
    providerId: 'codex',
    lastInteractedAt: '2026-10-18T11:58:00Z',
    ...overrides,
  };
}

describe('classifyMobileHomeTask', () => {
  it('puts agents waiting for input or failed into attention', () => {
    expect(classifyMobileHomeTask(task({ agentStatus: 'awaiting-input' }))).toBe('attention');
    expect(classifyMobileHomeTask(task({ agentStatus: 'error' }))).toBe('attention');
  });

  it('puts running agents into working', () => {
    expect(classifyMobileHomeTask(task({ agentStatus: 'working' }))).toBe('working');
  });

  it('puts completed, review or changed idle tasks into review', () => {
    expect(classifyMobileHomeTask(task({ agentStatus: 'completed' }))).toBe('review');
    expect(classifyMobileHomeTask(task({ lifecycle: 'review' }))).toBe('review');
    expect(classifyMobileHomeTask(task({ agentStatus: 'idle', linesAdded: 3 }))).toBe('review');
  });

  it('omits idle tasks without changes, finished tasks and archived tasks', () => {
    expect(classifyMobileHomeTask(task({ agentStatus: 'idle' }))).toBeNull();
    expect(
      classifyMobileHomeTask(task({ lifecycle: 'done', agentStatus: 'completed' }))
    ).toBeNull();
    expect(classifyMobileHomeTask(task({ archivedAt: '2026-10-01T00:00:00Z' }))).toBeNull();
    expect(
      classifyMobileHomeTask(task({ archivedAt: '2026-10-01T00:00:00Z', agentStatus: 'working' }))
    ).toBeNull();
  });

  it('keeps attention over finished lifecycle so a pending permission is never hidden', () => {
    expect(classifyMobileHomeTask(task({ lifecycle: 'done', agentStatus: 'awaiting-input' }))).toBe(
      'attention'
    );
  });
});

describe('groupMobileHomeTasks', () => {
  it('orders groups attention, working, review and drops empty ones', () => {
    const groups = groupMobileHomeTasks([
      task({ taskId: 'r', agentStatus: 'completed' }),
      task({ taskId: 'a', agentStatus: 'awaiting-input' }),
    ]);
    expect(groups.map((g) => g.id)).toEqual(['attention', 'review']);
    expect(groups[0].label).toBe('Necesita tu atención');
  });

  it('sorts rows by most recent interaction first', () => {
    const [group] = groupMobileHomeTasks([
      task({ taskId: 'old', agentStatus: 'working', lastInteractedAt: '2026-10-18T10:00:00Z' }),
      task({ taskId: 'new', agentStatus: 'working', lastInteractedAt: '2026-10-18T11:59:00Z' }),
    ]);
    expect(group.rows.map((r) => r.taskId)).toEqual(['new', 'old']);
  });

  it('builds row activity, agent label and line counts', () => {
    const [group] = groupMobileHomeTasks([
      task({ agentStatus: 'awaiting-input', providerId: 'claude' }),
    ]);
    expect(group.rows[0]).toMatchObject({
      activity: 'Espera tu respuesta',
      agentLabel: 'Claude',
      projectName: 'Aurora',
      linesAdded: 0,
    });
  });

  it('caps the review list', () => {
    const many = Array.from({ length: MOBILE_HOME_REVIEW_LIMIT + 5 }, (_, i) =>
      task({ taskId: `t${i}`, agentStatus: 'completed' })
    );
    expect(groupMobileHomeTasks(many)[0].rows).toHaveLength(MOBILE_HOME_REVIEW_LIMIT);
  });

  it('returns no groups when nothing needs the user', () => {
    expect(groupMobileHomeTasks([task({ agentStatus: 'idle' })])).toEqual([]);
  });
});

describe('formatRelativeTime', () => {
  it('formats long and short spans in Spanish', () => {
    expect(formatRelativeTime(NOW - 2 * 60_000, NOW)).toBe('hace 2 min');
    expect(formatRelativeTime(NOW - 12 * 60_000, NOW, 'short')).toBe('12m');
    expect(formatRelativeTime(NOW - 3 * 3_600_000, NOW)).toBe('hace 3 h');
    expect(formatRelativeTime(NOW - 2 * 86_400_000, NOW, 'short')).toBe('2d');
    expect(formatRelativeTime(NOW - 5_000, NOW)).toBe('ahora');
  });

  it('returns an empty string for unknown timestamps', () => {
    expect(formatRelativeTime(0, NOW)).toBe('');
  });
});
