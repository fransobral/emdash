import { describe, expect, it } from 'vitest';
import { mapPermissionOptions, permissionSheetTitle } from './permission-options';

const opt = (optionId: string, kind: string, name = optionId) => ({ optionId, name, kind });

describe('mapPermissionOptions', () => {
  it('maps the standard four ACP kinds to their actions', () => {
    const options = [
      opt('a1', 'allow_once'),
      opt('a2', 'allow_always', 'Always allow git push'),
      opt('r1', 'reject_once'),
      opt('r2', 'reject_always'),
    ];
    const choices = mapPermissionOptions(options);
    expect(choices.approve?.optionId).toBe('a1');
    expect(choices.approveAlways?.optionId).toBe('a2');
    expect(choices.reject?.optionId).toBe('r1');
    expect(choices.other.map((o) => o.optionId)).toEqual(['r2']);
  });

  it('omits "approve always" when the agent did not offer it', () => {
    const choices = mapPermissionOptions([opt('a1', 'allow_once'), opt('r1', 'reject_once')]);
    expect(choices.approveAlways).toBeUndefined();
    expect(choices.other).toEqual([]);
  });

  it('never promotes allow_always to the one-time approve button', () => {
    const choices = mapPermissionOptions([opt('a2', 'allow_always'), opt('r1', 'reject_once')]);
    expect(choices.approve).toBeUndefined();
    expect(choices.approveAlways?.optionId).toBe('a2');
  });

  it('never presents reject_always as the one-time reject', () => {
    const choices = mapPermissionOptions([opt('a1', 'allow_once'), opt('r2', 'reject_always')]);
    expect(choices.reject).toBeUndefined();
    expect(choices.other.map((o) => o.optionId)).toEqual(['r2']);
  });

  it('keeps unknown kinds as extra options instead of dropping them', () => {
    const choices = mapPermissionOptions([opt('x', 'something_new'), opt('a1', 'allow_once')]);
    expect(choices.other.map((o) => o.optionId)).toEqual(['x']);
  });

  it('only ever returns optionIds that were offered', () => {
    const offered = [opt('a1', 'allow_once'), opt('r1', 'reject_once'), opt('z', 'weird')];
    const c = mapPermissionOptions(offered);
    const returned = [c.approve, c.approveAlways, c.reject, ...c.other]
      .filter((o) => o !== undefined)
      .map((o) => o.optionId);
    expect(returned.sort()).toEqual(['a1', 'r1', 'z']);
  });
});

describe('permissionSheetTitle', () => {
  it('names the agent and the action', () => {
    expect(permissionSheetTitle('Codex', 'execute')).toBe('Codex quiere ejecutar un comando');
    expect(permissionSheetTitle('Claude', 'edit')).toBe('Claude quiere editar un archivo');
  });

  it('falls back to a generic subject and action', () => {
    expect(permissionSheetTitle(undefined, undefined)).toBe(
      'El agente quiere usar una herramienta'
    );
    expect(permissionSheetTitle('  ', 'read')).toBe('El agente quiere leer un archivo');
  });
});
