import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { NormalizedEvent } from '@emdash/core/runtimes/acp/api';
import { AcpTranscriptParser } from '@emdash/core/runtimes/acp/api';
import { describe, expect, it } from 'vitest';
import { enrichClaudeUpdate, parseTaskNotification } from './acp-transform';

// ── fixtures ──────────────────────────────────────────────────────────────────

function makeToolCall(
  overrides: Partial<NormalizedEvent & { kind: 'tool_call' }> = {}
): NormalizedEvent {
  return {
    kind: 'tool_call',
    toolCallId: 'tc-1',
    title: 'Run bash',
    toolKind: 'execute',
    status: 'in_progress',
    parentToolCallId: null,
    diffs: [],
    ...overrides,
    locations: overrides.locations ?? [],
  };
}

function makeToolUpdate(
  overrides: Partial<NormalizedEvent & { kind: 'tool_update' }> = {}
): NormalizedEvent {
  return {
    kind: 'tool_update',
    toolCallId: 'tc-1',
    title: null,
    toolKind: null,
    status: 'completed',
    parentToolCallId: null,
    diffs: [],
    ...overrides,
  };
}

function makeRaw(meta?: Record<string, unknown>): SessionUpdate {
  return {
    sessionUpdate: 'tool_call',
    toolCallId: 'tc-1',
    title: 'Run bash',
    ...(meta !== undefined ? { _meta: meta } : {}),
  };
}

// ── enrichClaudeUpdate ────────────────────────────────────────────────────────

