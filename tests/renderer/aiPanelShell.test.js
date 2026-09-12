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
    <div class="persona-dropdown" id="persona-dropdown" hidden></div>
    <div id="tab-selector-dropdown" hidden></div>
  </div>`;

beforeEach(() => {
  document.body.innerHTML = MARKUP;
  localStorage.clear();
  AIPanel._shellReady = false;
  AIPanel._conversations = {};
  AIPanel._unbindDismiss();
  global.window.TabManager = { activeTabId: 'tab-1', tabs: [{ id: 'tab-1', title: 'A page' }], switchTab: vi.fn() };
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

  // A page click never reaches this document; window blur is the signal.
  it('closes when focus leaves for a page', async () => {
    await openPanel();
    window.dispatchEvent(new Event('blur'));
    expect(AIPanel.isOpen()).toBe(false);
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
