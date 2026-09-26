export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

type InstallPromptListener = (prompt: InstallPromptEvent | null) => void;

let currentPrompt: InstallPromptEvent | null = null;
const listeners = new Set<InstallPromptListener>();

function publish(prompt: InstallPromptEvent | null): void {
  currentPrompt = prompt;
  for (const listener of listeners) listener(prompt);
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    publish(event as InstallPromptEvent);
  });
  window.addEventListener('appinstalled', () => publish(null));
}

export function subscribeInstallPrompt(listener: InstallPromptListener): () => void {
  listeners.add(listener);
  listener(currentPrompt);
  return () => listeners.delete(listener);
}

export function clearInstallPrompt(): void {
  publish(null);
}
