import type { AppNotification } from '@core/services/notifications/api';
import { describe, expect, it, vi } from 'vitest';
import {
  createWebNotificationController,
  type WebNotificationDependencies,
} from './web-notification-controller';

function notification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'notification-1',
    kind: 'agent-complete',
    groupKey: 'conversation:conversation-1',
    title: 'Claude - Mobile redesign',
    body: 'Your agent has finished working',
    target: {
      kind: 'task',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
    },
    source: {
      kind: 'conversation',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
    },
    sound: 'task_complete',
    count: 1,
    createdAt: 100,
    readAt: null,
    ...overrides,
  };
}

function fixture(overrides: Partial<WebNotificationDependencies> = {}) {
  let notifications = [notification()];
  let onFeedChange: ((next: readonly AppNotification[]) => void) | undefined;
  let onWorkerMessage: ((event: MessageEvent<unknown>) => void) | undefined;
  let permission: NotificationPermission = 'default';

  const registration = {
    showNotification: vi.fn(async () => undefined),
  } as unknown as ServiceWorkerRegistration;
  const prompt = vi.fn();
  const requestPermission = vi.fn(async () => {
    permission = 'granted';
    return permission;
  });
  const openTarget = vi.fn();

  const dependencies: WebNotificationDependencies = {
    isSupported: () => true,
    isSecureContext: () => true,
    isDocumentHidden: () => true,
    getPermission: () => permission,
    requestPermission,
    registerServiceWorker: vi.fn(async () => registration),
    getSettings: vi.fn(async () => ({ enabled: true, osNotifications: true })),
    loadFeed: vi.fn(async () => notifications),
    observeFeed: vi.fn((listener) => {
      onFeedChange = listener;
      return () => undefined;
    }),
    showPermissionPrompt: prompt,
    listenForWorkerMessages: vi.fn((listener) => {
      onWorkerMessage = listener;
      return () => undefined;
    }),
    openTarget,
    ...overrides,
  };

  return {
    controller: createWebNotificationController(dependencies),
    dependencies,
    prompt,
    registration,
    requestPermission,
    openTarget,
    setFeed(next: AppNotification[]) {
      notifications = next;
      onFeedChange?.(next);
    },
    sendWorkerMessage(data: unknown) {
      onWorkerMessage?.({ data } as MessageEvent<unknown>);
    },
  };
}

describe('web notification controller', () => {
  it('does not request permission or register a worker outside a secure context', async () => {
    const f = fixture({ isSecureContext: () => false });

    expect(await f.controller.start()).toBe('insecure');
    expect(f.prompt).not.toHaveBeenCalled();
    expect(f.requestPermission).not.toHaveBeenCalled();
    expect(f.dependencies.registerServiceWorker).not.toHaveBeenCalled();
  });

  it('offers an explicit action before requesting notification permission', async () => {
    const f = fixture();

    expect(await f.controller.start()).toBe('permission-required');
    expect(f.requestPermission).not.toHaveBeenCalled();
    expect(f.prompt).toHaveBeenCalledOnce();

    const enable = f.prompt.mock.calls[0]?.[0];
    expect(enable).toBeTypeOf('function');
    expect(await enable?.()).toBe('enabled');
    expect(f.requestPermission).toHaveBeenCalledOnce();
    expect(f.dependencies.registerServiceWorker).toHaveBeenCalledWith('/service-worker.js');
  });

  it('delivers only new agent completion and attention events, never hydrated history', async () => {
    const f = fixture({ getPermission: () => 'granted' });
    await f.controller.start();

    expect(f.registration.showNotification).not.toHaveBeenCalled();

    const completed = notification({ id: 'notification-2', createdAt: 200 });
    const attention = notification({
      id: 'notification-3',
      kind: 'agent-attention',
      body: 'Your agent is waiting for input',
      createdAt: 300,
    });
    const update = notification({ id: 'notification-4', kind: 'update-available', createdAt: 400 });
    f.setFeed([notification(), completed, attention, update]);
    await vi.waitFor(() => expect(f.registration.showNotification).toHaveBeenCalledTimes(2));

    expect(f.registration.showNotification).toHaveBeenNthCalledWith(
      1,
      completed.title,
      expect.objectContaining({
        body: completed.body,
        tag: completed.groupKey,
        data: {
          type: 'emdash-web-notification-open',
          notificationId: completed.id,
          target: completed.target,
        },
      })
    );
  });

  it('respects notification settings and suppresses browser banners while visible', async () => {
    const disabled = fixture({
      getPermission: () => 'granted',
      getSettings: vi.fn(async () => ({ enabled: false, osNotifications: true })),
    });
    await disabled.controller.start();
    disabled.setFeed([notification(), notification({ id: 'notification-2' })]);

    const visible = fixture({
      getPermission: () => 'granted',
      isDocumentHidden: () => false,
    });
    await visible.controller.start();
    visible.setFeed([notification(), notification({ id: 'notification-2' })]);

    await Promise.resolve();
    expect(disabled.registration.showNotification).not.toHaveBeenCalled();
    expect(visible.registration.showNotification).not.toHaveBeenCalled();
  });

  it('validates worker messages before opening an existing notification target', async () => {
    const f = fixture({ getPermission: () => 'granted' });
    await f.controller.start();

    f.sendWorkerMessage({
      type: 'emdash-web-notification-open',
      notificationId: 'notification-2',
      target: {
        kind: 'task',
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'conversation-1',
      },
    });
    f.sendWorkerMessage({
      type: 'emdash-web-notification-open',
      notificationId: 'notification-malformed',
      target: { kind: 'task', projectId: 42 },
    });

    expect(f.openTarget).toHaveBeenCalledOnce();
    expect(f.openTarget).toHaveBeenCalledWith(
      {
        kind: 'task',
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'conversation-1',
      },
      'notification-2'
    );
  });
});
