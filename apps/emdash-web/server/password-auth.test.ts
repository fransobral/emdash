import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createPasswordAuth, isPublicInstallAsset } from './password-auth';

function request(url: string, method = 'GET'): IncomingMessage {
  return { url, method, headers: {} } as IncomingMessage;
}

function response() {
  const res = { status: 0, headers: {} as Record<string, string> };
  return Object.assign(res, {
    writeHead(status: number, headers: Record<string, string> = {}) {
      res.status = status;
      res.headers = headers;
      return this;
    },
    end() {},
  }) as unknown as ServerResponse & { status: number; headers: Record<string, string> };
}

describe('isPublicInstallAsset', () => {
  it('exposes only the files browsers fetch without cookies to install the app', () => {
    expect(isPublicInstallAsset('/manifest.webmanifest')).toBe(true);
    expect(isPublicInstallAsset('/favicon.svg')).toBe(true);
    expect(isPublicInstallAsset('/icons/icon-192.png')).toBe(true);
    expect(isPublicInstallAsset('/icons/apple-touch-icon.png?v=2')).toBe(true);
  });

  it('keeps the app shell, worker, bundles, and APIs private', () => {
    for (const path of [
      '/',
      '/index.html',
      '/service-worker.js',
      '/assets/index-abc.js',
      '/api/bridge/state',
      '/icons/../index.html',
      '/icons%2F..%2Findex.html',
    ]) {
      expect(isPublicInstallAsset(path)).toBe(false);
    }
  });
});

describe('requireAuthentication', () => {
  const auth = createPasswordAuth({ password: 'secret', secret: 'token' });

  it('redirects anonymous page loads to the login screen', () => {
    const res = response();
    expect(auth.requireAuthentication(request('/'), res)).toBe(true);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/auth/login');
  });

  it('lets anonymous browsers read the install manifest and icons', () => {
    for (const path of ['/manifest.webmanifest', '/favicon.svg', '/icons/icon-512.png']) {
      const res = response();
      expect(auth.requireAuthentication(request(path), res)).toBe(false);
      expect(res.status).toBe(0);
    }
  });
});
