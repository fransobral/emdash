import type { SidebarTab } from '@core/features/tasks/api/browser/types';

export type MobileTaskSurface = 'workspace' | 'chats' | 'sessions' | 'files' | 'changes';

/** The three always-visible segments of the mobile task header. */
export type MobileTaskSegment = 'chat' | 'changes' | 'terminal';

export const mobileTaskSegmentItems = [
  { id: 'chat', label: 'Chat', surface: 'workspace' },
  { id: 'changes', label: 'Cambios', surface: 'changes' },
  { id: 'terminal', label: 'Terminal', surface: 'sessions' },
] as const satisfies ReadonlyArray<{
  id: MobileTaskSegment;
  label: string;
  surface: MobileTaskSurface;
}>;

/** Secondary surfaces reachable only from the header overflow menu. */
export const mobileTaskOverflowItems = [
  { surface: 'files', label: 'Archivos' },
  { surface: 'chats', label: 'Conversaciones' },
] as const satisfies ReadonlyArray<{ surface: MobileTaskSurface; label: string }>;

/** Segment highlighted for a surface, or null while an overflow surface is open. */
export function segmentForMobileSurface(surface: MobileTaskSurface): MobileTaskSegment | null {
  return mobileTaskSegmentItems.find((item) => item.surface === surface)?.id ?? null;
}

export function surfaceForMobileSegment(segment: MobileTaskSegment): MobileTaskSurface {
  return mobileTaskSegmentItems.find((item) => item.id === segment)!.surface;
}

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
