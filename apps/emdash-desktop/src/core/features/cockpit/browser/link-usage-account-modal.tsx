import { Button, Dialog, DirectoryField, Input } from '@emdash/ui/react/primitives';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { useModalController } from '@core/manifests/browser/modal-api';
import { getHostClient } from '@core/primitives/desktop-host/browser/host-client';
import { defineModal } from '@core/primitives/modals/react';
import { guidedLoginCommand, type UsageProviderId } from '../api';
import { getCockpitClient } from '../api/browser/client';

export type LinkUsageAccountModalArgs = { providerId?: UsageProviderId };

const PROVIDER_LABELS: Record<UsageProviderId, string> = { claude: 'Claude', codex: 'Codex' };
const COPY_RESET_MS = 2000;

export function LinkUsageAccountModal({
  providerId: initialProviderId,
}: LinkUsageAccountModalArgs) {
  const modal = useModalController('linkUsageAccountModal');
  const [providerId, setProviderId] = useState<UsageProviderId>(initialProviderId ?? 'claude');
  const [label, setLabel] = useState('');
  const [configDirPath, setConfigDirPath] = useState('');
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const command = configDirPath ? guidedLoginCommand(providerId, configDirPath) : '';
  const canSave = configDirPath.length > 0 && label.trim().length > 0 && !saving;

  async function handleChooseDirectory(): Promise<void> {
    const host = await getHostClient();
    const result = await host.openSelectDirectoryDialog({
      title: 'Elegir carpeta de configuración',
      message: 'Elegí (o creá) la carpeta donde se va a guardar la sesión de esta cuenta.',
    });
    if (result) setConfigDirPath(result);
  }

  async function handleCopy(): Promise<void> {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_RESET_MS);
    } catch {
      // Clipboard access can be denied; the command is still shown and selectable.
    }
  }

  async function handleSave(): Promise<void> {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const client = await getCockpitClient();
    const result = await client.addUsageAccount({
      providerId,
      label: label.trim(),
      configDirPath,
    });
    setSaving(false);
    if (result.success) modal.complete();
    else setError(result.error.message);
  }

  return (
    <>
      <Dialog.Header>
        <Dialog.Title>Vincular cuenta</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body className="flex flex-col gap-4">
        <p className="text-sm text-foreground-muted">
          Emdash no inicia sesión por vos. Elegí una carpeta, corré el comando en tu propia terminal
          y volvé para guardar la cuenta.
        </p>

        <div className="flex gap-2">
          {(['claude', 'codex'] as const).map((id) => (
            <Button
              key={id}
              type="button"
              variant={providerId === id ? 'primary' : 'secondary'}
              onClick={() => setProviderId(id)}
            >
              {PROVIDER_LABELS[id]}
            </Button>
          ))}
        </div>

        <label className="flex flex-col gap-1 text-sm">
          Nombre
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={`${PROVIDER_LABELS[providerId]} (personal)`}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Carpeta de configuración
          <DirectoryField
            path={configDirPath}
            placeholder="Elegir carpeta"
            onClick={() => void handleChooseDirectory()}
          />
        </label>

        {command && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-foreground-muted">
              Corré esto en tu terminal para iniciar sesión:
            </p>
            <div className="flex items-center gap-2 rounded-md border border-border bg-background-2 p-2">
              <code className="flex-1 truncate font-mono text-xs select-all">{command}</code>
              <Button type="button" variant="secondary" size="xs" onClick={() => void handleCopy()}>
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              </Button>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-foreground-error">{error}</p>}
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onClick={modal.dismiss}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={() => void handleSave()} disabled={!canSave}>
          Guardar
        </Button>
      </Dialog.Footer>
    </>
  );
}

export const linkUsageAccountModal = defineModal<void>()({
  id: 'linkUsageAccountModal',
  component: LinkUsageAccountModal,
  size: 'md',
});
