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
import { useNewChatModelOptions } from '@core/features/conversations/api/browser/discovered-models';
import { conversationRegistry } from '@core/features/conversations/api/browser/stores/conversation-registry';
import { useAgentAccounts } from '@core/features/conversations/api/browser/use-agent-accounts';
import { useEffectiveProvider } from '@core/features/conversations/api/browser/use-effective-provider';
import { providerPreferencesMemento } from '@core/features/conversations/contributions/mementos';
import { getProjectSshConnectionId } from '@core/features/projects/api/browser/stores/project-selectors';
// TODO(conversations-extraction): Pass task settings into the modal instead of importing task hooks.
import { useTaskSettings } from '@core/features/tasks/api/browser/hooks/useTaskSettings';
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
import { useLocalStorage } from '@core/primitives/react-hooks/browser/useLocalStorage';
import {
  patchProviderPreference,
  providerPreference,
  providerPreferenceKey,
} from './provider-preferences';

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
  const taskSettings = useTaskSettings();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoApproveOverride, setAutoApproveOverride] = useState<boolean | null>(null);
  const [useChatUiPreference, setUseChatUiPreference] = useLocalStorage(
    'initial-conversation:chat-ui-enabled',
    false
  );
  const [providerPreferences, setProviderPreferences] = useMemento(providerPreferencesMemento);
  const [modelOverrides, setModelOverrides] = useState<Record<string, string | null>>({});
  const [accountOverrides, setAccountOverrides] = useState<Record<string, string | null>>({});
  const { data: agentAccounts } = useAgentAccounts();
  const liveActionDisabledReason = projectAvailabilityUi.getLiveActionDisabledReason(projectId);
  useCloseGuard(isSubmitting);

  const { data: agents } = useAgents(hostRefFromConnectionId(connectionId));
  const selectedAgent = agents?.find((a) => a.id === providerId);

  const showAutoApproveToggle = agentSupportsAutoApprove(selectedAgent?.capabilities);
  const showAcpToggle = agentSupportsAcp(selectedAgent?.capabilities);
  const useAcp = showAcpToggle && useChatUiPreference;
  const transport = useAcp ? 'acp' : 'pty';
  const modelOptions = useNewChatModelOptions(providerId, connectionId, transport);
  const host = formatHostRef(hostRefFromConnectionId(connectionId));
  const preferenceKey = providerId ? providerPreferenceKey(host, providerId, transport) : null;
  const savedPreference = providerId
    ? providerPreference(providerPreferences, host, providerId, transport)
    : undefined;
  const savedModelUnsupported =
    savedPreference?.model !== undefined &&
    modelOptions !== null &&
    modelOptions[savedPreference.model] === undefined;
  const hasModelOverride =
    preferenceKey !== null && Object.prototype.hasOwnProperty.call(modelOverrides, preferenceKey);
  const selectedModel =
    preferenceKey !== null && hasModelOverride
      ? (modelOverrides[preferenceKey] ?? null)
      : savedModelUnsupported
        ? null
        : (savedPreference?.model ?? null);
  const setSelectedModel = useCallback(
    (model: string | null) => {
      if (!preferenceKey) return;
      setModelOverrides((current) => ({ ...current, [preferenceKey]: model }));
    },
    [preferenceKey]
  );
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
  const skipPermissions =
    showAutoApproveToggle && (autoApproveOverride ?? taskSettings.autoApproveByDefault);
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
      const conversationType: ConversationType = useAcp ? 'acp' : 'pty';
      await conversationMgr.createConversation({
        projectId,
        taskId,
        id,
        autoApprove: skipPermissions,
        provider: providerId,
        title,
        model: selectedModel ?? undefined,
        modeId: conversationType === 'acp' ? savedPreference?.modeId : undefined,
        effort: conversationType === 'acp' ? savedPreference?.effort : undefined,
        collaborationMode:
          conversationType === 'acp' ? savedPreference?.collaborationMode : undefined,
        agentAccountId: selectedAccountId,
        type: conversationType,
      });
      try {
        setProviderPreferences((current) =>
          patchProviderPreference(current, host, providerId, conversationType, {
            model: selectedModel,
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
    isSubmitting,
    providerId,
    title,
    complete,
    projectId,
    taskId,
    skipPermissions,
    selectedModel,
    useAcp,
    host,
    savedPreference?.effort,
    savedPreference?.modeId,
    savedPreference?.collaborationMode,
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
            <Field.Label>Agent</Field.Label>
            <AgentSelector
              autoFocus
              value={providerId}
              onChange={handleProviderChange}
              connectionId={connectionId}
            />
          </Field.Root>
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
                  <Select.Item value="">Default model</Select.Item>
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
          {showAutoApproveToggle ? (
            <Field.Root>
              <div className="flex items-center gap-2">
                <Switch
                  checked={skipPermissions}
                  disabled={!providerId || taskSettings.loading || taskSettings.saving}
                  onCheckedChange={setAutoApproveOverride}
                />
                <Field.Label>Auto-approve permissions</Field.Label>
              </div>
            </Field.Root>
          ) : null}
          {showAcpToggle ? (
            <Field.Root>
              <div className="flex items-center gap-2">
                <Switch checked={useAcp} onCheckedChange={setUseChatUiPreference} />
                <Field.Label>Use chat UI</Field.Label>
              </div>
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
          disabled={Boolean(liveActionDisabledReason) || createDisabled || isSubmitting}
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
