// @vitest-environment jsdom
//
// Personas are user data that flow straight into an AI request. create()/update()
// used to copy whatever was handed in, so an imported file (or a hand-edited
// localStorage entry) could set temperature:"hot" — which the model rejects with
// an opaque error — or a system prompt of unbounded length. importPersonas also
// reported "Imported 0 personas" as a success.

import { describe, it, expect, beforeEach } from 'vitest';

const { PersonasManager } = require('../../src/renderer/js/personas-manager.js');
const { BUILT_IN_PERSONAS } = require('../../src/renderer/js/personas-builtin.js');

beforeEach(() => {
  localStorage.clear();
  globalThis.window.BUILT_IN_PERSONAS = BUILT_IN_PERSONAS;
  PersonasManager.init();
});

describe('persona field validation', () => {
  it('coerces a non-numeric temperature to the default', () => {
    expect(PersonasManager.create({ name: 'T', systemPrompt: 'p', temperature: 'hot' }).temperature).toBe(0.7);
  });

  it('clamps temperature into 0..1', () => {
    expect(PersonasManager.create({ name: 'A', systemPrompt: 'p', temperature: 5 }).temperature).toBe(1);
    expect(PersonasManager.create({ name: 'B', systemPrompt: 'p', temperature: -3 }).temperature).toBe(0);
    expect(PersonasManager.create({ name: 'C', systemPrompt: 'p', temperature: '0.35' }).temperature).toBe(0.35);
  });

  it('caps name and system prompt length', () => {
    const p = PersonasManager.create({ name: 'n'.repeat(500), systemPrompt: 's'.repeat(50000) });
    expect(p.name.length).toBeLessThanOrEqual(60);
    expect(p.systemPrompt.length).toBeLessThanOrEqual(8000);
  });

  it('keeps at most five string quick prompts', () => {
    const p = PersonasManager.create({
      name: 'Q', systemPrompt: 'p',
      quickPrompts: ['a', 'b', 'c', 'd', 'e', 'f', 42, null, '   '],
    });
    expect(p.quickPrompts).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('rejects an unknown preferredBackend', () => {
    expect(PersonasManager.create({ name: 'X', systemPrompt: 'p', preferredBackend: 'skynet' }).preferredBackend)
      .toBe('auto');
  });

  it('normalizes on update too, and keeps id + createdAt', () => {
    const p = PersonasManager.create({ name: 'Y', systemPrompt: 'p', temperature: 0.4 });
    const u = PersonasManager.update(p.id, { temperature: 'nonsense' });
    expect(u.id).toBe(p.id);
    expect(u.createdAt).toBe(p.createdAt);
    expect(u.temperature).toBe(0.7);
  });

  it('built-in personas use VexIcons names, never emoji', () => {
    for (const p of BUILT_IN_PERSONAS) {
      expect(p.icon).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });
});

describe('importPersonas', () => {
  it('rejects a file with the wrong shape', () => {
    expect(() => PersonasManager.importPersonas({})).toThrow(/invalid import format/i);
  });

  it('throws rather than reporting a successful import of nothing', () => {
    expect(() => PersonasManager.importPersonas({ personas: [{ name: 'no prompt' }] }))
      .toThrow(/no valid personas/i);
  });

  it('imports valid entries and skips malformed ones', () => {
    const n = PersonasManager.importPersonas({
      personas: [
        { name: 'Good', systemPrompt: 'do things' },
        null,
        'nope',
        { name: '', systemPrompt: 'x' },
        { name: 'Also good', systemPrompt: 'more', temperature: 0.2 },
      ],
    });
    expect(n).toBe(2);
    expect(PersonasManager.getAll().some(p => p.name === 'Also good')).toBe(true);
  });
});

describe('per-tab persona keys', () => {
  it('prunes keys whose tab is gone', () => {
    PersonasManager.setActiveForTab('tab-a', 'builtin_research');
    PersonasManager.setActiveForTab('tab-b', 'builtin_research');
    expect(localStorage.getItem('vex.activePersonaByTab.tab-b')).toBeTruthy();

    expect(PersonasManager.pruneTabs(['tab-a'])).toBe(1);
    expect(localStorage.getItem('vex.activePersonaByTab.tab-a')).toBeTruthy();
    expect(localStorage.getItem('vex.activePersonaByTab.tab-b')).toBeNull();
  });

  // "AI persona for this tab" used to write the global default as well, so one
  // tab's choice leaked into every tab that hadn't picked its own.
  it('keeps a tab choice to that tab, and leaves the default alone', () => {
    PersonasManager.setDefault('builtin_default');
    PersonasManager.setActiveForTab('tab-a', 'builtin_research');

    expect(PersonasManager.getActiveForTab('tab-a').id).toBe('builtin_research');
    expect(PersonasManager.getActiveForTab('tab-b').id).toBe('builtin_default');
    expect(PersonasManager.getActiveForTab(null).id).toBe('builtin_default');
  });

  it('with no tab open, a choice becomes the default instead of being dropped', () => {
    PersonasManager.setDefault('builtin_default');
    PersonasManager.setActiveForTab(null, 'builtin_research');
    expect(PersonasManager.getActiveForTab(null).id).toBe('builtin_research');
  });

  it('falls back to a valid persona when the stored one was deleted', () => {
    const p = PersonasManager.create({ name: 'Temp', systemPrompt: 'x' });
    PersonasManager.setActiveForTab('tab-a', p.id);
    PersonasManager.remove(p.id);
    const active = PersonasManager.getActiveForTab('tab-a');
    expect(active).toBeTruthy();
    expect(active.id).not.toBe(p.id);
  });
});
