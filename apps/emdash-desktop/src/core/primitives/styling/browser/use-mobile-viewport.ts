import { useSyncExternalStore } from 'react';

/** Phone-width layouts; matches Tailwind's `max-md` variant (below 768px). */
const MOBILE_VIEWPORT_QUERY = '(max-width: 767px)';

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(MOBILE_VIEWPORT_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(MOBILE_VIEWPORT_QUERY).matches;
}

export function useMobileViewport(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
