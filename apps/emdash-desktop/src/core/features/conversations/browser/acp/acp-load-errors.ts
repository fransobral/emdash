import { WireError } from '@emdash/wire/rpc';

/** Timeouts and dropped connections, which a later attempt usually gets past. */
export function isTransientLoadError(error: unknown): boolean {
  if (error instanceof WireError) return error.code === 'TIMEOUT' || error.code === 'DISCONNECTED';
  return error instanceof Error && error.message.startsWith('Timed out');
}
