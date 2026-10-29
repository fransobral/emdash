#!/usr/bin/env node
// Re-applies emdash hotfix patches to installed node_modules packages after
// `pnpm install` (wired as the root "postinstall" script). Idempotent: a patch
// is skipped when its marker string is already present, and skipped with a
// warning when the installed package version differs from the patched one.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HOTFIXES = [
  {
    pkg: "@agentclientprotocol/codex-acp",
    version: "1.13.1",
    file: "dist/index.js",
    marker: "RESUME_MAX_TURNS",
    patch: "patches/hotfix/codex-acp-1.13.1-resume-tail-load.diff",
  },
  {
    pkg: "@agentclientprotocol/claude-agent-acp",
    version: "0.81.2",
    file: "dist/acp-agent.js",
    marker: "emdashTailMessages",
    patch: "patches/hotfix/claude-agent-acp-0.81.2-resume-tail-load.diff",
  },
];

for (const h of HOTFIXES) {
  const dir = join(root, "node_modules", h.pkg);
  const pj = join(dir, "package.json");
  if (!existsSync(pj)) { console.warn(`[hotfix] ${h.pkg} not installed, skipping`); continue; }
  const version = JSON.parse(readFileSync(pj, "utf8")).version;
  if (version !== h.version) { console.warn(`[hotfix] ${h.pkg}@${version} != ${h.version}, patch not applied (refresh ${h.patch})`); continue; }
  if (readFileSync(join(dir, h.file), "utf8").includes(h.marker)) { console.log(`[hotfix] ${h.pkg}: already applied`); continue; }
  try {
    // GNU patch writes a new file and renames it, so pnpm store hardlinks are not modified.
    execFileSync("patch", ["-p1", "--forward", "--silent", "-d", dir, "-i", join(root, h.patch)], { stdio: "inherit" });
    console.log(`[hotfix] ${h.pkg}: applied ${h.patch}`);
  } catch (e) {
    console.warn(`[hotfix] ${h.pkg}: failed to apply ${h.patch}: ${e.message}`);
  }
}
