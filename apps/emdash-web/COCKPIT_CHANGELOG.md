# VPS Cockpit Changes

## Feature 1: local directory browser

- `apps/emdash-desktop/src/core/features/projects/browser/components/directory-selector-modal.tsx`
  now accepts local and SSH hosts and resolves the appropriate home directory.
- `apps/emdash-web/web/overrides/local-directory-selector.tsx` opens the Wire-backed directory
  picker for local projects instead of rendering a path input.
- The desktop caller explicitly selects the SSH strategy, preserving its native local-dialog flow.

## Feature 2: live cockpit

- `apps/emdash-desktop/src/core/features/cockpit/` contributes the **En vivo** view.
- The view observes the existing project and task MobX stores, which are replicas of `projectList`,
  `taskList`, and `taskStats`; no polling or duplicate state service was added.
- `apps/emdash-desktop/src/core/features/workbench/browser/sidebar/left-sidebar.tsx` exposes the view.

## Feature 3: Hermes bridge

- `apps/emdash-web/server/bridge.ts` adds authenticated health, state, task creation, and prompt
  endpoints over the existing controller bundle.
- `apps/emdash-desktop/src/core/features/tasks/api/build-create-task-params.ts` is the pure task
  payload builder shared by the browser create flow and the bridge.
- `apps/emdash-web/server/index.ts` mounts the bridge before static hosting.

Set the shell variable once before running these commands:

```bash
export EMDASH_WEB_BRIDGE_TOKEN="$(grep '^EMDASH_WEB_BRIDGE_TOKEN=' /home/ubuntu/.emdash-web.env | cut -d= -f2-)"
```

Health:

```bash
curl -H "Authorization: Bearer $EMDASH_WEB_BRIDGE_TOKEN" \
  http://172.18.0.1:4200/api/bridge/health
```

State:

```bash
curl -H "Authorization: Bearer $EMDASH_WEB_BRIDGE_TOKEN" \
  http://172.18.0.1:4200/api/bridge/state
```

Create a task:

```bash
curl -X POST -H "Authorization: Bearer $EMDASH_WEB_BRIDGE_TOKEN" \
  -H 'content-type: application/json' \
  http://172.18.0.1:4200/api/bridge/tasks \
  -d '{"projectId":"<project-id>","prompt":"run tests","provider":"codex","baseBranch":"main"}'
```

Send or queue another prompt:

```bash
curl -X POST -H "Authorization: Bearer $EMDASH_WEB_BRIDGE_TOKEN" \
  -H 'content-type: application/json' \
  http://172.18.0.1:4200/api/bridge/tasks/<task-id>/prompt \
  -d '{"prompt":"summarize the result"}'
```

## Feature 4: uploads

- The bridge streams multipart file parts to disk and rejects traversal, absolute subpaths,
  symlinked path components, files outside `/home/ubuntu`, collisions, and oversized files.
- General uploads use `/home/ubuntu/uploads`; project uploads use a local project's root.
- `apps/emdash-desktop/src/core/features/cockpit/browser/files-view.tsx` contributes the
  **Archivos** drag-and-drop view. Its bridge token remains in browser local storage and is not
  embedded in the frontend bundle.
- Project uploads land under the project root, so existing editor file-tree observation displays
  them without a second filesystem implementation.

Upload one or more files:

```bash
curl -X POST -H "Authorization: Bearer $EMDASH_WEB_BRIDGE_TOKEN" \
  -F destType=general -F subPath=inbox -F 'files=@/tmp/example.txt' \
  http://172.18.0.1:4200/api/bridge/upload
```

Upload to a project:

```bash
curl -X POST -H "Authorization: Bearer $EMDASH_WEB_BRIDGE_TOKEN" \
  -F destType=project -F projectId='<project-id>' -F subPath=docs \
  -F 'files=@/tmp/example.txt' http://172.18.0.1:4200/api/bridge/upload
```

List uploads:

```bash
curl -H "Authorization: Bearer $EMDASH_WEB_BRIDGE_TOKEN" \
  'http://172.18.0.1:4200/api/bridge/uploads?destType=general&subPath=inbox'
```

## Design decisions

- HTTP calls route through the same desktop controllers used by WebSocket clients.
- Live reads acquire and release the contract's native live sources for coherent snapshots.
- Task creation defaults to ACP and Codex, and accepts `baseBranch` when a Git worktree should be
  created. Without it, the shared builder requests a non-Git workspace, matching directory projects.
- CORS headers are emitted only for loopback origins; bearer authentication is still mandatory.
- Existing destination files are not overwritten, avoiding symlink races and accidental data loss.

## Web GitHub authentication

- The public web UI presents GitHub's device flow as **Sign in with GitHub**. It registers the
  provider account through the existing GitHub Wire service and works without a browser callback.
- The Emdash account OAuth card remains Electron-only because `auth.emdash.sh` intentionally accepts
  loopback redirect URIs only. The desktop OAuth implementation is unchanged.

Manual test: sign in to `https://agents.fransobral.com`, open the GitHub integration, select
**Sign in with GitHub**, follow the displayed one-time-code instructions, and confirm the account
appears in Emdash.
