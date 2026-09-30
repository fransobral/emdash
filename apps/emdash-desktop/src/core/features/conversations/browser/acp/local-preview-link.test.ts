import { describe, expect, it } from 'vitest';
import { localPreviewHref } from './local-preview-link';

describe('localPreviewHref', () => {
  it('routes loopback dev-server links through the preview proxy', () => {
    expect(localPreviewHref('http://localhost:3017/')).toBe('/preview/open?port=3017&path=%2F');
    expect(localPreviewHref('http://127.0.0.1:5173/presentaciones/roadmap?x=1#top')).toBe(
      '/preview/open?port=5173&path=%2Fpresentaciones%2Froadmap%3Fx%3D1%23top'
    );
    expect(localPreviewHref('http://[::1]:8000/a')).toBe('/preview/open?port=8000&path=%2Fa');
  });

  it('leaves other links alone', () => {
    for (const href of [
      'https://github.com/emdash',
      'http://localhost/',
      'http://localhost.evil.com:3017/',
      'file:///etc/passwd',
      'src/app.ts',
      'not a url',
    ]) {
      expect(localPreviewHref(href)).toBe(href);
    }
  });
});
