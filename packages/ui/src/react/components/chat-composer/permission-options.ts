/**
 * Maps the ACP permission options an agent offered onto the three actions the
 * mobile approval sheet can show. Nothing is invented: every button resolves to
 * an optionId the agent itself returned, and an option is only used for the
 * action its `kind` states.
 *
 *   approve        allow_once     "Aprobar"
 *   approveAlways  allow_always   "Aprobar siempre …"   (only when offered)
 *   reject         reject_once    "Rechazar y explicar"
 *   other          anything else (reject_always, unknown kinds) keeps its own
 *                  agent-supplied name so it is never silently dropped or
 *                  reinterpreted as a one-time answer.
 */

export type PermissionOptionLike = {
  optionId: string;
  name: string;
  kind: string;
};

export type PermissionChoices<T extends PermissionOptionLike = PermissionOptionLike> = {
  approve: T | undefined;
  approveAlways: T | undefined;
  reject: T | undefined;
  other: T[];
};

export function mapPermissionOptions<T extends PermissionOptionLike>(
  options: readonly T[]
): PermissionChoices<T> {
  const approve = options.find((o) => o.kind === 'allow_once');
  const approveAlways = options.find((o) => o.kind === 'allow_always');
  const reject = options.find((o) => o.kind === 'reject_once');
  const used = new Set([approve, approveAlways, reject]);
  return {
    approve,
    approveAlways,
    reject,
    other: options.filter((o) => !used.has(o)),
  };
}

/** Kind of action a permission request gates; drives the sheet title. */
export type PermissionActionKind =
  | 'execute'
  | 'edit'
  | 'read'
  | 'delete'
  | 'search'
  | 'fetch'
  | 'other';

const ACTION_PHRASE: Record<PermissionActionKind, string> = {
  execute: 'ejecutar un comando',
  edit: 'editar un archivo',
  read: 'leer un archivo',
  delete: 'eliminar un archivo',
  search: 'hacer una búsqueda',
  fetch: 'consultar una página web',
  other: 'usar una herramienta',
};

/** "Codex quiere ejecutar un comando". */
export function permissionSheetTitle(
  agentName: string | undefined,
  action: PermissionActionKind | undefined
): string {
  return `${agentName?.trim() || 'El agente'} quiere ${ACTION_PHRASE[action ?? 'other']}`;
}
