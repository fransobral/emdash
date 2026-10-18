import { Button, Select } from '@emdash/ui/react/primitives';
import { ArrowUp, FolderClosed } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useEffectiveProvider } from '@core/features/conversations/api/browser/use-effective-provider';
import {
  asAvailableProject,
  getProjectManagerStore,
  getProjectSshConnectionId,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { agentLabel } from './mobile-home-model';

const CHIP_CLASS =
  'flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-background-2 px-3 text-[13px] text-foreground-muted';

/**
 * Bottom composer of the mobile home. It collects the prompt and project, then
 * hands off to the existing create-task modal (the only task-creation path) with
 * the prompt prefilled, so naming, workspace and agent options stay in one place.
 */
export const MobileNewTaskComposer = observer(function MobileNewTaskComposer() {
  const openTaskModal = useOpenModal('taskModal');
  const [prompt, setPrompt] = useState('');
  const [chosenProjectId, setChosenProjectId] = useState<string | undefined>();

  const projects = [...getProjectManagerStore().projects.values()].filter((project) =>
    asAvailableProject(project)
  );
  const projectId = projects.some((p) => p.id === chosenProjectId)
    ? chosenProjectId
    : projects[0]?.id;
  const { providerId } = useEffectiveProvider(
    projectId ? getProjectSshConnectionId(projectId) : undefined
  );

  const canSend = Boolean(projectId) && prompt.trim().length > 0;
  const openModal = (initialPrompt: string) => {
    void openTaskModal({ projectId, initialPrompt });
    setPrompt('');
  };

  return (
    <form
      className="flex flex-col gap-2.5 rounded-[22px] border border-border bg-background-1 p-3 pb-2.5 pl-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) openModal(prompt.trim());
      }}
    >
      <label htmlFor="mobile-new-task" className="text-xs text-foreground-passive">
        Nueva tarea
      </label>
      <input
        id="mobile-new-task"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder="¿Qué querés que haga?"
        enterKeyHint="send"
        autoComplete="off"
        className="min-h-11 bg-transparent text-base text-foreground outline-none placeholder:text-foreground-passive"
      />
      <div className="flex items-center gap-2">
        <Select.Root
          value={projectId ?? ''}
          onValueChange={(value) => setChosenProjectId(value as string)}
          disabled={projects.length === 0}
        >
          <Select.Trigger
            aria-label="Proyecto"
            showChevron={false}
            className={`${CHIP_CLASS} max-w-[45%] min-w-0`}
          >
            <FolderClosed aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">
              {projects.find((p) => p.id === projectId)?.name ?? 'Sin proyecto'}
            </span>
          </Select.Trigger>
          <Select.Content width="content-at-least-trigger" align="start">
            {projects.map((project) => (
              <Select.Item key={project.id} value={project.id}>
                {project.name ?? project.id}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
        <button
          type="button"
          aria-label="Elegir agente y opciones de la tarea"
          className={`${CHIP_CLASS} min-w-0`}
          disabled={!projectId}
          onClick={() => openModal(prompt.trim())}
        >
          <span className="truncate">{agentLabel(providerId) ?? 'Agente'}</span>
        </button>
        <span className="flex-1" />
        <Button
          type="submit"
          variant="primary"
          icon
          aria-label="Crear tarea"
          disabled={!canSend}
          className="size-11 min-h-11 min-w-11 rounded-full"
        >
          <ArrowUp aria-hidden="true" className="size-[18px]" />
        </Button>
      </div>
    </form>
  );
});
