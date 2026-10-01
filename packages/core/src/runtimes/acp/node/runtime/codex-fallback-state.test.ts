import { describe, expect, it } from 'vitest';
import { CodexFallbackState } from './codex-fallback-state';

describe('CodexFallbackState', () => {
  it('stays fully disabled when no fallback home was configured', () => {
    const state = new CodexFallbackState(undefined);
    expect(state.configured).toBe(false);
    state.activate(Date.now() + 60_000);
    expect(state.isActive(Date.now())).toBe(false);
    expect(state.envOverlay('codex', Date.now())).toBeUndefined();
  });

  it('is inactive until activated', () => {
    const state = new CodexFallbackState('/home/.codex-fallback');
    expect(state.configured).toBe(true);
    expect(state.isActive(Date.now())).toBe(false);
    expect(state.envOverlay('codex', Date.now())).toBeUndefined();
  });

  it('returns the CODEX_HOME overlay for codex while active', () => {
    const state = new CodexFallbackState('/home/.codex-fallback');
    const now = 1_000_000;
    state.activate(now + 60_000);
    expect(state.isActive(now)).toBe(true);
    expect(state.envOverlay('codex', now)).toEqual({ CODEX_HOME: '/home/.codex-fallback' });
  });

  it('does not overlay a non-codex provider even while active', () => {
    const state = new CodexFallbackState('/home/.codex-fallback');
    const now = 1_000_000;
    state.activate(now + 60_000);
    expect(state.envOverlay('claude', now)).toBeUndefined();
  });

  it('stops overlaying once now reaches the reset time', () => {
    const state = new CodexFallbackState('/home/.codex-fallback');
    state.activate(1_000_000);
    expect(state.isActive(999_999)).toBe(true);
    expect(state.isActive(1_000_000)).toBe(false);
    expect(state.envOverlay('codex', 1_000_000)).toBeUndefined();
  });

  it('activate() extends the window on repeated triggers', () => {
    const state = new CodexFallbackState('/home/.codex-fallback');
    state.activate(1_000_000);
    state.activate(2_000_000);
    expect(state.isActive(1_500_000)).toBe(true);
    expect(state.isActive(2_500_000)).toBe(false);
  });
});
