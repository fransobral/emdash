# TAREA: convertir Emdash Web en el cockpit de agentes de la VPS (interconectado con Hermes)

## Contexto del repo y del entorno
- Repo: /home/ubuntu/emdash  (rama actual: pr3250 — que agrega el frontend web self-hosted de Emdash).
- Es un monorepo pnpm. El frontend web vive en apps/emdash-web y reusa EXACTAMENTE el backend de escritorio (apps/emdash-desktop) montado dentro de un proceso Node.
- Node 24 está en /home/ubuntu/.local/node24/bin/node. El server corre como servicio systemd `emdash-web`:
  - Unit: /etc/systemd/system/emdash-web.service
  - Escucha en 172.18.0.1:4200 (red interna, con EMDASH_WEB_ALLOW_INSECURE_REMOTE=1)
  - Data dir: /home/ubuntu/.emdash-web   Env: /home/ubuntu/.emdash-web.env
  - Logs: journalctl -u emdash-web -f
- Leé apps/emdash-web/README.md y /home/ubuntu/emdash/AGENTS.md antes de empezar. Respetá sus convenciones.

## Reglas NO negociables
- NO rompas la app de escritorio ni el protocolo wire. El web reusa el backend desktop: no dupliques lógica, reusá operaciones/servicios existentes.
- Convenciones: pnpm, oxlint + oxfmt, TypeScript strict, Conventional Commits. Antes de terminar corré `pnpm run typecheck` y `pnpm run lint` dentro de apps/emdash-web (deben pasar).
- Trabajá en una rama nueva: `git checkout -b feat/web-cockpit`. Un commit por feature (mensajes convencionales).
- build: `cd /home/ubuntu/emdash/apps/emdash-web && pnpm build`
- Si better-sqlite3 tira error de ABI tras instalar: `cd node_modules/better-sqlite3 && npx prebuild-install`
- Al final: reiniciá el servicio (`sudo systemctl restart emdash-web`) y verificá con `node scripts/smoke.mjs "ws://172.18.0.1:4200/ws?token=$(grep EMDASH_WEB_TOKEN /home/ubuntu/.emdash-web.env | cut -d= -f2)" /home/ubuntu`.
- No hace falta tocar Cloudflare/túnel ni la configuración de red: eso lo maneja otro proceso. Tu trabajo termina en el código + servicio local + verificación.

---

## FEATURE 1 — Navegador de carpetas REAL (eliminar el campo de texto)

Problema: la versión web reemplazó el diálogo nativo de carpetas por un input de texto en
`apps/emdash-web/web/overrides/local-directory-selector.tsx`. El usuario quiere navegar el filesystem real.

Dato clave: la infraestructura por wire YA existe y YA soporta host local `{ type: 'local' }`. No hay que inventarla:
- Contrato: `apps/emdash-desktop/src/core/features/projects/api/wire-contract.ts`
  → `projectHostParamsSchema` (`{type:'local'}` | `{type:'ssh',connectionId}`), y los procedimientos
  `directoryTree` (liveModel con mutations expand/reveal), `getHostHomeDir`, `createHostDirectory`,
  `getDefaultRepositoriesRoot`, `ensureDefaultRepositoriesRoot`.
- Servidor: `apps/emdash-desktop/src/core/features/projects/node/wire-controller.ts`
  → `hostRefForProjectHost()` mapea local → LOCAL_HOST_REF y todo resuelve bien para local. El `directoryTree`
  provider usa `runtime.files.tree.model`. O sea: el backend local YA lista carpetas.
- Explorador (UI reutilizable): `apps/emdash-desktop/src/core/features/projects/browser/components/add-project-modal/project-directory-picker.tsx`
  → `ProjectDirectoryPicker` ya maneja `strategy: 'local' | 'ssh'` y arma `{ type:'local', root, sessionId }`
  o `{ type:'ssh', connectionId, root, sessionId }`. Tiene migas de pan, historial, crear carpeta, etc.
- Modal: `apps/emdash-desktop/src/core/features/projects/browser/components/directory-selector-modal.tsx`
  → hoy hardcodea `strategy="ssh"` y exige `connectionId`. Generalizalo.

Implementación:
1. Generalizá `DirectorySelectorModal` para recibir `strategy: 'local' | 'ssh'` y `connectionId?: string`.
   - Con `strategy==='local'`: no pidas connectionId, pasá `strategy="local"` a `ProjectDirectoryPicker`,
     y usá `getHostHomeDir({type:'local'})` como home. Título: "Seleccionar carpeta".
   - Registrá el modal para que pueda abrirse con ambas estrategias (ver `defineModal` + `useOpenModal`).
