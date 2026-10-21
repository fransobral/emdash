export type SidebarTab = 'conversations' | 'changes' | 'files';

/**
 * Desktop shows every conversation as a tab, so it has no conversations sidebar tab;
 * the phone layout keeps it. A remembered 'conversations' tab shows Changes on desktop.
 */
export function desktopSidebarTab(tab: SidebarTab): Exclude<SidebarTab, 'conversations'> {
  return tab === 'conversations' ? 'changes' : tab;
}
