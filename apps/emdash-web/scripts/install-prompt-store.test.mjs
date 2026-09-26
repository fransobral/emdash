import assert from 'node:assert/strict';
import test from 'node:test';

test('captures an install prompt before the React app mounts', async () => {
  const handlers = new Map();
  globalThis.window = {
    addEventListener(type, handler) {
      handlers.set(type, handler);
    },
  };

  const store = await import(`../web/install-prompt-store.ts?test=${Date.now()}`);
  const prompt = {
    preventDefaultCalled: false,
    preventDefault() {
      this.preventDefaultCalled = true;
    },
  };
  handlers.get('beforeinstallprompt')(prompt);

  let observed = null;
  store.subscribeInstallPrompt((value) => {
    observed = value;
  });

  assert.equal(prompt.preventDefaultCalled, true);
  assert.equal(observed, prompt);
});
