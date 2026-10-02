import { readFile } from 'node:fs/promises';
import path from 'node:path';

const CREDENTIALS_FILENAME = '.credentials.json';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Reads a Claude account's own OAuth access token from its
 * `CLAUDE_CONFIG_DIR/.credentials.json`, for the opt-in Anthropic usage
 * endpoint (Phase 2). Only the `claudeAiOauth.accessToken` field is ever
 * extracted; the parsed object and raw file contents are discarded
 * immediately on every return path. Callers must never log the returned
 * token, and must only call this right before using the token, not ahead
 * of time or at startup.
 */
export async function readClaudeOAuthAccessToken(configDirPath: string): Promise<string | null> {
  try {
    const raw = await readFile(path.join(configDirPath, CREDENTIALS_FILENAME), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const oauth = parsed.claudeAiOauth;
    if (!isRecord(oauth)) return null;
    const token = oauth.accessToken;
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}