2. Confirmá que `ProjectDirectoryPicker` funciona con `strategy='local'` (su `projectHostParams()` ya lo soporta).
   Si algún punto asume ssh, arreglalo.
3. Reescribí `apps/emdash-web/web/overrides/local-directory-selector.tsx`: para la estrategia local,
   en vez de un `<Input>`, mostrá un botón con la ruta elegida que abra el `directorySelectorModal`
   con `strategy:'local'` (igual que hoy hace la rama ssh). Mantené un input secundario opcional dentro del modal.
4. Directorio inicial: home del host local. Permitir navegar /home/ubuntu y todo el árbol.
5. Mantené el override existente donde se importa (vite.config.ts lo alias-ea) para no romper el build.

Aceptación F1: en "Add project" → "Local", aparece un explorador con migas de pan que lista carpetas
reales de la VPS, se navega y se selecciona carpeta. El control principal ya NO es un campo de texto.

---

## FEATURE 2 — Panel "En vivo" (panorama de todo lo que corre)

Una sección/pestaña nueva en la UI que muestre EN VIVO: proyectos, tareas, agentes y conversaciones activas
(qué está haciendo el sistema ahora). Debe actualizarse sola (sin polling manual).

Datos ya disponibles por wire (reusá los clientes existentes, no reimplementes):
- domain `projects`: `projectList` (liveModel) → { projects }.
- domain `tasks`: `taskList` (liveModel, key {projectId}) → Task{ id, projectId, name, status,
  conversations: Record<provider,number>, workspaceId, workspaceGit, prs, isPinned, ... };
  y `taskStats` (liveModel) con lifecycle de workspaces (observedStatus, lastCreateOutcome, lifecycle steps).
- domain `conversations`: estado de agentes acp/pty (ver `conversationsWireEvents`, agent-status).
- `TaskActiveWorkspace` incluye `path` (dónde corre la tarea) — mostralo.

Implementación (seguí el patrón de contribución del repo):
- Creá un slice nuevo en `apps/emdash-desktop/src/core/features/<tuFeature>/browser/` con su vista,
  registrado por `contributions/browser.ts` y agregado en `src/core/manifests/browser/browser-contributions.ts`
  (+ tabs si aplica: `contributions/tabs.ts` + task-tab-contributions.ts).
- La vista: lista de proyectos; dentro, tareas con estado/lastInteractedAt/workspacePath; contador de
  conversaciones por proveedor; badges de estado. Usá los clientes wire ya existentes (task-manager/store
  y el cliente de projectList). Suscribite a los liveModels para refresco en vivo.
- Estética consistente con la app (usá componentes de @emdash/ui).

Aceptación F2: al crear/correr una tarea (por UI o por el puente del Feature 3), el panel lo refleja en vivo.

---

## FEATURE 3 — Puente Hermes ⇄ Emdash (HTTP control API)

Objetivo: que un agente externo (Hermes, que vive en WhatsApp) pueda (a) LEER el estado de Emdash y
(b) CREAR tareas que aparezcan EN VIVO en la UI (porque usan el mismo service layer).

Implementación:
- Nuevo archivo `apps/emdash-web/server/bridge.ts`: router HTTP con token, montado en `server/index.ts`
  DENTRO del callback de createServer, ANTES del static/404 (ver líneas ~127-132 de server/index.ts).
- Token: env `EMDASH_WEB_BRIDGE_TOKEN` (nuevo; agregalo a /home/ubuntu/.emdash-web.env).
  Aceptá `Authorization: Bearer $EMDASH_WEB_BRIDGE_TOKEN`. Rechazá sin token con 401. CORS solo localhost.
- El router recibe el MISMO bundle de controladores que se pasa a `attachWireGateway`:
  `controllers.controllers` (Record<domain, Controller>) — ya disponible en index.ts (bootControllers).
  Para llamar procedimientos: `controllers.controllers[domain].call(path, input, meta)`
  (ver cómo `createRoutingController` en server/ws-gateway.ts hace route()); para liveModels usá
  resolveLive/acquireLive del mismo modo.

Endpoints (JSON):
1. GET  /api/bridge/health → { ok: true }
2. GET  /api/bridge/state → snapshot de solo lectura:
   { projects: [...], tasksByProject: { [projectId]: [ { id, name, status, conversations,
     workspacePath, lastInteractedAt } ] }, activeConversations: [...], providers: [...] }
   Implementalo leyendo `projects.projectList` y `tasks.taskList` (por proyecto) y el estado de agentes.
