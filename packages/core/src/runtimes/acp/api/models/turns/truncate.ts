import type { ToolNode } from './tool-calls';
import type { TranscriptItem, TranscriptTurn } from './turn';

/** Text fields at or under this byte size are left untouched. */
export const ITEM_TRUNCATION_THRESHOLD_BYTES = 32 * 1024;
/** Bytes kept from the start of a truncated text field. */
export const ITEM_TRUNCATION_HEAD_BYTES = 8 * 1024;
/** Bytes kept from the end of a truncated text field. */
export const ITEM_TRUNCATION_TAIL_BYTES = 8 * 1024;

/** Default serialized size budget for a single history page sent over Wire. */
export const HISTORY_PAGE_BYTE_BUDGET = 4 * 1024 * 1024;

const textEncoder = new TextEncoder();

function byteLength(text: string): number {
  return textEncoder.encode(text).length;
}

/** Truncates `text` to a head/tail window with a marker when it exceeds the byte threshold. */
export function truncateText(text: string): { text: string; truncated: boolean } {
  const size = byteLength(text);
  if (size <= ITEM_TRUNCATION_THRESHOLD_BYTES) return { text, truncated: false };

  const encoded = textEncoder.encode(text);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const head = decoder.decode(encoded.subarray(0, ITEM_TRUNCATION_HEAD_BYTES));
  const tail = decoder.decode(encoded.subarray(encoded.length - ITEM_TRUNCATION_TAIL_BYTES));
  const omittedBytes = size - ITEM_TRUNCATION_HEAD_BYTES - ITEM_TRUNCATION_TAIL_BYTES;
  const omittedKb = Math.max(1, Math.round(omittedBytes / 1024));
  return {
    text: `${head}\n… [${omittedKb} KB omitidos] …\n${tail}`,
    truncated: true,
  };
}

/** Truncates the oversized text fields of a single tool node, recursing into children. */
export function truncateToolNode(node: ToolNode): ToolNode {
  if (node.kind === 'tool-group') {
    return { ...node, children: node.children.map(truncateToolNode) };
  }

  let truncated = false;
  const next = { ...node };
  if (next.children) next.children = next.children.map(truncateToolNode);

  switch (next.kind) {
    case 'execute-tool-call': {
      if (next.outputText !== undefined) {
        const result = truncateText(next.outputText);
        next.outputText = result.text;
        truncated = truncated || result.truncated;
      }
      break;
    }
    case 'create-file-tool-call': {
      const result = truncateText(next.content);
      next.content = result.text;
      truncated = truncated || result.truncated;
      break;
    }
    case 'modify-file-tool-call': {
      const oldResult = truncateText(next.oldText);
      next.oldText = oldResult.text;
      const newResult = truncateText(next.newText);
      next.newText = newResult.text;
      truncated = truncated || oldResult.truncated || newResult.truncated;
      break;
    }
    default:
      break;
  }

  return truncated ? { ...next, truncated: true } : next;
}

/** Truncates the oversized text fields of a single transcript item. */
export function truncateTranscriptItem(item: TranscriptItem): TranscriptItem {
  if (item.kind === 'message') {
    const result = truncateText(item.text);
    return result.truncated ? { ...item, text: result.text, truncated: true } : item;
  }
  if (item.kind === 'thinking') {
    const result = truncateText(item.text);
    return result.truncated ? { ...item, text: result.text, truncated: true } : item;
  }
  return truncateToolNode(item);
}

/** Truncates the oversized text fields of every item in a turn. Does not drop items. */
export function truncateTranscriptTurn(turn: TranscriptTurn): TranscriptTurn {
  return { ...turn, items: turn.items.map(truncateTranscriptItem) };
}

/** Truncates the oversized text fields of every item in every turn. Does not drop turns. */
export function truncateTranscriptTurns(turns: readonly TranscriptTurn[]): TranscriptTurn[] {
  return turns.map(truncateTranscriptTurn);
}

function serializedByteLength(value: unknown): number {
  return byteLength(JSON.stringify(value));
}

/**
 * Drops the oldest items of an already-truncated turn until it fits the byte budget.
 * Sizes every item exactly once and tracks a running total, instead of re-serializing
 * the whole remaining item list on every dropped item (which is quadratic in item count
 * and was observed to hang on turns with thousands of items).
 */
function trimTurnItemsToBudget(turn: TranscriptTurn, budgetBytes: number): TranscriptTurn {
  const itemSizes = turn.items.map(serializedByteLength);
  const turnOverheadBytes = serializedByteLength({ ...turn, items: [] });
  let startIndex = 0;
  let total = turnOverheadBytes + itemSizes.reduce((sum, size) => sum + size, 0);
  while (turn.items.length - startIndex > 1 && total > budgetBytes) {
    total -= itemSizes[startIndex]!;
    startIndex += 1;
  }
  return { ...turn, items: turn.items.slice(startIndex), itemsTruncated: true };
}

export interface BoundedHistoryPage {
  /** Turns kept within the byte budget, oldest first. */
  turns: TranscriptTurn[];
  /** Number of turns dropped from the front (oldest end) of the input to fit the budget. */
  droppedOldestTurnCount: number;
}

/**
 * Bounds an already item-truncated, ascending-by-seq list of turns to a serialized byte
 * budget. Drops whole turns from the oldest end first; if a single remaining turn still
 * exceeds the budget on its own, trims that turn's oldest items and marks it partial via
 * `itemsTruncated` instead of dropping it, so the page always stays under budget.
 *
 * Sizes are summed from a per-turn size computed once each, not from re-serializing the
 * whole remaining array on every drop, to stay linear in the input size.
 */
export function boundHistoryPageToBudget(
  turns: readonly TranscriptTurn[],
  budgetBytes: number = HISTORY_PAGE_BYTE_BUDGET
): BoundedHistoryPage {
  if (turns.length === 0) return { turns: [], droppedOldestTurnCount: 0 };

  const turnSizes = turns.map(serializedByteLength);
  let startIndex = 0;
  let total = turnSizes.reduce((sum, size) => sum + size, 0);
  while (turns.length - startIndex > 1 && total > budgetBytes) {
    total -= turnSizes[startIndex]!;
    startIndex += 1;
  }

  const kept = turns.slice(startIndex);
  const [onlyTurn] = kept;
  const bounded =
    kept.length === 1 && onlyTurn && total > budgetBytes
      ? [trimTurnItemsToBudget(onlyTurn, budgetBytes)]
      : [...kept];

  return { turns: bounded, droppedOldestTurnCount: startIndex };
}
