import React from 'react';
import { AgentAccountsPanel } from '@core/features/cockpit/contributions/browser/accounts-panel';
import { useSettingsSearch } from '@core/features/settings/browser/search/settings-search-context';
import { AgentsPanel } from '@core/features/settings/contributions/browser/agents-page/AgentsPanel';

export function AgentsSettingsPage() {
  const { query: settingsSearchQuery, setQuery: setSettingsSearchQuery } = useSettingsSearch();

  return (
    <div className="flex flex-col gap-5">
      <AgentAccountsPanel />
      <AgentsPanel
        header={{ title: 'Agents', description: 'Manage agents and model configurations.' }}
        searchQuery={settingsSearchQuery}
        onSearchQueryChange={setSettingsSearchQuery}
      />
    </div>
  );
}
