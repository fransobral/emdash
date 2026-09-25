/**
 * Delete projects by id over the emdash-web wire.
 * Usage: node scripts/delproj.mjs ws://127.0.0.1:4200/ws?token=... <id> [id...]
 */
import { connect, streamTransport } from '@emdash/wire/rpc';
import WebSocket from 'ws';

const url = process.argv[2];
const ids = process.argv.slice(3);
if (!url || ids.length === 0) {
  console.error('usage: node scripts/delproj.mjs <ws-url> <projectId...>');
  process.exit(1);
}

const ws = new WebSocket(url, {
  headers: process.env.EMDASH_WEB_COOKIE ? { Cookie: process.env.EMDASH_WEB_COOKIE } : undefined,
});
ws.binaryType = 'nodebuffer';
const dataListeners = new Set();
const closeListeners = new Set();
ws.on('message', (chunk) => { for (const l of dataListeners) l(chunk); });
ws.on('close', (code, reason) => { console.error(`ws closed ${code} ${reason}`); for (const l of closeListeners) l(); });
const input = { on(event, cb) { if (event === 'data') dataListeners.add(cb); else closeListeners.add(cb); return this; } };
const output = { write: (chunk) => ws.send(chunk) };

await new Promise((resolve, reject) => {
  ws.on('open', resolve);
  ws.on('error', reject);
  setTimeout(() => reject(new Error('connect timeout')), 10_000);
});
const connection = connect(streamTransport(input, output));

for (const id of ids) {
  try {
    await connection.call('projects.deleteProject', { projectId: id }, { timeoutMs: 60_000 });
    console.log('deleted', id);
  } catch (error) {
    console.log('err', id, error instanceof Error ? error.message : error);
  }
}
ws.close();
process.exit(0);
