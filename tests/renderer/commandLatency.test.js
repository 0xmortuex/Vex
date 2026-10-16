// @vitest-environment jsdom
//
// T0-013: Ctrl+K latency budget and provider isolation. With thousands of
// commands the first results must show quickly (the list used to be drawn in
// full before the first row showed: 500 ms for "a" at 3000 commands); every
// source of results runs isolated and timed, so one that throws, or is slow,
// costs the palette only that source, with a "still searching" line while it
// is waited for.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { CommandBar } = require('../../src/renderer/js/command.js');

// The product target is 50 ms for the first paint at 2000 commands on a normal
// PC. CI machines are slower and jsdom draws rows slowly, so the assertions use
// a generous bound; the measured times are printed.
const BUDGET_MS = 50;
const CI_BUDGET_MS = 400;

const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'tab', 'mail', 'note', 'open', 'close', 'save', 'toggle', 'search', 'panel'];
function synthetic(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: 'syn' + i, label: WORDS[i % 13] + ' ' + WORDS[(i * 7) % 13] + ' ' + i,
    hint: 'Synthetic ' + WORDS[(i * 3) % 13], icon: 'plus', action() {},
  }));
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const rows = () => document.querySelectorAll('#command-results .command-result').length;
const statusText = () => (document.getElementById('command-status') || { textContent: '', style: {} }).textContent;

let realCommands;
beforeEach(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  document.body.innerHTML = '<div id="command-overlay"><input id="command-input"><div id="command-results"></div></div>';
  realCommands = CommandBar.commands;
  CommandBar.commands = synthetic(3000);
  CommandBar.isOpen = true;
  CommandBar.selectedIndex = 0;
  CommandBar._providerStats = {};
  CommandBar._providers = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  CommandBar.commands = realCommands;
  delete globalThis.VexQuickCommands; delete globalThis.Toolbox; delete globalThis.TabContentIndex; delete globalThis.TabManager;
  delete globalThis.VexCalc; delete globalThis.VexFeatures; delete window.ClipboardHistory;
  vi.restoreAllMocks();
});

describe('first paint at thousands of commands', () => {
  it('shows the first results fast at 3000 synthetic commands, and records what each provider took', () => {
    const report = [];
    for (const q of ['a', 'tab', 'open save', '>tab', 'zz', '']) {
      const t0 = performance.now();
      CommandBar.search(q);
      const ms = performance.now() - t0;
      report.push(`${JSON.stringify(q)} ${ms.toFixed(1)} ms (${CommandBar.results.length} results, ${rows()} drawn)`);
      expect(ms, `search ${JSON.stringify(q)}`).toBeLessThan(CI_BUDGET_MS);
      expect(rows()).toBeLessThanOrEqual(Math.max(CommandBar.FIRST_ROWS, 1));
    }
    console.info('[bench] 3000 commands, first paint:', report.join('; '));
    const timings = CommandBar.providerTimings();
    expect(timings.commands.calls).toBeGreaterThan(0);
    expect(typeof timings.commands.ms).toBe('number');
    expect(CommandBar._lastSearchMs).toBeGreaterThanOrEqual(0);
  });

  it('meets the 50 ms product budget at 2000 commands when the machine is not loaded (informational on CI)', () => {
    CommandBar.commands = synthetic(2000);
    CommandBar.search('tab');                      // warm: the lower-cased forms are made once
    const t0 = performance.now();
    CommandBar.search('tab o');
    const ms = performance.now() - t0;
    console.info('[bench] 2000 commands, warm "tab o": ' + ms.toFixed(1) + ' ms (budget ' + BUDGET_MS + ' ms)');
    expect(ms).toBeLessThan(CI_BUDGET_MS);
  });

  it('draws only the first rows at once, the rest right after, and every row is reachable with the arrows', async () => {
    CommandBar.search('a');
    expect(CommandBar.results.length).toBeGreaterThan(1000);
    expect(rows()).toBe(CommandBar.FIRST_ROWS);
    for (let i = 0; i < 100 && rows() < CommandBar.results.length; i++) await wait(50);
    expect(rows()).toBe(CommandBar.results.length);
    // Arrowing up from the top wraps to the last row, which must exist already
    // even before the rest has been drawn.
    CommandBar.search('a');
    expect(rows()).toBe(CommandBar.FIRST_ROWS);
    CommandBar.selectPrev();
    expect(CommandBar.selectedIndex).toBe(CommandBar.results.length - 1);
    expect(rows()).toBe(CommandBar.results.length);
    expect(document.querySelectorAll('#command-results .command-result.selected')).toHaveLength(1);
  });

  it('the cached lower-casing follows a changed label', () => {
    const c = { id: 'x', label: 'Alpha Thing', hint: '', action() {} };
    expect(CommandBar._scoreCommand('alpha', c)).toBe(100);
    c.label = 'Beta Thing';
    expect(CommandBar._scoreCommand('alpha', c)).toBe(0);
    expect(CommandBar._scoreCommand('thing', c)).toBe(85);
  });
});

