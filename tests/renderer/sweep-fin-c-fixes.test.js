// @vitest-environment jsdom
//
// Fixes from the 2026-09-29 pass (area fin-c): a player frame added after a
// page loaded gets the volume and Night mode, a persona no longer replaces the
// Group Tabs / multi-tab prompts, history search and the agent go back to this
// tab's chat, a group's arrow points the right way, and the shortcut editor
// asks main to let its keys through while it records.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;

const flush = () => new Promise(r => setTimeout(r, 0));

// ---- 8: late frames ---------------------------------------------------------
describe('a frame that loads after the page', () => {
  let SV;
  const frameLoad = (wv, isMainFrame) => {
    const e = new Event('did-frame-finish-load');   // <webview> events do not bubble
    e.isMainFrame = isMainFrame;
    wv.dispatchEvent(e);
  };
  const webview = (url) => {
    const wv = document.createElement('webview');
    wv.getURL = () => url;
    wv.getWebContentsId = () => 7;
    document.body.appendChild(wv);
    return wv;
  };

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    localStorage.clear();
    document.body.innerHTML = '';
    window.VexProblems = { note: vi.fn() };
    window.vex = { evalAllFrames: vi.fn(async () => ({ ok: true, results: [{ ok: true, value: { ok: true, touched: 1, media: 1, frames: 0 } }] })) };
    SV = require('../../src/renderer/js/site-volume.js');
  });
  afterEach(() => { vi.useRealTimers(); delete window.vex; });

  it('is heard once its burst settles, for embedded frames only', () => {
    const fn = vi.fn();
    SV.vexOnLateFrame(fn, 400);
    const wv = webview('https://a.example/');
    frameLoad(wv, true);
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();                 // the page itself has dom-ready
    frameLoad(wv, false); frameLoad(wv, false); frameLoad(wv, false);
    vi.advanceTimersByTime(399);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(wv);
  });

  it('gets the volume kept for the site', async () => {
    SV.SiteVolume.set('https://a.example/', 30);
    SV.SiteVolume.init();
    const wv = webview('https://a.example/watch');
    frameLoad(wv, false);
    vi.advanceTimersByTime(500);
    expect(window.vex.evalAllFrames).toHaveBeenCalledTimes(1);
    expect(window.vex.evalAllFrames.mock.calls[0][1]).toContain('window.__vexVolume = 0.3');
    const other = webview('https://b.example/');
    frameLoad(other, false);
    vi.advanceTimersByTime(500);
    expect(window.vex.evalAllFrames).toHaveBeenCalledTimes(1);   // nothing kept there
  });

  it('gets Night mode on a site that has it on', () => {
    window.vexOnLateFrame = SV.vexOnLateFrame;
    window.vexGuestEvalFrames = SV.vexGuestEvalFrames;
    const { NightAudio } = require('../../src/renderer/js/night-audio.js');
    NightAudio.remember('https://film.example/', true);
    NightAudio.init();
    frameLoad(webview('https://film.example/x'), false);
    vi.advanceTimersByTime(500);
    expect(window.vex.evalAllFrames).toHaveBeenCalledTimes(1);
    expect(window.vex.evalAllFrames.mock.calls[0][1]).toContain('__vexNight');
    frameLoad(webview('https://quiet.example/'), false);
    vi.advanceTimersByTime(500);
    expect(window.vex.evalAllFrames).toHaveBeenCalledTimes(1);
  });

  it('gets the Master Volume level, when it is not 100%', () => {
    window.vexOnLateFrame = SV.vexOnLateFrame;
    window.vexGuestEvalFrames = SV.vexGuestEvalFrames;
    const { MasterVolume } = require('../../src/renderer/js/master-volume.js');   // wires itself on load
    const wv = webview('https://a.example/');
    frameLoad(wv, false);
    vi.advanceTimersByTime(500);
    expect(window.vex.evalAllFrames).not.toHaveBeenCalled();     // 100%: nothing to do
    localStorage.setItem(MasterVolume.KEY, '2');
    frameLoad(wv, false);
    vi.advanceTimersByTime(500);
    expect(window.vex.evalAllFrames).toHaveBeenCalledTimes(1);
    expect(window.vex.evalAllFrames.mock.calls[0][1]).toContain('__vexMV');
    delete window.vexOnLateFrame; delete window.vexGuestEvalFrames;
  });
});

