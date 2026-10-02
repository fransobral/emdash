import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ClaudeUsageScan, CodexUsageScan } from '@emdash/core/services/usage/node';
import { ClaudeUsageReader, CodexUsageReader } from '@emdash/core/services/usage/node';
import type { Logger } from '@emdash/shared/logger';
import { createController, type Controller } from '@emdash/wire/rpc';
import { cockpitContract } from '../api/contract';
import { buildUsageSnapshot, startOfLocalDay } from './usage-snapshot';

/** Same env vars already allow-listed for provider process spawning. */
function resolveClaudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(homedir(), '.claude');
}

function resolveCodexHome(): string {
  return process.env.CODEX_HOME?.trim() || path.join(homedir(), '.codex');
}

export function createCockpitWireController(logger: Logger): Controller {
  const claudeConfigDir = resolveClaudeConfigDir();
  const codexHome = resolveCodexHome();
  const claudeReader = new ClaudeUsageReader(claudeConfigDir);
  const codexReader = new CodexUsageReader(codexHome);

  return createController(cockpitContract, {
    usageSnapshot: async () => {
      const now = Date.now();
      const since = startOfLocalDay(now);
      const [claude, codex] = await Promise.all([
        scanOrNull(claudeConfigDir, () => claudeReader.scan(since), logger),
        scanOrNull(codexHome, () => codexReader.scan(since), logger),
      ]);
      return buildUsageSnapshot({ claude, codex, now });
    },
  });
}

/**
 * Returns `null` when the provider's config dir does not exist at all (not
 * configured on this machine), rather than treating that as an error. A
 * scan failure on an existing dir is logged and degrades to `null` too — a
 * local-file read problem must never take down the whole Hoy dashboard.
 */
async function scanOrNull<T extends ClaudeUsageScan | CodexUsageScan>(
  configDir: string,
  scan: () => Promise<T>,
  logger: Logger
): Promise<T | null> {
  if (!existsSync(configDir)) return null;
  try {
    return await scan();
  } catch (error) {
    logger.warn('cockpit: usage scan failed', { configDir, error });
    return null;
  }
}
