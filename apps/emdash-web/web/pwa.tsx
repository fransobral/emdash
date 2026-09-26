import { toggleLeftSidebarCommand } from '@core/features/workbench/contributions/commands';
import { scopes } from '@core/primitives/view-scopes/browser';
import { Download, Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  clearInstallPrompt,
  subscribeInstallPrompt,
  type InstallPromptEvent,
} from './install-prompt-store';

export function registerPwa(): void {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  const register = () => void navigator.serviceWorker.register('/sw.js');
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

export function InstallAppPrompt() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    return subscribeInstallPrompt(setInstallPrompt);
  }, []);

  if (dismissed) return null;

  if (!window.isSecureContext) {
    return (
      <aside className="emdash-install-prompt" aria-label="Emdash installation unavailable">
        <div>
          <strong>HTTPS required</strong>
          <span>Brave can only install Emdash from HTTPS or localhost.</span>
        </div>
        <button
          type="button"
          className="emdash-install-dismiss"
          aria-label="Dismiss installation notice"
          onClick={() => setDismissed(true)}
        >
          <X aria-hidden="true" />
        </button>
      </aside>
    );
  }

  if (!installPrompt) return null;

  const install = async () => {
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') clearInstallPrompt();
    else setDismissed(true);
  };

  return (
    <aside className="emdash-install-prompt" aria-label="Install Emdash">
      <div>
        <strong>Install Emdash</strong>
        <span>Open it like a native app.</span>
      </div>
      <button type="button" className="emdash-install-action" onClick={() => void install()}>
        <Download aria-hidden="true" />
        Install
      </button>
      <button
        type="button"
        className="emdash-install-dismiss"
        aria-label="Dismiss install prompt"
        onClick={() => setDismissed(true)}
      >
        <X aria-hidden="true" />
      </button>
    </aside>
  );
}

export function MobileNavigationButton() {
  const [workspaceMounted, setWorkspaceMounted] = useState(false);

  useEffect(() => {
    const update = () =>
      setWorkspaceMounted(Boolean(document.querySelector('.workspace-main-panel')));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!workspaceMounted) return null;

  return (
    <button
      type="button"
      className="emdash-mobile-navigation"
      aria-label="Open navigation"
      onClick={() => scopes.getActiveCommand(toggleLeftSidebarCommand)?.execute(undefined)}
    >
      <Menu aria-hidden="true" />
    </button>
  );
}
