import { Resizable, useCollapsiblePanelBinding } from '@emdash/ui/react/primitives';
import { useEffect, useRef, type ReactNode } from 'react';
import { useWorkspaceLayoutContext } from '@core/features/workbench/contributions/browser/layout-provider';
import { getNavigation } from '@core/primitives/navigation/browser/navigation-selectors';
import { useMobileWorkspace } from '@renderer/lib/layout/use-mobile-workspace';

const LEFT_PANEL_DEFAULT_SIZE = '20%';
// Resize floor (the released builds' value): dragging shrinks the sidebar only
// down to this width; dragging past it snaps the collapsible panel's layout to
// `collapsedSize` (0), which the binding's close-threshold check turns into a
// semantic close.
const LEFT_SIDEBAR_MIN_SIZE = '200px';
const LEFT_SIDEBAR_MAX_SIZE = '30%';
const MAIN_PANEL_MIN_SIZE = '30%';

// Drag-to-close threshold for the left sidebar, in percent of the group.
// 200px — the old resize floor — is at least 8% of the group on any window up
// to 2500px wide, so every width the previous UI let a user settle at stays a
// plain resize/restore, never a surprise close. Below 8% (~115px at 1440px)
// the sidebar content is unusable, so a drag settling there reads as intent
// to close rather than a resize.
const LEFT_SIDEBAR_CLOSE_THRESHOLD = 8;

interface WorkspaceLayoutProps {
  leftSidebar: ReactNode;
  mainContent: ReactNode;
}

export function WorkspaceLayout({ leftSidebar, mainContent }: WorkspaceLayoutProps) {
  const { isLeftOpen, toggleLeftSidebar, layoutStorage } = useWorkspaceLayoutContext();
  const isMobile = useMobileWorkspace();
  const binding = useCollapsiblePanelBinding({
    storageKey: 'workspace-outer',
    storage: layoutStorage,
    panelIds: ['workspace-left', 'workspace-main'],
    collapsiblePanelId: 'workspace-left',
    open: isLeftOpen,
    // Only reachable while open, so toggle is the semantic close command.
    onCloseRequest: () => toggleLeftSidebar(),
    closeThreshold: LEFT_SIDEBAR_CLOSE_THRESHOLD,
  });

  useEffect(() => {
    if (!isMobile || !isLeftOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') toggleLeftSidebar();
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isLeftOpen, isMobile, toggleLeftSidebar]);

  // Picking a destination in the mobile drawer should reveal it. The check
  // runs on the next tick because navigating to another project swaps in that
  // project's chrome state, which may itself report the sidebar as open.
  const drawer = useRef({ isLeftOpen, toggleLeftSidebar });
  useEffect(() => {
    drawer.current = { isLeftOpen, toggleLeftSidebar };
  });
  useEffect(() => {
    if (!isMobile) return;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = getNavigation().onDidNavigate.subscribe(() => {
      clearTimeout(pending);
      pending = setTimeout(() => {
        if (drawer.current.isLeftOpen) drawer.current.toggleLeftSidebar();
      }, 0);
    });
    return () => {
      clearTimeout(pending);
      unsubscribe();
    };
  }, [isMobile]);

  if (isMobile) {
    return (
      <div className="relative h-full w-full overflow-hidden">
        <div className="workspace-main-panel h-full w-full">{mainContent}</div>
        {isLeftOpen && (
          <div className="absolute inset-0 z-40">
            <button
              type="button"
              aria-label="Close navigation"
              aria-controls="workspace-mobile-navigation"
              className="absolute inset-0 h-full w-full cursor-default bg-black/55 backdrop-blur-[1px]"
              onClick={toggleLeftSidebar}
            />
            <aside
              id="workspace-mobile-navigation"
              role="dialog"
              aria-modal="true"
              aria-label="Workspace navigation"
              className="absolute inset-y-0 left-0 z-10 w-[min(86vw,320px)] overflow-hidden bg-background shadow-2xl"
            >
              {leftSidebar}
            </aside>
          </div>
        )}
      </div>
    );
  }

  return (
    <Resizable.Group id="workspace-outer" orientation="horizontal" {...binding.groupProps}>
      {/* Closed = panel AND handle unmounted (sync contract: never program
          the panels). */}
      {isLeftOpen && (
        <>
          <Resizable.Panel
            {...binding.collapsiblePanelProps}
            defaultSize={binding.collapsiblePanelProps.defaultSize ?? LEFT_PANEL_DEFAULT_SIZE}
            minSize={LEFT_SIDEBAR_MIN_SIZE}
            maxSize={LEFT_SIDEBAR_MAX_SIZE}
            collapsible
            collapsedSize="0%"
          >
            {leftSidebar}
          </Resizable.Panel>
          <Resizable.Handle variant="ghost" className="-ml-px" />
        </>
      )}
      <Resizable.Panel id="workspace-main" minSize={MAIN_PANEL_MIN_SIZE}>
        {mainContent}
      </Resizable.Panel>
    </Resizable.Group>
  );
}

interface WorkspaceContentLayoutProps {
  titlebarSlot: ReactNode;
  mainPanel: ReactNode;
}

export function WorkspaceContentLayout({ titlebarSlot, mainPanel }: WorkspaceContentLayoutProps) {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {titlebarSlot}
      <div className="flex-1 overflow-hidden">
        <div className="flex h-full flex-col overflow-hidden">{mainPanel}</div>
      </div>
    </div>
  );
}
