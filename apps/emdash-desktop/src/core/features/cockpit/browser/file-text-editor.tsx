import { Button } from '@emdash/ui/react/primitives';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FsApi, FsEntry } from './files-api';

type EditorState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; saved: string; draft: string; modifiedAt: number };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Plain-text editor for files in the explorer; saves refuse if the file changed on disk. */
export function FileTextEditor({
  api,
  entry,
  onClose,
}: {
  api: FsApi;
  entry: FsEntry;
  onClose: () => void;
}) {
  const [state, setState] = useState<EditorState>({ kind: 'loading' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.read(entry.path).then(
      (file) =>
        active &&
        setState({
          kind: 'ready',
          saved: file.content,
          draft: file.content,
          modifiedAt: file.modifiedAt,
        }),
      (error: unknown) => active && setState({ kind: 'error', message: errorText(error) })
    );
    return () => {
      active = false;
    };
  }, [api, entry.path]);

  const dirty = state.kind === 'ready' && state.draft !== state.saved;

  async function save(): Promise<void> {
    if (state.kind !== 'ready' || !dirty || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await api.write(entry.path, state.draft, state.modifiedAt);
      setState({ ...state, saved: state.draft, modifiedAt: result.modifiedAt });
    } catch (error) {
      setSaveError(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  function close(): void {
    if (dirty && !window.confirm('Hay cambios sin guardar. ¿Descartarlos?')) return;
    onClose();
  }

  return (
    <section className="flex min-h-[60vh] flex-col overflow-hidden rounded-lg border border-border bg-background-1">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Button variant="ghost" size="sm" aria-label="Volver" onClick={close}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {entry.name}
            {dirty && <span className="text-foreground-muted"> •</span>}
          </p>
          <p className="truncate font-mono text-xs text-foreground-passive">{entry.path}</p>
        </div>
        <Button variant="primary" size="sm" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? 'Guardando…' : 'Guardar'}
        </Button>
      </header>
      {saveError && <p className="text-destructive px-4 py-2 text-sm">{saveError}</p>}
      {state.kind === 'loading' && (
        <p className="px-4 py-5 text-sm text-foreground-muted">Abriendo…</p>
      )}
      {state.kind === 'error' && (
        <p className="text-destructive px-4 py-5 text-sm">No se puede editar: {state.message}</p>
      )}
      {state.kind === 'ready' && (
        <textarea
          className="min-h-[60vh] flex-1 resize-none bg-transparent p-4 font-mono text-xs leading-relaxed outline-none"
          spellCheck={false}
          value={state.draft}
          aria-label={`Contenido de ${entry.name}`}
          onChange={(event) => setState({ ...state, draft: event.currentTarget.value })}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 's') {
              event.preventDefault();
              void save();
            }
          }}
        />
      )}
    </section>
  );
}
