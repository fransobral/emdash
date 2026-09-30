import { describe, expect, it } from 'vitest';
import {
  getFileKind,
  isBinaryForDiff,
  isMonacoBackedKind,
} from '@core/features/editor/api/browser/renderers/fileKind';

describe('fileKind', () => {
  it('treats csv as a Monaco-backed preview kind', () => {
    const kind = getFileKind('customers.csv');

    expect(kind).toBe('csv');
    expect(isMonacoBackedKind(kind)).toBe(true);
  });

  it('previews PDFs and common videos instead of treating them as binary', () => {
    expect(getFileKind('docs/roadmap-aurora-12-meses.pdf')).toBe('pdf');
    expect(getFileKind('clips/demo.MOV')).toBe('video');
    expect(getFileKind('clips/demo.webm')).toBe('video');
    expect(getFileKind('clips/demo.avi')).toBe('binary');
    expect(isMonacoBackedKind('pdf')).toBe(false);
    expect(isBinaryForDiff('docs/roadmap.pdf')).toBe(true);
    expect(isBinaryForDiff('clips/demo.mp4')).toBe(true);
  });
});