3. POST /api/bridge/tasks → crea una tarea.
   body: { projectId, prompt, provider?, model?, name?, baseBranch?, agentAutoApprove? }
   - Construí `CreateTaskParams` REUSANDO la lógica real de la UI:
     `apps/emdash-desktop/src/core/features/tasks/browser/create-task-modal/build-create-task-params.ts`
     y `.../api/browser/create-task-modal/use-workspace-config.ts` (que usa `buildWorkspaceConfigFromPreset`
     de @core/primitives/workspaces/api). Como esos son hooks de browser, EXTRAÉ la parte pura a un helper
     node-side reutilizable (p. ej. `buildCreateTaskParams({projectId, prompt, provider, model, name, baseBranch})`
     → { id, projectId, taskConfig, workspaceConfig }) y que la UI también lo use (evitá divergencia).
     `TaskConfig` y `WorkspaceConfig` son versionados — mirá `@core/primitives/tasks/api/task-config.ts` y
     `@core/primitives/workspaces/api`.
   - Llamá `tasks.createTask` vía el controller. Devolvé { taskId, conversationId } (de CreateTaskSuccess).
4. POST /api/bridge/tasks/:taskId/prompt → body { prompt } → envía/encola un mensaje a la conversación
   inicial de la tarea (mismo path que usa el chat de la UI; buscá el servicio de mensajes de conversación).

Aceptación F3:
- `curl -H "Authorization: Bearer $EMDASH_WEB_BRIDGE_TOKEN" http://172.18.0.1:4200/api/bridge/state`
  devuelve JSON válido con proyectos/tareas.
- `curl -XPOST -H "Authorization: Bearer $EMDASH_WEB_BRIDGE_TOKEN" -H 'content-type: application/json' \
  http://172.18.0.1:4200/api/bridge/tasks -d '{"projectId":"<real>","prompt":"run tests","provider":"codex"}'`
  crea una tarea que APARECE EN VIVO en el panel del Feature 2.

---

## FEATURE 4 — Subida de archivos a la VPS y a los proyectos

Objetivo: un apartado para subir archivos fácil (desde el celular) a la VPS y a un proyecto.

Backend (en el mismo router bridge):
- POST /api/bridge/upload — multipart/form-data. Campos: `destType` ('project'|'general'), `projectId?`,
  `subPath?`, y `files[]`. Para 'general', destino base = /home/ubuntu/uploads (creala si no existe).
  Para 'project', destino base = el workspace/path del proyecto. Escribí con streaming a disco.
- Seguridad: resolvé el path final y verificá que quede DENTRO de un root permitido
  (HOME=/home/ubuntu, /home/ubuntu/uploads, y el workspace del proyecto). Bloqueá path traversal
  (`..`), absolutos fuera de root, y symlinks que escapen. Tamaño máximo por archivo configurable por env
  (ej. EMDASH_WEB_UPLOAD_MAX_MB, default 200). Devolvé [{ name, path, sizeBytes }].
- GET /api/bridge/uploads?destType=...&projectId=... → lista lo subido en el destino.

Frontend:
- Nueva pestaña "Archivos" en la UI con drag&drop + `<input type=file>` múltiple, selector de destino
  (elegir proyecto y subcarpeta, o carpeta general), y lista de subidos con tamaño.
- Reusá el árbol/editor de archivos existente (slice `editor`) para poder VER los archivos subidos.
- (Opcional) botón "Subir aquí" dentro del explorador de archivos de un proyecto.

Aceptación F4: subo un archivo desde el navegador y aparece en el filesystem de la VPS y en el árbol.

---

## CRITERIOS DE ACEPTACIÓN GLOBALES
1. Crear proyecto abre un explorador de carpetas REAL del filesystem de la VPS (navegable), no un input.
2. Hay un panel "en vivo" con proyectos/tareas/agentes que se actualiza solo.
3. `GET /api/bridge/state` (con token) devuelve el estado del sistema en JSON.
4. `POST /api/bridge/tasks` crea una tarea que aparece EN VIVO en la UI.
5. Se puede subir un archivo desde el navegador y verlo en el árbol/filesystem.
6. `pnpm run typecheck` y `pnpm run lint` pasan en apps/emdash-web. Smoke test pasa. Servicio `emdash-web`
   reiniciado y sano (systemctl is-active emdash-web).

## CÓMO REPORTAR
Al terminar, dejá un resumen en `apps/emdash-web/COCKPIT_CHANGELOG.md`: qué archivos tocaste por feature,
el comando exacto para probar cada endpoint del bridge, y cualquier decisión de diseño tomada.
