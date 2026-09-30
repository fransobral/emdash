/**
 * Emdash Web server entry.
 *
 * Boots the exact desktop backend stack — SQLite database, SSH
 * infrastructure, runtime workers, services, and the full wire controller
 * bundle — then exposes it over WebSocket (`/ws?token=...`) and serves the
 * web renderer build as static files.
 *
 * Environment:
 *   EMDASH_WEB_PORT      listen port (default 4200)
 *   EMDASH_WEB_HOST      bind address (default 127.0.0.1)
 *   EMDASH_WEB_TOKEN     access token; auto-generated and printed when unset
 *   EMDASH_WEB_DATA_DIR  user-data directory (default ~/.emdash-web)
 *   EMDASH_WEB_APP_DIR   app root hosting out/main worker bundles
 *   EMDASH_WEB_PREVIEW_ORIGIN      public origin of the local preview proxy
 *                                  (e.g. https://preview.example.com); unset disables it
 *   EMDASH_WEB_PREVIEW_PORT        preview proxy listen port (default 4201)
 *   EMDASH_WEB_PREVIEW_DENY_PORTS  extra comma-separated ports the preview must not reach
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conversationEvents } from '@core/features/conversations/api/node/conversation-events';
import { conversationWireEvents } from '@core/features/conversations/node/event-host';
import { loadActiveAgentStatusConversationIds } from '@core/features/conversations/node/load-active-agent-status-conversation-ids';
import { renameConversation } from '@core/features/conversations/node/renameConversation';
import { bootBackground } from '@main/bootstrap/boot/phases/background';
import { bootControllers } from '@main/bootstrap/boot/phases/controllers';
import { bootDatabase } from '@main/bootstrap/boot/phases/database';
import { bootInfrastructure } from '@main/bootstrap/boot/phases/infrastructure';
import { bootRuntimes } from '@main/bootstrap/boot/phases/runtimes';
import { bootServices } from '@main/bootstrap/boot/phases/services';
import { loadAppConfig, setAppConfig } from '@main/bootstrap/core/config';
import { acpAgentStatusBridge } from '@main/core/acp/agent-status-bridge';
import { setAgentStatusConversationEventPublisher } from '@main/core/agent-status/agent-status-service';
import { tuiAgentStatusBridge } from '@main/core/agent-status/tui-agent-status-bridge';
import { startUserEnvCapture } from '@main/lib/userEnv';
import { createBridgeHandler } from './bridge';
import { createPasswordAuth } from './password-auth';
import {
  createPortPolicy,
  createPreviewOpenHandler,
  createPreviewProxy,
  INFRA_PORTS,
} from './preview-proxy';
import { createStaticHandler } from './static';
import { attachWireGateway } from './ws-gateway';

const here = resolve(fileURLToPath(import.meta.url), '..');

const PORT = Number(process.env.EMDASH_WEB_PORT ?? 4200);
const HOST = process.env.EMDASH_WEB_HOST ?? '127.0.0.1';
const TOKEN = process.env.EMDASH_WEB_TOKEN ?? randomBytes(24).toString('base64url');
const BRIDGE_TOKEN = process.env.EMDASH_WEB_BRIDGE_TOKEN ?? '';
const PASSWORD = process.env.EMDASH_WEB_PASSWORD ?? '';
const PREVIEW_ORIGIN = process.env.EMDASH_WEB_PREVIEW_ORIGIN ?? '';
const PREVIEW_PORT = Number(process.env.EMDASH_WEB_PREVIEW_PORT ?? 4201);
const PREVIEW_DENY_PORTS = (process.env.EMDASH_WEB_PREVIEW_DENY_PORTS ?? '')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);
const DATA_DIR = resolve(process.env.EMDASH_WEB_DATA_DIR ?? join(homedir(), '.emdash-web'));

async function main(): Promise<void> {
  // The token rides plaintext HTTP/WebSocket query strings; refuse non-loopback
  // binds unless the operator explicitly acknowledges the exposure and fronts
  // the server with a TLS-terminating proxy.
  const isLoopback = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1';
  const allowInsecureRemote = process.env.EMDASH_WEB_ALLOW_INSECURE_REMOTE === '1';
  if (!isLoopback && !allowInsecureRemote) {
    console.error(
      `[emdash-web] refusing to bind ${HOST}: the access token travels over plaintext ` +
        'HTTP/WebSocket. Front the server with a TLS-terminating proxy, or set ' +
        'EMDASH_WEB_ALLOW_INSECURE_REMOTE=1 to acknowledge the exposure on a trusted network.'
    );
    process.exit(1);
  }

  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(join(DATA_DIR, 'logs'), { recursive: true });

  const config = loadAppConfig({
    ...process.env,
    emdashUserDataDir: DATA_DIR,
  } as NodeJS.ProcessEnv);
  setAppConfig(config);

  startUserEnvCapture();
  const database = await bootDatabase(config);
  const infrastructure = await bootInfrastructure(database);
  const runtimes = await bootRuntimes(database, infrastructure);
  const services = await bootServices(database, infrastructure, runtimes);
  const controllers = await bootControllers(database, infrastructure, runtimes, services);

  // Conversation/agent status bridges keep the UI live-updating.
  const publishConversationEvent = (event: Parameters<typeof conversationWireEvents.emit>[1]) =>
    conversationWireEvents.emit(undefined, event);
  setAgentStatusConversationEventPublisher(publishConversationEvent);

  acpAgentStatusBridge.initialize(
    (handler) => conversationEvents.on('conversation:created', handler),
    {
      runtimes: runtimes.broker,
      onLocalWorkerStateChanged: runtimes.workers.acp.onStateChanged.bind(runtimes.workers.acp),
      loadActiveConversationIds: (host) =>
        loadActiveAgentStatusConversationIds(database.db, host, 'acp'),
      renameConversation: (conversationId, name) =>
        renameConversation(
          {
            db: database.db,
            runtimes: runtimes.broker,
            hostIsReachable: services.hostIsReachable,
          },
          conversationId,
          name
        ),
    }
  );
  tuiAgentStatusBridge.initialize({
    runtimes: runtimes.broker,
    onLocalWorkerStateChanged: runtimes.workers.tuiAgents.onStateChanged.bind(
      runtimes.workers.tuiAgents
    ),
    loadActiveConversationIds: (host) =>
      loadActiveAgentStatusConversationIds(database.db, host, 'pty'),
  });
  services.hostAttachments.register({
    label: 'acp-agent-status',
    attach: (host) => acpAgentStatusBridge.attachHost(host),
    detach: (host) => acpAgentStatusBridge.detachHost(host),
  });
  services.hostAttachments.register({
    label: 'tui-agent-status',
    attach: (host) => tuiAgentStatusBridge.attachHost(host),
    detach: (host) => tuiAgentStatusBridge.detachHost(host),
  });

  try {
    await bootBackground(services, runtimes, { updater: false });
  } catch (error) {
    console.warn('[emdash-web] background tasks failed to start:', error);
  }

  const staticHandler = createStaticHandler(join(here, 'web'));
  const passwordAuth = createPasswordAuth({ password: PASSWORD, secret: TOKEN });
  const bridgeHandler = createBridgeHandler({
    token: BRIDGE_TOKEN,
    sessionToken: TOKEN,
    controllers: controllers.controllers,
  });
  const isPreviewPortAllowed = createPortPolicy([
    PORT,
    PREVIEW_PORT,
    ...INFRA_PORTS,
    ...PREVIEW_DENY_PORTS,
  ]);
  const previewOpen = createPreviewOpenHandler({
    origin: PREVIEW_ORIGIN,
    secret: TOKEN,
    isAllowed: isPreviewPortAllowed,
  });
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/api/bridge/')) {
      void bridgeHandler(req, res);
      return;
    }
    if (req.url?.startsWith('/auth/')) {
      void passwordAuth.handle(req, res);
      return;
    }
    if (passwordAuth.requireAuthentication(req, res)) return;
    if (req.url?.startsWith('/preview/')) {
      void previewOpen(req, res).then((handled) => {
        if (handled) return;
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Not found');
      });
      return;
    }
    if (staticHandler(req, res)) return;
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });

  attachWireGateway(server, {
    token: TOKEN,
    controllers: controllers.controllers,
    authorizeRequest: passwordAuth.isAuthenticated,
  });

  server.listen(PORT, HOST, () => {
    const displayHost = HOST === '0.0.0.0' ? '<machine-ip>' : HOST;
    console.log('');
    console.log('  Emdash Web is running');
    console.log(`  URL   : http://${displayHost}:${PORT}/`);
    console.log(`  Token : ${TOKEN}`);
    console.log(`  Open  : http://${displayHost}:${PORT}/?token=${TOKEN}`);
    console.log(`  Data  : ${DATA_DIR}`);
    console.log('');
    console.log('  Keep the token private — it grants full project, git, and');
    console.log('  terminal access on this machine.');
  });

  // Serves agent dev servers at the root of their own origin; see preview-proxy.ts.
  const previewProxy = createPreviewProxy({ secret: TOKEN, isAllowed: isPreviewPortAllowed });
  const previewServer = createServer(previewProxy.handleRequest);
  previewServer.on('upgrade', previewProxy.handleUpgrade);
  previewServer.on('error', (error) => {
    console.warn('[emdash-web] preview proxy failed to start:', error);
  });
  previewServer.listen(PREVIEW_PORT, HOST, () => {
    console.log(
      `  Preview proxy on ${HOST}:${PREVIEW_PORT} (${PREVIEW_ORIGIN || 'origin not set'})`
    );
  });

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('[emdash-web] shutting down…');
    server.close();
    server.closeAllConnections?.();
    previewServer.close();
    previewServer.closeAllConnections?.();
    try {
      await runtimes.dispose();
    } catch {
      /* best effort */
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error: unknown) => {
  console.error('[emdash-web] fatal boot error:', error);
  process.exit(1);
});
