import { Badge } from '@emdash/ui/react/primitives';
import type { UsageAccount, UsageProvider } from '../api/contract';
import { formatTokens, formatUsd } from './usage-format';
import { UsageLimitBar } from './usage-limit-bar';

const PROVIDER_LABELS: Record<UsageProvider['providerId'], string> = {
  claude: 'Claude',
  codex: 'Codex',
};

export function UsageProviderCard({ provider }: { provider: UsageProvider }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium text-foreground-muted">
        {PROVIDER_LABELS[provider.providerId]}
      </h3>
      {provider.accounts.length === 0 ? (
        <p className="text-xs text-foreground-muted">Sin cuentas vinculadas.</p>
      ) : (
        provider.accounts.map((account) => (
          <UsageAccountCard key={account.accountId} account={account} />
        ))
      )}
    </div>
  );
}

function UsageAccountCard({ account }: { account: UsageAccount }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-background-2 p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{account.label}</span>
        {account.isDefault && <Badge variant="outline">predeterminada</Badge>}
      </div>
      <UsageLimitBar
        label="5h"
        usedPercent={account.rateLimits.fiveHour?.usedPercent ?? null}
        resetsAt={account.rateLimits.fiveHour?.resetsAt}
        stale={account.rateLimits.stale}
      />
      <UsageLimitBar
        label="Semanal"
        usedPercent={account.rateLimits.weekly?.usedPercent ?? null}
        resetsAt={account.rateLimits.weekly?.resetsAt}
        stale={account.rateLimits.stale}
      />
      <ModelsTodaySummary account={account} />
    </div>
  );
}

function ModelsTodaySummary({ account }: { account: UsageAccount }) {
  if (account.modelsToday.length === 0) {
    return <p className="text-xs text-foreground-muted">Sin uso hoy.</p>;
  }

  const byModel = account.modelsToday
    .map((model) => `${model.model} ${formatTokens(model.inputTokens + model.outputTokens)}`)
    .join(' · ');
  const totalTokens = account.modelsToday.reduce((sum, m) => sum + m.inputTokens, 0);
  const totalOutput = account.modelsToday.reduce((sum, m) => sum + m.outputTokens, 0);
  const totalCache = account.modelsToday.reduce((sum, m) => sum + m.cacheTokens, 0);

  return (
    <div className="flex flex-col gap-1 text-xs text-foreground-muted">
      <p>
        Tokens hoy: {formatTokens(totalTokens)} (in) / {formatTokens(totalOutput)} (out) /{' '}
        {formatTokens(totalCache)} (cache)
        {account.costTodayUsd !== null ? (
          <>
            {' '}
            · {formatUsd(account.costTodayUsd)}
            {account.costSource === 'estimated' ? ' (estimado)' : ''}
          </>
        ) : (
          ' · costo no disponible'
        )}
      </p>
      <p className="truncate">Por modelo: {byModel}</p>
    </div>
  );
}
