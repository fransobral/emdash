import { formatHostRef, type SerializedHostRef } from '@emdash/core/primitives/host/api';
import { hostRefFromConnectionId } from '@core/features/agents/api/browser/client';
import { useAgents } from '@core/features/agents/api/browser/use-agents';
import {
  discoveredModelsMemento,
  type DiscoveredModel,
  type DiscoveredModelsState,
} from '@core/features/conversations/contributions/mementos';
import { getMementoClient, type MementoHandle } from '@core/primitives/mementos/browser';
import { useMemento } from '@core/primitives/mementos/react';
import { appSubject } from '@core/primitives/subjects/api';

export type NewChatModelOption = { name: string; description?: string };
type ConversationTransport = 'acp' | 'pty';

let handle: MementoHandle<DiscoveredModelsState> | null = null;

export function discoveredModelsKey(host: SerializedHostRef, providerId: string): string {
  return JSON.stringify([host, providerId]);
}

function sameModels(a: readonly DiscoveredModel[], b: readonly DiscoveredModel[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (model, i) =>
        model.id === b[i].id && model.name === b[i].name && model.description === b[i].description
    )
  );
}

/** Returns `state` itself when the catalog is unchanged, so callers can skip the write. */
export function withDiscoveredModels(
  state: DiscoveredModelsState,
  host: SerializedHostRef,
  providerId: string,
  models: readonly DiscoveredModel[]
): DiscoveredModelsState {
  const key = discoveredModelsKey(host, providerId);
  const current = state.entries[key];
  if (models.length === 0 || (current && sameModels(current, models))) return state;
  const next = models.map(({ id, name, description }) =>
    description ? { id, name, description } : { id, name }
  );
  return { ...state, entries: { ...state.entries, [key]: next } };
}

export async function rememberDiscoveredModels(
  host: SerializedHostRef,
  providerId: string,
  models: readonly DiscoveredModel[]
): Promise<void> {
  const catalog = discoveredModelsHandle();
  await catalog.ready;
  if (withDiscoveredModels(catalog.value, host, providerId, models) === catalog.value) return;
  catalog.update((current) => withDiscoveredModels(current, host, providerId, models));
}

/**
 * Chat sessions only accept models from the catalog the agent reports, and that
 * catalog follows the installed CLI, so it lists new models as soon as the CLI
 * ships them. The plugin's static list is the fallback until an agent has reported.
 */
export function modelOptionsForNewChat(
  staticOptions: Record<string, NewChatModelOption> | null,
  discovered: readonly DiscoveredModel[] | undefined,
  transport: ConversationTransport
): Record<string, NewChatModelOption> | null {
  if (transport !== 'acp' || !discovered || discovered.length === 0) return staticOptions;
  return Object.fromEntries(
    discovered.map((model) => [
      model.id,
      {
        name: model.name,
        description: model.description ?? staticOptions?.[model.id]?.description,
      },
    ])
  );
}

export function useNewChatModelOptions(
  providerId: string | null,
  connectionId: string | undefined,
  transport: ConversationTransport
): Record<string, NewChatModelOption> | null {
  const hostRef = hostRefFromConnectionId(connectionId);
  const { data: agents } = useAgents(hostRef);
  const [discovered] = useMemento(discoveredModelsMemento);
  if (!providerId) return null;
  const models = agents?.find((agent) => agent.id === providerId)?.capabilities.models;
  const staticOptions = models?.kind === 'selectable' ? models.modelOptions : null;
  const key = discoveredModelsKey(formatHostRef(hostRef), providerId);
  return modelOptionsForNewChat(staticOptions, discovered.entries[key], transport);
}

function discoveredModelsHandle(): MementoHandle<DiscoveredModelsState> {
  if (handle) return handle;
  const space = getMementoClient().subject(appSubject({}));
  handle = space.handle(discoveredModelsMemento);
  return handle;
}