// ---- 9a: a persona and the prompts that are not its to replace -------------
describe('a persona on the local model', () => {
  let AIRouter;
  beforeEach(async () => {
    vi.resetModules();
    AIRouter = (await import('../../src/renderer/js/ai-router.js')).AIRouter;
    globalThis.MultiTabContext = { formatForAI: (cs) => cs.map(c => c.title).join(' | ') };
    globalThis.Ollama = { ping: vi.fn(async () => true), generate: vi.fn(async () => '{}'), chat: vi.fn(async () => '{}'), getBaseUrl: () => 'http://127.0.0.1:11434' };
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { delete globalThis.Ollama; delete globalThis.MultiTabContext; vi.restoreAllMocks(); });
  const persona = { systemPrompt: 'You are a PIRATE.' };
  const sys = () => globalThis.Ollama.generate.mock.calls[0][2].systemPrompt;

  it('does not replace Group Tabs\' own JSON prompt', async () => {
    await AIRouter.callOn('local', 'groupTabs', { tabs: [], persona });
    expect(sys()).toMatch(/^You cluster browser tabs/);
    expect(sys()).not.toContain('PIRATE');
  });

  it('gives a multi-tab question its voice, and the question keeps its own prompt', async () => {
    await AIRouter.callOn('local', 'multiTab', { message: 'compare', tabContexts: [{ title: 'Tab A', text: 'a' }], persona });
    expect(sys()).toMatch(/^You are Vex AI/);
    expect(sys()).toContain('{"reply"');
    expect(sys()).toContain('PIRATE');
  });

  it('still replaces the plain chat prompt', async () => {
    await AIRouter.callOn('local', 'chat', { message: 'hi', persona });
    expect(sys()).toMatch(/^You are a PIRATE/);
  });
});

// ---- 9b, 9c: back to this tab's chat ----------------------------------------
describe('with an earlier chat on screen', () => {
  let AIPanel;
  const msgs = () => document.getElementById('ai-messages');
  const texts = (id) => (AIPanel._conversations[id] || []).map(m => m.content);

  beforeEach(() => {
    vi.resetModules();
    ({ AIPanel } = require('../../src/renderer/js/ai-panel.js'));
    document.body.innerHTML = `
      <button id="btn-toggle-ai"></button>
      <div id="ai-panel" class="open">
        <div id="ai-current-tab"></div>
        <div id="ai-messages"></div>
        <textarea id="ai-input"></textarea>
        <button id="ai-send"></button><button id="ai-stop-agent"></button><button id="ai-pause-agent"></button>
      </div>`;
    localStorage.clear();
    window.showToast = vi.fn();
    window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const tabs = [{ id: 'tab-1', title: 'One', url: 'https://one.example/' }, { id: 'tab-2', title: 'Two', url: 'https://two.example/' }];
    globalThis.TabManager = { activeTabId: 'tab-1', tabs, getActiveTab: () => tabs.find(t => t.id === globalThis.TabManager.activeTabId) };
    globalThis.VexMarkdown = { render: (t) => '<p>' + t + '</p>' };
    globalThis.AIPanel = AIPanel;
    AIPanel._conversations = { 'tab-2': [{ role: 'user', content: 'old question', at: 1 }, { role: 'assistant', content: 'old answer', at: 2 }] };
    AIPanel._convPrivate = {};
    AIPanel._sending = false;
    AIPanel._viewingId = 'tab-2';
    AIPanel._renderMessages();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { delete globalThis.AIRouter; delete globalThis.AgentLoop; delete window.HistoryPanel; vi.restoreAllMocks(); });

  it('a history search is saved to this tab\'s chat and drawn there', async () => {
    window.HistoryPanel = { entries: [{ id: 'h1', url: 'https://x.example/', title: 'X' }] };
    globalThis.AIRouter = { callAI: vi.fn(async () => ({ result: '{"matches":[],"interpretation":"x"}' })) };
    await AIPanel._handleHistorySearch('that article');
    expect(AIPanel._viewingId).toBe(null);
    // The answer is kept with the chat too, or a redraw lost it (2026-09-29).
    expect(texts('tab-1')).toEqual(['that article', 'x\n\nNo matching pages found in your history.']);
    expect(texts('tab-2')).toEqual(['old question', 'old answer']);
    expect(msgs().textContent).not.toContain('old answer');
  });

  it('an agent task is drawn in this tab\'s chat, not under the earlier one', async () => {
    localStorage.setItem('vex.agentModeChosen', '1');
    globalThis.AgentLoop = { start: vi.fn(() => new Promise(() => {})), isRunning: () => false, lastRun: null, runs: () => [] };
    document.getElementById('ai-input').value = 'do the thing';
    AIPanel._sendAgent();
    expect(AIPanel._viewingId).toBe(null);
    expect(texts('tab-1')).toEqual(['do the thing']);
    expect(msgs().textContent).not.toContain('old answer');
    expect(msgs().textContent).toContain('do the thing');
  });
});

// ---- 10: the group arrow ------------------------------------------------------
describe('a tab group\'s arrow', () => {
  it('turns down when the group is open, and stays pointing right when collapsed', () => {
    const css = fs.readFileSync(path.join(__dirname, '../../src/renderer/css/tabs.css'), 'utf8');
    expect(css).toMatch(/\.tab-group:not\(\.collapsed\) \.tab-group-chevron \{\s*transform: rotate\(90deg\);/);
    expect(css).not.toMatch(/\.tab-group\.collapsed \.tab-group-chevron \{\s*transform/);
  });
});

// ---- 11: recording a key main would otherwise take -----------------------------
describe('the shortcut editor while it records', () => {
  let ShortcutsRegistry, ShortcutEditor;
  beforeEach(() => {
    vi.resetModules();
    ShortcutsRegistry = require('../../src/renderer/js/shortcuts-registry.js');
    ShortcutEditor = require('../../src/renderer/js/shortcut-editor.js');
    localStorage.clear();
    document.body.innerHTML = '<div id="host"></div>';
    window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    window.showToast = vi.fn();
    globalThis.ShortcutsRegistry = ShortcutsRegistry;
    globalThis.CommandBar = { commands: [{ id: 'zap', label: 'Zap an element', action: () => {} }] };
    ShortcutsRegistry.resetAll();
    ShortcutsRegistry.init();
    window.vex = { setShortcutCapturing: vi.fn() };
    ShortcutEditor.renderPanel(document.getElementById('host'));
  });
  afterEach(() => { delete window.vex; });
  const key = (init) => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));

  it('tells main when it starts and when Escape ends it', () => {
    document.querySelector('[data-add="zap"]').click();
    expect(window.vex.setShortcutCapturing.mock.calls).toEqual([[true]]);
    key({ key: 'Escape' });
    expect(window.vex.setShortcutCapturing.mock.calls).toEqual([[true], [false]]);
  });

  it('ends it on a click elsewhere, and on a bound key', () => {
    document.querySelector('[data-add="zap"]').click();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(window.vex.setShortcutCapturing).toHaveBeenLastCalledWith(false);
    document.querySelector('[data-add="zap"]').click();
    key({ key: '1', ctrlKey: true, altKey: true });
    expect(ShortcutsRegistry.getShortcut('cmd:zap')).toBe('Ctrl+Alt+1');
    expect(window.vex.setShortcutCapturing).toHaveBeenLastCalledWith(false);
  });

  it('Ctrl+T pressed while recording gets the registry\'s answer, not a new tab', () => {
    document.querySelector('[data-add="zap"]').click();
    key({ key: 't', code: 'KeyT', ctrlKey: true });
    expect(ShortcutsRegistry.getShortcut('cmd:zap')).toBeNull();
    expect(window.showToast.mock.calls[0][0]).toMatch(/already used by "New Tab"/);
    expect(window.vex.setShortcutCapturing).toHaveBeenLastCalledWith(false);
  });

  it('works where main offers no such call', () => {
    delete window.vex;
    document.querySelector('[data-add="zap"]').click();
    expect(() => key({ key: 'Escape' })).not.toThrow();
  });
});
