import { Button, Select } from '@emdash/ui/react/primitives';
import { ArrowUp, Cpu, FolderClosed, ShieldCheck, ShieldOff } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { hostRefFromConnectionId } from '@core/features/agents/api/browser/client';
import { useAgents } from '@core/features/agents/api/browser/use-agents';
import { useNewChatModelOptions } from '@core/features/conversations/api/browser/discovered-models';
import { useEffectiveProvider } from '@core/features/conversations/api/browser/use-effective-provider';
import {
  asAvailableProject,
  getProjectManagerStore,
  getProjectSshConnectionId,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { useTaskSettings } from '@core/features/tasks/api/browser/hooks/useTaskSettings';
import {
  AUTO_APPROVE_PREFERENCE_KEY,
  CHAT_UI_PREFERENCE_KEY,
} from '@core/features/tasks/contributions/browser/task-config/initial-conversation-section';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { agentSupportsAcp, agentSupportsAutoApprove } from '@core/primitives/agents/api';
import { useLocalStorage } from '@core/primitives/react-hooks/browser/useLocalStorage';
import { agentLabel } from './mobile-home-model';

const CHIP_CLASS =
  'flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-background-2 px-3 text-[13px] text-foreground-muted';

/** Select value for "let the agent CLI pick its default model". */
const DEFAULT_MODEL_VALUE = '';

/**
 * Bottom composer of the mobile home. It collects the prompt, project, model and
 * auto-approve choice, then hands off to the existing create-task modal (the only
 * task-creation path) prefilled with them, so naming and workspace options stay in
 * one place. Effort and permission mode are session options: they appear in the chat
 * composer once the agent starts.
 */
export const MobileNewTaskComposer = observer(function MobileNewTaskComposer() {
  const openTaskModal = useOpenModal('taskModal');
  const [prompt, setPrompt] = useState('');
  const [chosenProjectId, setChosenProjectId] = useState<string | undefined>();
  const [chosenModel, setChosenModel] = useState(DEFAULT_MODEL_VALUE);

  const projects = [...getProjectManagerStore().projects.values()].filter((project) =>
    asAvailableProject(project)
  );
  const projectId = projects.some((p) => p.id === chosenProjectId)
    ? chosenProjectId
    : projects[0]?.id;
  const connectionId = projectId ? getProjectSshConnectionId(projectId) : undefined;
  const { providerId } = useEffectiveProvider(connectionId);
  const { data: agents } = useAgents(hostRefFromConnectionId(connectionId));
  const capabilities = agents?.find((agent) => agent.id === providerId)?.capabilities;

  // Same remembered preferences the create-task modal reads when it opens.
  const { autoApproveByDefault } = useTaskSettings();
  const [autoApprovePreference, setAutoApprovePreference] = useLocalStorage(
    AUTO_APPROVE_PREFERENCE_KEY,
    autoApproveByDefault
  );
  const [useChatUiPreference] = useLocalStorage(CHAT_UI_PREFERENCE_KEY, false);
  const canAutoApprove = agentSupportsAutoApprove(capabilities);
  const autoApprove = canAutoApprove && autoApprovePreference;
  const transport = agentSupportsAcp(capabilities) && useChatUiPreference ? 'acp' : 'pty';

  const modelOptions = useNewChatModelOptions(providerId, connectionId, transport);
  // A model chosen for another agent or project is not valid here: fall back to default.
  const model = modelOptions && chosenModel in modelOptions ? chosenModel : DEFAULT_MODEL_VALUE;
  const modelName = model ? (modelOptions?.[model]?.name ?? model) : 'Modelo por defecto';

  const canSend = Boolean(projectId) && prompt.trim().length > 0;
  const openModal = (initialPrompt: string) => {
    void openTaskModal({ projectId, initialPrompt, initialModel: model || undefined });
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
      <div className="flex flex-wrap items-center gap-2">
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
        {modelOptions && Object.keys(modelOptions).length > 0 ? (
          <Select.Root value={model} onValueChange={(value) => setChosenModel(value as string)}>
            <Select.Trigger
              aria-label="Modelo"
              showChevron={false}
              className={`${CHIP_CLASS} max-w-[55%] min-w-0`}
            >
              <Cpu aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">{modelName}</span>
            </Select.Trigger>
            <Select.Content width="content-at-least-trigger" align="start">
              <Select.Item value={DEFAULT_MODEL_VALUE}>Modelo por defecto</Select.Item>
              {Object.entries(modelOptions).map(([id, option]) => (
                <Select.Item key={id} value={id}>
                  {option.name}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        ) : null}
        {canAutoApprove ? (
          <button
            type="button"
            aria-pressed={autoApprove}
            aria-label="Auto-aprobar permisos"
            className={`${CHIP_CLASS} ${autoApprove ? 'border-accent text-foreground' : ''}`}
            onClick={() => setAutoApprovePreference(!autoApprove)}
          >
            {autoApprove ? (
              <ShieldCheck aria-hidden="true" className="size-3.5 shrink-0" />
            ) : (
              <ShieldOff aria-hidden="true" className="size-3.5 shrink-0" />
            )}
            <span>{autoApprove ? 'Auto-aprobar' : 'Pedir permiso'}</span>
          </button>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          icon
          aria-label="Crear tarea"
          disabled={!canSend}
          className="ml-auto size-11 min-h-11 min-w-11 rounded-full"
        >
          <ArrowUp aria-hidden="true" className="size-[18px]" />
        </Button>
      </div>
    </form>
  );
});
