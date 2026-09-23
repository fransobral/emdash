import { z } from 'zod';
import { workbenchLayout } from '@core/primitives/layouts/api';
import { defineView } from '@core/primitives/views/api';

export const cockpitViewDef = defineView({
  id: 'cockpit',
  params: z.object({}),
  layout: workbenchLayout,
  telemetryEvent: 'cockpit_viewed',
});
