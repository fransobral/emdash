import { cockpitViewRuntime } from '../browser/cockpit-view';
import { cockpitFilesViewRuntime } from '../browser/files-view';

export const cockpitBrowserContributions = {
  views: [cockpitViewRuntime, cockpitFilesViewRuntime],
  modalDefs: [],
} as const;
