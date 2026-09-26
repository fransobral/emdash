import { workbenchLayout } from '@core/primitives/layouts/api';
import { defineView } from '@core/primitives/views/api';
import { z } from 'zod';

export const cockpitViewDef = defineView({
  id: 'cockpit',
  params: z.object({}),
  layout: workbenchLayout,
  telemetryEvent: 'cockpit_viewed',
});

export const cockpitFilesViewDef = defineView({
  id: 'cockpitFiles',
  params: z.object({}),
  layout: workbenchLayout,
  telemetryEvent: 'cockpit_files_viewed',
});
