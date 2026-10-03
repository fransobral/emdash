import { describe, expect, it } from 'vitest';
import {
  boundHistoryPageToBudget,
  HISTORY_PAGE_BYTE_BUDGET,
  ITEM_TRUNCATION_HEAD_BYTES,
  ITEM_TRUNCATION_TAIL_BYTES,
  ITEM_TRUNCATION_THRESHOLD_BYTES,
  truncateText,
  truncateTranscriptTurn,
  truncateTranscriptTurns,
} from './truncate';
import type { TranscriptTurn } from './turn';

function executeTurn(seq: number, outputText: string): TranscriptTurn {
  return {
    id: `turn-${seq}`,
    seq,
    initiator: 'user',
    items: [
      {
        kind: 'execute-tool-call',
        id: `item-${seq}`,
        seq: 0,
        toolCallId: `tool-${seq}`,
        title: 'run command',
        status: 'done',
        outputText,
      },
    ],
  };
}

describe('truncateText', () => {
  it('leaves short text untouched', () => {
    const result = truncateText('hello world');
    expect(result).toEqual({ text: 'hello world', truncated: false });
  });

  it('truncates text over the byte threshold to a head/tail window with a marker', () => {
    const big = 'a'.repeat(ITEM_TRUNCATION_THRESHOLD_BYTES + 1000);
    const result = truncateText(big);

    expect(result.truncated).toBe(true);
    expect(result.text).toContain('omitidos');
    expect(result.text.startsWith('a'.repeat(10))).toBe(true);
    expect(result.text.endsWith('a'.repeat(10))).toBe(true);
    // Bounded well under the original size.
    expect(result.text.length).toBeLessThan(
      ITEM_TRUNCATION_HEAD_BYTES + ITEM_TRUNCATION_TAIL_BYTES + 200
    );
  });
});

describe('truncateTranscriptTurn', () => {
  it('does not mutate or flag items under the threshold', () => {
    const turn = executeTurn(1, 'small output');
    const result = truncateTranscriptTurn(turn);
    expect(result.items[0]).toEqual(turn.items[0]);
  });

  it('truncates an oversized tool-call outputText and marks the item truncated', () => {
    const big = 'x'.repeat(ITEM_TRUNCATION_THRESHOLD_BYTES * 2);
    const turn = executeTurn(1, big);
    const result = truncateTranscriptTurn(turn);
    const item = result.items[0] as { outputText?: string; truncated?: boolean };

    expect(item.truncated).toBe(true);
    expect(item.outputText?.length).toBeLessThan(big.length);
    // The turn itself is not marked itemsTruncated — no items were dropped, only shrunk.
    expect(result.itemsTruncated).toBeUndefined();
  });
});

describe('verifying the bug hypothesis: an unbounded turn exceeds the wire frame cap', () => {
  it('a turn with many large tool outputs serializes far past the 16 MiB wire frame cap', () => {
    const MAX_FRAME_BYTES = 16 * 1024 * 1024;
    const bigOutput = 'y'.repeat(50 * 1024); // 50 KB, like real oversized tool output
    const turn: TranscriptTurn = {
      id: 'giant-turn',
      seq: 1,
      initiator: 'agent',
      items: Array.from({ length: 1800 }, (_, i) => ({
        kind: 'execute-tool-call' as const,
        id: `item-${i}`,
        seq: i,
        toolCallId: `tool-${i}`,
        title: 'run command',
        status: 'done' as const,
        outputText: bigOutput,
      })),
    };

    const rawSize = Buffer.byteLength(JSON.stringify([turn]), 'utf8');
    expect(rawSize).toBeGreaterThan(MAX_FRAME_BYTES);

    // After per-item truncation and page budgeting, it must fit the page budget
    // (and therefore comfortably under the wire frame cap).
    const truncated = truncateTranscriptTurns([turn]);
    const { turns: bounded } = boundHistoryPageToBudget(truncated);
    const boundedSize = Buffer.byteLength(JSON.stringify(bounded), 'utf8');
    expect(boundedSize).toBeLessThanOrEqual(HISTORY_PAGE_BYTE_BUDGET);
    expect(boundedSize).toBeLessThan(MAX_FRAME_BYTES);
  });
});

describe('boundHistoryPageToBudget', () => {
  it('returns small pages unchanged', () => {
    const turns = [executeTurn(1, 'a'), executeTurn(2, 'b')];
    const result = boundHistoryPageToBudget(turns);
    expect(result).toEqual({ turns, droppedOldestTurnCount: 0 });
  });

  it('drops the oldest turns first when the page exceeds the byte budget', () => {
    const bigOutput = 'z'.repeat(ITEM_TRUNCATION_THRESHOLD_BYTES - 100);
    // Each turn alone fits under the threshold (no per-item truncation), but together
    // several turns exceed a small budget.
    const turns = [executeTurn(1, bigOutput), executeTurn(2, bigOutput), executeTurn(3, bigOutput)];
    const budget = Buffer.byteLength(JSON.stringify(turns.slice(1)), 'utf8');

    const result = boundHistoryPageToBudget(turns, budget);

    expect(result.droppedOldestTurnCount).toBe(1);
    expect(result.turns.map((t) => t.seq)).toEqual([2, 3]);
  });

  it('trims the oldest items of a single oversized turn instead of dropping it', () => {
    const bigOutput = 'q'.repeat(ITEM_TRUNCATION_THRESHOLD_BYTES - 100);
    const turn: TranscriptTurn = {
      id: 'solo-turn',
      seq: 1,
      initiator: 'agent',
      items: Array.from({ length: 10 }, (_, i) => ({
        kind: 'execute-tool-call' as const,
        id: `item-${i}`,
        seq: i,
        toolCallId: `tool-${i}`,
        title: 'run command',
        status: 'done' as const,
        outputText: bigOutput,
      })),
    };
    // Budget fits roughly 3 items worth of this turn.
    const budget = bigOutput.length * 3 + 2000;

    const result = boundHistoryPageToBudget([turn], budget);

    expect(result.droppedOldestTurnCount).toBe(0);
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]?.itemsTruncated).toBe(true);
    expect(result.turns[0]?.items.length).toBeLessThan(10);
    // Keeps the most recent items (highest seq), drops the oldest.
    const keptSeqs = result.turns[0]?.items.map((item) => item.seq) ?? [];
    expect(Math.min(...keptSeqs)).toBeGreaterThan(0);
  });

  it('returns an empty page for an empty input', () => {
    expect(boundHistoryPageToBudget([])).toEqual({ turns: [], droppedOldestTurnCount: 0 });
  });
});
