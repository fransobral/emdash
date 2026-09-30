import { Button, Spinner } from '@emdash/ui/react/primitives';
import { ArrowLeft, Download } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  PdfViewer,
  PreviewMessage,
  VideoViewer,
} from '@core/features/editor/contributions/browser/renderers/media-viewers';
import { formatBytes, previewKindForName, type FsApi, type FsEntry } from './files-api';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Streams an image, PDF, or video from the host through a reusable view link. */
export function FilePreview({
  api,
  entry,
  onClose,
  onDownload,
}: {
  api: FsApi;
  entry: FsEntry;
  onClose: () => void;
  onDownload: () => void;
}) {
  const kind = previewKindForName(entry.name);
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; url: string }
  >({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });
    api.viewUrl(entry.path).then(
      (url) => active && setState({ kind: 'ready', url }),
      (error: unknown) => active && setState({ kind: 'error', message: errorText(error) })
    );
    return () => {
      active = false;
    };
  }, [api, entry.path]);

  const url = state.kind === 'ready' ? state.url : null;
  const pdfSource = useMemo(() => (url ? { url } : null), [url]);

  return (
    <section className="flex h-[75vh] min-h-[60vh] flex-col overflow-hidden rounded-lg border border-border bg-background-1">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Button variant="ghost" size="sm" aria-label="Volver" onClick={onClose}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{entry.name}</p>
          <p className="truncate text-xs text-foreground-passive">
            {formatBytes(entry.sizeBytes)} · {entry.path}
          </p>
        </div>
        <Button variant="ghost" size="sm" aria-label="Descargar" onClick={onDownload}>
          <Download className="size-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1">
        {state.kind === 'loading' && (
          <PreviewMessage>
            <Spinner size="sm" />
          </PreviewMessage>
        )}
        {state.kind === 'error' && (
          <PreviewMessage>No se puede mostrar: {state.message}</PreviewMessage>
        )}
        {url && kind === 'image' && (
          <div className="flex h-full items-center justify-center overflow-auto bg-background-2 p-3">
            <img src={url} alt={entry.name} className="max-h-full max-w-full object-contain" />
          </div>
        )}
        {pdfSource && kind === 'pdf' && <PdfViewer source={pdfSource} />}
        {url && kind === 'video' && <VideoViewer src={url} name={entry.name} />}
      </div>
    </section>
  );
}
