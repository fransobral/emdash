import { formatHostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { describe, expect, it } from 'vitest';
import type { DiscoveredModelsState } from '@core/features/conversations/contributions/mementos';
import {
  discoveredModelsKey,
  modelOptionsForNewChat,
  withDiscoveredModels,
} from './discovered-models';

const local = formatHostRef(LOCAL_HOST_REF);
const empty: DiscoveredModelsState = { version: '1', entries: {} };
const staticOptions = {
  'gpt-6-sol': { name: 'GPT-6 Sol', description: 'Static description' },
  'gpt-5.4-mini': { name: 'GPT-5.4 Mini' },
};

describe('discovered models', () => {
  it('offers the models the agent reported instead of the plugin list for chat UI', () => {
    const options = modelOptionsForNewChat(
      staticOptions,
      [
        { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' },
        { id: 'gpt-6-sol', name: 'GPT-6 Sol' },
      ],
      'acp'
    );

    expect(options).toEqual({
      'gpt-6.1-sol': { name: 'GPT-6.1 Sol', description: undefined },
      'gpt-6-sol': { name: 'GPT-6 Sol', description: 'Static description' },
    });
  });

  it('keeps the plugin list until an agent has reported, and for terminal chats', () => {
    const reported = [{ id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' }];

    expect(modelOptionsForNewChat(staticOptions, undefined, 'acp')).toBe(staticOptions);
    expect(modelOptionsForNewChat(staticOptions, [], 'acp')).toBe(staticOptions);
    expect(modelOptionsForNewChat(staticOptions, reported, 'pty')).toBe(staticOptions);
  });

  it('stores a catalog per host and provider and skips unchanged writes', () => {
    const models = [{ id: 'opus[1m]', name: 'Opus', description: 'Opus 4.8' }];

    const stored = withDiscoveredModels(empty, local, 'claude', models);
    expect(stored.entries[discoveredModelsKey(local, 'claude')]).toEqual(models);
    expect(withDiscoveredModels(stored, local, 'claude', [{ ...models[0] }])).toBe(stored);
    expect(withDiscoveredModels(stored, local, 'claude', [])).toBe(stored);

    const updated = withDiscoveredModels(stored, local, 'claude', [
      ...models,
      { id: 'sonnet', name: 'Sonnet' },
    ]);
    expect(updated).not.toBe(stored);
    expect(updated.entries[discoveredModelsKey(local, 'claude')]).toHaveLength(2);
  });
});
