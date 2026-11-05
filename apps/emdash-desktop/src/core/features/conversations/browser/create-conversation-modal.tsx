import { formatHostRef } from '@emdash/core/primitives/host/api';
import { Dialog, Field, Select, Switch } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { hostRefFromConnectionId } from '@core/features/agents/api/browser/client';
import { useAgents } from '@core/features/agents/api/browser/use-agents';
import { AgentSelector } from '@core/features/agents/contributions/browser/agent-selector';
import {
  accountNotLoggedInHint,
  resolveSelectedAccountId,
} from '@core/features/conversations/api/browser/agent-account-selection';
import { nextDefaultConversationTitle } from '@core/features/conversations/api/browser/conversation-title-utils';
import {
  patchProviderSettings,
  readProviderSettings,
} from '@core/features/conversations/api/browser/provider-preferences';
import { conversationRegistry } from '@core/features/conversations/api/browser/stores/conversation-registry';
import { useAgentAccounts } from '@core/features/conversations/api/browser/use-agent-accounts';
import { useConversationLaunchSettings } from '@core/features/conversations/api/browser/use-conversation-launch-settings';
import { useEffectiveProvider } from '@core/features/conversations/api/browser/use-effective-provider';
import { ConversationTransportToggle } from '@core/features/conversations/contributions/browser/conversation-transport-toggle';
import {
  providerComposerOptions,
  selectCachedProviderOptions,
} from '@core/features/conversations/contributions/browser/provider-composer-options';
import { providerPreferencesMemento } from '@core/features/conversations/contributions/mementos';
import { getProjectSshConnectionId } from '@core/features/projects/api/browser/stores/project-selectors';
import { useModalController } from '@core/manifests/browser/modal-api';
import { projectAvailabilityUi } from '@core/manifests/browser/project-availability-ui';
import { agentSupportsAcp, agentSupportsAutoApprove } from '@core/primitives/agents/api';
import {
  isAgentAccountProviderId,
  type ConversationType,
} from '@core/primitives/conversations/api';
import { ConfirmButton } from '@core/primitives/keybindings/browser/confirm-button';
import { getMementoClient } from '@core/primitives/mementos/browser';
import { useMemento } from '@core/primitives/mementos/react';
import { defineModal } from '@core/primitives/modals/react';
import { useCloseGuard } from '@core/primitives/modals/react/use-close-guard';
import {
  patchProviderPreference,
  providerPreference,
  providerPreferenceKey,
} from './agent-account-preferences';