describe('one provider failing never blanks the palette', () => {
  beforeEach(() => { CommandBar.commands = [{ id: 'new', label: 'New Tab', hint: 'Open a new tab', icon: 'plus', action() {} }]; });

  it('survives every provider throwing at once and still lists the commands and the search row', () => {
    globalThis.VexQuickCommands = { results() { throw new Error('quick broke'); }, withoutOpener: q => q };
    globalThis.VexCalc = { evaluate() { throw new Error('calc broke'); } };
    globalThis.Toolbox = { all() { throw new Error('toolbox broke'); } };
    globalThis.TabManager = { tabs: [{ id: 't1', title: 'New tab page', url: 'https://x.example/', favicon: '' }], activeTabId: 'zz', getActiveTab() { return null; } };
    globalThis.TabContentIndex = { search() { throw new Error('index broke'); } };
    window.ClipboardHistory = { enabled() { return true; }, list() { throw new Error('clip broke'); } };
    globalThis.VexFeatures = { search() { throw new Error('features broke'); } };
    expect(() => CommandBar.search('new')).not.toThrow();
    const ids = CommandBar.results.map(r => r.id);
    expect(ids).toContain('new');
    expect(ids).toContain('search');
    expect(ids).toContain('tab:t1');                  // the title match survives the content index throwing
    const t = CommandBar.providerTimings();
    for (const id of ['quick-commands', 'calculator', 'tools', 'tab-content', 'clipboard']) expect(t[id].failures, id).toBe(1);
    expect(t['quick-commands'].lastError).toBe('quick broke');
    expect(rows()).toBe(CommandBar.results.length);
  });

  it('a command whose when() throws is left out and the rest show', () => {
    CommandBar.commands = [
      { id: 'bad', label: 'New Bad', icon: 'plus', when() { throw new Error('nope'); }, action() {} },
      { id: 'good', label: 'New Good', icon: 'plus', action() {} },
    ];
    CommandBar.search('new');
    expect(CommandBar.results.map(r => r.id)).toContain('good');
    expect(CommandBar.results.map(r => r.id)).not.toContain('bad');
  });
});

