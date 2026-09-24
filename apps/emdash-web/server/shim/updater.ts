/** The self-hosted server is deployed by systemd and has no Electron package to update. */
export async function initializeUpdater(): Promise<void> {
  // Intentionally disabled for the web host.
}
