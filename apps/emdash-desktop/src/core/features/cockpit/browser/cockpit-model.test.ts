import { describe, expect, it } from 'vitest';
import { buildTodayDashboard } from './cockpit-model';

const now = new Date(2026, 8, 25, 15, 30).getTime();

describe('buildTodayDashboard', () => {
  it('summarizes live agents and same-day notifications from real records', () => {
    const dashboard = buildTodayDashboard(
      [
        {
          id: 'aurora',
          name: 'Aurora',
          tasks: [
            {
              id: 'task-1',
              name: 'Mobile dashboard',
              status: 'in_progress',
              lastInteractedAt: new Date(now - 1_000).toISOString(),
              conversations: [
                { id: 'working', title: 'Implementando', providerId: 'claude', status: 'working' },
                {
                  id: 'waiting',
                  title: 'Revisión',
                  providerId: 'codex',
                  status: 'awaiting-input',
                },
              ],
            },
          ],
        },
      ],
      now
    );

    expect(dashboard.agents).toEqual({ working: 1, attention: 1, error: 0 });
    expect(dashboard.activity).toEqual({ completedTasks: 0 });
    expect(dashboard.activeAgents.map((agent) => agent.id)).toEqual(['working', 'waiting']);
  });

  it('orders recent tasks and ranks projects by today activity without inventing token usage', () => {
    const dashboard = buildTodayDashboard(
      [
        {
          id: 'quiet',
          name: 'Quiet',
          tasks: [
            {
              id: 'old',
              name: 'Yesterday',
              status: 'done',
              lastInteractedAt: new Date(2026, 8, 24, 23, 59).toISOString(),
              conversations: [],
            },
          ],
        },
        {
          id: 'busy',
          name: 'Busy',
          tasks: [
            {
              id: 'recent',
              name: 'Most recent',
              status: 'review',
              lastInteractedAt: new Date(now - 500).toISOString(),
              conversations: [],
            },
            {
              id: 'earlier',
              name: 'Earlier',
              status: 'done',
              lastInteractedAt: new Date(now - 5_000).toISOString(),
              conversations: [],
            },
          ],
        },
      ],
      now
    );

    expect(dashboard.recentTasks.map((task) => task.id)).toEqual(['recent', 'earlier']);
    expect(dashboard.projects[0]).toMatchObject({ id: 'busy', todayTasks: 2 });
    expect(dashboard.activity).toEqual({ completedTasks: 1 });
    expect(dashboard.usage).toEqual({ availability: 'unavailable' });
  });

  it('handles invalid activity timestamps and empty data safely', () => {
    expect(
      buildTodayDashboard(
        [
          {
            id: 'project',
            name: 'Project',
            tasks: [
              {
                id: 'task',
                name: 'Task',
                status: 'todo',
                lastInteractedAt: 'not-a-date',
                conversations: [],
              },
            ],
          },
        ],
        now
      )
    ).toMatchObject({
      agents: { working: 0, attention: 0, error: 0 },
      recentTasks: [],
      projects: [],
    });
  });
});
