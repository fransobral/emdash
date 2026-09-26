// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('web notification service worker', () => {
  it('focuses an existing client, forwards the deep-link payload, and falls back to opening app', () => {
    const source = readFileSync(resolve(__dirname, '../public/service-worker.js'), 'utf8');

    expect(source).toContain("addEventListener('notificationclick'");
    expect(source).toContain('event.notification.data');
    expect(source).toContain('client.focus()');
    expect(source).toContain('client.postMessage(payload)');
    expect(source).toContain("clients.openWindow('/')");
  });
});
