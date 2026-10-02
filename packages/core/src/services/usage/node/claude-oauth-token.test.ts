import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readClaudeOAuthAccessToken } from './claude-oauth-token';

let configDir: string;

beforeEach(async () => {
  configDir = await mkdtemp(path.join(tmpdir(), 'emdash-claude-oauth-token-'));
});

afterEach(async () => {
  await rm(configDir, { recursive: true, force: true });
});

describe('readClaudeOAuthAccessToken', () => {
  it('reads the access token out of claudeAiOauth.accessToken', async () => {
    await writeFile(
      path.join(configDir, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'tok-123', refreshToken: 'ignored' } })
    );

    const token = await readClaudeOAuthAccessToken(configDir);

    expect(token).toBe('tok-123');
  });

  it('returns null when the credentials file does not exist', async () => {
    const token = await readClaudeOAuthAccessToken(configDir);

    expect(token).toBeNull();
  });

  it('returns null when the credentials file is not valid JSON', async () => {
    await writeFile(path.join(configDir, '.credentials.json'), 'not json');

    const token = await readClaudeOAuthAccessToken(configDir);

    expect(token).toBeNull();
  });

  it('returns null when claudeAiOauth is missing', async () => {
    await writeFile(path.join(configDir, '.credentials.json'), JSON.stringify({ other: true }));

    const token = await readClaudeOAuthAccessToken(configDir);

    expect(token).toBeNull();
  });

  it('returns null when accessToken is not a string', async () => {
    await writeFile(
      path.join(configDir, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 42 } })
    );

    const token = await readClaudeOAuthAccessToken(configDir);

    expect(token).toBeNull();
  });
});
