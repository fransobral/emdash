/**
 * Mdash tablet (portrait, touch) bottom tab bar.
 *
 * Isolated on purpose: it does not import workbench internals. Each tab proxies
 * a click to the matching left-sidebar button (by aria-label), so navigation
 * logic stays in one place. The sidebar itself is hidden in portrait by
 * tablet.css and reopened as a drawer from the "Más" tab.
 * Only rendered when the tablet-portrait media query matches.
 */
import React, { useEffect, useState } from 'react';

const QUERY = '(pointer: coarse) and (min-width: 768px) and (orientation: portrait)';
const DRAWER_ATTR = 'data-tablet-drawer';

type Tab = { label: string; target: string; icon: React.ReactNode };

const svg = (d: React.ReactNode) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);

const TABS: Tab[] = [
  { label: 'Hoy', target: 'Hoy', icon: svg(<path d="M22 12h-4l-3 9L9 3l-3 9H2" />) },
  { label: 'Archivos', target: 'Archivos', icon: svg(<><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" /><path d="M14 2v5h6" /></>) },
  { label: 'Multitarea', target: 'Multitarea', icon: svg(<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>) },
  { label: 'Automations', target: 'Automations', icon: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>) },
];
const MORE_ICON = svg(<><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></>);
// Destinations reachable only through "Más" (the drawer): Settings, Search, projects, feedback.
const MORE_TARGETS = ['Settings'];

const sidebarButton = (label: string) =>
  document.querySelector<HTMLElement>(`#workspace-left [aria-label="${label}"]`);

function useMatches(query: string) {
  const [m, setM] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}

function readActive(): string | null {
  const el = document.querySelector<HTMLElement>('#workspace-left [data-active][aria-label]');
  return el?.getAttribute('aria-label') ?? null;
}

export function TabletTabBar() {
  const enabled = useMatches(QUERY);
  const [active, setActive] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    setActive(readActive());
    const obs = new MutationObserver(() => setActive(readActive()));
    obs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-active'] });
    return () => obs.disconnect();
  }, [enabled]);

  useEffect(() => {
    const root = document.documentElement;
    if (enabled && drawer) root.setAttribute(DRAWER_ATTR, '');
    else root.removeAttribute(DRAWER_ATTR);
  }, [enabled, drawer]);

  // Close the drawer after any navigation made inside it.
  useEffect(() => {
    if (!drawer) return;
    const close = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('#workspace-left [data-slot="button"], #workspace-left a, #workspace-left [role="button"]')) {
        window.setTimeout(() => setDrawer(false), 50);
      }
    };
    document.addEventListener('click', close, true);
    return () => document.removeEventListener('click', close, true);
  }, [drawer]);

  if (!enabled) return null;

  const go = (target: string) => {
    setDrawer(false);
    sidebarButton(target)?.click();
  };
  const moreActive = drawer || (active !== null && MORE_TARGETS.includes(active));

  return (
    <>
      {drawer && (
        <div className="mdash-drawer-scrim" onClick={() => setDrawer(false)} aria-hidden="true" />
      )}
      <nav className="mdash-tabbar" aria-label="Navegación principal">
        {TABS.map((t) => (
          <button key={t.target} type="button" className="mdash-tab"
            aria-current={!drawer && active === t.target ? 'page' : undefined}
            onClick={() => go(t.target)}>
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
        <button type="button" className="mdash-tab" aria-expanded={drawer}
          aria-current={moreActive ? 'page' : undefined}
          onClick={() => setDrawer((d) => !d)}>
          {MORE_ICON}
          <span>Más</span>
        </button>
      </nav>
    </>
  );
}
