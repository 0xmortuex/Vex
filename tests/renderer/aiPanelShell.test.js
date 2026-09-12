// @vitest-environment jsdom
//
// The Vex AI shell: two modes, and dismissal.
//
// Dismissal is the bug this covers. The panel only ever closed from its own X
// button, so clicking anywhere else left it open. A click inside a page happens
// in a <webview> and never reaches this document, so window blur has to be
// watched too — the same way every other popup in Vex does it.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
// The panel answers questions about Vex from this catalogue, so it has to be
// present or those tests pass for the wrong reason (a null result).
const { VexFeatures } = require('../../src/renderer/js/feature-catalog.js');
globalThis.VexFeatures = VexFeatures; global.window.VexFeatures = VexFeatures;
const { AIPanel } = require('../../src/renderer/js/ai-panel.js');

// Only the parts of the panel the shell touches.
const MARKUP = `
  <button id="btn-toggle-ai"></button>
  <div id="elsewhere">page chrome</div>
  <div id="ai-panel">
    <div class="ai-header">
      <button class="ai-icon-btn" id="ai-new-chat"></button>
      <button class="ai-icon-btn" id="ai-history-btn"></button>
      <button class="ai-icon-btn" id="ai-expand"></button>
      <button class="ai-icon-btn ai-close" id="ai-close"></button>
    </div>
    <div class="ai-history" id="ai-history" hidden>
      <button id="ai-history-close"></button>
      <div class="ai-history-list" id="ai-history-list"></div>
    </div>
    <div class="ai-messages" id="ai-messages"></div>
    <div class="ai-quick-actions" id="ai-quick-actions"></div>
    <div class="persona-prompts-row" id="persona-prompts-row"></div>
    <textarea id="ai-input"></textarea>
    <button id="ai-send"></button>
    <button id="ai-send-agent"></button>
    <button id="ai-export"></button>
    <button id="ai-clear"></button>
    <div class="persona-dropdown" id="persona-dropdown" hidden><div class="persona-list" id="persona-list"></div></div>
    <div id="tab-selector-dropdown" hidden></div>
  </div>`;

beforeEach(() => {
  document.body.innerHTML = MARKUP;
  localStorage.clear();
  // The panel escapes everything it renders through this.
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  AIPanel._shellReady = false;
  AIPanel._conversations = {};
  AIPanel._unbindDismiss();
  global.window.TabManager = {
    activeTabId: 'tab-1', tabs: [{ id: 'tab-1', title: 'A page' }],
    switchTab: vi.fn(), getActiveTab: () => ({ id: 'tab-1', title: 'A page' }),
  };
  globalThis.TabManager = global.window.TabManager;
  AIPanel._initShell();
});

const openPanel = () => {
  document.getElementById('ai-panel').classList.add('open');
  AIPanel._bindDismiss();
  return new Promise(r => setTimeout(r, 0)); // listeners attach on the next tick
};

describe('two modes', () => {
  it('starts docked', () => {
    expect(document.getElementById('ai-panel').classList.contains('expanded')).toBe(false);
  });

  it('full screen is a class on the panel, not a separate surface', () => {
    AIPanel.setMode('expanded');
    expect(document.getElementById('ai-panel').classList.contains('expanded')).toBe(true);
    AIPanel.setMode('docked');
    expect(document.getElementById('ai-panel').classList.contains('expanded')).toBe(false);
  });

  it('remembers the mode across sessions', () => {
    AIPanel.setMode('expanded');
    expect(localStorage.getItem('vex.aiMode')).toBe('expanded');
    AIPanel._shellReady = false;
    AIPanel._initShell();
    expect(document.getElementById('ai-panel').classList.contains('expanded')).toBe(true);
  });

  it('does not record the mode when restoring it at startup', () => {
    localStorage.removeItem('vex.aiMode');
    AIPanel._shellReady = false;
    AIPanel._initShell();
    expect(localStorage.getItem('vex.aiMode')).toBe(null);
  });

  it('toggles between the two', () => {
    AIPanel.toggleMode();
    expect(AIPanel._savedMode()).toBe('expanded');
    AIPanel.toggleMode();
    expect(AIPanel._savedMode()).toBe('docked');
  });
});

