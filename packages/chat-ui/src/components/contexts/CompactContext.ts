/**
 * CompactContext — phone-density flag for descendant renderers.
 *
 * Structure-affecting compact behavior (tool-run collapsing) is decided at
 * segmentation time via `SegmentCtx.compact`; this context only carries the
 * presentational half, such as the right-aligned user bubble. The flag is fixed
 * for the lifetime of a view, so a plain accessor is enough.
 */

import { createContext, useContext } from 'solid-js';

export const CompactContext = createContext<() => boolean>(() => false);

export const useCompact = (): (() => boolean) => useContext(CompactContext);
