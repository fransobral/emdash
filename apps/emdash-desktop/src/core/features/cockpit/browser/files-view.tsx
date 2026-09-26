import { cockpitFilesViewDef } from '@core/features/cockpit/contributions/views';
import { getProjectManagerStore } from '@core/features/projects/api/browser/stores/project-selectors';
import { Titlebar } from '@core/features/workbench/contributions/browser/Titlebar';
import { defineViewRuntime } from '@core/primitives/views/react';
import { Button, Field, Input, Select } from '@emdash/ui/react/primitives';
import { Upload } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Fragment, useCallback, useEffect, useState } from 'react';

type UploadEntry = { name: string; path: string; sizeBytes: number };
const BRIDGE_TOKEN_KEY = 'emdash-web-bridge-token';
const SESSION_TOKEN_KEY = 'emdash-web-token';

export const FilesMainPanel = observer(function FilesMainPanel() {
  const projects = [...getProjectManagerStore().projects.values()].filter(
    (project) => project.data?.type === 'local'
  );
  const [sessionToken] = useState(() => localStorage.getItem(SESSION_TOKEN_KEY));
  const [token, setToken] = useState(
    () => localStorage.getItem(BRIDGE_TOKEN_KEY) ?? localStorage.getItem(SESSION_TOKEN_KEY) ?? ''
  );
  const [destType, setDestType] = useState<'general' | 'project'>('general');
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [subPath, setSubPath] = useState('');
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    if (!token || (destType === 'project' && !projectId)) return;
    const query = new URLSearchParams({ destType });
    if (projectId && destType === 'project') query.set('projectId', projectId);
    if (subPath) query.set('subPath', subPath);
    const response = await fetch(`/api/bridge/uploads?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(await responseText(response));
    setEntries((await response.json()) as UploadEntry[]);
  }, [destType, projectId, subPath, token]);

  useEffect(() => {
    void loadEntries().catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : String(caught));
    });
  }, [loadEntries]);

  async function upload(files: FileList | File[]): Promise<void> {
    if (!token) {
      setError('Ingresá el token del bridge.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem(BRIDGE_TOKEN_KEY, token);
      const body = new FormData();
      body.set('destType', destType);
      if (destType === 'project') body.set('projectId', projectId);
      if (subPath) body.set('subPath', subPath);
      for (const file of files) body.append('files', file);
      const response = await fetch('/api/bridge/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body,
      });
      if (!response.ok) throw new Error(await responseText(response));
      await loadEntries();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="h-full overflow-y-auto bg-background px-6 py-5 text-foreground">
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <header>
          <h1 className="text-xl font-semibold">Archivos</h1>
          <p className="text-sm text-foreground-muted">
            Subí archivos a una carpeta general o directamente a un proyecto local.
          </p>
        </header>
        <div className="grid gap-4 rounded-lg border border-border bg-background-1 p-4 sm:grid-cols-2">
          {!sessionToken && (
            <Field.Root>
              <Field.Label>Token del bridge</Field.Label>
              <Input
                type="password"
                value={token}
                onChange={(event) => setToken(event.currentTarget.value)}
                onBlur={() => localStorage.setItem(BRIDGE_TOKEN_KEY, token)}
              />
            </Field.Root>
          )}
          <Field.Root>
            <Field.Label>Destino</Field.Label>
            <Select.Root
              value={destType}
              onValueChange={(value) => setDestType(value as 'general' | 'project')}
            >
              <Select.Trigger appearance="input">
                {destType === 'general' ? 'General' : 'Proyecto'}
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="general">General (/home/ubuntu/uploads)</Select.Item>
                <Select.Item value="project">Proyecto</Select.Item>
              </Select.Content>
            </Select.Root>
          </Field.Root>
          {destType === 'project' && (
            <Field.Root>
              <Field.Label>Proyecto</Field.Label>
              <Select.Root value={projectId} onValueChange={(value) => setProjectId(value ?? '')}>
                <Select.Trigger appearance="input">
                  {projects.find((project) => project.id === projectId)?.name ?? 'Elegir proyecto'}
                </Select.Trigger>
                <Select.Content>
                  {projects.map((project) => (
                    <Select.Item key={project.id} value={project.id}>
                      {project.name ?? project.id}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Field.Root>
          )}
          <Field.Root>
            <Field.Label>Subcarpeta (opcional)</Field.Label>
            <Input
              value={subPath}
              placeholder="docs/entradas"
              onChange={(event) => setSubPath(event.currentTarget.value)}
            />
          </Field.Root>
        </div>
        <label
          className="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-background-1 p-6 text-center"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void upload(event.dataTransfer.files);
          }}
        >
          <Upload className="size-7 text-foreground-muted" />
          <span className="text-sm">Arrastrá archivos aquí o elegilos desde el dispositivo.</span>
          <Button render={<span />} variant="secondary" disabled={busy}>
            {busy ? 'Subiendo…' : 'Elegir archivos'}
          </Button>
          <input
            className="sr-only"
            type="file"
            multiple
            disabled={busy}
            onChange={(event) =>
              event.currentTarget.files && void upload(event.currentTarget.files)
            }
          />
        </label>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <section className="overflow-hidden rounded-lg border border-border bg-background-1">
          <h2 className="border-b border-border px-4 py-3 font-medium">Archivos subidos</h2>
          {entries.length === 0 ? (
            <p className="px-4 py-5 text-sm text-foreground-muted">Todavía no hay archivos.</p>
          ) : (
            <div className="divide-y divide-border">
              {entries.map((entry) => (
                <div key={entry.path} className="flex justify-between gap-4 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{entry.name}</p>
                    <p className="truncate text-xs text-foreground-passive">{entry.path}</p>
                  </div>
                  <span className="shrink-0 text-foreground-muted">
                    {formatBytes(entry.sizeBytes)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
});

async function responseText(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `HTTP ${response.status}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const cockpitFilesViewRuntime = defineViewRuntime(cockpitFilesViewDef, {
  slots: {
    wrap: Fragment,
    titlebar: () => <Titlebar leftSlot={<span className="px-2 text-sm">Archivos</span>} />,
    main: FilesMainPanel,
  },
});
