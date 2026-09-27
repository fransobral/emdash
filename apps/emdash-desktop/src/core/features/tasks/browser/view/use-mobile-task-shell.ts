import { useMobileViewport } from '@core/primitives/styling/browser/use-mobile-viewport';

export function useMobileTaskShell(): boolean {
  return useMobileViewport();
}
