import type { Strategy } from '@core/features/projects/browser/components/add-project-modal/add-project-modal';
import type { ProjectDirectoryPickerClient } from '@core/features/projects/browser/components/add-project-modal/project-directory-picker';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { DirectoryField as DirectoryFieldPrimitive } from '@emdash/ui/react/primitives';

interface DirectoryFieldProps {
  strategy: Strategy;
  connectionId?: string;
  title: string;
  message: string;
  path?: string;
  getProjectsClient(): Promise<ProjectDirectoryPickerClient>;
  onPathChange: (path: string) => void;
  placeholder?: string;
  ensureDefaultRoot?: boolean;
}

export function DirectoryField({
  strategy,
  connectionId,
  path = '',
  getProjectsClient,
  onPathChange,
  placeholder = 'Select a directory',
  ensureDefaultRoot = false,
}: DirectoryFieldProps) {
  const openDirectorySelectorModal = useOpenModal('directorySelectorModal');
  const disabled = strategy === 'ssh' && !connectionId;

  const handleChooseDirectory = async () => {
    if (strategy === 'ssh' && !connectionId) return;
    const outcome = await openDirectorySelectorModal({
      strategy,
      connectionId,
      initialPath: path || undefined,
      ensureDefaultRoot,
      getProjectsClient,
    });
    if (outcome.success) onPathChange(outcome.data.path);
  };

  return (
    <DirectoryFieldPrimitive
      path={path}
      placeholder={placeholder}
      disabled={disabled}
      onClick={() => void handleChooseDirectory()}
    />
  );
}
