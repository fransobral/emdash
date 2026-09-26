import { useQuery } from '@tanstack/react-query';
import { detectPlatformContext } from '@core/primitives/keybindings/api';
import type { NodePlatform } from '../api/host-contract';
import { getHostClient } from './host-client';

function detectedNodePlatform(): NodePlatform {
  const os = detectPlatformContext().os;
  if (os === 'mac') return 'darwin';
  if (os === 'windows') return 'win32';
  return 'linux';
}

/** Platform of the process hosting local projects, which may differ from the web browser. */
export function useHostPlatform(): NodePlatform {
  const { data } = useQuery({
    queryKey: ['app', 'platform'],
    queryFn: async () => (await getHostClient()).getPlatform(),
    placeholderData: detectedNodePlatform,
    staleTime: Infinity,
  });

  return data ?? detectedNodePlatform();
}
