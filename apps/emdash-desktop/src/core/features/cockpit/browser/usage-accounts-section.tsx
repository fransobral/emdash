import { Badge, Button, Switch } from '@emdash/ui/react/primitives';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AGENT_ACCOUNTS_QUERY_KEY } from '@core/features/conversations/api/browser/use-agent-accounts';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import type { UsageLinkedAccount, UsageProviderId } from '../api';
import { getCockpitClient } from '../api/browser/client';

const PROVIDER_LABELS: Record<UsageProviderId, string> = { claude: 'Claude', codex: 'Codex' };

function accountKey(account: Pick<UsageLinkedAccount, 'providerId' | 'accountId'>): string {
  return `${account.providerId}:${account.accountId}`;
}

/**
 * Account-linking UI for Phase 1: lists every Claude/Codex account emdash
 * knows about, with a freshly-checked "Vinculada"/"Pendiente" credential
 * status, and lets the user add, rename, or remove accounts. Emdash never
 * performs the login itself — "Agregar cuenta" only points emdash at a
 * config directory and shows the command the user runs on their own.
 */
export function UsageAccountsSection() {
  const queryClient = useQueryClient();
  const [accounts, setAccounts] = useState<UsageLinkedAccount[] | null>(null);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const openLinkModal = useOpenModal('linkUsageAccountModal');

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const client = await getCockpitClient();
      setAccounts(await client.linkedAccounts());
      void queryClient.invalidateQueries({ queryKey: AGENT_ACCOUNTS_QUERY_KEY });
      setError(null);
    } catch {
      setError('No pudimos cargar las cuentas. Volvé a actualizar.');
    }
  }, [queryClient]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleAdd(): Promise<void> {
    const outcome = await openLinkModal();
    if (outcome.success) void refresh();
  }

  async function handleRemove(account: UsageLinkedAccount): Promise<void> {
    const client = await getCockpitClient();
    await client.removeUsageAccount({
      providerId: account.providerId,
      accountId: account.accountId,
    });
    void refresh();
  }

  async function handleRenameSave(account: UsageLinkedAccount): Promise<void> {
    const client = await getCockpitClient();
    const label = draftLabel.trim();
    if (label) {
      await client.renameUsageAccount({
        providerId: account.providerId,
        accountId: account.accountId,
        label,
      });
    }
    setRenamingKey(null);
    void refresh();
  }

  async function handleOauthUsageToggle(
    account: UsageLinkedAccount,
    enabled: boolean
  ): Promise<void> {
    const client = await getCockpitClient();
    await client.setUsageOauthEnabled({
      providerId: account.providerId,
      accountId: account.accountId,
      enabled,
    });
    void refresh();
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-background-1 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Cuentas vinculadas</h2>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="xs" onClick={() => void refresh()}>
            Actualizar
          </Button>
          <Button type="button" variant="secondary" size="xs" onClick={() => void handleAdd()}>
            <Plus className="size-3" />
            Agregar cuenta
          </Button>
        </div>
      </div>
      <p className="text-xs text-foreground-muted">
        Elegí el mail en Account al crear una conversación nueva. Cada cuenta usa su propia carpeta
        de configuración.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-foreground-error">
          {error}
        </p>
      ) : null}
      {accounts === null ? (
        <p className="text-sm text-foreground-muted">Cargando cuentas…</p>
      ) : accounts.length === 0 ? (
        <p className="text-sm text-foreground-muted">Sin cuentas vinculadas.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {accounts.map((account) => {
            const key = accountKey(account);
            const isRenaming = renamingKey === key;
            return (
              <li
                key={key}
                className="flex items-center justify-between gap-2 rounded-md border border-border p-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{PROVIDER_LABELS[account.providerId]}</Badge>
                    {isRenaming ? (
                      <input
                        autoFocus
                        className="min-w-0 flex-1 rounded border border-border bg-background px-1 text-sm"
                        value={draftLabel}
                        onChange={(e) => setDraftLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleRenameSave(account);
                          if (e.key === 'Escape') setRenamingKey(null);
                        }}
                      />
                    ) : (
                      <span className="truncate text-sm font-medium">{account.label}</span>
                    )}
                    {account.isDefault && <Badge tone="info">predeterminada</Badge>}
                    {account.plan && <Badge variant="outline">{account.plan}</Badge>}
                    <Badge tone={account.credentialStatus === 'linked' ? 'success' : 'warning'}>
                      {account.credentialStatus === 'linked' ? 'Vinculada' : 'Pendiente'}
                    </Badge>
                  </div>
                  <p className="truncate text-xs text-foreground-passive">
                    {account.configDirPath || 'Sin carpeta configurada'}
                  </p>
                  {account.providerId === 'claude' && (
                    <label className="mt-1 flex items-center gap-2 text-xs text-foreground-muted">
                      <Switch
                        size="sm"
                        checked={account.oauthUsageEnabled}
                        onCheckedChange={(enabled) => void handleOauthUsageToggle(account, enabled)}
                      />
                      Límites en vivo (beta, no oficial)
                    </label>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {isRenaming ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="xs"
                      onClick={() => void handleRenameSave(account)}
                    >
                      Guardar
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      icon
                      aria-label="Renombrar cuenta"
                      onClick={() => {
                        setRenamingKey(key);
                        setDraftLabel(account.label);
                      }}
                    >
                      <Pencil className="size-3" />
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    icon
                    aria-label="Quitar cuenta"
                    onClick={() => void handleRemove(account)}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
