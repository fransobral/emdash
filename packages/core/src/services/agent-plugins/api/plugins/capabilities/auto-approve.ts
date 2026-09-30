import { definePluginCapability } from '@emdash/shared/plugins';
import z from 'zod';

/**
 * autoApproveDescriptor is used to describe the auto-approve that an agent supports.
 * @param kind - The kind of auto-approve descriptor.
 * @param kind: 'supported' - The agent supports auto-approve.
 * @param kind: 'none' - The agent does not support auto-approve.
 * @param acpModeId - The ACP session mode a chat starts in when auto-approve is on.
 */
export const autoApproveCapability = definePluginCapability()(
  'auto-approve',
  z.object({
    kind: z.enum(['supported', 'none']),
    acpModeId: z.string().optional(),
  }),
  { kind: 'none' }
);
