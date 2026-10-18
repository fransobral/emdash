import { describe, expect, it } from 'vitest';
import {
  mobileSurfaceFromChrome,
  mobileTaskOverflowItems,
  mobileTaskSegmentItems,
  segmentForMobileSurface,
  sidebarTabForMobileSurface,
  surfaceForMobileSegment,
} from './mobile-task-surfaces';

describe('mobile task surfaces', () => {
  it('exposes chat, changes and terminal as the three primary segments', () => {
    expect(mobileTaskSegmentItems.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'chat', label: 'Chat' },
      { id: 'changes', label: 'Cambios' },
      { id: 'terminal', label: 'Terminal' },
    ]);
  });

  it('keeps files and conversations reachable from the overflow menu', () => {
    expect(mobileTaskOverflowItems.map((item) => item.surface)).toEqual(['files', 'chats']);
  });

  it('maps segments to the existing surfaces and back', () => {
    expect(surfaceForMobileSegment('chat')).toBe('workspace');
    expect(surfaceForMobileSegment('changes')).toBe('changes');
    expect(surfaceForMobileSegment('terminal')).toBe('sessions');
    expect(segmentForMobileSurface('workspace')).toBe('chat');
    expect(segmentForMobileSurface('sessions')).toBe('terminal');
    expect(segmentForMobileSurface('changes')).toBe('changes');
  });

  it('highlights no segment while an overflow surface is open', () => {
    expect(segmentForMobileSurface('files')).toBeNull();
    expect(segmentForMobileSurface('chats')).toBeNull();
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
