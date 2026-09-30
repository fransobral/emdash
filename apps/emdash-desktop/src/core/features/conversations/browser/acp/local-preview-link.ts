const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]']);

/**
 * Routes a link to a dev server on the Emdash host (`http://localhost:3017/x`)
 * through emdash-web's preview proxy, so it opens from a laptop or phone.
 * Any other href is returned unchanged.
 */
export function localPreviewHref(href: string): string {
  let url: URL;
  try {
    url = new URL(href.trim());
  } catch {
    return href;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return href;
  if (!LOCAL_HOSTNAMES.has(url.hostname) || !url.port) return href;
  const path = `${url.pathname}${url.search}${url.hash}`;
  return `/preview/open?port=${url.port}&path=${encodeURIComponent(path)}`;
}
