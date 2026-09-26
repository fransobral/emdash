import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const appRoot = resolve(import.meta.dirname, '..');

async function read(path) {
  return readFile(resolve(appRoot, path), 'utf8');
}

test('the web shell advertises installable app metadata', async () => {
  const html = await read('web/index.html');

  assert.match(html, /rel="icon"[^>]+href="\/favicon\.svg"/);
  assert.match(html, /rel="manifest"[^>]+href="\/manifest\.webmanifest"/);
  assert.match(html, /name="theme-color"/);
  assert.match(html, /viewport-fit=cover/);
});

test('the manifest defines a standalone Emdash experience with maskable icons', async () => {
  const manifest = JSON.parse(await read('web/public/manifest.webmanifest'));

  assert.equal(manifest.name, 'Emdash');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512'));
  assert.ok(manifest.icons.some((icon) => icon.purpose.includes('maskable')));
});

test('the service worker provides an offline app-shell fallback', async () => {
  const worker = await read('web/public/sw.js');

  assert.match(worker, /addEventListener\('install'/);
  assert.match(worker, /addEventListener\('fetch'/);
  assert.match(worker, /caches\.open/);
  assert.match(worker, /\/index\.html/);
});

test('service-worker registration also works when the page already loaded', async () => {
  const runtime = await read('web/pwa.tsx');

  assert.match(runtime, /document\.readyState === 'complete'/);
  assert.match(runtime, /navigator\.serviceWorker\.register\('\/sw\.js'\)/);
});
