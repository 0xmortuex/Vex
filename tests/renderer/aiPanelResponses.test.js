// @vitest-environment jsdom
//
// AIPanel response handling and the history-search intent gate.
//
// Two regressions are pinned here:
//   1. _parseResponse returned whatever JSON.parse produced, so a model that
//      answered '"hi"' or '42' (valid JSON, not an object) left `.reply`
//      undefined and the panel rendered an EMPTY assistant bubble. Truncated
//      output ('{"reply": "half a sen') was shown to the user as raw JSON.
//   2. The "find in history" intent matched a bare "find"/"remember"/"recall",
//      so an ordinary question ("how do I find the average of a list?") ran a
//      history search — which ships up to 200 history entries (titles, URLs,
//      summaries) to the AI backend.

import { describe, it, expect } from 'vitest';

const { AIPanel } = require('../../src/renderer/js/ai-panel.js');

describe('AIPanel._parseResponse', () => {
  it('returns a plain object unchanged', () => {
    expect(AIPanel._parseResponse('{"reply":"hello","citations":[]}'))
      .toEqual({ reply: 'hello', citations: [] });
  });

  it('strips ```json fences', () => {
    expect(AIPanel._parseResponse('```json\n{"reply":"hi"}\n```').reply).toBe('hi');
  });

  it('wraps a bare JSON string as the reply (was an empty bubble)', () => {
    expect(AIPanel._parseResponse('"just text"')).toEqual({ reply: 'just text' });
  });

  it('wraps a bare JSON number as the reply (was an empty bubble)', () => {
    expect(AIPanel._parseResponse('42')).toEqual({ reply: '42' });
  });

  it('wraps a JSON array as the reply rather than treating it as fields', () => {
    expect(AIPanel._parseResponse('[1,2]').reply).toBe('[1,2]');
  });

  it('recovers the reply from truncated JSON instead of showing raw JSON', () => {
    const out = AIPanel._parseResponse('{"reply": "half a sentence');
    expect(out.reply).toBe('half a sentence');
    expect(out.truncated).toBe(true);
  });

  it('unescapes newlines and quotes when recovering a reply', () => {
    const out = AIPanel._parseResponse('{"reply": "line one\\nline \\"two\\"" , "x');
    expect(out.reply).toBe('line one\nline "two"');
  });

  it('falls back to the raw text when there is no JSON at all', () => {
    expect(AIPanel._parseResponse('Just a plain answer.').reply).toBe('Just a plain answer.');
  });

  it('handles empty input', () => {
    expect(AIPanel._parseResponse('')).toEqual({ reply: '' });
    expect(AIPanel._parseResponse(null)).toEqual({ reply: '' });
  });
});

describe('AIPanel.isHistoryIntent — the gate on sending browsing history to the AI', () => {
  const no = [
    'how do I find the average of a list in python?',
    'find the bug in this function',
    'remember to add a semicolon here',
    'can you recall what a monad is?',
    'what is the last week of the fiscal year?',
    'summarize this page',
    'translate that post into French',
    'write a find-and-replace regex',
    '',
  ];
  const yes = [
    'search my history for the tailwind docs',
    'what was in my browsing history yesterday',
    'where did I see that chart about inflation',
    'where have I read about rust lifetimes',
    'that article I read last week about sleep',
    'find the page I visited about mortgage rates',
    'reopen the video I watched yesterday',
  ];

  it.each(no)('does NOT treat %j as a history lookup', (msg) => {
    expect(AIPanel.isHistoryIntent(msg)).toBe(false);
  });

  it.each(yes)('treats %j as a history lookup', (msg) => {
    expect(AIPanel.isHistoryIntent(msg)).toBe(true);
  });
});

describe('AIPanel conversation persistence', () => {
  it('round-trips conversations through localStorage, dropping junk', () => {
    localStorage.clear();
    AIPanel._conversations = {
      't1': [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }],
    };
    AIPanel._persistConversations();

    AIPanel._conversations = {};
    AIPanel._loadConversations();
    expect(AIPanel._conversations.t1).toHaveLength(2);
    expect(AIPanel._conversations.t1[1].content).toBe('hello');
  });

  it('caps a single conversation at MAX_CONV_MESSAGES', () => {
    localStorage.clear();
    AIPanel._conversations = { t1: [] };
    for (let i = 0; i < 200; i++) AIPanel._conversations.t1.push({ role: 'user', content: 'm' + i });
    AIPanel._persistConversations();
    const stored = JSON.parse(localStorage.getItem(AIPanel.CONV_KEY));
    expect(stored.t1).toHaveLength(AIPanel.MAX_CONV_MESSAGES);
    expect(stored.t1[stored.t1.length - 1].content).toBe('m199');
  });

  it('drops conversations for tabs that no longer exist', () => {
    localStorage.clear();
    globalThis.window.TabManager = { tabs: [{ id: 'alive' }] };
    globalThis.TabManager = globalThis.window.TabManager;
    AIPanel._conversations = {
      alive: [{ role: 'user', content: 'still here' }],
      closed: [{ role: 'user', content: 'gone' }],
    };
    AIPanel._persistConversations();
    const stored = JSON.parse(localStorage.getItem(AIPanel.CONV_KEY));
    expect(Object.keys(stored)).toEqual(['alive']);
    delete globalThis.TabManager;
    delete globalThis.window.TabManager;
  });

  it('ignores a corrupt store instead of throwing', () => {
    localStorage.setItem(AIPanel.CONV_KEY, '{not json');
    AIPanel._conversations = {};
    expect(() => AIPanel._loadConversations()).not.toThrow();
    expect(AIPanel._conversations).toEqual({});
  });
});
