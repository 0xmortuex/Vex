// @vitest-environment jsdom
//
// "All the actions taken by the AI ... categorized properly, not all of them
// displayed in chat, structured, clean and neat" (2026-09-27). A run is one
// card: a live line, the steps folded away with category chips, the details
// of each step under it, the costs in the footer — not forty bubbles.

import { describe, it, expect, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; window.VexIcons = VexIcons;
const { AgentRunCard } = require('../../src/renderer/js/agent-run-card.js');

let box;
beforeEach(() => { document.body.innerHTML = '<div id="ai-messages"></div>'; box = document.getElementById('ai-messages'); });

function run() {
  const c = AgentRunCard.create(box, "Search this shop for 'moon knight'", { replay: true });
  c.step('thinking', 'Thinking... (step 1)', 'loading');
  c.step('action', 'Click the "Search" button.\n→ click({"selector":"[data-vex-id=\\"vex-2\\"]"})', 'action');
  c.step('result', 'Clicked "Search" — new on the page: "Moon Knight Poster", "Moon Knight Mug"', 'success');
  c.step('cost', '↳ 1.6 s · 5,213 → 59 tokens', 'cost');
  c.step('action', 'Look it up.\n→ web_search({"query":"moon knight shop","count":4})', 'action');
  c.step('result', 'Found 4 results for "moon knight shop" (DuckDuckGo)', 'success');
  c.step('action', 'Type it.\n→ type_text({"selector":"#add","text":"moon"})', 'action');
  c.step('result', 'Failed: That is a button ("Add to cart"), not a text field.', 'error');
  c.step('loop-prevent', 'Not doing that again — last time it changed nothing on the page.', 'warn');
  return c;
}

describe('one card per run', () => {
  it('is one message, not a bubble per step', () => {
    run();
    expect(box.children.length).toBe(1);
    expect(box.querySelector('.agent-run-card')).not.toBeNull();
  });

  it('keeps the steps folded away until opened', () => {
    const c = run();
    expect(c.el.querySelector('.arc-body').hidden).toBe(true);
    expect(c.el.querySelector('.arc-count').textContent).toBe('3 steps');
    c.el.querySelector('.arc-toggle').click();
    expect(c.el.querySelector('.arc-body').hidden).toBe(false);
  });

  it('writes each step in plain words, not as a tool call', () => {
    const c = run();
    const lines = [...c.el.querySelectorAll('.arc-what')].map(n => n.textContent);
    expect(lines[0]).toBe('Clicked "Search"');
    expect(lines.join(' ')).not.toMatch(/data-vex-id|\{"/);
    expect(c.el.querySelector('.arc-out').textContent).toMatch(/^now shows "Moon Knight Poster"/);
  });

  it('sorts steps into categories you can filter by', () => {
    const c = run();
    const chips = [...c.el.querySelectorAll('.arc-chip')].map(b => b.textContent);
    expect(chips).toEqual(['All4', 'Clicks & typing1', 'Web search1', 'Problems2']);
    [...c.el.querySelectorAll('.arc-chip')].find(b => b.textContent.startsWith('Problems')).click();
    const shown = [...c.el.querySelectorAll('.arc-step')].filter(li => !li.hidden);
    expect(shown.length).toBe(2);
  });

  it('keeps the exact action, the result and the cost one click away', () => {
    const c = run();
    c.el.querySelector('.arc-row').click();
    const d = c.el.querySelector('.arc-detail');
    expect(d.hidden).toBe(false);
    expect(d.textContent).toContain('Click the "Search" button.');
    expect(d.textContent).toContain('click({"selector"');
    expect(d.textContent).toContain('5,213 → 59 tokens');
  });

  it('ends with a status and the totals in the footer', () => {
    const c = run();
    c.step('end', 'Agent finished — 3 steps, 4.1 s thinking, 12,000 tokens in, 90 out', 'info');
    expect(c.el.querySelector('.arc-title').textContent).toBe('Done');
    // The step count lives in the header; the footer's count was of thinking
    // rounds (refused ones included) and disagreed with it.
    expect(c.el.querySelector('.arc-foot').textContent).toBe('4.1 s thinking, 12,000 tokens in, 90 out · 2 problems along the way');
    expect(c.el.classList.contains('running')).toBe(false);
  });

  it('shows a stop as a stop', () => {
    const c = run();
    c.step('stopped', 'Stopped by you.', 'warn');
    c.step('end', 'Agent finished', 'info');
    expect(c.el.querySelector('.arc-title').textContent).toBe('Stopped');
  });
});
