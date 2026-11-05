import { Button, Select } from '@emdash/ui/react/primitives';
import { ArrowUp, Cpu, FolderClosed, ShieldCheck, ShieldOff } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { hostRefFromConnectionId } from '@core/features/agents/api/browser/client';
import { useAgents } from '@core/features/agents/api/browser/use-agents';
import { formatHostRef } from '@emdash/core/primitives/host/api';
import { patchProviderSettings } from '@core/features/conversations/api/browser/provider-preferences';
import { useConversationLaunchSettings } from '@core/features/conversations/api/browser/use-conversation-launch-settings';
import { useEffectiveProvider } from '@core/features/conversations/api/browser/use-effective-provider';
import {
  asAvailableProject,
  getProjectManagerStore,
  getProjectSshConnectionId,
} from '@core/features/projects/api/browser/stores/project-selectors';
import {
  providerComposerOptions,
  selectCachedProviderOptions,
} from '@core/features/conversations/contributions/browser/provider-composer-options';
import { useOpenModal } from '@core/manifests/browser/modal-api';
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

  // Same provider settings the create-task modal reads when it opens (synced across devices).
  const host = formatHostRef(hostRefFromConnectionId(connectionId));
  const launchSettings = useConversationLaunchSettings(host, providerId, capabilities);
  const { autoApprove, useChatUi } = launchSettings;
  const canAutoApprove = launchSettings.autoApproveSupported;

  // Chat UI: the model is a provider option, saved as the agent's preference so the
  // created chat starts with it. Terminal: the CLI's static model list, passed to the modal.
  const acpModel = useChatUi
    ? providerComposerOptions(
        selectCachedProviderOptions(launchSettings.settings.catalogs, launchSettings.settings.acp.options),
        launchSettings.settings.acp.options,
        (configId, value) => {
          if (providerId)
            void patchProviderSettings({ host, providerId }, { transport: 'acp', options: { [configId]: value } });
        }
      )
    : null;
  const staticModels = capabilities?.models;
  const modelOptions = acpModel
    ? (acpModel.modelOptions ?? null)
    : staticModels?.kind === 'selectable'
      ? staticModels.modelOptions
      : null;
  // A model chosen for another agent or project is not valid here: fall back to default.
  const model = acpModel
    ? (acpModel.selectedModel ?? DEFAULT_MODEL_VALUE)
    : modelOptions && chosenModel in modelOptions
      ? chosenModel
      : DEFAULT_MODEL_VALUE;
  const modelName = model ? (modelOptions?.[model]?.name ?? model) : 'Modelo por defecto';
  const selectModel = (value: string) => {
    if (acpModel) {
      if (value) acpModel.onModelChange?.(value);
    } else setChosenModel(value);
  };

  const canSend = Boolean(projectId) && prompt.trim().length > 0;
  const openModal = (initialPrompt: string) => {
    void openTaskModal({ projectId, initialPrompt, initialModel: (!acpModel && model) || undefined });
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
          <Select.Root value={model} onValueChange={(value) => selectModel(value as string)}>
            <Select.Trigger
              aria-label="Modelo"
              showChevron={false}
              className={`${CHIP_CLASS} max-w-[55%] min-w-0`}
            >
              <Cpu aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">{modelName}</span>
            </Select.Trigger>
            <Select.Content width="content-at-least-trigger" align="start">
              {acpModel ? null : (
                <Select.Item value={DEFAULT_MODEL_VALUE}>Modelo por defecto</Select.Item>
              )}
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
            onClick={() => launchSettings.setAutoApprove(!autoApprove)}
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
