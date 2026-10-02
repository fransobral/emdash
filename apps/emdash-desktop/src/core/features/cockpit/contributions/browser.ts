import { cockpitViewRuntime } from '../browser/cockpit-view';
import { cockpitFilesViewRuntime } from '../browser/files-view';
import { linkUsageAccountModal } from '../browser/link-usage-account-modal';

export const cockpitBrowserContributions = {
  views: [cockpitViewRuntime, cockpitFilesViewRuntime],
  modalDefs: [linkUsageAccountModal],
} as const;
