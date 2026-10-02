import { describe, expect, it } from 'vitest';
import type { DashboardUsage } from './cockpit-model';
import { usageCriticalWarnings } from './usage-section';

function accountUsage(usedPercent: number, resetsAt: number | null = null): DashboardUsage {
  return {
    availability: 'exact',
    generatedAt: 0,
    providers: [
      {
        providerId: 'codex',
        accounts: [
          {
            accountId: 'default',
            label: 'Codex',
            isDefault: true,
            rateLimits: {
              source: 'exact',
              fiveHour: { usedPercent, resetsAt },
              weekly: null,
              stale: false,
            },
            modelsToday: [],
            costTodayUsd: null,
            costSource: 'unavailable',
          },
        ],
      },
    ],
    sessionsToday: [],
  };
}

describe('usageCriticalWarnings', () => {
  it('returns no warnings below the 95% threshold', () => {
    expect(usageCriticalWarnings(accountUsage(94))).toEqual([]);
  });

  it('warns at or above the 95% threshold, including the reset time', () => {
    const resetsAt = new Date('2026-10-02T14:32:00.000Z').getTime();
    const warnings = usageCriticalWarnings(accountUsage(96, resetsAt));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Codex');
    expect(warnings[0]).toContain('96%');
    expect(warnings[0]).toContain('reinicia a las');
  });

  it('returns no warnings when usage is entirely unavailable', () => {
    expect(usageCriticalWarnings({ availability: 'unavailable' })).toEqual([]);
  });
});
