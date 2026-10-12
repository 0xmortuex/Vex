// A shortcut added in the shortcuts bar (Glass and the browser looks) keeps the
// site's logo by default, saved as color: "". The data contract refused an
// empty colour, so main refused the whole batch of settings it was in, and the
// batch, re-queued, was refused again on every later save: from the first such
// shortcut nothing changed in Vex reached disk (release check, 2026-10-11).
// An empty colour is "no colour", as the bar draws it.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { validatePayload } = require('../../src/main/ipc-policy.js');
const C = require('../../src/renderer/js/data-contracts.js');

const shortcuts = (list) => ['persist-apply', [[['vex.shortcuts', JSON.stringify(list)], ['vex.somethingElse', '1']]]];

describe('a shortcut with no colour of its own', () => {
  it('is saved, and so is everything saved with it', () => {
    const [channel, args] = shortcuts([{ url: 'https://example.com', name: 'Example', color: '' }]);
    expect(() => validatePayload(channel, args)).not.toThrow();
    expect(() => C.storage('shortcuts', [{ url: 'https://example.com', name: 'Example', color: '' }])).not.toThrow();
  });

  it('a colour that is not a colour is still refused', () => {
    const [channel, args] = shortcuts([{ url: 'https://example.com', name: 'Example', color: 'red;background:url(x)' }]);
    expect(() => validatePayload(channel, args)).toThrow(/Invalid color/);
    expect(() => C.storage('groups', [{ id: 'g', color: 'red" onclick="alert(1)' }])).toThrow();
  });
});