describe('enrichClaudeUpdate', () => {
  it('preserves start/update provenance and content continuity through Agent enrichment', () => {
    const p = new AcpTranscriptParser({
      conversationId: 'claude-stream',
      enrich: enrichClaudeUpdate,
    });
    const start: SessionUpdate = {
      sessionUpdate: 'tool_call',
      toolCallId: 'agent',
      title: 'Investigate',
      kind: 'other',
      status: 'in_progress',
      _meta: { claudeCode: { toolName: 'Agent' } },
    };
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'agent',
      status: 'completed',
      _meta: { claudeCode: { toolName: 'Agent' } },
    };
    expect(enrichClaudeUpdate(makeToolCall(), start)).toMatchObject({
      kind: 'subagent',
      operation: 'start',
    });
    expect(enrichClaudeUpdate(makeToolUpdate(), update)).toMatchObject({
      kind: 'subagent',
      operation: 'update',
    });
    p.push(start, 0);
    p.push({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hel' } }, 10);
    p.push(update, 20);
    p.push(
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'child',
        title: 'Read',
        kind: 'read',
        _meta: { claudeCode: { parentToolUseId: 'agent' } },
      },
      25
    );
    p.push({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'lo' } }, 30);
    expect(
      p.activeTurn?.items.filter((item) => item.kind === 'message').map((item) => item.text)
    ).toEqual(['hello']);
    p.endTurn(40);
    p.push(update, 50);
    expect(p.activeTurn).toBeNull();
    expect(p.agents[0].launchTurnId).toBe(p.history[0].id);
  });

  it('is identity for message kind', () => {
    const update: NormalizedEvent = {
      kind: 'message',
      role: 'assistant',
      messageId: 'assistant',
      text: 'hello',
    };
    const raw = makeRaw({ claudeCode: { parentToolUseId: 'parent-1' } });
    expect(enrichClaudeUpdate(update, raw)).toBe(update);
  });

  it('is identity for thinking kind', () => {
    const update: NormalizedEvent = { kind: 'thinking', messageId: 'main', text: 'thinking...' };
    const raw = makeRaw({ claudeCode: { parentToolUseId: 'parent-1' } });
    expect(enrichClaudeUpdate(update, raw)).toBe(update);
  });

  it('is identity for ignored kind', () => {
    const update: NormalizedEvent = { kind: 'ignored' };
    const raw = makeRaw({ claudeCode: { parentToolUseId: 'parent-1' } });
    expect(enrichClaudeUpdate(update, raw)).toBe(update);
  });

  it('is identity for tool_call when _meta is absent', () => {
    const update = makeToolCall();
    const raw = makeRaw();
    expect(enrichClaudeUpdate(update, raw)).toBe(update);
  });

  it('is identity for tool_call when claudeCode is absent', () => {
    const update = makeToolCall();
    const raw = makeRaw({ other: 'value' });
    expect(enrichClaudeUpdate(update, raw)).toBe(update);
  });

  it('is identity for tool_call when parentToolUseId is absent', () => {
    const update = makeToolCall();
    const raw = makeRaw({ claudeCode: { toolName: 'Bash' } });
    expect(enrichClaudeUpdate(update, raw)).toBe(update);
  });

  it('is identity for tool_call when parentToolUseId is not a string', () => {
    const update = makeToolCall();
    const raw = makeRaw({ claudeCode: { parentToolUseId: 42 } });
    expect(enrichClaudeUpdate(update, raw)).toBe(update);
  });

  it('promotes parentToolUseId to parentToolCallId on tool_call', () => {
    const update = makeToolCall();
    const raw = makeRaw({ claudeCode: { parentToolUseId: 'parent-abc' } });
    const result = enrichClaudeUpdate(update, raw);
    expect(result).not.toBe(update);
    expect(result).toMatchObject({ kind: 'tool_call', parentToolCallId: 'parent-abc' });
  });

  it('promotes parentToolUseId to parentToolCallId on tool_update', () => {
    const update = makeToolUpdate();
    const raw = makeRaw({ claudeCode: { parentToolUseId: 'parent-xyz' } });
    const result = enrichClaudeUpdate(update, raw);
    expect(result).not.toBe(update);
    expect(result).toMatchObject({ kind: 'tool_update', parentToolCallId: 'parent-xyz' });
  });

  it('uses rawOutput as Claude execute output fallback when standard content is absent', () => {
    const update = makeToolUpdate();
    const raw = {
      ...makeRaw({ claudeCode: { toolName: 'Bash' } }),
      rawOutput: 'hello from raw output',
    } as unknown as SessionUpdate;

    expect(enrichClaudeUpdate(update, raw)).toMatchObject({
      kind: 'tool_update',
      outputText: 'hello from raw output',
    });
  });

  it('does not overwrite standard outputText with Claude rawOutput', () => {
    const update = makeToolUpdate({ outputText: 'standard output' });
    const raw = {
      ...makeRaw({ claudeCode: { toolName: 'Bash' } }),
      rawOutput: 'raw output',
    } as unknown as SessionUpdate;

    expect(enrichClaudeUpdate(update, raw)).toBe(update);
  });

  it('removes a description echoed by Claude command metadata', () => {
    const command = 'git rev-parse --abbrev-ref HEAD';
    const description = 'Get current branch name';
    const update = makeToolUpdate({
      title: command,
      toolKind: 'execute',
      status: null,
      inputSummary: description,
      outputText: description,
    });
    const raw = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc-1',
      title: command,
      kind: 'execute',
      content: [{ type: 'content', content: { type: 'text', text: description } }],
      rawInput: { command, description },
    } as unknown as SessionUpdate;

    const result = enrichClaudeUpdate(update, raw);
    expect(result).toMatchObject({
      kind: 'tool_update',
      title: command,
      inputSummary: description,
    });
    expect(result).not.toHaveProperty('outputText');
  });

  it('preserves matching output outside Claude command metadata updates', () => {
    const description = 'Get current branch name';
    const update = makeToolUpdate({
      inputSummary: description,
      outputText: description,
    });
    const raw = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc-1',
      title: null,
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: description } }],
      rawInput: { description },
    } as unknown as SessionUpdate;

    expect(enrichClaudeUpdate(update, raw)).toBe(update);
  });

  it('preserves all other fields on tool_call when enriching', () => {
    const update = makeToolCall({ toolCallId: 'tc-99', title: 'Read file', toolKind: 'read' });
    const raw = makeRaw({ claudeCode: { parentToolUseId: 'parent-1' } });
    const result = enrichClaudeUpdate(update, raw);
    expect(result).toMatchObject({
      kind: 'tool_call',
      toolCallId: 'tc-99',
      title: 'Read file',
      toolKind: 'read',
    });
  });

  it('does not mutate the original update', () => {
    const update = makeToolCall();
    const raw = makeRaw({ claudeCode: { parentToolUseId: 'parent-42' } });
    enrichClaudeUpdate(update, raw);
    expect(update).toMatchObject({ kind: 'tool_call', parentToolCallId: null });
  });

  it('reclassifies Claude Agent tool calls as subagent events', () => {
    const update = makeToolCall({ title: 'Task', toolKind: 'think' });
    const raw = makeRaw({ claudeCode: { toolName: 'Agent' } });

    expect(enrichClaudeUpdate(update, raw)).toMatchObject({
      kind: 'subagent',
      toolCallId: 'tc-1',
      title: 'Task',
      status: 'in_progress',
      parentToolCallId: null,
    });
  });

  it('marks async-launched agents as running background subagents', () => {
    const update = makeToolUpdate({ title: null, status: 'completed' });
    const raw = makeRaw({
      claudeCode: {
        toolName: 'Agent',
        toolResponse: {
          isAsync: true,
          status: 'async_launched',
          agentId: 'agent-1',
          description: 'Find event parsing',
          outputFile: '/tmp/agent-1.output',
        },
      },
    });

    expect(enrichClaudeUpdate(update, raw)).toMatchObject({
      kind: 'subagent',
      agentId: 'agent-1',
      background: true,
      outputFile: '/tmp/agent-1.output',
      title: 'Find event parsing',
      status: 'in_progress',
    });
  });

  it('reclassifies task-notification user chunks as subagent updates', () => {
    const update: NormalizedEvent = {
      kind: 'message',
      role: 'user',
      messageId: 'u1',
      text: [
        '<task-notification>',
        '<task-id>agent-1</task-id>',
        '<tool-use-id>toolu_123</tool-use-id>',
        '<output-file>/tmp/agent-1.output</output-file>',
        '<status>completed</status>',
        '<summary>Agent "Find event parsing" finished</summary>',
        '</task-notification>',
      ].join('\n'),
    };

    expect(enrichClaudeUpdate(update, makeRaw())).toEqual({
      kind: 'subagent_update',
      agentId: 'agent-1',
      toolCallId: 'toolu_123',
      status: 'completed',
      summary: 'Agent "Find event parsing" finished',
      outputFile: '/tmp/agent-1.output',
    });
  });

  it('ignores local command pseudo-user chunks', () => {
    const update: NormalizedEvent = {
      kind: 'message',
      role: 'user',
      messageId: 'u1',
      text: '<command-name>/model</command-name>',
    };

    expect(enrichClaudeUpdate(update, makeRaw())).toEqual({ kind: 'ignored' });
  });

  it('reclassifies an async_task_spawned update as a background subagent start', () => {
    const raw = {
      sessionUpdate: 'async_task_spawned',
      asyncTaskId: 'task-1',
      name: 'Explore',
      taskType: 'local_agent',
      description: 'Explore the auth module',
      showInTranscript: true,
      canStop: true,
      outputFilePath: '/tmp/task-1.output',
      toolCallId: 'tc-launch',
    } as unknown as SessionUpdate;

    expect(enrichClaudeUpdate({ kind: 'ignored' }, raw)).toEqual({
      kind: 'subagent',
      operation: 'start',
      toolCallId: 'tc-launch',
      title: 'Explore the auth module',
      status: 'in_progress',
      parentToolCallId: null,
      background: true,
      agentId: 'task-1',
      outputFile: '/tmp/task-1.output',
    });
  });

  it('falls back to the task name and asyncTaskId when async_task_spawned omits description/toolCallId', () => {
    const raw = {
      sessionUpdate: 'async_task_spawned',
      asyncTaskId: 'task-2',
      name: 'Background task',
    } as unknown as SessionUpdate;

    expect(enrichClaudeUpdate({ kind: 'ignored' }, raw)).toMatchObject({
      kind: 'subagent',
      toolCallId: 'task-2',
      title: 'Background task',
      agentId: 'task-2',
    });
  });

  it('reclassifies async_task_progress as an in-progress subagent_update carrying metadata', () => {
    const raw = {
      sessionUpdate: 'async_task_progress',
      asyncTaskId: 'task-1',
      toolCallId: 'tc-launch',
      outputFilePath: '/tmp/task-1.output',
      summary: 'Still exploring',
    } as unknown as SessionUpdate;

    expect(enrichClaudeUpdate({ kind: 'ignored' }, raw)).toEqual({
      kind: 'subagent_update',
      agentId: 'task-1',
      toolCallId: 'tc-launch',
      status: 'in_progress',
      summary: 'Still exploring',
      outputFile: '/tmp/task-1.output',
    });
  });

  it.each([
    ['completed', 'completed'],
    ['failed', 'failed'],
    // The adapter already collapses killed/cancelled/stopped to "stopped"
    // before publishing async_task_state_update (see async-tasks.js
    // taskState()); emdash has no "stopped" AgentStatus, so it maps to failed.
    ['stopped', 'failed'],
  ] as const)(
    'reclassifies async_task_state_update state %s as subagent_update status %s',
    (state, status) => {
      const raw = {
        sessionUpdate: 'async_task_state_update',
        asyncTaskId: 'task-1',
        toolCallId: 'tc-launch',
        state,
        summary: 'Done exploring',
        outputFilePath: '/tmp/task-1.output',
      } as unknown as SessionUpdate;

      expect(enrichClaudeUpdate({ kind: 'ignored' }, raw)).toEqual({
        kind: 'subagent_update',
        agentId: 'task-1',
        toolCallId: 'tc-launch',
        status,
        summary: 'Done exploring',
        outputFile: '/tmp/task-1.output',
      });
    }
  );

  it('settles a background agent launched via the Agent tool once async_task_state_update arrives', () => {
    const p = new AcpTranscriptParser({
      conversationId: 'claude-stream',
      enrich: enrichClaudeUpdate,
    });

    p.push(
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'tc-launch',
        title: 'Agent',
        kind: 'other',
        status: 'completed',
        _meta: {
          claudeCode: {
            toolName: 'Agent',
            toolResponse: {
              isAsync: true,
              status: 'async_launched',
              agentId: 'task-1',
              description: 'Explore the auth module',
              outputFile: '/tmp/task-1.output',
            },
          },
        },
      },
      0
    );
    expect(p.agents[0]).toMatchObject({ agentId: 'task-1', status: 'running', background: true });

    p.push(
      {
        sessionUpdate: 'async_task_state_update',
        asyncTaskId: 'task-1',
        toolCallId: 'tc-launch',
        state: 'completed',
        summary: 'Explored the auth module',
      } as unknown as SessionUpdate,
      10
    );

    expect(p.agents[0]).toMatchObject({
      agentId: 'task-1',
      status: 'completed',
      summary: 'Explored the auth module',
    });
  });

  it("nests a background agent's own tool calls under its launch node across a turn boundary", () => {
    const p = new AcpTranscriptParser({
      conversationId: 'claude-stream',
      enrich: enrichClaudeUpdate,
    });

    // Turn 1: the user asks for help, the model launches a background agent.
    p.push(
      {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'explore the auth module' },
      },
      0
    );
    p.push(
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'tc-launch',
        title: 'Agent',
        kind: 'other',
        status: 'completed',
        _meta: {
          claudeCode: {
            toolName: 'Agent',
            toolResponse: {
              isAsync: true,
              status: 'async_launched',
              agentId: 'task-1',
              description: 'Explore the auth module',
            },
          },
        },
      },
      10
    );
    p.endTurn(20);

    // Turn 2: a new user message opens a second turn while the agent is still running.
    p.push(
      {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'anything else running?' },
      },
      30
    );

    // The background agent's own tool call arrives, parented to the launch tool call —
    // the adapter streams child activity onto the same session regardless of turn.
    p.push(
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'tc-child-1',
        title: 'Read auth.ts',
        kind: 'read',
        status: 'completed',
        _meta: { claudeCode: { parentToolUseId: 'tc-launch' } },
      },
      40
    );

    const launchTurn = p.history[0];
    const launchNode = launchTurn.items.find(
      (item) => 'toolCallId' in item && item.toolCallId === 'tc-launch'
    );
    expect(launchNode).toMatchObject({ kind: 'spawn-subagent-tool-call', agentId: 'task-1' });
    expect(launchNode && 'children' in launchNode ? launchNode.children : undefined).toMatchObject([
      { toolCallId: 'tc-child-1', title: 'Read auth.ts' },
    ]);

    // Settling the agent updates the launch node's own status too.
    p.push(
      {
        sessionUpdate: 'async_task_state_update',
        asyncTaskId: 'task-1',
        toolCallId: 'tc-launch',
        state: 'completed',
      } as unknown as SessionUpdate,
      50
    );
    const settledLaunchNode = p.history[0].items.find(
      (item) => 'toolCallId' in item && item.toolCallId === 'tc-launch'
    );
    expect(settledLaunchNode).toMatchObject({ status: 'done' });
  });
});

describe('parseTaskNotification', () => {
  it('extracts the stable notification fields without parsing the result body', () => {
    expect(
      parseTaskNotification(
        [
          '<task-notification>',
          '<task-id>agent-1</task-id>',
          '<tool-use-id>toolu_123</tool-use-id>',
          '<output-file>/tmp/agent-1.output</output-file>',
          '<status>completed</status>',
          '<summary>Background command "Search & report" completed</summary>',
          '<result>May contain <xml-like> text and markdown.</result>',
          '</task-notification>',
        ].join('\n')
      )
    ).toEqual({
      taskId: 'agent-1',
      toolUseId: 'toolu_123',
      outputFile: '/tmp/agent-1.output',
      status: 'completed',
      summary: 'Background command "Search & report" completed',
    });
  });
});
