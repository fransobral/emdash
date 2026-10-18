/** Copy and list-capping for the compact "files changed" card (pure, no Solid). */

import type { TurnChangeFile } from '@/model';

export const MAX_VISIBLE_CHANGE_FILES = 3;

export const TURN_CHANGES_COPY = {
  title: (n: number) => (n === 1 ? '1 archivo cambiado' : `${n} archivos cambiados`),
  more: (n: number) => `y ${n} más`,
  view: 'Ver cambios',
} as const;

/** Files shown on the card, how many were folded into "y N más", and total rows drawn. */
export function visibleChangeFiles(files: readonly TurnChangeFile[]): {
  files: TurnChangeFile[];
  hidden: number;
  rowCount: number;
} {
  const shown = files.slice(0, MAX_VISIBLE_CHANGE_FILES);
  const hidden = files.length - shown.length;
  return { files: shown, hidden, rowCount: shown.length + (hidden > 0 ? 1 : 0) };
}