describe('slow providers answer late, with a still-searching line', () => {
  it('shows the first paint without it, "still searching" after 80 ms, then adds the answer', async () => {
    CommandBar.commands = [{ id: 'new', label: 'New Tab', icon: 'plus', action() {} }];
    CommandBar.registerProvider({ id: 'notes', label: 'Notes', search: () => new Promise(r => setTimeout(() => r([{ id: 'note:1', label: 'New boiler note', action() {} }]), 200)) });
    const t0 = performance.now();
    CommandBar.search('new');
    expect(performance.now() - t0).toBeLessThan(CI_BUDGET_MS);
    expect(CommandBar.results.map(r => r.id)).not.toContain('note:1');
    expect(statusText()).toBe('');
    await wait(140);
    expect(statusText()).toBe('Still searching: Notes…');
    await wait(220);
    expect(CommandBar.results.map(r => r.id)).toContain('note:1');
    expect(rows()).toBe(CommandBar.results.length);
    expect(statusText()).toBe('');
    expect(CommandBar.providerTimings().notes.late).toBe(1);
  });

  it('a provider that rejects or throws costs only itself', async () => {
    CommandBar.commands = [{ id: 'new', label: 'New Tab', icon: 'plus', action() {} }];
    CommandBar.registerProvider({ id: 'mail', label: 'Mail', search: () => Promise.reject(new Error('imap down')) });
    CommandBar.registerProvider({ id: 'library', label: 'Library', search: () => { throw new Error('sync throw'); } });
    CommandBar.registerProvider({ id: 'kb', label: 'Knowledge base', search: () => [{ id: 'kb:1', label: 'New note from kb', action() {} }] });
    CommandBar.search('new');
    await wait(60);
    const ids = CommandBar.results.map(r => r.id);
    expect(ids).toContain('new');
    expect(ids).toContain('kb:1');
    const t = CommandBar.providerTimings();
    expect(t.mail.failures).toBe(1);
    expect(t.library.failures).toBe(1);
    expect(t.mail.lastError).toBe('imap down');
    expect(statusText()).toBe('');
  });

  it('an answer for an old query is dropped', async () => {
    CommandBar.commands = [{ id: 'new', label: 'New Tab', icon: 'plus', action() {} }];
    CommandBar.registerProvider({ id: 'slow', label: 'Slow', search: (q) => new Promise(r => setTimeout(() => r([{ id: 'late:' + q, label: 'late ' + q, action() {} }]), 100)) });
    CommandBar.search('new');
    CommandBar.search('new t');
    await wait(220);
    const ids = CommandBar.results.map(r => r.id);
    expect(ids).toContain('late:new t');
    expect(ids).not.toContain('late:new');
  });

  it('a built-in provider that was slow moves after the first paint, and back when it is fast', async () => {
    CommandBar.commands = [{ id: 'new', label: 'New Tab', icon: 'plus', action() {} }];
    globalThis.TabManager = { tabs: [{ id: 't1', title: 'Order confirmation', url: 'https://shop.example/o', favicon: '' }], activeTabId: 'zz', getActiveTab() { return null; } };
    let slow = true;
    globalThis.TabContentIndex = { search() { if (slow) { const e = performance.now() + 40; while (performance.now() < e) { /* busy */ } } return [{ tabId: 't1', score: 3 }]; } };
    CommandBar.search('refund');                       // measured: slow (40 ms)
    expect(CommandBar.results.map(r => r.id)).toContain('tab:t1');
    CommandBar.search('refund');                       // now deferred
    expect(CommandBar.results.map(r => r.id)).not.toContain('tab:t1');
    await wait(80);
    expect(CommandBar.results.map(r => r.id)).toContain('tab:t1');
    slow = false;
    CommandBar.search('refund');
    for (let i = 0; i < 50 && CommandBar.providerTimings()['tab-content'].ms > CommandBar.SLOW_MS; i++) await wait(20);   // the deferred run measures it fast
    CommandBar.search('refund');
    expect(CommandBar.results.map(r => r.id)).toContain('tab:t1');   // inline again
  });

  it('refuses a provider without an id or search, and a duplicate', () => {
    expect(() => CommandBar.registerProvider({ id: '', search() {} })).toThrow();
    expect(() => CommandBar.registerProvider({ id: 'x' })).toThrow();
    const off = CommandBar.registerProvider({ id: 'dup', search: () => [] });
    expect(() => CommandBar.registerProvider({ id: 'dup', search: () => [] })).toThrow('exists already');
    off();
    expect(() => CommandBar.registerProvider({ id: 'dup', search: () => [] })).not.toThrow();
  });
});
