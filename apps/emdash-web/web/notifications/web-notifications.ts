import { requestAppSettingsMeta } from '@core/features/settings/api/browser/app-settings-client';
import { runNotificationOpenHandler } from '@core/primitives/notifications/browser/open-handlers';
import {
  getNotificationsFeedStore,
  type NotificationsFeedStore,
} from '@core/services/notifications/browser';
import { toast } from '@emdash/ui/react/primitives';
import { reaction } from 'mobx';
import {
  createWebNotificationController,
  type WebNotificationDependencies,
} from './web-notification-controller';

let feedStorePromise: Promise<NotificationsFeedStore> | null = null;

function getFeedStore(): Promise<NotificationsFeedStore> {
  feedStorePromise ??= getNotificationsFeedStore();
  return feedStorePromise;
}

const browserDependencies: WebNotificationDependencies = {
  isSupported: () => 'Notification' in window && 'serviceWorker' in navigator,
  isSecureContext: () => window.isSecureContext,
  isDocumentHidden: () => document.visibilityState !== 'visible',
  getPermission: () => Notification.permission,
  requestPermission: () => Notification.requestPermission(),
  registerServiceWorker: (path) => navigator.serviceWorker.register(path),
  getSettings: async () => {
    const result = await requestAppSettingsMeta('notifications');
    return {
      enabled: result.value.enabled,
      osNotifications: result.value.osNotifications,
    };
  },
  loadFeed: async () => (await getFeedStore()).all,
  observeFeed: (listener) => {
    let dispose: (() => void) | null = null;
    let cancelled = false;
    void getFeedStore().then((store) => {
      if (cancelled) return;
      dispose = reaction(() => store.all, listener);
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  },
  showPermissionPrompt: (enable) => {
    toast.info('Enable agent notifications', {
      id: 'web-notification-permission',
      description: 'Get notified when an agent finishes or needs your attention.',
      duration: 15_000,
      action: {
        label: 'Enable',
        onClick: () => {
          void enable().then((result) => {
            if (result === 'denied') {
              toast.warning('Notifications are blocked', {
                description: 'Allow notifications for this site in your browser settings.',
              });
            }
          });
        },
      },
    });
  },
  listenForWorkerMessages: (listener) => {
    navigator.serviceWorker.addEventListener('message', listener);
    return () => navigator.serviceWorker.removeEventListener('message', listener);
  },
  openTarget: runNotificationOpenHandler,
};

let controller: ReturnType<typeof createWebNotificationController> | null = null;

export function initWebNotifications(): () => void {
  controller ??= createWebNotificationController(browserDependencies);
  void controller.start();
  return () => {
    controller?.dispose();
    controller = null;
  };
}