export const CreateConversationModal = observer(function CreateConversationModal({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const { complete } = useModalController('createConversationModal');
  const connectionId = getProjectSshConnectionId(projectId);
  const { providerId, setProviderOverride, createDisabled } = useEffectiveProvider(connectionId);
  const conversationMgr = conversationRegistry.get(taskId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const liveActionDisabledReason = projectAvailabilityUi.getLiveActionDisabledReason(projectId);
  useCloseGuard(isSubmitting);

  const { data: agents } = useAgents(hostRefFromConnectionId(connectionId));
  const selectedAgent = agents?.find((a) => a.id === providerId);
  const host = formatHostRef(hostRefFromConnectionId(connectionId));
  const launchSettings = useConversationLaunchSettings(
    host,
    providerId,
    selectedAgent?.capabilities
  );
  const showAcpToggle = agentSupportsAcp(selectedAgent?.capabilities);
  const useAcp = showAcpToggle && launchSettings.useChatUi;
  const transport = useAcp ? 'acp' : 'pty';
  const showAutoApproveToggle = agentSupportsAutoApprove(selectedAgent?.capabilities, transport);
  const skipPermissions = showAutoApproveToggle && launchSettings.autoApprove;

  // Model: chat UI conversations use the provider's own model option (saved as the agent's
  // preference, like the chat composer); terminal conversations pass the CLI's static model.
  const [providerPreferences, setProviderPreferences] = useMemento(providerPreferencesMemento);
  const [modelOverrides, setModelOverrides] = useState<Record<string, string | null>>({});
  const [accountOverrides, setAccountOverrides] = useState<Record<string, string | null>>({});
  const { data: agentAccounts } = useAgentAccounts();
  const preferenceKey = providerId ? providerPreferenceKey(host, providerId, transport) : null;
  const savedPreference = providerId
    ? providerPreference(providerPreferences, host, providerId, transport)
    : undefined;
  const acpModel = useAcp
    ? providerComposerOptions(
        selectCachedProviderOptions(
          launchSettings.settings.catalogs,
          launchSettings.settings.acp.options
        ),
        launchSettings.settings.acp.options,
        (configId, value) => {
          if (providerId)
            void patchProviderSettings(
              { host, providerId },
              { transport: 'acp', options: { [configId]: value } }
            );
        }
      )
    : null;
  const staticModels = selectedAgent?.capabilities.models;
  const modelOptions = acpModel
    ? (acpModel.modelOptions ?? null)
    : staticModels?.kind === 'selectable'
      ? staticModels.modelOptions
      : null;
  const hasModelOverride =
    preferenceKey !== null && Object.prototype.hasOwnProperty.call(modelOverrides, preferenceKey);
  const savedPtyModel =
    savedPreference?.model !== undefined && modelOptions?.[savedPreference.model] !== undefined
      ? savedPreference.model
      : null;
  const selectedModel = acpModel
    ? (acpModel.selectedModel ?? null)
    : preferenceKey !== null && hasModelOverride
      ? (modelOverrides[preferenceKey] ?? null)
      : savedPtyModel;
  const setSelectedModel = useCallback(
    (model: string | null) => {
      if (acpModel) {
        if (model) acpModel.onModelChange?.(model);
        return;
      }
      if (!preferenceKey) return;
      setModelOverrides((current) => ({ ...current, [preferenceKey]: model }));
    },
    [acpModel, preferenceKey]
  );

  // Account: Claude/Codex can run under any linked account (separate config homes).
  const providerAccounts =
    providerId && agentAccounts && isAgentAccountProviderId(providerId)
      ? agentAccounts[providerId]
      : undefined;
  const showAccountPicker = Boolean(providerAccounts && providerAccounts.length > 1);
  const hasAccountOverride =
    preferenceKey !== null && Object.prototype.hasOwnProperty.call(accountOverrides, preferenceKey);
  const selectedAccountId = providerAccounts
    ? preferenceKey !== null && hasAccountOverride
      ? (accountOverrides[preferenceKey] ?? undefined)
      : resolveSelectedAccountId(providerAccounts, savedPreference?.accountId)
    : undefined;
  const selectedAccount = providerAccounts?.find((account) => account.id === selectedAccountId);
  const setSelectedAccountId = useCallback(
    (accountId: string | null) => {
      if (!preferenceKey) return;
      setAccountOverrides((current) => ({ ...current, [preferenceKey]: accountId }));
    },
    [preferenceKey]
  );
  const title = providerId
    ? nextDefaultConversationTitle(
        providerId,
        Array.from(
          conversationMgr?.conversations.values() ?? [],
          (conversation) => conversation.data
        )
      )
    : 'Conversation';

  const handleProviderChange = useCallback(
    (next: typeof providerId) => {
      setProviderOverride(next);
    },
    [setProviderOverride]
  );

  const handleCreateConversation = useCallback(async () => {
    if (
      liveActionDisabledReason ||
      createDisabled ||
      !launchSettings.ready ||
      isSubmitting ||
      !conversationMgr ||
      !providerId
    ) {
      return;
    }
    const id = crypto.randomUUID();
    setIsSubmitting(true);
    setError(null);
    try {
      const settings = await readProviderSettings({ host, providerId });
      const conversationType: ConversationType = useAcp ? 'acp' : 'pty';
      await conversationMgr.createConversation({
        projectId,
        taskId,
        id,
        autoApprove: showAutoApproveToggle && settings.pty.autoApprove,
        provider: providerId,
        title,
        options: conversationType === 'acp' ? settings.acp.options : undefined,
        model: conversationType === 'pty' ? (selectedModel ?? undefined) : undefined,
        agentAccountId: selectedAccountId,
        type: conversationType,
      });
      try {
        setProviderPreferences((current) =>
          patchProviderPreference(current, host, providerId, conversationType, {
            ...(conversationType === 'pty' && { model: selectedModel }),
            accountId: selectedAccountId ?? null,
          })
        );
      } catch (preferenceError) {
        getMementoClient().reportError(preferenceError);
      }
      setIsSubmitting(false);
      complete({ conversationId: id, type: conversationType });
    } catch {
      setError('Failed to create conversation');
      setIsSubmitting(false);
    }
  }, [
    conversationMgr,
    liveActionDisabledReason,
    createDisabled,
    launchSettings.ready,
    isSubmitting,
    providerId,
    title,
    complete,
    projectId,
    taskId,
    showAutoApproveToggle,
    useAcp,
    host,
    selectedModel,
    selectedAccountId,
    setProviderPreferences,
  ]);

  return (
    <>
      <Dialog.Header>
        <Dialog.Title>Create Conversation</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body>
        <Field.Group>
          <Field.Root>
            <AgentSelector
              autoFocus
              value={providerId}
              onChange={handleProviderChange}
              connectionId={connectionId}
              trailingControl={
                showAcpToggle ? (
                  <ConversationTransportToggle
                    value={transport}
                    disabled={!launchSettings.ready || isSubmitting}
                    onValueChange={(value) => launchSettings.setUseChatUi(value === 'acp')}
                  />
                ) : null
              }
            />
          </Field.Root>
          {showAutoApproveToggle ? (
            <Field.Root>
              <div className="flex items-center gap-2">
                <Switch
                  checked={skipPermissions}
                  disabled={!providerId || !launchSettings.ready || isSubmitting}
                  onCheckedChange={launchSettings.setAutoApprove}
                />
                <Field.Label>Auto-approve permissions</Field.Label>
              </div>
            </Field.Root>
          ) : null}
          {modelOptions ? (
            <Field.Root>
              <Field.Label>Model</Field.Label>
              <Select.Root
                value={selectedModel ?? ''}
                onValueChange={(value) => setSelectedModel(value || null)}
              >
                <Select.Trigger appearance="input" className="w-full">
                  <Select.Value placeholder="Default model">
                    {selectedModel
                      ? (modelOptions[selectedModel]?.name ?? selectedModel)
                      : 'Default model'}
                  </Select.Value>
                </Select.Trigger>
                <Select.Content align="start" width="trigger">
                  {acpModel ? null : <Select.Item value="">Default model</Select.Item>}
                  {Object.entries(modelOptions).map(([id, option]) => (
                    <Select.Item key={id} value={id}>
                      {option.name}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Field.Root>
          ) : null}
          {showAccountPicker && providerAccounts ? (
            <Field.Root>
              <Field.Label>Account</Field.Label>
              <Select.Root
                value={selectedAccountId ?? ''}
                onValueChange={(value) => setSelectedAccountId(value || null)}
              >
                <Select.Trigger appearance="input" className="w-full">
                  <Select.Value placeholder="Default account">
                    {selectedAccount?.label ?? 'Default account'}
                  </Select.Value>
                </Select.Trigger>
                <Select.Content align="start" width="trigger">
                  {providerAccounts.map((account) => (
                    <Select.Item key={account.id} value={account.id}>
                      {account.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
              {accountNotLoggedInHint(selectedAccount) && (
                <p className="text-xs text-foreground-muted">
                  {accountNotLoggedInHint(selectedAccount)}
                </p>
              )}
            </Field.Root>
          ) : null}
          {error && <p className="text-destructive text-xs">{error}</p>}
          {liveActionDisabledReason && (
            <p className="text-xs text-foreground-muted" role="note" tabIndex={0}>
              {liveActionDisabledReason}
            </p>
          )}
        </Field.Group>
      </Dialog.Body>
      <Dialog.Footer>
        <ConfirmButton
          variant="primary"
          onClick={() => void handleCreateConversation()}
          disabled={
            Boolean(liveActionDisabledReason) ||
            createDisabled ||
            !launchSettings.ready ||
            isSubmitting
          }
        >
          {isSubmitting ? 'Creating...' : 'Create'}
        </ConfirmButton>
      </Dialog.Footer>
    </>
  );
});

export const createConversationModal = defineModal<{
  conversationId: string;
  type: ConversationType;
}>()({
  id: 'createConversationModal',
  component: CreateConversationModal,
  ignoreOutsidePressAfterWindowBlur: true,
});
