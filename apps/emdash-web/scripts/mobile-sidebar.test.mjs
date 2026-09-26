import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const repoRoot = resolve(import.meta.dirname, '../../..');

async function read(path) {
  return readFile(resolve(repoRoot, path), 'utf8');
}

test('mobile workspace exposes a reopen control that hides while the drawer is open', async () => {
  const layout = await read(
    'apps/emdash-desktop/src/renderer/lib/layout/workspace-layout.tsx'
  );
  const pwa = await read('apps/emdash-web/web/pwa.tsx');
  const styles = await read('apps/emdash-web/web/mobile.css');

  assert.match(layout, /className="workspace-main-panel h-full w-full"/);
  assert.match(layout, /id="workspace-mobile-navigation"/);
  assert.match(pwa, /querySelector\('\.workspace-main-panel'\)/);
  assert.match(styles, /body:has\(#workspace-mobile-navigation\) \.emdash-mobile-navigation/);
  assert.match(styles, /min-height:\s*44px/);
});

test('desktop keeps the reopen control hidden outside the mobile breakpoint', async () => {
  const styles = await read('apps/emdash-web/web/mobile.css');
  const mobileBreakpoint = styles.indexOf('@media (max-width: 767px)');
  const hiddenButton = styles.indexOf('.emdash-mobile-navigation {');

  assert.ok(hiddenButton >= 0 && hiddenButton < mobileBreakpoint);
  assert.match(styles.slice(hiddenButton, mobileBreakpoint), /display:\s*none/);
});
