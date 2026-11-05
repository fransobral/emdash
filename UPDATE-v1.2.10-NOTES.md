# EmDash update/v1.2.10 notes

Branch: `update/v1.2.10` (worktree `/home/ubuntu/emdash-update`)
Base merge: `origin/main` @ 592281113 into Francisco `ee2d270b3`
Tip: see `git rev-parse HEAD`

## Production
- Live tree `/home/ubuntu/emdash` on `develop` untouched
- `emdash-web` was NOT restarted/stopped during this work
- Deploy only after Francisco explicit OK

## Feature decisions (overlap)

| Area | Choice | Why |
|------|--------|-----|
| Cockpit (En vivo, Archivos, Hermes, usage accounts) | **Keep ours** | Unique VPS cockpit; upstream has no equivalent live/files/bridge |
| Official Usage (`features/usage`) | **Keep upstream** | First-party settings/overview; wired alongside cockpit in manifests |
| Usage account linking WIP (stash) | **Keep ours on cockpit** | Multi-account Codex/Claude linking is cockpit-specific |
| Provider options / model-mode selectors | **Upstream** | Generic options system replaces old set-mode-id APIs |
| Tablet CSS / tab bar / view-scope guard | **Ours** | Required for tablet/mobile remount |
| ACP hotfixes (resume tail-load) | **Ours** | postinstall patches still apply on install |
| GitHub onboarding device-flow in sign-in-step | **Upstream temporarily** | Hook removed; build needs account OAuth path. Follow-up: wire IntegrationDeviceFlow for web |
| GitHub integration auth / directory picker / notification handlers | **Upstream** | Cleaner post-refactor; no unique VPS behavior lost |
| ACP chat panel/store/session, composer, terminals | **Merged** | Keep restart-session / mobile bits + upstream fixes |

## Follow-ups before deploy
1. Re-wire web GitHub device-flow onboarding via IntegrationDeviceFlowService
2. Smoke typecheck/lint; manual tablet + cockpit usage smoke
3. Explicit Francisco OK to restart `emdash-web` from this worktree/build
