import { Badge } from '@emdash/ui/react/primitives';
import type { DashboardSessionRow } from './cockpit-model';
import { formatDurationMinutes, formatTokens, formatUsd } from './usage-format';

const PROVIDER_LABELS: Record<DashboardSessionRow['provider'], string> = {
  claude: 'Claude',
  codex: 'Codex',
};

export function UsageSessionsTable({ sessions }: { sessions: readonly DashboardSessionRow[] }) {
  if (sessions.length === 0) {
    return <p className="px-4 py-5 text-sm text-foreground-muted">Sin sesiones hoy.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-xs">
        <thead>
          <tr className="border-b border-border text-foreground-muted">
            <th className="px-3 py-2 font-medium">Tarea</th>
            <th className="px-3 py-2 font-medium">Proveedor</th>
            <th className="px-3 py-2 font-medium">Cuenta</th>
            <th className="px-3 py-2 font-medium">Modelo</th>
            <th className="px-3 py-2 font-medium">Tokens</th>
            <th className="px-3 py-2 font-medium">Duración</th>
            <th className="px-3 py-2 font-medium">Costo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sessions.map((session) => (
            <tr key={`${session.provider}:${session.accountId}:${session.sessionId}`}>
              <td className="px-3 py-2">
                {session.taskName ?? (
                  <span className="text-foreground-muted">sin tarea vinculada</span>
                )}
                {session.taskStatus && (
                  <Badge className="ml-1.5" variant="outline">
                    {session.taskStatus}
                  </Badge>
                )}
              </td>
              <td className="px-3 py-2">{PROVIDER_LABELS[session.provider]}</td>
              <td className="px-3 py-2">{session.accountLabel}</td>
              <td className="max-w-40 truncate px-3 py-2">{session.model ?? '—'}</td>
              <td className="px-3 py-2 tabular-nums">
                {formatTokens(session.inputTokens)} / {formatTokens(session.outputTokens)} /{' '}
                {formatTokens(session.cacheTokens)}
              </td>
              <td className="px-3 py-2 tabular-nums">
                {formatDurationMinutes(session.startedAt, session.lastActivityAt)}
              </td>
              <td className="px-3 py-2 tabular-nums">
                {session.costUsd !== null ? (
                  <>
                    {formatUsd(session.costUsd)}
                    {session.costSource === 'estimated' ? ' (estimado)' : ''}
                  </>
                ) : (
                  <span className="text-foreground-muted">no disponible</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