describe('dismissal', () => {
  it('closes when the user clicks elsewhere in the chrome', async () => {
    await openPanel();
    document.getElementById('elsewhere').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(AIPanel.isOpen()).toBe(false);
  });

  it('stays open when the click is inside the panel', async () => {
    await openPanel();
    document.getElementById('ai-messages').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(AIPanel.isOpen()).toBe(true);
  });

  // A click inside a page happens in a <webview> and never reaches this
  // document — focus moving into the guest is the signal that it happened.
  it('closes when you click into the page', async () => {
    await openPanel();
    const wv = document.createElement('webview');
    document.body.appendChild(wv);
    wv.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(AIPanel.isOpen()).toBe(false);
  });

  // Switching applications should not cost you your place in the conversation.
  // This is the case that used to close it: blur fires either way, so the
  // handler has to look at WHERE focus went.
  it('stays open when the whole app loses focus', async () => {
    await openPanel();
    const had = document.hasFocus;
    document.hasFocus = () => false;          // the app is in the background
    try {
      window.dispatchEvent(new Event('blur'));
      await new Promise(r => setTimeout(r, 0));
      expect(AIPanel.isOpen()).toBe(true);
    } finally { document.hasFocus = had; }
  });

  it('closes on Escape', async () => {
    await openPanel();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(AIPanel.isOpen()).toBe(false);
  });

  it('Escape closes an open dropdown first, not the whole panel', async () => {
    await openPanel();
    document.getElementById('persona-dropdown').hidden = false;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('persona-dropdown').hidden).toBe(true);
    expect(AIPanel.isOpen()).toBe(true);
  });

  // Otherwise the button would close it on mousedown and reopen it on click.
  it('leaves the toggle button alone so it stays a toggle', async () => {
    await openPanel();
    document.getElementById('btn-toggle-ai').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(AIPanel.isOpen()).toBe(true);
  });

  it('stops listening once closed', async () => {
    await openPanel();
    AIPanel.close();
    expect(AIPanel._onDocDown).toBe(null);
  });
});

describe('starters and chats', () => {
  it('shows the starters only while the conversation is empty', () => {
    AIPanel._syncStarters();
    expect(document.getElementById('ai-quick-actions').hidden).toBe(false);

    AIPanel._conversations['tab-1'] = [{ role: 'user', content: 'hi' }];
    AIPanel._syncStarters();
    expect(document.getElementById('ai-quick-actions').hidden).toBe(true);
  });

  it('new chat empties the thread and brings the starters back', () => {
    AIPanel._conversations['tab-1'] = [{ role: 'user', content: 'hi' }];
    AIPanel.newChat();
    expect(AIPanel._getConv()).toEqual([]);
    expect(document.getElementById('ai-quick-actions').hidden).toBe(false);
  });

  it('lists a conversation under recent chats', () => {
    AIPanel._conversations['tab-1'] = [{ role: 'user', content: 'about sea ice' }];
    AIPanel.toggleHistory(true);
    const items = document.querySelectorAll('#ai-history-list .ai-history-item');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toContain('about sea ice');
  });

  it('says so plainly when there are no conversations', () => {
    AIPanel.toggleHistory(true);
    expect(document.getElementById('ai-history-list').textContent).toContain('No conversations yet');
  });
});

