import { Button, Field, Input } from '@emdash/ui/react/primitives';
import { ArrowUp, FolderPlus, RefreshCw, Upload, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cockpitFilesViewDef } from '@core/features/cockpit/contributions/views';
import { getProjectManagerStore } from '@core/features/projects/api/browser/stores/project-selectors';
import { Titlebar } from '@core/features/workbench/contributions/browser/Titlebar';
import { cn } from '@core/primitives/styling/browser/cn';
import { defineViewRuntime } from '@core/primitives/views/react';
import { FileTextEditor } from './file-text-editor';
import {
  createFsApi,
  formatBytes,
  FsApiError,
  pathCrumbs,
  type FsEntry,
  type FsListing,
} from './files-api';
import { EntryRow } from './files-entry-row';

const BRIDGE_TOKEN_KEY = 'emdash-web-bridge-token';
const SESSION_TOKEN_KEY = 'emdash-web-token';
const LAST_PATH_KEY = 'emdash-files-path';
const HOME = '/home/ubuntu';

type UploadItem = {
  id: string;
  name: string;
  sizeBytes: number;
  receivedBytes: number;
  status: 'uploading' | 'done' | 'error' | 'canceled';
  error?: string;
  controller: AbortController;
};

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: the value just isn't remembered.
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const FilesMainPanel = observer(function FilesMainPanel() {
  const projects = [...getProjectManagerStore().projects.values()].filter(
    (project) => project.data?.type === 'local'
  );
  const [sessionToken] = useState(() => readStorage(SESSION_TOKEN_KEY));
  const [token, setToken] = useState(
    () => readStorage(BRIDGE_TOKEN_KEY) ?? readStorage(SESSION_TOKEN_KEY) ?? ''
  );
  const api = useMemo(() => createFsApi(token), [token]);
  const [path, setPath] = useState(() => readStorage(LAST_PATH_KEY) ?? HOME);
  const [pathDraft, setPathDraft] = useState(path);
  const [listing, setListing] = useState<FsListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [editing, setEditing] = useState<FsEntry | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (target: string) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const next = await api.list(target);
        setListing(next);
        setPath(next.path);
        setPathDraft(next.path);
        writeStorage(LAST_PATH_KEY, next.path);
      } catch (caught) {
        setError(errorText(caught));
      } finally {
        setLoading(false);
      }
    },
    [api, token]
  );

  const initialPath = useRef(path);
  useEffect(() => {
    void load(initialPath.current);
  }, [load]);

  const patchUpload = (id: string, patch: Partial<UploadItem>) =>
    setUploads((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  async function uploadOne(file: File, dir: string, overwrite = false): Promise<void> {
    const item: UploadItem = {
      id: crypto.randomUUID(),
      name: file.name,
      sizeBytes: file.size,
      receivedBytes: 0,
      status: 'uploading',
      controller: new AbortController(),
    };
    setUploads((items) => [item, ...items.filter((other) => other.name !== file.name)]);
    try {
      await api.upload({
        file,
        dir,
        overwrite,
        signal: item.controller.signal,
        onProgress: (receivedBytes) => patchUpload(item.id, { receivedBytes }),
      });
      patchUpload(item.id, { status: 'done', receivedBytes: file.size });
    } catch (caught) {
      if (item.controller.signal.aborted) {
        patchUpload(item.id, { status: 'canceled' });
        return;
      }
      const exists = caught instanceof FsApiError && caught.status === 409;
      if (exists && !overwrite && window.confirm(`${file.name} ya existe. ¿Reemplazarlo?`)) {
        await uploadOne(file, dir, true);
        return;
      }
      patchUpload(item.id, { status: 'error', error: errorText(caught) });
    }
  }

  async function upload(files: FileList | File[]): Promise<void> {
    if (!token) {
      setError('Ingresá el token del bridge.');
      return;
    }
    writeStorage(BRIDGE_TOKEN_KEY, token);
    const dir = path;
    for (const file of Array.from(files)) await uploadOne(file, dir);
    if (dir === path) await load(dir);
  }

  async function createFolder(): Promise<void> {
    const name = newFolder?.trim();
    if (!name) return;
    try {
      await api.mkdir(path, name);
      setNewFolder(null);
      await load(path);
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  async function download(entry: FsEntry): Promise<void> {
    try {
      window.location.href = await api.downloadUrl(entry.path);
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  async function renameEntry(entry: FsEntry, newName: string): Promise<boolean> {
    try {
      await api.rename(entry.path, newName);
      await load(path);
      return true;
    } catch (caught) {
      setError(errorText(caught));
      return false;
    }
  }

  async function deleteEntry(entry: FsEntry): Promise<void> {
    const what =
      entry.kind === 'directory' ? `la carpeta ${entry.name} y todo su contenido` : entry.name;
    if (!window.confirm(`¿Eliminar ${what}? No se puede deshacer.`)) return;
    try {
      await api.remove(entry.path);
      await load(path);
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  const places = [
    { name: 'Inicio', path: HOME },
    { name: 'Uploads', path: `${HOME}/uploads` },
    ...projects.flatMap((project) =>
      project.data?.type === 'local'
        ? [{ name: project.name ?? project.id, path: project.data.path }]
        : []
    ),
    { name: 'Raíz', path: '/' },
  ];
  const entries = (listing?.entries ?? []).filter(
    (entry) => showHidden || !entry.name.startsWith('.')
  );

  return (
    <main
      className="h-full overflow-y-auto bg-background px-4 py-4 text-foreground sm:px-6 sm:py-5"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (event.dataTransfer.files.length > 0) void upload(event.dataTransfer.files);
      }}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        {!sessionToken && (
          <Field.Root>
            <Field.Label>Token del bridge</Field.Label>
            <Input
              type="password"
              value={token}
              onChange={(event) => setToken(event.currentTarget.value)}
              onBlur={() => writeStorage(BRIDGE_TOKEN_KEY, token)}
            />
          </Field.Root>
        )}
        <div className="flex flex-wrap gap-2">
          {places.map((place) => (
            <Button
              key={place.path}
              size="sm"
              variant={path === place.path ? 'secondary' : 'ghost'}
              onClick={() => void load(place.path)}
            >
              {place.name}
            </Button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void load(pathDraft.trim() || '/');
          }}
        >
          <Input
            className="font-mono text-xs"
            value={pathDraft}
            aria-label="Ruta"
            onChange={(event) => setPathDraft(event.currentTarget.value)}
          />
          <Button type="submit" variant="secondary" disabled={loading}>
            Ir
          </Button>
        </form>
        <nav className="flex flex-wrap items-center gap-1 text-sm text-foreground-muted">
          {pathCrumbs(path).map((crumb, index) => (
            <Fragment key={crumb.path}>
              {index > 1 && <span>/</span>}
              <button
                type="button"
                className="rounded px-1 hover:bg-background-2 hover:text-foreground"
                onClick={() => void load(crumb.path)}
              >
                {crumb.name}
              </button>
            </Fragment>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => fileInput.current?.click()} disabled={!token}>
            <Upload className="size-4" /> Subir aquí
          </Button>
          <Button variant="secondary" onClick={() => setNewFolder(newFolder === null ? '' : null)}>
            <FolderPlus className="size-4" /> Nueva carpeta
          </Button>
          <Button variant="ghost" onClick={() => void load(path)} disabled={loading}>
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
          </Button>
          <label className="ml-auto flex items-center gap-2 text-sm text-foreground-muted">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(event) => setShowHidden(event.currentTarget.checked)}
            />
            Ocultos
          </label>
          <input
            ref={fileInput}
            className="sr-only"
            type="file"
            multiple
            onChange={(event) => {
              const files = event.currentTarget.files;
              if (files && files.length > 0) void upload(Array.from(files));
              event.currentTarget.value = '';
            }}
          />
        </div>
        {newFolder !== null && (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void createFolder();
            }}
          >
            <Input
              autoFocus
              value={newFolder}
              placeholder="Nombre de la carpeta"
              onChange={(event) => setNewFolder(event.currentTarget.value)}
            />
            <Button type="submit" variant="secondary">
              Crear
            </Button>
          </form>
        )}
        {error && <p className="text-destructive text-sm">{error}</p>}
        {uploads.length > 0 && <UploadList uploads={uploads} onClear={() => setUploads([])} />}
        {editing ? (
          <FileTextEditor
            api={api}
            entry={editing}
            onClose={() => {
              setEditing(null);
              void load(path);
            }}
          />
        ) : (
          <section className="overflow-hidden rounded-lg border border-border bg-background-1">
            {listing?.parent && (
              <button
                type="button"
                className="flex w-full items-center gap-3 border-b border-border px-4 py-2.5 text-left text-sm hover:bg-background-2"
                onClick={() => void load(listing.parent!)}
              >
                <ArrowUp className="size-4 text-foreground-muted" /> ..
              </button>
            )}
            {entries.length === 0 ? (
              <p className="px-4 py-5 text-sm text-foreground-muted">
                {loading ? 'Cargando…' : 'Carpeta vacía. Arrastrá archivos acá para subirlos.'}
              </p>
            ) : (
              <div className="divide-y divide-border">
                {entries.map((entry) => (
                  <EntryRow
                    key={entry.path}
                    entry={entry}
                    onOpen={() => void load(entry.path)}
                    onEdit={() => setEditing(entry)}
                    onDownload={() => void download(entry)}
                    onRename={(newName) => renameEntry(entry, newName)}
                    onDelete={() => void deleteEntry(entry)}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
});

function UploadList({ uploads, onClear }: { uploads: UploadItem[]; onClear: () => void }) {
  const active = uploads.some((item) => item.status === 'uploading');
  return (
    <section className="rounded-lg border border-border bg-background-1">
      <div className="flex items-center justify-between border-b border-border px-4 py-2 text-sm">
        <span className="font-medium">Subidas</span>
        {!active && (
          <button
            type="button"
            className="text-foreground-muted hover:text-foreground"
            onClick={onClear}
          >
            Limpiar
          </button>
        )}
      </div>
      <div className="divide-y divide-border">
        {uploads.map((item) => {
          const percent = item.sizeBytes
            ? Math.floor((item.receivedBytes / item.sizeBytes) * 100)
            : 100;
          return (
            <div key={item.id} className="flex flex-col gap-1.5 px-4 py-2.5 text-sm">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <span className="shrink-0 text-xs text-foreground-muted">
                  {item.status === 'uploading' &&
                    `${formatBytes(item.receivedBytes)} / ${formatBytes(item.sizeBytes)} · ${percent}%`}
                  {item.status === 'done' && `Listo · ${formatBytes(item.sizeBytes)}`}
                  {item.status === 'canceled' && 'Cancelada'}
                  {item.status === 'error' && 'Error'}
                </span>
                {item.status === 'uploading' && (
                  <button
                    type="button"
                    aria-label={`Cancelar ${item.name}`}
                    className="shrink-0 rounded p-1 text-foreground-muted hover:bg-background-2"
                    onClick={() => item.controller.abort()}
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
              {item.status === 'uploading' && (
                <div className="h-1 overflow-hidden rounded bg-background-2">
                  <div
                    className="h-full bg-foreground transition-[width]"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              )}
              {item.error && <p className="text-destructive text-xs">{item.error}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export const cockpitFilesViewRuntime = defineViewRuntime(cockpitFilesViewDef, {
  slots: {
    wrap: Fragment,
    titlebar: () => <Titlebar leftSlot={<span className="px-2 text-sm">Archivos</span>} />,
    main: FilesMainPanel,
  },
});
