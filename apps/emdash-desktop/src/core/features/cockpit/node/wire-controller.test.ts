import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { noopLogger } from '@emdash/shared/logger';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ProviderAccount,
  ProviderAccountStore,
  ProviderAccountUpsert,
} from '@core/services/provider-accounts/api/provider-account-store';
import { usageSnapshotSchema } from '../api/contract';
import { createCockpitWireController } from './wire-controller';

/** Minimal in-memory `ProviderAccountStore`, enough for the cockpit controller's own tests. */
class FakeProviderAccountStore implements ProviderAccountStore {
  private rows = new Map<string, ProviderAccount>();

  private key(providerId: string, accountId: string): string {
    return `${providerId}:${accountId}`;
  }

  async upsertAccount(input: ProviderAccountUpsert) {
    const key = this.key(input.providerId, input.accountId);
    const existing = this.rows.get(key);
    const now = Date.now();
    const account: ProviderAccount = {
      providerId: input.providerId,
      accountId: input.accountId,
      credentialRef:
        existing?.credentialRef ?? `provider-credential:${input.providerId}:${input.accountId}`,
      isDefault: existing?.isDefault ?? this.listSync(input.providerId).length === 0,
      meta: input.meta ? { version: '1' as const, ...input.meta } : (existing?.meta ?? null),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.rows.set(key, account);
    const status: 'created' | 'updated' = existing ? 'updated' : 'created';
    return { account, status };
  }

  private listSync(providerId: string): ProviderAccount[] {
    return [...this.rows.values()].filter((a) => a.providerId === providerId);
  }

  async listAccounts(providerId: string) {
    return this.listSync(providerId);
  }

  async getAccount(providerId: string, accountId?: string) {
    if (accountId) return this.rows.get(this.key(providerId, accountId)) ?? null;
    return this.listSync(providerId).find((a) => a.isDefault) ?? null;
  }

  async getDefaultAccountId(providerId: string) {
    return (await this.getAccount(providerId))?.accountId ?? null;
  }

  async setDefaultAccount(providerId: string, accountId: string) {
    const target = this.rows.get(this.key(providerId, accountId));
    if (!target) return null;
    for (const account of this.listSync(providerId)) {
      account.isDefault = account.accountId === accountId;
    }
    return target;
  }

  async resolveSecret() {
    return null;
  }

  async removeAccount(providerId: string, accountId: string) {
    const key = this.key(providerId, accountId);
    const removed = this.rows.get(key) ?? null;
    this.rows.delete(key);
    return removed;
  }

  async isConfigured(providerId: string) {
    return this.listSync(providerId).length > 0;
  }
}

let claudeConfigDir: string;
let codexHome: string;
let store: FakeProviderAccountStore;

beforeEach(async () => {
  claudeConfigDir = await mkdtemp(path.join(tmpdir(), 'emdash-cockpit-claude-'));
  codexHome = await mkdtemp(path.join(tmpdir(), 'emdash-cockpit-codex-'));
  store = new FakeProviderAccountStore();
  await store.upsertAccount({
    providerId: 'claude',
    accountId: 'default',
    meta: { label: 'Claude', configDirPath: claudeConfigDir, credentialSource: 'cli' },
  });
  await store.upsertAccount({
    providerId: 'codex',
    accountId: 'default',
    meta: { label: 'Codex', configDirPath: codexHome, credentialSource: 'cli' },
  });
});

afterEach(async () => {
  await rm(claudeConfigDir, { recursive: true, force: true });
  await rm(codexHome, { recursive: true, force: true });
});

describe('createCockpitWireController usageSnapshot', () => {
  it('reports exact when both linked accounts config dirs are empty but present', async () => {
    const controller = createCockpitWireController(noopLogger, store);
    const snapshot = usageSnapshotSchema.parse(await controller.call('usageSnapshot', undefined));
    expect(snapshot.availability).toBe('exact');
    expect(snapshot.providers).toEqual([
      { providerId: 'claude', accounts: [expect.objectContaining({ accountId: 'default' })] },
      { providerId: 'codex', accounts: [expect.objectContaining({ accountId: 'default' })] },
    ]);
    expect(snapshot.sessionsToday).toEqual([]);
  });

  it('reads a real Claude session file end to end through the wire contract', async () => {
    const now = Date.now();
    const dir = path.join(claudeConfigDir, 'projects', '-home-ubuntu-demo');
    await mkdir(dir, { recursive: true });
    const lines = [
      {
        type: 'cost-state',
        sessionId: 'wire-session',
        totalCostUSD: 4.2,
        startTime: now,
        hasUnknownModelCost: false,
        modelUsage: {
          'claude-sonnet-4-5-20250929': {
            inputTokens: 10,
            outputTokens: 5,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            costUSD: 4.2,
          },
        },
      },
      {
        type: 'assistant',
        sessionId: 'wire-session',
        cwd: '/home/ubuntu/demo',
        timestamp: new Date(now).toISOString(),
        message: { model: 'claude-sonnet-4-5-20250929', usage: { input_tokens: 10 } },
      },
    ];
    await writeFile(
      path.join(dir, 'wire-session.jsonl'),
      lines.map((line) => JSON.stringify(line)).join('\n') + '\n'
    );

    const controller = createCockpitWireController(noopLogger, store);
    const snapshot = usageSnapshotSchema.parse(await controller.call('usageSnapshot', undefined));
    const claudeAccount = snapshot.providers.find((p) => p.providerId === 'claude')?.accounts[0];
    expect(claudeAccount?.costTodayUsd).toBeCloseTo(4.2);
    expect(snapshot.sessionsToday).toHaveLength(1);
    expect(snapshot.sessionsToday[0].cwd).toBe('/home/ubuntu/demo');
  });

  it('treats a missing config dir as not configured instead of an error', async () => {
    await rm(codexHome, { recursive: true, force: true });
    const controller = createCockpitWireController(noopLogger, store);
    const snapshot = usageSnapshotSchema.parse(await controller.call('usageSnapshot', undefined));
    expect(snapshot.availability).toBe('partial');
    const codexAccount = snapshot.providers.find((p) => p.providerId === 'codex')?.accounts[0];
    expect(codexAccount).toEqual(
      expect.objectContaining({ accountId: 'default', costSource: 'unavailable' })
    );
  });

  it('reports usageSnapshot across two accounts on the same provider', async () => {
    const otherDir = await mkdtemp(path.join(tmpdir(), 'emdash-cockpit-claude-2-'));
    await store.upsertAccount({
      providerId: 'claude',
      accountId: 'work',
      meta: { label: 'Claude (work)', configDirPath: otherDir, credentialSource: 'cli' },
    });
    try {
      const controller = createCockpitWireController(noopLogger, store);
      const snapshot = usageSnapshotSchema.parse(await controller.call('usageSnapshot', undefined));
      const claudeProvider = snapshot.providers.find((p) => p.providerId === 'claude');
      expect(claudeProvider?.accounts.map((a) => a.accountId)).toEqual(['default', 'work']);
    } finally {
      await rm(otherDir, { recursive: true, force: true });
    }
  });
});

describe('createCockpitWireController account linking', () => {
  it('lists linked accounts with a freshly-checked credential status', async () => {
    await writeFile(path.join(claudeConfigDir, '.credentials.json'), '{}');
    const controller = createCockpitWireController(noopLogger, store);
    const accounts = (await controller.call('linkedAccounts', undefined)) as Array<{
      providerId: string;
      accountId: string;
      credentialStatus: string;
    }>;
    const claude = accounts.find((a) => a.providerId === 'claude' && a.accountId === 'default');
    const codex = accounts.find((a) => a.providerId === 'codex' && a.accountId === 'default');
    expect(claude?.credentialStatus).toBe('linked');
    expect(codex?.credentialStatus).toBe('missing');
  });

  it('adds, renames and removes an account through the wire contract', async () => {
    const newDir = await mkdtemp(path.join(tmpdir(), 'emdash-cockpit-claude-new-'));
    try {
      const controller = createCockpitWireController(noopLogger, store);
      const added = (await controller.call('addUsageAccount', {
        providerId: 'claude',
        label: 'Cuenta nueva',
        configDirPath: newDir,
      })) as { success: boolean; data: { accountId: string; label: string } };
      expect(added.success).toBe(true);
      const accountId = added.data.accountId;
      expect(added.data.label).toBe('Cuenta nueva');

      const renamed = (await controller.call('renameUsageAccount', {
        providerId: 'claude',
        accountId,
        label: 'Renombrada',
      })) as { success: boolean; data: { label: string; configDirPath: string } };
      expect(renamed.success).toBe(true);
      expect(renamed.data.label).toBe('Renombrada');
      // Renaming must not drop the account's config dir.
      expect(renamed.data.configDirPath).toBe(newDir);

      const removed = (await controller.call('removeUsageAccount', {
        providerId: 'claude',
        accountId,
      })) as { success: boolean; data: { removed: boolean } };
      expect(removed.success).toBe(true);
      expect(removed.data.removed).toBe(true);
    } finally {
      await rm(newDir, { recursive: true, force: true });
    }
  });

  it('fails to rename an account that does not exist', async () => {
    const controller = createCockpitWireController(noopLogger, store);
    const result = (await controller.call('renameUsageAccount', {
      providerId: 'claude',
      accountId: 'missing',
      label: 'x',
    })) as { success: boolean };
    expect(result.success).toBe(false);
  });
});

describe('createCockpitWireController setUsageOauthEnabled', () => {
  it('toggles the opt-in OAuth usage setting for a Claude account', async () => {
    const controller = createCockpitWireController(noopLogger, store);
    const result = (await controller.call('setUsageOauthEnabled', {
      providerId: 'claude',
      accountId: 'default',
      enabled: true,
    })) as { success: boolean; data: { oauthUsageEnabled: boolean; configDirPath: string } };
    expect(result.success).toBe(true);
    expect(result.data.oauthUsageEnabled).toBe(true);
    // Toggling the setting must not drop the account's config dir.
    expect(result.data.configDirPath).toBe(claudeConfigDir);
  });

  it('rejects the setting for a non-Claude account', async () => {
    const controller = createCockpitWireController(noopLogger, store);
    const result = (await controller.call('setUsageOauthEnabled', {
      providerId: 'codex',
      accountId: 'default',
      enabled: true,
    })) as { success: boolean };
    expect(result.success).toBe(false);
  });

  it('fails for an account that does not exist', async () => {
    const controller = createCockpitWireController(noopLogger, store);
    const result = (await controller.call('setUsageOauthEnabled', {
      providerId: 'claude',
      accountId: 'missing',
      enabled: true,
    })) as { success: boolean };
    expect(result.success).toBe(false);
  });

  it('never calls the network: usageSnapshot leaves rate limits unavailable when OAuth usage is off', async () => {
    const controller = createCockpitWireController(noopLogger, store);
    const snapshot = usageSnapshotSchema.parse(await controller.call('usageSnapshot', undefined));
    const claudeAccount = snapshot.providers.find((p) => p.providerId === 'claude')?.accounts[0];
    expect(claudeAccount?.rateLimits).toEqual({
      source: 'unavailable',
      fiveHour: null,
      weekly: null,
      stale: false,
    });
  });
});