describe('built-in personas', () => {
  const { BUILT_IN_PERSONAS } = require('../../src/renderer/js/personas-builtin.js');

  it('ships a broad set, not a handful', () => {
    expect(BUILT_IN_PERSONAS.length).toBeGreaterThanOrEqual(20);
  });

  it('gives every persona a real drawn icon', () => {
    for (const p of BUILT_IN_PERSONAS) expect(VexIcons.has(p.icon), `${p.id} -> ${p.icon}`).toBe(true);
  });

  it('keeps ids unique and prefixed, so a saved choice keeps working', () => {
    const ids = BUILT_IN_PERSONAS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('builtin_'), id).toBe(true);
  });

  it('stays inside the limits the manager enforces', () => {
    for (const p of BUILT_IN_PERSONAS) {
      expect(p.name.length, p.id).toBeLessThanOrEqual(60);
      expect(p.systemPrompt.length, p.id).toBeLessThanOrEqual(8000);
      expect(p.temperature, p.id).toBeGreaterThanOrEqual(0);
      expect(p.temperature, p.id).toBeLessThanOrEqual(1);
      expect(p.quickPrompts.length, p.id).toBeLessThanOrEqual(5);
    }
  });
});

// Reasoning models put their working in a <think> block before the answer.
// Left in place it broke JSON.parse, so the parser fell through to a regex that
// scraped "reply" out of the raw text and discarded the reasoning entirely.
describe('reasoning models', () => {
  const J = (o) => JSON.stringify(o);

  it('separates the thinking from the answer', () => {
    const p = AIPanel._parseResponse('<think>weighing it up</think>' + J({ reply: 'the answer' }));
    expect(p.reply).toBe('the answer');
    expect(p.thinking).toBe('weighing it up');
  });

  it('handles the other tag spellings models use', () => {
    for (const tag of ['think', 'thinking', 'reasoning']) {
      const p = AIPanel._parseResponse(`<${tag}>inner</${tag}>` + J({ reply: 'a' }));
      expect(p.thinking, tag).toBe('inner');
    }
  });

  it('joins several blocks rather than keeping only the last', () => {
    const p = AIPanel._parseResponse('<think>one</think>mid<think>two</think>' + J({ reply: 'a' }));
    expect(p.thinking).toContain('one');
    expect(p.thinking).toContain('two');
  });

  // Generation stopped mid-thought: there is reasoning but no answer yet.
  it('treats an unterminated block as thinking with no answer', () => {
    const p = AIPanel._parseResponse('<think>still going');
    expect(p.thinkingOnly).toBe(true);
    expect(p.reply).toBe('');
    expect(p.thinking).toBe('still going');
  });

  it('never leaves the tag in the answer', () => {
    const p = AIPanel._parseResponse('<think>x</think>plain prose answer');
    expect(p.reply).not.toMatch(/think/i);
    expect(p.reply).toBe('plain prose answer');
  });

  it('leaves a response with no thinking exactly as it was', () => {
    const p = AIPanel._parseResponse(J({ reply: 'hi', citations: [] }));
    expect(p.reply).toBe('hi');
    expect(p.thinking).toBeUndefined();
  });

  it('still recovers a truncated reply, and keeps the reasoning with it', () => {
    const p = AIPanel._parseResponse('<think>r</think>{"reply": "half a sen');
    expect(p.truncated).toBe(true);
    expect(p.reply).toBe('half a sen');
    expect(p.thinking).toBe('r');
  });
});

describe('what Vex knows about itself', () => {
  it('hands over the feature catalogue when asked about Vex', () => {
    const m = AIPanel._vexKnowledge('What features does Vex have?');
    expect(m).toBeTruthy();
    expect(m.role).toBe('system');
    expect(m.content).toContain('Vex is the browser');
  });

  it('answers for "this browser" too', () => {
    expect(AIPanel._vexKnowledge('what can this browser do?')).toBeTruthy();
  });

  it('stays out of the way for an ordinary page question', () => {
    // Guard against passing for the wrong reason: with no catalogue loaded
    // every call returns null and this would look green regardless.
    expect(AIPanel._vexKnowledge('what can Vex do?')).toBeTruthy();
    expect(AIPanel._vexKnowledge('summarise this article')).toBe(null);
    expect(AIPanel._vexKnowledge('what is convexity?')).toBe(null);
  });

  it('is capped, so it cannot crowd out a small local model', () => {
    const m = AIPanel._vexKnowledge('tell me everything about Vex');
    expect(m.content.length).toBeLessThanOrEqual(AIPanel.VEX_KNOWLEDGE_LIMIT);
  });

  it('tells the model not to invent features', () => {
    expect(AIPanel._vexKnowledge('vex features').content).toContain('not sure rather than guessing');
  });
});

