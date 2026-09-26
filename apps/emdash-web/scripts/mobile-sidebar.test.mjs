import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const repoRoot = resolve(import.meta.dirname, '../../..');

async function read(path) {
  return readFile(resolve(repoRoot, path), 'utf8');
}

test('mobile workspace navigation behaves as an accessible modal drawer', async () => {
  const layout = await read(
    'apps/emdash-desktop/src/renderer/lib/layout/workspace-layout.tsx'
  );
  const styles = await read('apps/emdash-web/web/mobile.css');

  assert.match(layout, /className="workspace-left-backdrop hidden"/);
  assert.match(layout, /aria-label="Close navigation"/);
  assert.match(layout, /onClick=\{\(\) => toggleLeftSidebar\(\)\}/);
  assert.match(styles, /\.workspace-left-backdrop\s*\{/);
  assert.match(styles, /\.workspace-left-panel\s*\{/);
  assert.match(styles, /width:\s*min\(88vw,\s*340px\)/);
  assert.match(styles, /min-height:\s*44px/);
});

test('desktop keeps the backdrop hidden outside the mobile breakpoint', async () => {
  const styles = await read('apps/emdash-web/web/mobile.css');
  const mobileBreakpoint = styles.indexOf('@media (max-width: 767px)');
  const hiddenBackdrop = styles.indexOf('.workspace-left-backdrop');

  assert.ok(hiddenBackdrop >= 0 && hiddenBackdrop < mobileBreakpoint);
  assert.match(styles.slice(hiddenBackdrop, mobileBreakpoint), /display:\s*none/);
});
