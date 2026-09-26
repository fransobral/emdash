import { AlertCircle, ChevronRight, Loader2, MessageCircleQuestion } from 'lucide-react';
import type { AgentStatus } from '@core/primitives/agents/api';
import { cn } from '@core/primitives/styling/browser/cn';
import type { TodayAgent } from './cockpit-model';

const STATUS_COPY: Partial<Record<AgentStatus, { label: string; tone: string }>> = {
  working: { label: 'Trabajando', tone: 'text-foreground-muted' },
  'awaiting-input': { label: 'Espera tu respuesta', tone: 'text-amber-500' },
  error: { label: 'Error', tone: 'text-destructive' },
};

function StatusIcon({ status }: { status: AgentStatus }) {
  if (status === 'awaiting-input') return <MessageCircleQuestion className="size-4" />;
  if (status === 'error') return <AlertCircle className="size-4" />;
  return <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />;
}

export function ActiveAgentsList({
  agents,
  onOpen,
}: {
  agents: readonly TodayAgent[];
  onOpen: (agent: TodayAgent) => void;
}) {
  if (agents.length === 0) {
    return (
      <p className="px-4 py-5 text-sm text-foreground-muted">Ningún agente corriendo ahora.</p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {agents.map((agent) => {
        const copy = STATUS_COPY[agent.status] ?? { label: agent.status, tone: '' };
        return (
          <li key={agent.id}>
            <button
              type="button"
              onClick={() => onOpen(agent)}
              className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-background-2 focus-visible:bg-background-2 focus-visible:outline-none active:bg-background-2"
            >
              <span className={cn('shrink-0', copy.tone)}>
                <StatusIcon status={agent.status} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{agent.taskName}</span>
                <span className="block truncate text-xs text-foreground-muted">
                  {agent.projectName} · {agent.title}
                </span>
              </span>
              <span className={cn('shrink-0 text-xs', copy.tone)}>{copy.label}</span>
              <ChevronRight className="size-4 shrink-0 text-foreground-passive" aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
