import type { AppNotification, NotificationTarget } from '@core/services/notifications/api';

const WORKER_PATH = '/service-worker.js';
const OPEN_MESSAGE_TYPE = 'emdash-web-notification-open';

type NotificationSettings = { enabled: boolean; osNotifications: boolean };
type OpenNotificationMessage = {
  type: typeof OPEN_MESSAGE_TYPE;
  notificationId: string;
  target: NotificationTarget;
};

export type WebNotificationStartResult =
  | 'enabled'
  | 'unsupported'
  | 'insecure'
  | 'disabled'
  | 'denied'
  | 'permission-required';

export type WebNotificationDependencies = {
  isSupported(): boolean;
  isSecureContext(): boolean;
  isDocumentHidden(): boolean;
  getPermission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  registerServiceWorker(path: string): Promise<ServiceWorkerRegistration>;
  getSettings(): Promise<NotificationSettings>;
  loadFeed(): Promise<readonly AppNotification[]>;
  observeFeed(listener: (notifications: readonly AppNotification[]) => void): () => void;
  showPermissionPrompt(enable: () => Promise<WebNotificationStartResult>): void;
  listenForWorkerMessages(listener: (event: MessageEvent<unknown>) => void): () => void;
  openTarget(target: NotificationTarget, notificationId: string): void;
};

function isNotificationTarget(value: unknown): value is NotificationTarget {
  if (!value || typeof value !== 'object') return false;
  const target = value as Record<string, unknown>;
  if (target.kind === 'none') return true;
  if (target.kind === 'update') {
    return target.version === undefined || typeof target.version === 'string';
  }
  return (
    target.kind === 'task' &&
    typeof target.projectId === 'string' &&
    typeof target.taskId === 'string' &&
    (target.conversationId === undefined || typeof target.conversationId === 'string')
  );
}

function parseOpenMessage(value: unknown): OpenNotificationMessage | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;
  if (
    message.type !== OPEN_MESSAGE_TYPE ||
    typeof message.notificationId !== 'string' ||
    !isNotificationTarget(message.target)
  ) {
    return null;
  }
  return message as OpenNotificationMessage;
}

export function createWebNotificationController(deps: WebNotificationDependencies) {
  let registration: ServiceWorkerRegistration | null = null;
  let stopObserving: (() => void) | null = null;
  let stopListening: (() => void) | null = null;
  const knownIds = new Set<string>();

  async function deliver(notification: AppNotification): Promise<void> {
    const isAgentEvent =
      notification.kind === 'agent-complete' || notification.kind === 'agent-attention';
    if (!registration || !deps.isDocumentHidden() || !isAgentEvent) return;
    const settings = await deps.getSettings();
    if (!settings.enabled || !settings.osNotifications) return;
    await registration.showNotification(notification.title, {
      body: notification.body,
      tag: notification.groupKey,
      data: {
        type: OPEN_MESSAGE_TYPE,
        notificationId: notification.id,
        target: notification.target,
      } satisfies OpenNotificationMessage,
    });
  }

  function receiveFeed(next: readonly AppNotification[]): void {
    for (const notification of [...next].sort((a, b) => a.createdAt - b.createdAt)) {
      if (knownIds.has(notification.id)) continue;
      knownIds.add(notification.id);
      void deliver(notification);
    }
  }

  async function enable(): Promise<WebNotificationStartResult> {
    const permission =
      deps.getPermission() === 'default' ? await deps.requestPermission() : deps.getPermission();
    if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'permission-required';
    registration ??= await deps.registerServiceWorker(WORKER_PATH);
    if (!stopObserving) {
      const initial = await deps.loadFeed();
      for (const item of initial) knownIds.add(item.id);
      stopObserving = deps.observeFeed(receiveFeed);
    }
    stopListening ??= deps.listenForWorkerMessages((event) => {
      const message = parseOpenMessage(event.data);
      if (message) deps.openTarget(message.target, message.notificationId);
    });
    return 'enabled';
  }

  async function start(): Promise<WebNotificationStartResult> {
    if (!deps.isSupported()) return 'unsupported';
    if (!deps.isSecureContext()) return 'insecure';
    const settings = await deps.getSettings();
    if (!settings.enabled || !settings.osNotifications) return 'disabled';
    if (deps.getPermission() === 'denied') return 'denied';
    if (deps.getPermission() === 'default') {
      deps.showPermissionPrompt(enable);
      return 'permission-required';
    }
    return await enable();
  }

  function dispose(): void {
    stopObserving?.();
    stopListening?.();
    stopObserving = null;
    stopListening = null;
  }

  return { start, dispose };
}