describe('the reasoning survives being stored', () => {
  it('keeps thinking with its turn through save and reload', () => {
    globalThis.TabManager = { activeTabId: 't1', tabs: [{ id: 't1' }] };
    global.window.TabManager = globalThis.TabManager;
    AIPanel._conversations = { t1: [{ role: 'assistant', content: 'a', thinking: 'because' }] };
    AIPanel._persistConversations();

    AIPanel._conversations = {};
    AIPanel._loadConversations();
    expect(AIPanel._conversations.t1[0].thinking).toBe('because');
  });

  it('caps a very long chain of thought rather than filling the store', () => {
    globalThis.TabManager = { activeTabId: 't1', tabs: [{ id: 't1' }] };
    global.window.TabManager = globalThis.TabManager;
    AIPanel._conversations = { t1: [{ role: 'assistant', content: 'a', thinking: 'x'.repeat(50000) }] };
    AIPanel._persistConversations();
    AIPanel._conversations = {};
    AIPanel._loadConversations();
    expect(AIPanel._conversations.t1[0].thinking.length).toBeLessThanOrEqual(AIPanel.MAX_THINKING_CHARS);
  });
});

// Streaming. The local backend sends NDJSON fragments, so a partial answer is
// usually half-written JSON — unreadable unless it is unwrapped first.
describe('a streamed answer while it is still arriving', () => {
  it('unwraps a half-finished JSON reply into readable text', () => {
    const p = AIPanel._streamPreview('{"reply": "Sea ice forms when');
    expect(p.body).toBe('Sea ice forms when');
  });

  it('shows nothing rather than a naked brace before the reply starts', () => {
    expect(AIPanel._streamPreview('{"repl').body).toBe('');
    expect(AIPanel._streamPreview('{').body).toBe('');
  });

  it('separates reasoning that arrives before the answer', () => {
    const p = AIPanel._streamPreview('<think>working on it');
    expect(p.thinking).toBe('working on it');
    expect(p.body).toBe('');
  });

  it('carries both once the answer has started', () => {
    const p = AIPanel._streamPreview('<think>done</think>{"reply": "here it is');
    expect(p.thinking).toBe('done');
    expect(p.body).toBe('here it is');
  });

  it('passes plain prose straight through', () => {
    expect(AIPanel._streamPreview('just talking').body).toBe('just talking');
  });

  it('decodes escapes rather than showing them raw', () => {
    expect(AIPanel._streamPreview('{"reply": "line one\nline two').body).toContain('\n');
  });
});

describe('ways into the features an answer mentions', () => {
  it('offers a chip for a feature the answer names', () => {
    // A setting or panel target opens without CommandBar, which this
    // environment does not load.
    const name = VexFeatures.ITEMS.find(f => (f.name || '').length > 8 && (f.setting || f.panel)).name;
    const row = AIPanel._featureChips(`You can use ${name} for that.`);
    expect(row).toBeTruthy();
    expect(row.textContent).toContain(name);
  });

  it('offers nothing when no feature is named', () => {
    expect(AIPanel._featureChips('the weather is nice today')).toBe(null);
  });

  it('never offers more than a handful', () => {
    const all = VexFeatures.ITEMS.map(f => f.name).join(' and ');
    const row = AIPanel._featureChips(all);
    expect(row.querySelectorAll('.ai-feature-chip').length).toBeLessThanOrEqual(AIPanel.MAX_FEATURE_CHIPS);
  });
});

