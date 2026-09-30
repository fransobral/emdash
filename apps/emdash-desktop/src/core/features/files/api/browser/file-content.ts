import { encodeResourceUri, type HostFileRef } from '@emdash/core/primitives/path/api';
import { createScope } from '@emdash/shared/concurrency';
import { observe, pin, remote } from '@emdash/wire/state';
import { filesWireContract, type FilesContentModel } from '../contract';
import { getFilesClient } from './client';

/**
 * Watches a file's disk content and invokes `onChange` with every snapshot.
 * Intended for config-file watchers (e.g. `.emdash.json`), not open editors —
 * editor tabs acquire interest through OpenFileStore instead.
 */
export async function watchFileContent(
  ref: HostFileRef,
  onChange: (content: FilesContentModel) => void
): Promise<() => void> {
  if (typeof window === 'undefined') return () => {};
  const client = await getFilesClient();
  const uri = encodeResourceUri(ref);
  const scope = createScope({ label: `watch-file-content:${uri}` });
  const contentRemote = remote(filesWireContract.content, client.content, { scope, lingerMs: 0 });
  const model = contentRemote({ uri, source: 'disk' });
  pin(scope, [model.states.content]);
  observe(
    model.states.content,
    (current) => {
      if (current.value) onChange(current.value);
    },
    { scope }
  );
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    void (async () => {
      try {
        await contentRemote.dispose();
      } finally {
        await scope.dispose();
      }
    })();
  };
}

/**
 * Largest file read whole for an in-panel preview (images, PDFs, videos). The
 * default read limit is 200 KB, which cut off most photos.
 */
export const MEDIA_PREVIEW_MAX_BYTES = 100 * 1024 * 1024;

/** Reads up to MEDIA_PREVIEW_MAX_BYTES of a file for previews that need its bytes. */
export async function readMediaFile(ref: HostFileRef) {
  const client = await getFilesClient();
  const result = await client.fs.readBytes({
    uri: encodeResourceUri(ref),
    options: { maxBytes: MEDIA_PREVIEW_MAX_BYTES },
  });
  if (!result.success) return result;
  const bytes = await result.data.bytes();
  // Copy into a plain ArrayBuffer-backed array so it can back a Blob or move to a worker.
  const copy: Uint8Array<ArrayBuffer> = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return {
    success: true as const,
    data: {
      bytes: copy,
      mimeType: result.data.meta.mimeType,
      size: result.data.meta.totalSize,
      truncated: result.data.meta.truncated,
    },
  };
}

/** Reads an image file's bytes and returns them as a data URL for previews. */
export async function readImageFile(ref: HostFileRef) {
  const result = await readMediaFile(ref);
  if (!result.success) return result;
  const { bytes, mimeType, size, truncated } = result.data;
  const dataUrl = await blobToDataUrl(new Blob([bytes], { type: mimeType }));
  return { success: true as const, data: { dataUrl, mimeType, size, truncated } };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)), { once: true });
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Image read failed')), {
      once: true,
    });
    reader.readAsDataURL(blob);
  });
}
