import { useEffect, useState } from 'react';

const MOBILE_WORKSPACE_QUERY = '(max-width: 767px)';

function getIsMobileWorkspace(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(MOBILE_WORKSPACE_QUERY).matches;
}

export function useMobileWorkspace(): boolean {
  const [isMobile, setIsMobile] = useState(getIsMobileWorkspace);

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_WORKSPACE_QUERY);
    const update = () => setIsMobile(mediaQuery.matches);

    update();
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, []);

  return isMobile;
}
