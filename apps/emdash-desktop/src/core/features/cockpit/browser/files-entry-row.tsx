import { Button, DropdownMenu, Input } from '@emdash/ui/react/primitives';
import { Download, Ellipsis, Eye, File, Folder, Pencil, SquarePen, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@core/primitives/styling/browser/cn';
import { formatBytes, type FsEntry } from './files-api';

export interface EntryRowProps {
  entry: FsEntry;
  /** Images, PDFs and videos open in the viewer instead of the text editor. */
  isPreviewable?: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDownload: () => void;
  onRename: (newName: string) => Promise<boolean>;
  onDelete: () => void;
}

export function EntryRow({
  entry,
  isPreviewable = false,
  onOpen,
  onEdit,
  onDownload,
  onRename,
  onDelete,
}: EntryRowProps) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const isDirectory = entry.kind === 'directory';
  const isFile = entry.kind === 'file';
  const Icon = isDirectory ? Folder : File;

  async function submitRename(): Promise<void> {
    const next = renaming?.trim();
    if (!next || next === entry.name) {
      setRenaming(null);
      return;
    }
    if (await onRename(next)) setRenaming(null);
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2 text-sm">
      <Icon
        className={cn('size-4 shrink-0', isDirectory ? 'text-foreground' : 'text-foreground-muted')}
      />
      {renaming !== null ? (
        <form
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submitRename();
          }}
        >
          <Input
            autoFocus
            value={renaming}
            aria-label={`Nuevo nombre para ${entry.name}`}
            onChange={(event) => setRenaming(event.currentTarget.value)}
            onKeyDown={(event) => event.key === 'Escape' && setRenaming(null)}
          />
          <Button type="submit" size="sm" variant="secondary">
            Guardar
          </Button>
        </form>
      ) : (
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left hover:underline disabled:no-underline"
          disabled={!isDirectory && !isFile}
          onClick={isDirectory ? onOpen : onEdit}
        >
          {entry.name}
          {entry.symlink && <span className="text-foreground-passive"> ↗</span>}
        </button>
      )}
      <span className="hidden shrink-0 text-xs text-foreground-passive sm:inline">
        {entry.modifiedAt ? new Date(entry.modifiedAt).toLocaleString() : ''}
      </span>
      {isFile && (
        <span className="shrink-0 text-xs text-foreground-muted">
          {formatBytes(entry.sizeBytes)}
        </span>
      )}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          render={<Button variant="ghost" size="sm" aria-label={`Acciones para ${entry.name}`} />}
        >
          <Ellipsis className="size-4" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content side="bottom" align="end">
          {isFile && (
            <DropdownMenu.Item onClick={onEdit}>
              {isPreviewable ? <Eye /> : <SquarePen />}
              {isPreviewable ? 'Ver' : 'Editar'}
            </DropdownMenu.Item>
          )}
          {isFile && (
            <DropdownMenu.Item onClick={onDownload}>
              <Download />
              Descargar
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item onClick={() => setRenaming(entry.name)}>
            <Pencil />
            Renombrar
          </DropdownMenu.Item>
          <DropdownMenu.Item variant="destructive" onClick={onDelete}>
            <Trash2 />
            Eliminar
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  );
}
