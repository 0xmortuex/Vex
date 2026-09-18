// @vitest-environment jsdom
//
// The agent's page tools, run for real: the webview here evaluates the SAME
// script the executor injects, against this jsdom document.
//   type_text wrote el.value directly — React/Vue inputs never noticed, and the
//     advice to "press Enter with \n" pressed nothing, so a search box took the
//     text and then nothing happened.
//   click fired `click` alone — a menu that opens on pointerdown never opened.

import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { AgentExecutor, PAGE_TOOLS } = require('../../src/renderer/js/agent-executor.js');

function guest() {
  return {
    getURL: () => 'https://site.example/', isLoading: () => false,
    executeJavaScript: (code) => Promise.resolve((0, eval)(code)),
    sendInputEvent: vi.fn(),
  };
}
const box = (el) => { el.getBoundingClientRect = () => ({ left: 10, top: 10, width: 80, height: 20, right: 90, bottom: 30 }); return el; };

beforeEach(() => {
  document.body.innerHTML = '';
  Element.prototype.scrollIntoView = () => {};
  globalThis.WebviewManager = { getActiveWebview: () => null, webviews: new Map() };
  globalThis.TabManager = { tabs: [], activeTabId: null };
  delete window.VexTabPolicy;
});

describe('type_text', () => {
  it('goes through the native setter with a real input event, so framework inputs see it', async () => {
    document.body.innerHTML = '<input id="q" value="old">';
    const el = document.getElementById('q');
    const events = [];
    el.addEventListener('input', (e) => events.push(e.constructor.name + ':' + e.inputType));
    el.addEventListener('change', () => events.push('change'));
    const r = await AgentExecutor.executeTool('type_text', { selector: '#q', text: 'electron' }, { webview: guest() });
    expect(r).toEqual({ ok: true, result: 'Typed text' });
    expect(el.value).toBe('electron');                       // replaced, not appended
    expect(events).toEqual(['InputEvent:insertText', 'change']);
    await AgentExecutor.executeTool('type_text', { selector: '#q', text: ' docs', clearFirst: false }, { webview: guest() });
    expect(el.value).toBe('electron docs');
  });

  it('submit:true presses Enter and submits the form; a trailing newline means the same', async () => {
    document.body.innerHTML = '<form id="f"><input id="q"></form>';
    const form = document.getElementById('f');
    const submitted = vi.fn((e) => e.preventDefault());
    form.addEventListener('submit', submitted);
    const keys = [];
    document.getElementById('q').addEventListener('keydown', (e) => keys.push(e.key));
    const wv = guest();
    const r = await AgentExecutor.executeTool('type_text', { selector: '#q', text: 'vex browser', submit: true }, { webview: wv });
    expect(r.result).toBe('Typed text and pressed Enter');
    expect(keys).toEqual(['Enter']);
    expect(submitted).toHaveBeenCalledTimes(1);
    expect(wv.sendInputEvent).not.toHaveBeenCalled();          // the form took it; no second Enter
    await AgentExecutor.executeTool('type_text', { selector: '#q', text: 'again\n' }, { webview: wv });
    expect(document.getElementById('q').value).toBe('again');
    expect(submitted).toHaveBeenCalledTimes(2);
  });

  it('with no form, sends a real Enter key into the page', async () => {
    document.body.innerHTML = '<input id="q">';
    const wv = guest();
    await AgentExecutor.executeTool('type_text', { selector: '#q', text: 'hi', submit: true }, { webview: wv });
    expect(wv.sendInputEvent.mock.calls.map(c => c[0].type + ':' + c[0].keyCode)).toEqual(['keyDown:Enter', 'char:\r', 'keyUp:Enter']);
  });

  it('reports a missing field as a failure', async () => {
    const r = await AgentExecutor.executeTool('type_text', { selector: '#nope', text: 'x' }, { webview: guest() });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Element not found: #nope/);
  });
});

