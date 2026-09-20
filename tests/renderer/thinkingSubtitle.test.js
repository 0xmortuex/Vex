// @vitest-environment jsdom
//
// What Show thinking looks like: one line under "Thinking…" that keeps
// changing, like a subtitle, with the whole reasoning one click away — in the
// chat bubble and in the agent's step row.

import { describe, it, expect, vi, beforeEach } from 'vitest';
const { AIPanel } = require('../../src/renderer/js/ai-panel.js');
const { AgentLoop } = require('../../src/renderer/js/agent-loop.js');

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  document.body.innerHTML = '<div id="ai-messages"></div>';
  // An answer still being written is rendered as markdown now, and that path
  // escapes and links through the renderer's own helpers.
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
});

describe('the subtitle line', () => {
  it('is the latest line the model wrote, without its markdown', () => {
    expect(AIPanel._thoughtSubtitle('1. **Analyze** the request\n* Weigh **combi** vs `system` boilers')).toBe('Weigh combi vs system boilers');
    expect(AIPanel._thoughtSubtitle('first\n\n   \nsecond thought')).toBe('second thought');
  });

  it('never grows past one short line', () => {
    const s = AIPanel._thoughtSubtitle('x'.repeat(500));
    expect(s.length).toBe(140);
    expect(s.startsWith('…')).toBe(true);
  });

  it('is empty for nothing', () => {
    expect(AIPanel._thoughtSubtitle('')).toBe('');
    expect(AIPanel._thoughtSubtitle(null)).toBe('');
  });
});

describe('in a chat bubble', () => {
  function bubble() {
    const el = document.createElement('div');
    el.className = 'ai-msg assistant loading';
    el.textContent = 'Thinking…';
    document.getElementById('ai-messages').appendChild(el);
    return el;
  }

  it('shows the live line INSIDE the summary, so it is visible while folded', () => {
    const el = bubble();
    const onToken = AIPanel._liveRenderer(el);
    onToken.onThinking('', 'Reading the page.\nThe user wants a comparison.');
    vi.advanceTimersByTime(60);
    const details = el.querySelector('details.ai-thinking');
    expect(details.open).toBe(false);
    const live = details.querySelector('summary .ai-thinking-live');
    expect(live.textContent).toBe('The user wants a comparison.');
    expect(details.querySelector('.ai-thinking-label').textContent).toMatch(/^Thinking… 8 words$/);
    expect(details.querySelector('.ai-thinking-body').textContent).toContain('Reading the page.');
    // The "Thinking…" placeholder beside it is gone — it was squeezed into a
    // column of letters — and the bubble now stacks.
    expect(el.classList.contains('is-thinking')).toBe(true);
    expect(el.firstChild).toBe(details);
    expect(el.childNodes).toHaveLength(1);
  });

  it('keeps updating as the model thinks', () => {
    const el = bubble();
    const onToken = AIPanel._liveRenderer(el);
    onToken.onThinking('', 'one');
    vi.advanceTimersByTime(60);
    onToken.onThinking('', 'one\ntwo');
    vi.advanceTimersByTime(60);
    expect(el.querySelector('.ai-thinking-live').textContent).toBe('two');
    expect(el.querySelectorAll('details.ai-thinking')).toHaveLength(1);
  });

  it('survives the answer starting — it used to be wiped with the placeholder', () => {
    const el = bubble();
    const onToken = AIPanel._liveRenderer(el);
    onToken.onThinking('', 'Deciding what to say.');
    vi.advanceTimersByTime(60);
    onToken('{"reply":"A system', '{"reply":"A system');
    vi.advanceTimersByTime(60);
    expect(el.querySelector('details.ai-thinking')).not.toBe(null);
    expect(el.querySelector('.ai-msg-content').textContent).toBe('A system');
    // Thinking is over once the answer is being written.
    expect(el.querySelector('.ai-thinking-live').hidden).toBe(true);
    expect(el.querySelector('.ai-thinking-label').textContent).toMatch(/^Thought for 4 words$/);
  });

  it('hands the thoughts back so they are kept with the answer', () => {
    const onToken = AIPanel._liveRenderer(bubble());
    onToken.onThinking('', 'kept');
    expect(onToken.thinking()).toBe('kept');
  });

  it('a thought is text, never markup', () => {
    const el = bubble();
    const onToken = AIPanel._liveRenderer(el);
    onToken.onThinking('', '<img src=x onerror=alert(1)>');
    vi.advanceTimersByTime(60);
    expect(el.querySelector('img')).toBe(null);
  });
});

describe('in the agent step row', () => {
  function row() {
    const el = document.createElement('div');
    el.className = 'ai-msg assistant loading agent-step-thinking';
    el.innerHTML = 'Thinking... (step 1) <span class="ai-spinner"></span>';
    document.getElementById('ai-messages').appendChild(el);
    return el;
  }

  it('adds a faded line under the step, and the full reasoning on hover', () => {
    const el = row();
    AgentLoop._streamThought('Look at the page.\nI should click Orders.');
    const live = el.querySelector('.agent-think-live');
    expect(live.textContent).toBe('I should click Orders.');
    expect(live.title).toContain('Look at the page.');
  });

  it('the "what I am doing" text arriving does not throw the thinking away', () => {
    const el = row();
    AgentLoop._streamThought('I should click Orders.');
    AgentLoop._streamStep('{"thought":"Open the orders page","tool":"click_text"');
    expect(el.textContent).toContain('Open the orders page → click_text');
    expect(el.querySelector('.agent-think-live').textContent).toBe('I should click Orders.');
  });

  it('does nothing when there is no step running', () => {
    expect(() => AgentLoop._streamThought('x')).not.toThrow();
  });
});
