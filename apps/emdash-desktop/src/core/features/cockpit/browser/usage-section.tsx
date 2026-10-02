import { Coins } from 'lucide-react';
import type { DashboardUsage } from './cockpit-model';
import { UsageProviderCard } from './usage-provider-card';
import { UsageSessionsTable } from './usage-sessions-table';

const CRITICAL_THRESHOLD_PERCENT = 95;
const PROVIDER_LABELS: Record<'claude' | 'codex', string> = { claude: 'Claude', codex: 'Codex' };

/** Replaces the previous unconditional "Tokens no disponibles" card. */
export function UsageSection({ usage }: { usage: DashboardUsage }) {
  if (usage.availability === 'unavailable') {
    return (
      <section className="rounded-lg border border-border bg-background-1 p-4">
        <div className="flex items-start gap-3">
          <Coins className="mt-0.5 size-5 text-foreground-muted" />
          <div>
            <h2 className="font-medium">Tokens no disponibles</h2>
            <p className="text-sm text-foreground-muted">
              No encontramos un directorio de configuración de Claude ni de Codex en esta máquina.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-background-1 p-4">
      <div className="flex items-start gap-3">
        <Coins className="mt-0.5 size-5 text-foreground-muted" />
        <div>
          <h2 className="font-medium">Uso y límites</h2>
          <p className="text-sm text-foreground-muted">
            {usage.availability === 'partial'
              ? 'Solo encontramos datos locales de uno de los proveedores.'
              : 'Lecturas locales exactas de cada proveedor; el costo estimado usa una tabla de precios cuando el proveedor no lo informa.'}
          </p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {usage.providers.map((provider) => (
          <UsageProviderCard key={provider.providerId} provider={provider} />
        ))}
      </div>
      <div className="overflow-hidden rounded-md border border-border">
        <div className="border-b border-border px-3 py-2 text-sm font-medium">Sesiones de hoy</div>
        <UsageSessionsTable sessions={usage.sessionsToday} />
      </div>
    </section>
  );
}

/** Header-level "about to hit the limit" messages, Spanish, for the ≥95% rule. */
export function usageCriticalWarnings(usage: DashboardUsage): string[] {
  if (usage.availability === 'unavailable') return [];
  const warnings: string[] = [];
  for (const provider of usage.providers) {
    for (const account of provider.accounts) {
      for (const [windowLabel, window] of [
        ['5h', account.rateLimits.fiveHour],
        ['semanal', account.rateLimits.weekly],
      ] as const) {
        if (!window || window.usedPercent < CRITICAL_THRESHOLD_PERCENT) continue;
        const reset = window.resetsAt ? ` — reinicia a las ${formatTime(window.resetsAt)}` : '';
        warnings.push(
          `${PROVIDER_LABELS[provider.providerId]} (${account.label}): ` +
            `${Math.round(window.usedPercent)}% de la ventana de ${windowLabel}${reset}.`
        );
      }
    }
  }
  return warnings;
}

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