describe('click and click_text', () => {
  it('sends the whole pointer sequence, not click alone', async () => {
    document.body.innerHTML = '<button id="menu">Open menu</button>';
    const el = box(document.getElementById('menu'));
    const seen = [];
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.addEventListener(t, () => seen.push(t));
    const r = await AgentExecutor.executeTool('click', { selector: '#menu' }, { webview: guest() });
    expect(r).toEqual({ ok: true, result: 'Clicked "Open menu"' });
    expect(seen).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
  });

  it('click_text finds the closest visible match: exact, then starts-with, then contains', async () => {
    document.body.innerHTML = '<a href="#a" id="a">Sign in to continue</a><button id="b">Sign in</button><button id="c" style="display:none">Sign in</button>';
    for (const el of document.querySelectorAll('a, button')) box(el);
    const clicked = [];
    for (const el of document.querySelectorAll('a, button')) el.addEventListener('click', (e) => { e.preventDefault(); clicked.push(el.id); });
    expect(await AgentExecutor.executeTool('click_text', { text: 'sign in' }, { webview: guest() })).toEqual({ ok: true, result: 'Clicked "sign in"' });
    expect(clicked).toEqual(['b']);
    await AgentExecutor.executeTool('click_text', { text: 'continue' }, { webview: guest() });
    expect(clicked).toEqual(['b', 'a']);
    // A label broken across lines in the markup still matches — and its letters
    // survive (a whitespace regex that lost its backslash once ate every "s").
    document.body.insertAdjacentHTML('beforeend', '<button id="d">Show\n      all   sessions</button>');
    box(document.getElementById('d')).addEventListener('click', () => clicked.push('d'));
    expect((await AgentExecutor.executeTool('click_text', { text: 'show all sessions' }, { webview: guest() })).result).toBe('Clicked "show all sessions"');
    expect(clicked).toEqual(['b', 'a', 'd']);
    const miss = await AgentExecutor.executeTool('click_text', { text: 'checkout' }, { webview: guest() });
    expect(miss.ok).toBe(false);
    expect(miss.error).toMatch(/Nothing clickable says "checkout" — call extract_elements/);
  });
});

describe('select_option and press_key', () => {
  it('chooses by value or by the text the user sees, and lists the options when wrong', async () => {
    document.body.innerHTML = '<select id="s"><option value="us">United States</option><option value="tr">Türkiye</option></select>';
    const changed = vi.fn();
    document.getElementById('s').addEventListener('change', changed);
    await AgentExecutor.executeTool('select_option', { selector: '#s', value: 'türkiye' }, { webview: guest() });
    expect(document.getElementById('s').value).toBe('tr');
    expect(changed).toHaveBeenCalledTimes(1);
    const bad = await AgentExecutor.executeTool('select_option', { selector: '#s', value: 'Mars' }, { webview: guest() });
    expect(bad.error).toMatch(/No option "Mars". Options: United States \| Türkiye/);
  });

  it('press_key sends a real key and refuses an unknown one', async () => {
    const wv = guest();
    expect(await AgentExecutor.executeTool('press_key', { key: 'ArrowDown' }, { webview: wv })).toEqual({ ok: true, result: 'Pressed Down' });
    expect(wv.sendInputEvent.mock.calls.map(c => c[0].type + ':' + c[0].keyCode)).toEqual(['keyDown:Down', 'keyUp:Down']);
    expect((await AgentExecutor.executeTool('press_key', { key: 'F13' }, { webview: wv })).error).toMatch(/press_key takes one of/);
  });
});

describe('what needs a page and what does not', () => {
  it('page tools say what to do when none is open; the rest run anyway', async () => {
    const r = await AgentExecutor.executeTool('click', { selector: '#x' });
    expect(r).toEqual({ ok: false, error: 'No page is open — use new_tab first, or a tool that needs no page (web_search, read_url)' });
    expect(PAGE_TOOLS).toContain('click_text');
    for (const t of ['web_search', 'read_url', 'read_tab', 'save_note', 'create_reminder', 'add_bookmark', 'search_history', 'group_tabs', 'list_tabs']) expect(PAGE_TOOLS, t).not.toContain(t);
    globalThis.AgentTools = { webSearch: vi.fn(async (q) => ({ query: q, engine: 'DuckDuckGo', results: [] })) };
    expect((await AgentExecutor.executeTool('web_search', { query: 'vex' })).ok).toBe(true);
    delete globalThis.AgentTools;
  });

  it('read_tab reads another open tab without switching, and says so when it is asleep', async () => {
    document.body.innerHTML = '<main>Background tab text</main>';
    const other = guest();
    globalThis.TabManager = { tabs: [{ id: 'a', title: 'A', url: 'https://a.example/' }, { id: 'z', title: 'Z', url: 'https://z.example/', sleeping: true }], activeTabId: 'x' };
    globalThis.WebviewManager = { getActiveWebview: () => null, webviews: new Map([['a', other]]) };
    const r = await AgentExecutor.executeTool('read_tab', { tabId: 'a' });
    expect(r.result).toMatchObject({ title: 'A', url: 'https://a.example/' });
    expect(r.result.text).toContain('Background tab text');
    expect((await AgentExecutor.executeTool('read_tab', { tabId: 'z' })).error).toMatch(/asleep — switch_tab to it first, or read_url its address: https:\/\/z\.example\//);
    expect((await AgentExecutor.executeTool('read_tab', { tabId: 'nope' })).error).toMatch(/list_tabs gives the ids/);
  });
});
