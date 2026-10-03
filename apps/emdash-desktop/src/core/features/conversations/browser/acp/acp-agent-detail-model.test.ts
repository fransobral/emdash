import type { ToolNode, TranscriptTurn } from '@emdash/core/runtimes/acp/api/client';
import { describe, expect, it } from 'vitest';
import { deriveAgentActivity } from './acp-agent-detail-model';

function turn(items: TranscriptTurn['items']): TranscriptTurn {
  return { id: 'turn-1', seq: 0, initiator: 'user', items };
}

function launchNode(children: ToolNode[]): TranscriptTurn['items'][number] {
  return {
    id: 'turn-1:tool:tc-launch',
    seq: 0,
    toolCallId: 'tc-launch',
    title: 'Explore the auth module',
    status: 'running',
    kind: 'spawn-subagent-tool-call',
    name: 'Explore the auth module',
    background: true,
    agentId: 'task-1',
    children,
  };
}

describe('deriveAgentActivity', () => {
  it('is unavailable when there is no active turn', () => {
    expect(deriveAgentActivity(null, 'turn-1', 'tc-launch')).toEqual({
      available: false,
      rows: [],
    });
  });

  it('is unavailable when the agent was not launched in the current active turn', () => {
    const activeTurn = turn([launchNode([])]);
    expect(deriveAgentActivity(activeTurn, 'turn-0', 'tc-launch')).toEqual({
      available: false,
      rows: [],
    });
  });

  it('is available with no rows when the launch node has no children yet', () => {
    const activeTurn = turn([launchNode([])]);
    expect(deriveAgentActivity(activeTurn, 'turn-1', 'tc-launch')).toEqual({
      available: true,
      rows: [],
    });
  });

  it('flattens the launch node children into seq-ordered activity rows', () => {
    const activeTurn = turn([
      launchNode([
        {
          id: 'child-2',
          seq: 2,
          toolCallId: 'tc-child-2',
          title: 'Run grep',
          status: 'done',
          kind: 'execute-tool-call',
        },
        {
          id: 'child-1',
          seq: 1,
          toolCallId: 'tc-child-1',
          title: 'Read auth.ts',
          status: 'done',
          kind: 'read-tool-call',
        },
      ]),
    ]);

    expect(deriveAgentActivity(activeTurn, 'turn-1', 'tc-launch')).toEqual({
      available: true,
      rows: [
        { id: 'child-1', title: 'Read auth.ts', status: 'done', kindLabel: 'Read' },
        { id: 'child-2', title: 'Run grep', status: 'done', kindLabel: 'Shell' },
      ],
    });
  });

  it('flattens nested tool groups and nested children', () => {
    const activeTurn = turn([
      launchNode([
        {
          kind: 'tool-group',
          id: 'group-1',
          seq: 1,
          label: 'Reading files',
          groupKind: 'read-batch',
          status: 'done',
          children: [
            {
              id: 'child-1',
              seq: 1,
              toolCallId: 'tc-child-1',
              title: 'Read auth.ts',
              status: 'done',
              kind: 'read-tool-call',
              children: [
                {
                  id: 'grandchild-1',
                  seq: 2,
                  toolCallId: 'tc-grandchild-1',
                  title: 'Search TODO',
                  status: 'running',
                  kind: 'search-tool-call',
                  query: 'TODO',
                },
              ],
            },
          ],
        },
      ]),
    ]);

    expect(deriveAgentActivity(activeTurn, 'turn-1', 'tc-launch').rows).toEqual([
      { id: 'child-1', title: 'Read auth.ts', status: 'done', kindLabel: 'Read' },
      { id: 'grandchild-1', title: 'Search TODO', status: 'running', kindLabel: 'Search' },
    ]);
  });

  it('is available with no rows when the launch node cannot be found', () => {
    const activeTurn = turn([]);
    expect(deriveAgentActivity(activeTurn, 'turn-1', 'tc-launch')).toEqual({
      available: true,
      rows: [],
    });
  });
});
