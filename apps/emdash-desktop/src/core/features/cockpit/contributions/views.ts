import { z } from 'zod';
import { workbenchLayout } from '@core/primitives/layouts/api';
import { defineView } from '@core/primitives/views/api';

export const cockpitViewDef = defineView({
  id: 'cockpit',
  params: z.object({}),
  layout: workbenchLayout,
  telemetryEvent: 'cockpit_viewed',
});

export const cockpitFilesViewDef = defineView({
  id: 'cockpitFiles',
  // Folder to open; without it the explorer reopens the last visited folder.
  params: z.object({ path: z.string().optional() }),
  layout: workbenchLayout,
  telemetryEvent: 'cockpit_files_viewed',
});
