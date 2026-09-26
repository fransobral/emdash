import { describe, expect, it } from 'vitest';
import {
  mobileSurfaceFromChrome,
  mobileTaskSurfaceItems,
  sidebarTabForMobileSurface,
} from './mobile-task-surfaces';

describe('mobile task surfaces', () => {
  it('keeps the dense desktop panels behind five mutually exclusive mobile destinations', () => {
    expect(mobileTaskSurfaceItems).toEqual([
      { id: 'workspace', label: 'Workspace' },
      { id: 'chats', label: 'Chats' },
      { id: 'sessions', label: 'Sessions' },
      { id: 'files', label: 'Files' },
      { id: 'changes', label: 'Changes' },
    ]);
  });

  it('maps file surfaces to the existing sidebar store without inventing parallel state', () => {
    expect(sidebarTabForMobileSurface('files')).toBe('files');
    expect(sidebarTabForMobileSurface('changes')).toBe('changes');
    expect(sidebarTabForMobileSurface('chats')).toBe('conversations');
    expect(sidebarTabForMobileSurface('workspace')).toBeUndefined();
    expect(sidebarTabForMobileSurface('sessions')).toBeUndefined();
  });

  it('derives the visible surface from command-owned task chrome state', () => {
    expect(
      mobileSurfaceFromChrome({
        focusedRegion: 'bottom',
        sidebarCollapsed: false,
        sidebarTab: 'files',
      })
    ).toBe('sessions');
    expect(
      mobileSurfaceFromChrome({
        focusedRegion: 'main',
        sidebarCollapsed: false,
        sidebarTab: 'changes',
      })
    ).toBe('changes');
    expect(
      mobileSurfaceFromChrome({
        focusedRegion: 'main',
        sidebarCollapsed: true,
        sidebarTab: 'files',
      })
    ).toBe('workspace');
  });

  // Regression: ISSUE-002 — conversations without an open tab were unreachable on mobile
  it('surfaces the full conversation list so closed conversations stay reachable', () => {
    expect(
      mobileSurfaceFromChrome({
        focusedRegion: 'main',
        sidebarCollapsed: false,
        sidebarTab: 'conversations',
      })
    ).toBe('chats');
    expect(
      mobileSurfaceFromChrome({
        focusedRegion: 'main',
        sidebarCollapsed: true,
        sidebarTab: 'conversations',
      })
    ).toBe('workspace');
  });
});
