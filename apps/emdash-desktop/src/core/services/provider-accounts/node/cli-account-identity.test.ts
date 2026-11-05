import { describe, expect, it } from 'vitest';
import { readCliAccountIdentity } from './cli-account-identity';

describe('readCliAccountIdentity', () => {
  it('extracts only Codex email and plan from the ID token', () => {
    const claims = {
      email: 'pro@example.com',
      'https://api.openai.com/auth': { chatgpt_plan_type: 'pro' },
    };
    const token = `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
    expect(
      readCliAccountIdentity('codex', '/codex', () =>
        JSON.stringify({ tokens: { id_token: token, access_token: 'secret' } })
      )
    ).toEqual({ email: 'pro@example.com', plan: 'pro' });
  });

  it('reads Claude identity from its own settings file', () => {
    expect(
      readCliAccountIdentity('claude', '/accounts/claude-work', (file) => {
        if (file !== '/accounts/claude-work/.claude.json') throw new Error('missing');
        return JSON.stringify({
          oauthAccount: { emailAddress: 'work@example.com', organizationType: 'claude_max' },
        });
      })
    ).toEqual({ email: 'work@example.com', plan: 'claude_max' });
  });

  it('does not borrow the default Claude identity for a different config directory', () => {
    expect(
      readCliAccountIdentity('claude', '/other', () => {
        throw new Error('missing');
      })
    ).toEqual({ email: null, plan: null });
  });

  it('handles malformed credentials without surfacing their contents', () => {
    expect(readCliAccountIdentity('codex', '/codex', () => '{broken')).toEqual({
      email: null,
      plan: null,
    });
  });
});
