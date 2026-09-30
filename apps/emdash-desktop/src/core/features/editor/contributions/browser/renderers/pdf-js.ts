import type * as PdfJs from 'pdfjs-dist';

let loading: Promise<typeof PdfJs> | null = null;

/**
 * pdf.js is ~1.6 MB with its worker, so it loads on the first PDF preview
 * instead of with the app (same reason Monaco is loaded lazily).
 */
export function loadPdfJs(): Promise<typeof PdfJs> {
  loading ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  loading.catch(() => {
    // Let the next preview retry instead of caching a failed chunk load.
    loading = null;
  });
  return loading;
}
