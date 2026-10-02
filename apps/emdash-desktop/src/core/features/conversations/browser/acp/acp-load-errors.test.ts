import { WireError } from '@emdash/wire/rpc';
import { describe, expect, it } from 'vitest';
import { isTransientLoadError } from './acp-load-errors';

describe('isTransientLoadError', () => {
  it('retries timeouts and dropped connections, not real failures', () => {
    expect(isTransientLoadError(new Error('Timed out attaching ACP session'))).toBe(true);
    expect(isTransientLoadError(new WireError('DISCONNECTED', 'gone'))).toBe(true);
    expect(isTransientLoadError(new WireError('TIMEOUT', 'slow'))).toBe(true);
    expect(isTransientLoadError(new WireError('HANDLER_ERROR', 'boom'))).toBe(false);
    expect(isTransientLoadError(new Error('auth required'))).toBe(false);
  });
});