describe('emoji in the model\'s own words', () => {
  it('strips them by default, to match an interface that has none', () => {
    expect(AIPanel._deEmoji('Hey there! \u{1F60A} all good')).toBe('Hey there! all good');
  });

  it('leaves ordinary prose symbols alone', () => {
    expect(AIPanel._deEmoji('Acme \u00a9 2026 \u2122')).toBe('Acme \u00a9 2026 \u2122');
  });

  it('can be turned back on, because they are the model\'s words', () => {
    localStorage.setItem(AIPanel.STRIP_EMOJI_KEY, '0');
    expect(AIPanel._deEmoji('Hi \u{1F60A}')).toBe('Hi \u{1F60A}');
  });
});

describe('personas can be filtered', () => {
  it('narrows the list to what was typed', () => {
    global.window.PersonasManager = globalThis.PersonasManager = {
      getAll: () => [{ id: 'a', name: 'Security Vex', description: 'phishing' }, { id: 'b', name: 'Kitchen Vex', description: 'recipes' }],
      getById: (id) => ({ id, name: id }),
      setActiveForTab: vi.fn(),
      getActiveForTab: () => null,
    };
    AIPanel._personaFilter = 'kitchen';
    AIPanel._renderPersonaDropdown();
    const items = document.querySelectorAll('#persona-list .persona-item');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toContain('Kitchen');
    AIPanel._personaFilter = '';
  });

  it('says so when nothing matches, instead of showing a blank list', () => {
    AIPanel._personaFilter = 'zzzznotapersona';
    AIPanel._renderPersonaDropdown();
    expect(document.getElementById('persona-list').textContent).toContain('No persona matches');
    AIPanel._personaFilter = '';
  });
});

// Chats used to be deleted the moment their tab closed, so "Recent chats" had
// to tell the user their own conversation was unreachable.
describe('chats outlive their tabs', () => {
  beforeEach(() => { AIPanel._convPrivate = {}; AIPanel._viewingId = null; });

  it('keeps a conversation after its tab is gone', () => {
    AIPanel._conversations = { closed: [{ role: 'user', content: 'still here' }] };
    globalThis.TabManager = { activeTabId: 'other', tabs: [{ id: 'other' }] };
    global.window.TabManager = globalThis.TabManager;
    AIPanel._persistConversations();

    AIPanel._conversations = {};
    AIPanel._loadConversations();
    expect(AIPanel._conversations.closed[0].content).toBe('still here');
  });

  it('still refuses to write a private tab\'s chat to disk', () => {
    AIPanel._conversations = { secret: [{ role: 'user', content: 'private' }] };
    AIPanel._convPrivate = { secret: true };
    AIPanel._persistConversations();
    expect(localStorage.getItem(AIPanel.CONV_KEY)).not.toContain('private');
  });

  it('shows the chat you picked, not the active tab\'s', () => {
    AIPanel._conversations = { 'tab-1': [{ role: 'user', content: 'current' }], old: [{ role: 'user', content: 'earlier' }] };
    AIPanel._viewingId = 'old';
    expect(AIPanel._getConv()[0].content).toBe('earlier');
    AIPanel._viewingId = null;
    expect(AIPanel._getConv()[0].content).toBe('current');
  });

  it('says which chat is on screen, with a way back', () => {
    AIPanel._conversations = { old: [{ role: 'user', content: 'earlier' }] };
    AIPanel._viewingId = 'old';
    AIPanel._syncViewingBanner();
    const bar = document.getElementById('ai-viewing');
    expect(bar).toBeTruthy();
    expect(bar.textContent).toContain('closed');
    bar.querySelector('button').click();
    expect(AIPanel._viewingId).toBe(null);
    expect(document.getElementById('ai-viewing')).toBe(null);
  });
});
