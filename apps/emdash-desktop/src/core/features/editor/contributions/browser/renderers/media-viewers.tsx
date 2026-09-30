import { Spinner } from '@emdash/ui/react/primitives';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { loadPdfJs } from './pdf-js';

/** Where a PDF comes from: a URL the browser can fetch, or bytes already in memory. */
export type PdfSource = { url: string } | { data: Uint8Array };

const MAX_PAGE_WIDTH = 1000;
const PAGE_GAP_PX = 12;
const A4_ASPECT = 1.4142;
const MAX_PIXEL_RATIO = 2;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function PreviewMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-4 text-center text-xs text-foreground-passive">
      {children}
    </div>
  );
}

/**
 * Renders a PDF with pdf.js onto canvases, so it works the same on desktop and
 * mobile browsers (mobile browsers can't show PDFs inside a page). Pages render
 * as they scroll into view.
 */
export function PdfViewer({ source }: { source: PdfSource }) {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'ready'; doc: PDFDocumentProxy }
  >({ kind: 'loading' });
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    setState({ kind: 'loading' });
    loadPdfJs()
      .then((pdfjs) => {
        if (cancelled) return null;
        // pdf.js transfers the buffer to its worker, so hand it a copy.
        task = pdfjs.getDocument(
          'url' in source ? { url: source.url } : { data: source.data.slice() }
        );
        return task.promise;
      })
      .then((doc) => {
        if (doc && !cancelled) setState({ kind: 'ready', doc });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: errorText(error) });
      });
    return () => {
      cancelled = true;
      // Destroying the loading task also frees the document and its worker.
      void task?.destroy();
    };
  }, [source]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const available = Math.floor((entry?.contentRect.width ?? 0) - 2 * PAGE_GAP_PX);
      setWidth(Math.max(0, Math.min(available, MAX_PAGE_WIDTH)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={scroller} className="h-full overflow-auto bg-background-2">
      {state.kind === 'loading' && (
        <PreviewMessage>
          <Spinner size="sm" />
        </PreviewMessage>
      )}
      {state.kind === 'error' && (
        <PreviewMessage>No se pudo abrir el PDF: {state.message}</PreviewMessage>
      )}
      {state.kind === 'ready' && width > 0 && (
        <div
          className="flex flex-col items-center"
          style={{ gap: PAGE_GAP_PX, padding: PAGE_GAP_PX }}
        >
          {Array.from({ length: state.doc.numPages }, (_, index) => (
            <PdfPage key={index} doc={state.doc} pageNumber={index + 1} width={width} />
          ))}
        </div>
      )}
    </div>
  );
}

function PdfPage({
  doc,
  pageNumber,
  width,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  width: number;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [aspect, setAspect] = useState(A4_ASPECT);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '800px 0px' }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    doc
      .getPage(pageNumber)
      .then((page) => {
        const target = canvas.current;
        if (cancelled || !target) return;
        const base = page.getViewport({ scale: 1 });
        setAspect(base.height / base.width);
        const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
        const viewport = page.getViewport({ scale: (width / base.width) * ratio });
        target.width = Math.floor(viewport.width);
        target.height = Math.floor(viewport.height);
        task = page.render({ canvas: target, viewport });
        return task.promise;
      })
      .catch((caught: unknown) => {
        // A cancelled render is expected when the width changes or the preview closes.
        const isCancel = caught instanceof Error && caught.name === 'RenderingCancelledException';
        if (!cancelled && !isCancel) setError(errorText(caught));
      });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNumber, width, visible]);

  return (
    <div
      ref={holder}
      className="relative shrink-0 bg-white shadow-sm"
      style={{ width, height: Math.round(width * aspect) }}
      aria-label={`Página ${pageNumber} de ${doc.numPages}`}
    >
      <canvas ref={canvas} className="block h-full w-full" />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-4 text-xs text-foreground-passive">
          No se pudo mostrar la página {pageNumber}: {error}
        </div>
      )}
    </div>
  );
}

/** Native player; `playsInline` keeps iOS from forcing fullscreen. */
export function VideoViewer({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <PreviewMessage>Este navegador no puede reproducir {name}.</PreviewMessage>;
  }
  return (
    <div className="flex h-full items-center justify-center bg-black">
      <video
        src={src}
        controls
        playsInline
        preload="metadata"
        aria-label={name}
        className="max-h-full max-w-full"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
