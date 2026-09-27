// @vitest-environment jsdom
//
// "I want to see the process of what he is doing and how" (2026-09-27). A test
// run found the agent could not see what its own actions did: it heard only
// 'Clicked "Add to cart"', never that the page now said "Added to cart", so it
// clicked on until it ran out of steps. And typing into a button came back as
// "Script failed to execute".

import { describe, it, expect, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { AgentCursor, installVexAgentCursor } = require('../../src/renderer/js/agent-cursor.js');
const { AgentExecutor } = require('../../src/renderer/js/agent-executor.js');

describe('telling the agent what its action did', () => {
  const page = (url, title, text) => ({ url, title, text });
  it('says what is new on the page', () => {
    const d = AgentExecutor.describeChange(page('u', 'Shop', 'Poster\nCart is empty'), page('u', 'Shop', 'Poster\nAdded to cart: 1 item'));
    expect(d).toContain('new on the page: "Added to cart: 1 item"');
  });
  it('says where it went when the address changed', () => {
    const d = AgentExecutor.describeChange(page('https://a/', 'A', 'x'), page('https://a/p?id=0', 'Moon Knight Poster', 'y'));
    expect(d).toContain('now on "Moon Knight Poster" (https://a/p?id=0)');
  });
  it('says when nothing happened, which is worth knowing too', () => {
    expect(AgentExecutor.describeChange(page('u', 'T', 'same'), page('u', 'T', 'same'))).toBe(' — nothing visible changed on the page');
  });
  it('says nothing when the page could not be read', () => {
    expect(AgentExecutor.describeChange(null, page('u', 'T', ''))).toBe('');
  });
});

describe('the caption beside the cursor', () => {
  it("is the first sentence of the model's own words, kept short", () => {
    expect(AgentCursor.caption('Click the "Add to cart" button. Then check the cart.')).toBe('Click the "Add to cart" button.');
    expect(AgentCursor.caption('x'.repeat(200)).length).toBeLessThanOrEqual(90);
    expect(AgentCursor.caption('')).toBe('');
  });
});

describe('the cursor on the page', () => {
  beforeEach(() => { document.body.innerHTML = '<button id="b" style="position:absolute;left:100px;top:50px">Go</button>'; delete window.__vexCursor; });
  it('installs once, out of reach of the page and the mouse', () => {
    installVexAgentCursor();
    installVexAgentCursor();
    const hosts = document.querySelectorAll('[data-vex-agent-cursor]');
    expect(hosts.length).toBe(1);
    expect(hosts[0].style.pointerEvents).toBe('none');
    expect(typeof window.__vexCursor.moveTo).toBe('function');
  });
  it('can be switched off', () => {
    localStorage.clear();
    expect(AgentCursor.enabled()).toBe(true);
    AgentCursor.setEnabled(false);
    expect(AgentCursor.enabled()).toBe(false);
  });
});

describe('an action that did nothing is not done again', () => {
  const { ToolCallHistory } = require('../../src/renderer/js/agent-loop.js');
  const ok = (r) => ({ ok: true, result: r });
  it('refuses the same click after it changed nothing, and points at what did change', () => {
    const h = new ToolCallHistory();
    h.add('click', { selector: '#add' }, ok('Clicked "Add to cart" — new on the page: "Added to cart: 1 item"'));
    h.add('extract_elements', {}, ok('1 interactive elements'));
    h.add('click', { selector: '#add' }, ok('Clicked "Add to cart" — nothing visible changed on the page'));
    h.add('search_in_page', { query: 'x' }, ok('Done'));
    expect(h.isStuckInLoop('click', { selector: '#add' })).toBe(true);
    const g = h.loopGuidance('click', { selector: '#add' });
    expect(g.error).toMatch(/^NOT DONE AGAIN/);
    expect(g.error).toContain('Added to cart: 1 item');
    expect(g.error).toContain('call finish');
  });
  it('lets an action that worked be done again (Next page, Next page)', () => {
    const h = new ToolCallHistory();
    h.add('click_text', { text: 'Next' }, ok('Clicked "next" — new on the page: "Page 2"'));
    h.add('extract_text', {}, ok('...'));
    expect(h.isStuckInLoop('click_text', { text: 'Next' })).toBe(false);
  });
});

describe('a retry after the page was changed in between', () => {
  const { ToolCallHistory } = require('../../src/renderer/js/agent-loop.js');
  const ok = (r) => ({ ok: true, result: r });
  it('lets "Search" be pressed again after something was typed', () => {
    const h = new ToolCallHistory();
    h.add('click', { selector: '#go' }, ok('Clicked "Search" — nothing visible changed on the page'));
    h.add('type_text', { selector: '#q', text: 'moon' }, ok('Typed text — the field now says "moon"'));
    expect(h.isStuckInLoop('click', { selector: '#go' })).toBe(false);
  });
});
