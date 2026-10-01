import { describe, expect, it, vi } from 'vitest';
import {
  FakeAcpAgent,
  makeAcpHarness,
  makeStartInput,
  testPluginHost,
} from '#runtimes/acp/node/acp-test-support';
import { AcpRuntime } from './runtime';

const usageLimitError = {
  message: 'Internal error',
  data: {
    codexErrorInfo: 'usageLimitExceeded',
    message:
      "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Oct 3rd, 2099 2:10 PM.",
  },
};

function makeCodexHarness(codexFallbackHome: string | undefined) {
  const agent = new FakeAcpAgent();
  const acpBehavior = {
    buildSpawn: () => ({ command: '/fake/node', args: ['codex-agent.js'], env: {} }),
    connect: agent.behavior.connect,
  };
  const h = makeAcpHarness({
    agentHost: testPluginHost({
      providerId: 'codex',
      acpBehavior,
      authProvider: { name: 'Codex', auth: { kind: 'none' } },
    }),
    codexFallbackHome,
  });
  // makeAcpHarness builds its own FakeAcpAgent internally; override with ours so the
  // agentHost (bound to `acpBehavior.connect`) and the harness agree on which instance
  // `h.agent` observes.
  return { h, agent };
}

describe('Codex usage-limit failover', () => {
  it('relaunches the conversation on the fallback CODEX_HOME and resends the failed prompt', async () => {
    const { h, agent } = makeCodexHarness('/fake/codex-fallback-home');
    agent.prompt
      .mockRejectedValueOnce(usageLimitError)
      .mockResolvedValueOnce({ stopReason: 'end_turn' });

    const spawnEnvs: Array<Record<string, string>> = [];
    const originalSpawn = h.fakeHost.spawn.bind(h.fakeHost);
    h.fakeHost.spawn = async (spec) => {
      spawnEnvs.push(spec.env);
      return originalSpawn(spec);
    };

    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-codex', providerId: 'codex' });
    await rt.launchSession(input);
    expect(h.children).toHaveLength(1);

    const sendResult = await rt.sendPrompt('conv-codex', { text: 'hello' });
    expect(sendResult).toMatchObject({ success: true });

    // The failover (stop + relaunch + resend) runs fire-and-forget off the catch block;
    // wait for it to settle a second spawned process and a second prompt attempt.
    await vi.waitFor(() => {
      expect(h.children).toHaveLength(2);
      expect(agent.loadSession).toHaveBeenCalledTimes(1);
      expect(agent.prompt).toHaveBeenCalledTimes(2);
    });

    expect(agent.loadSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1' })
    );
    expect(spawnEnvs[1]).toMatchObject({ CODEX_HOME: '/fake/codex-fallback-home' });
    // The resent prompt carries the original text.
    expect(agent.prompt.mock.calls[1][0]).toMatchObject({
      prompt: [{ type: 'text', text: 'hello' }],
    });

    await rt.dispose();
  });

  it('surfaces the error normally when no fallback home is configured', async () => {
    const { h, agent } = makeCodexHarness(undefined);
    agent.prompt.mockRejectedValueOnce(usageLimitError);

    const rt = new AcpRuntime(h.deps);
    await rt.launchSession(makeStartInput({ conversationId: 'conv-codex', providerId: 'codex' }));
    expect(h.children).toHaveLength(1);

    const sendResult = await rt.sendPrompt('conv-codex', { text: 'hello' });
    expect(sendResult).toMatchObject({ success: true });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.children).toHaveLength(1);
    expect(agent.loadSession).not.toHaveBeenCalled();

    await rt.dispose();
  });
});
