import type { SidebarTab } from '@core/features/tasks/api/browser/types';

export type MobileTaskSurface = 'workspace' | 'chats' | 'sessions' | 'files' | 'changes';

export const mobileTaskSurfaceItems = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'chats', label: 'Chats' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'files', label: 'Files' },
  { id: 'changes', label: 'Changes' },
] as const satisfies ReadonlyArray<{ id: MobileTaskSurface; label: string }>;

export function sidebarTabForMobileSurface(surface: MobileTaskSurface): SidebarTab | undefined {
  if (surface === 'chats') return 'conversations';
  return surface === 'files' || surface === 'changes' ? surface : undefined;
}

export function mobileSurfaceFromChrome({
  focusedRegion,
  sidebarCollapsed,
  sidebarTab,
}: {
  focusedRegion: 'main' | 'bottom';
  sidebarCollapsed: boolean;
  sidebarTab: SidebarTab;
}): MobileTaskSurface {
  if (focusedRegion === 'bottom') return 'sessions';
  if (!sidebarCollapsed && sidebarTab === 'conversations') return 'chats';
  if (!sidebarCollapsed && (sidebarTab === 'files' || sidebarTab === 'changes')) return sidebarTab;
  return 'workspace';
}
