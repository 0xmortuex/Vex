// @vitest-environment jsdom
//
// An answer that is still being written must survive the panel being closed,
// reopened, or left for another tab.
//
// Reported 2026-09-20: "when i ask an AI question, if i close the AI sidebar
// the thinking thing goes away — i don't think it continues". It did continue,
// and the answer was saved; but _renderMessages empties the message list to
// redraw it, which took the live bubble with it. Every token after that landed
// in an element no longer on screen, so there was nothing to see until the
// whole answer arrived — indistinguishable from a stopped answer.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
const { VexFeatures } = require('../../src/renderer/js/feature-catalog.js');
globalThis.VexFeatures = VexFeatures; global.window.VexFeatures = VexFeatures;
const { AIPanel } = require('../../src/renderer/js/ai-panel.js');

beforeEach(() => {
  document.body.innerHTML = `
    <button id="btn-toggle-ai" title="Toggle AI Panel"></button>
    <div id="ai-panel">
      <div class="ai-messages" id="ai-messages"></div>
      <textarea id="ai-input"></textarea>
      <button id="ai-send"></button>
    </div>`;
  localStorage.clear();
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  AIPanel._conversations = { 'tab-1': [{ role: 'user', content: 'why is the sky blue' }] };
  AIPanel._live = null;
  AIPanel._viewingId = null;
  global.window.TabManager = {
    activeTabId: 'tab-1',
    tabs: [{ id: 'tab-1', title: 'A page' }, { id: 'tab-2', title: 'Another' }],
    getActiveTab: () => ({ id: 'tab-1', title: 'A page' }),
    switchTab: vi.fn(),
  };
  globalThis.TabManager = global.window.TabManager;
  globalThis.VideoChat = { linkify: (html) => html };
  globalThis.VexMarkdown = { render: (t) => '<p>' + t + '</p>' };
});

const messages = () => document.getElementById('ai-messages');

// The state mid-answer: a loading bubble, remembered as the live one.
function startAnswering(tabId = 'tab-1') {
  const el = AIPanel._addLoading();
  AIPanel._live = { tabId, el };
  return el;
}

describe('an answer still being written', () => {
  it('is still there after the panel is redrawn — the same element, so tokens keep landing in it', () => {
    vi.useFakeTimers();
    const el = startAnswering();
    const onToken = AIPanel._liveRenderer(el);
    onToken('Because', 'Because');
    AIPanel._renderMessages();                       // what reopening the panel does
    expect(messages().contains(el)).toBe(true);
    expect(el.isConnected).toBe(true);
    // And it is still the bubble the renderer writes into: a token that
    // arrives AFTER the redraw has to show up on screen.
    onToken(' the air scatters blue', 'Because the air scatters blue');
    vi.advanceTimersByTime(200);
    expect(el.textContent).toContain('Because the air scatters blue');
    expect(messages().textContent).toContain('scatters blue');
    vi.useRealTimers();
  });

  it('is drawn after the messages, not in the middle of them', () => {
    const el = startAnswering();
    AIPanel._renderMessages();
    expect(messages().lastElementChild).toBe(el);
    expect(messages().querySelector('.ai-msg.user')).not.toBeNull();
  });

  it('belongs to its own chat: another tab does not show it, and does not lose it', () => {
    const el = startAnswering('tab-1');
    global.window.TabManager.activeTabId = 'tab-2';
    globalThis.TabManager.activeTabId = 'tab-2';
    AIPanel._conversations['tab-2'] = [];
    AIPanel._renderMessages();
    expect(messages().contains(el)).toBe(false);     // not this chat
    expect(AIPanel._live.el).toBe(el);               // still running, still remembered
    global.window.TabManager.activeTabId = 'tab-1';
    globalThis.TabManager.activeTabId = 'tab-1';
    AIPanel._renderMessages();
    expect(messages().contains(el)).toBe(true);      // back where it belongs
  });

  it('nothing is restored once the answer has finished', () => {
    const el = startAnswering();
    AIPanel._live = null;
    AIPanel._renderMessages();
    expect(messages().contains(el)).toBe(false);
  });
});

describe('the toolbar button while the panel is shut', () => {
  it('says Vex is working, and says it again in the tooltip', () => {
    const btn = document.getElementById('btn-toggle-ai');
    AIPanel._setComposerBusy(true);
    expect(btn.classList.contains('working')).toBe(true);
    expect(btn.title).toMatch(/answering/i);
    AIPanel._setComposerBusy(false);
    expect(btn.classList.contains('working')).toBe(false);
    expect(btn.title).toBe('Toggle AI Panel');       // the tooltip it had before
  });

  it('the mark for an answer that arrived while it was shut clears when you open it', () => {
    const btn = document.getElementById('btn-toggle-ai');
    btn.classList.add('answered');
    AIPanel.open();
    expect(btn.classList.contains('answered')).toBe(false);
  });
});
