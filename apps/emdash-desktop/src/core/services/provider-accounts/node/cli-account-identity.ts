import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export type CliAccountIdentity = { email: string | null; plan: string | null };

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Extracts display metadata only. Credentials and raw file contents never leave this helper. */
export function readCliAccountIdentity(
  providerId: string,
  configDirPath: string,
  read: (file: string) => string = (file) => readFileSync(file, 'utf8')
): CliAccountIdentity {
  const unavailable = { email: null, plan: null };
  if (!configDirPath) return unavailable;
  try {
    if (providerId === 'codex') {
      const auth = record(JSON.parse(read(path.join(configDirPath, 'auth.json'))));
      const token = text(record(auth.tokens).id_token);
      if (!token) return unavailable;
      const claims = record(
        JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'))
      );
      return {
        email: text(claims.email),
        plan: text(record(claims['https://api.openai.com/auth']).chatgpt_plan_type),
      };
    }
    if (providerId === 'claude') {
      const files = [path.join(configDirPath, '.claude.json')];
      if (path.resolve(configDirPath) === path.join(homedir(), '.claude'))
        files.push(path.join(homedir(), '.claude.json'));
      for (const file of files) {
        try {
          const account = record(record(JSON.parse(read(file))).oauthAccount);
          const email = text(account.emailAddress) ?? text(account.email);
          if (email) return { email, plan: text(account.organizationType) };
        } catch {
          /* Try only this account's own alternative settings path. */
        }
      }
    }
  } catch {
    /* Missing or malformed credentials have no display identity. */
  }
  return unavailable;
}
