import type { ContractClient } from '@emdash/wire/rpc';
import { domainClient } from '@core/primitives/wire/browser/connection';
import { desktopHostContract, desktopHostDomain } from '../api/host-contract';

export type HostClient = ContractClient<typeof desktopHostContract>;

/** Typed client for the desktop host wire domain (shell, clipboard, dialogs, window). */
export function getHostClient(): Promise<HostClient> {
  return domainClient<HostClient>(desktopHostDomain, desktopHostContract);
}

export async function openExternal(url: string) {
  if (!navigator.userAgent.includes('Electron')) {
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    return opened
      ? { success: true }
      : { success: false, error: 'The browser blocked the new window' };
  }
  return (await getHostClient()).openExternal({ url });
}

export async function copyTextToClipboard(text: string) {
  if (!navigator.userAgent.includes('Electron') && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Clipboard write failed',
      };
    }
  }
  return (await getHostClient()).clipboardWriteText({ text });
}
