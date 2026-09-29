import { peek } from '@emdash/wire/state';
import { describe, expect, it } from 'vitest';
import { makeAcpHarness, makeStartInput } from '#runtimes/acp/node/acp-test-support';
import { AcpRuntime } from './runtime';

/** The ACP SDK dispatches notifications through several awaits but settles responses at once. */
async function lagMicrotasks(count: number): Promise<void> {
  for (let i = 0; i < count; i++) await Promise.resolve();
}

describe('session load replay ordering', () => {
  it('keeps history notifications that settle after the load response inside the replay', async () => {
    const h = makeAcpHarness();
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-big-history', sessionId: 'original' });
    h.agent.loadSession.mockImplementationOnce(async () => {
      const client = h.client();
      // History sent before the response, still in flight when the response lands.
      void (async () => {
        await lagMicrotasks(50);
        await client.sessionUpdate({
          sessionId: 'original',
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'replayed-tool',
            title: 'Edit GOAL.md',
            status: 'in_progress',
            kind: 'edit',
          },
        });
      })();
      return {};
    });

    expect((await rt.launchSession(input)).success).toBe(true);
    await lagMicrotasks(100);

    const live = rt.sessionLiveModels(input.conversationId)!;
    expect(peek(live.states.state)).toMatchObject({ agentTurnActive: false, isGenerating: false });
    await rt.dispose();
  });
});
