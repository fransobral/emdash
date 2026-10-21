import { describe, expect, it } from 'vitest';
import { makeAcpHarness, makeStartInput } from '#runtimes/acp/node/acp-test-support';
import { AcpRuntime } from './runtime';

describe('ACP session reset', () => {
  it('restarts the conversation on a fresh provider session instead of resuming', async () => {
    const h = makeAcpHarness();
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-reset' });
    await rt.launchSession(input);
    h.agent.newSession.mockResolvedValueOnce({ sessionId: 'session-2' });
    h.agent.prompt.mockClear();

    const reset = await rt.resetSession('conv-reset');

    expect(reset).toEqual({ success: true, data: { sessionId: 'session-2' } });
    expect(h.agent.newSession).toHaveBeenCalledTimes(2);
    expect(h.agent.loadSession).not.toHaveBeenCalled();

    await rt.sendPrompt('conv-reset', { text: 'after reset' });
    expect(h.agent.prompt).toHaveBeenCalledWith({
      sessionId: 'session-2',
      prompt: [{ type: 'text', text: 'after reset' }],
    });
    await rt.dispose();
  });

  it('does not let a stale host session id revive the old session after a reset', async () => {
    const h = makeAcpHarness();
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-stale' });
    await rt.launchSession(input);
    h.agent.newSession.mockResolvedValueOnce({ sessionId: 'session-2' });
    await rt.resetSession('conv-stale');

    // The host record still reports the pre-reset id until its report converges.
    await rt.attachSession({ ...input, sessionId: 'session-1' });
    await rt.stopSession('conv-stale');
    await rt.sendPrompt('conv-stale', { text: 'wake' });

    expect(h.agent.loadSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-2' })
    );
    await rt.dispose();
  });

  it('reports an invalid state for a conversation that is not attached', async () => {
    const h = makeAcpHarness();
    const rt = new AcpRuntime(h.deps);

    const reset = await rt.resetSession('conv-missing');

    expect(reset).toMatchObject({ success: false, error: { type: 'invalid_state' } });
    await rt.dispose();
  });
});
