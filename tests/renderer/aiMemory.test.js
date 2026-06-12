// @vitest-environment jsdom
//
// Unit coverage for AIMemory — the persistent "facts the assistant remembers"
// store and the system message it injects into chat history.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { AIMemory } = require('../../src/renderer/js/ai-memory.js');

beforeEach(() => {
  localStorage.clear();
  AIMemory.data = { enabled: true, facts: [] };
  globalThis.window.showToast = vi.fn();
});

describe('AIMemory store', () => {
  it('adds facts, dedupes case-insensitively, and persists', () => {
    expect(AIMemory.add('I prefer concise answers')).toBe(true);
    expect(AIMemory.add('i prefer concise answers')).toBe(false); // dup
    expect(AIMemory.list()).toHaveLength(1);
    const saved = JSON.parse(localStorage.getItem('vex.aiMemory'));
    expect(saved.facts[0].text).toBe('I prefer concise answers');
  });

  it('rejects empty facts and caps at 100', () => {
    expect(AIMemory.add('   ')).toBe(false);
    for (let i = 0; i < 120; i++) AIMemory.add('fact number ' + i);
    expect(AIMemory.list().length).toBeLessThanOrEqual(100);
  });

  it('remove() drops a fact by id', () => {
    AIMemory.add('one'); AIMemory.add('two');
    const id = AIMemory.list()[0].id;
    AIMemory.remove(id);
    expect(AIMemory.list().some(f => f.id === id)).toBe(false);
  });
});

describe('AIMemory.historyMessage (injection)', () => {
  it('returns null when disabled or empty', () => {
    expect(AIMemory.historyMessage()).toBeNull();
    AIMemory.add('x');
    AIMemory.setEnabled(false);
    expect(AIMemory.historyMessage()).toBeNull();
  });

  it('returns a system message listing every fact when enabled', () => {
    AIMemory.add('I live in Istanbul');
    AIMemory.add('I code in TypeScript');
    const msg = AIMemory.historyMessage();
    expect(msg.role).toBe('system');
    expect(msg.content).toContain('I live in Istanbul');
    expect(msg.content).toContain('I code in TypeScript');
  });

  it('the injected history stays <=10 items so the worker slice(-10) keeps memory', () => {
    // Mirror the ai-panel.js assembly: memory at front + last 9 of history.
    AIMemory.add('remember me');
    const history = Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: 'm' + i }));
    const memMsg = AIMemory.historyMessage();
    const out = memMsg ? [memMsg, ...history.slice(-9)] : history;
    expect(out).toHaveLength(10);
    expect(out[0]).toBe(memMsg);
    expect(out[0].role).toBe('system');
  });
});
