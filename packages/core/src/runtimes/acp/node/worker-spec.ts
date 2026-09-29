import type { Logger } from '@emdash/shared/logger';
import type { PluginRegistry } from '@emdash/shared/plugins';
import type { ProvidedWireComponentRequirements } from '@emdash/wire/worker';
import type { WireComponentWorkerCreateOptions } from '@emdash/wire/worker';
import type { z } from 'zod';
import type { CLIAgentPluginProvider } from '#services/agent-plugins/api/plugins';
import { type acpComponentConfigSchema, createAcpComponent } from './component';

/**
 * An ACP agent connection with no live session is reclaimed after two idle
 * minutes; reconnecting re-establishes it transparently.
 */
export const ACP_CONNECTION_IDLE_TTL_MS = 120_000;

/**
 * A chat whose agent has been quiet this long is suspended. Waking one replays
 * its whole rollout, which takes long on big chats, so chats used during the
 * day stay awake; each awake agent costs a few hundred MB.
 */
export const ACP_SESSION_IDLE_MS = 6 * 60 * 60_000;

type AcpComponent = ReturnType<typeof createAcpComponent>;
type AcpWorkerOptions = WireComponentWorkerCreateOptions<
  AcpComponent['requirements'],
  z.infer<typeof acpComponentConfigSchema>
>;

export type AcpWorkerSpecInput = {
  pluginRegistry: PluginRegistry<CLIAgentPluginProvider>;
  executable: string;
  env: NodeJS.ProcessEnv;
  logger?: Logger;
  dependencies: ProvidedWireComponentRequirements<AcpComponent['requirements']>;
  attachmentsDir: string;
  intentsFilePath: string;
};

/**
 * Spawn spec for the ACP session runtime worker. Sessions idle out after
 * ACP_SESSION_IDLE_MS without output; idle agent connections are reclaimed after
 * ACP_CONNECTION_IDLE_TTL_MS. The plugin registry is injected by the embedding
 * app so core stays plugin-free.
 */
export function acpWorkerSpec(
  input: AcpWorkerSpecInput
): readonly [AcpComponent, AcpWorkerOptions] {
  return [
    createAcpComponent({
      pluginRegistry: input.pluginRegistry,
      logger: input.logger,
    }),
    {
      name: 'acp',
      executable: input.executable,
      env: input.env,
      dependencies: input.dependencies,
      config: {
        attachmentsDir: input.attachmentsDir,
        intentsFilePath: input.intentsFilePath,
        lifecycle: {
          session: { kind: 'idle-after', outputMs: ACP_SESSION_IDLE_MS },
          connectionIdleTtlMs: ACP_CONNECTION_IDLE_TTL_MS,
        },
      },
    },
  ];
}
