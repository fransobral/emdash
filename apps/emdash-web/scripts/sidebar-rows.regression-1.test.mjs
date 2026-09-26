// Regression: ISSUE-001 — sidebar projects overlapped each other on mobile
// Found by /qa on 2026-09-26
// Report: apps/emdash-web/.gstack/qa-reports/qa-report-localhost-2026-09-26.md
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const repoRoot = resolve(import.meta.dirname, '../../..');
const read = (path) => readFile(resolve(repoRoot, path), 'utf8');
const sidebar = 'apps/emdash-desktop/src/core/features/workbench/browser/sidebar';

test('mobile CSS never resizes the virtualized drawer rows behind the list', async () => {
  // Rows are absolutely positioned at a fixed pitch; forcing a taller min-height
  // from CSS made every row spill into the next one.
  const styles = await read('apps/emdash-web/web/mobile.css');

  assert.doesNotMatch(styles, /#workspace-mobile-navigation (button|a|\[role)/);
});

test('the virtual list and its rows agree on the 44px mobile row height', async () => {
  const list = await read(`${sidebar}/sidebar-virtual-list.tsx`);
  const project = await read(`${sidebar}/project-item.tsx`);
  const task = await read(`${sidebar}/task-item.tsx`);

  assert.match(list, /MOBILE_ROW_HEIGHT = 44/);
  assert.match(list, /estimateSize: \(\) => rowHeight/);
  assert.match(list, /virtualizer\.measure\(\)/);
  assert.match(project, /h-8 max-md:h-11/);
  assert.match(task, /h-8 max-md:h-11/);
});
