import { Button, Dialog, Field, Input, ModalLayout } from '@emdash/ui/react/primitives';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useModalController } from '@core/manifests/browser/modal-api';
import { ConfirmButton } from '@core/primitives/keybindings/browser/confirm-button';
import { defineModal } from '@core/primitives/modals/react';
import {
  ProjectDirectoryPicker,
  type ProjectDirectoryPickerClient,
} from './add-project-modal/project-directory-picker';

export interface DirectorySelectorModalProps {
  strategy: 'local' | 'ssh';
  connectionId?: string;
  initialPath?: string;
  ensureDefaultRoot?: boolean;
  getProjectsClient(): Promise<ProjectDirectoryPickerClient>;
}

export function DirectorySelectorModal({
  strategy,
  connectionId,
  initialPath = '',
  ensureDefaultRoot = false,
  getProjectsClient,
}: DirectorySelectorModalProps) {
  const modal = useModalController('directorySelectorModal');
  const [selectedPathOverride, setSelectedPathOverride] = useState<string | null>(null);
  const host =
    strategy === 'local'
      ? ({ type: 'local' } as const)
      : connectionId
        ? ({ type: 'ssh', connectionId } as const)
        : null;
  const homeQuery = useQuery({
    queryKey: ['projectHostHomeDir', host],
    queryFn: async () => (await getProjectsClient()).getHostHomeDir(host!),
    enabled: host !== null,
  });
  const ensureDefaultRootQuery = useQuery({
    queryKey: ['ensureProjectDefaultRepositoriesRoot', host],
    queryFn: async () => (await getProjectsClient()).ensureDefaultRepositoriesRoot(host!),
    enabled: ensureDefaultRoot && host !== null,
  });
  const pickerInitialPath =
    ensureDefaultRoot && ensureDefaultRootQuery.data?.success
      ? ensureDefaultRootQuery.data.data
      : initialPath || homeQuery.data || '';
  const selectedPath = selectedPathOverride ?? pickerInitialPath;
  const canSelect = selectedPath.trim().length > 0;
  const isPreparingPicker = ensureDefaultRoot && ensureDefaultRootQuery.isPending;

  return (
    <ModalLayout
      header={
        <Dialog.Header>
          <Dialog.Title>Seleccionar carpeta</Dialog.Title>
        </Dialog.Header>
      }
      footer={
        <Dialog.Footer>
          <Button variant="secondary" onClick={modal.dismiss}>
            Cancel
          </Button>
          <ConfirmButton
            variant="primary"
            type="button"
            disabled={!canSelect}
            onClick={() => modal.complete({ path: selectedPath })}
          >
            Select
          </ConfirmButton>
        </Dialog.Footer>
      }
    >
      <Dialog.Body className="gap-4">
        {/* Initial-focus target: keeps the modal from auto-focusing the path input. */}
        <div data-autofocus tabIndex={-1} className="flex flex-col gap-4 outline-none">
          {isPreparingPicker ? (
            <div className="rounded-md border border-border bg-background-1 p-3 text-sm text-foreground-muted">
              Preparing folder browser...
            </div>
          ) : (
            <ProjectDirectoryPicker
              strategy={strategy}
              connectionId={connectionId}
              initialPath={pickerInitialPath}
              homePath={homeQuery.data ?? ''}
              homePending={homeQuery.isPending}
              homeError={homeQuery.error}
              value={selectedPath}
              getProjectsClient={getProjectsClient}
              onSelect={setSelectedPathOverride}
            />
          )}
          <Field.Root>
            <Field.Label>Path</Field.Label>
            <Input
              value={selectedPath}
              placeholder="/home/user/project"
              spellCheck={false}
              onChange={(event) => setSelectedPathOverride(event.target.value)}
            />
          </Field.Root>
        </div>
      </Dialog.Body>
    </ModalLayout>
  );
}

export const directorySelectorModal = defineModal<{ path: string }>()({
  id: 'directorySelectorModal',
  component: DirectorySelectorModal,
  size: 'lg',
});
