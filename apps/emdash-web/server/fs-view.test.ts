import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createViewTickets, mediaTypeForPath, parseRange, streamInline } from './fs-view';

let dir: string;
let server: Server | null = null;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fs-view-'));
});

afterEach(async () => {
  await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
  server = null;
  await rm(dir, { recursive: true, force: true });
});

async function serve(path: string): Promise<string> {
  server = createServer((req, res) => void streamInline(path, req, res));
  await new Promise<void>((done) => server?.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}

describe('file previews', () => {
  it('previews images, PDFs and videos but never SVG or HTML', () => {
    expect(mediaTypeForPath('/a/Foto.JPG')).toBe('image/jpeg');
    expect(mediaTypeForPath('/a/roadmap.pdf')).toBe('application/pdf');
    expect(mediaTypeForPath('/a/clip.mov')).toBe('video/quicktime');
    expect(mediaTypeForPath('/a/logo.svg')).toBeNull();
    expect(mediaTypeForPath('/a/page.html')).toBeNull();
  });

  it('parses byte ranges the way video players send them', () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=100-', 100)).toBe('invalid');
    expect(parseRange('bytes=5-1', 100)).toBe('invalid');
    expect(parseRange('items=0-1', 100)).toBe('invalid');
  });

  it('keeps view links reusable until they expire', () => {
    let time = 1_000;
    const tickets = createViewTickets('secret', () => time);
    const ticket = tickets.issue('/home/ubuntu/clip.mp4');
    expect(tickets.redeem(ticket)).toBe('/home/ubuntu/clip.mp4');
    expect(tickets.redeem(ticket)).toBe('/home/ubuntu/clip.mp4');
    expect(() => createViewTickets('other').redeem(ticket)).toThrow('invalid view link');
    time += 31 * 60_000;
    expect(() => tickets.redeem(ticket)).toThrow('view link expired');
  });

  it('streams the requested range inline with a sandboxing policy', async () => {
    const path = join(dir, 'clip.mp4');
    await writeFile(path, Buffer.from('0123456789'));
    const url = await serve(path);

    const whole = await fetch(url);
    expect(whole.status).toBe(200);
    expect(whole.headers.get('content-type')).toBe('video/mp4');
    expect(whole.headers.get('content-security-policy')).toContain('sandbox');
    expect(await whole.text()).toBe('0123456789');

    const part = await fetch(url, { headers: { range: 'bytes=2-5' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await part.text()).toBe('2345');

    const beyond = await fetch(url, { headers: { range: 'bytes=50-' } });
    expect(beyond.status).toBe(416);
  });
});
