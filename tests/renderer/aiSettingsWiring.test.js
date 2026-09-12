// @vitest-environment jsdom
//
// AI Backend section (ai-settings.js). Its radios, model select and refresh
// buttons live in the static index.html markup, but SidebarManager re-renders
// the section on EVERY Settings open — so wiring them each time stacked one more
// listener per open: N toasts and N router writes per click, and concurrent
// "Checking…" runs that restored the wrong button label. Only the routing grid
// is rebuilt, so only it may be re-wired.

import { beforeEach, describe, expect, it, vi } from 'vitest';

function settingsMarkup() {
  return `
    <span id="cloud-status"></span>
    <span id="local-status"></span>
    <div id="ai-mode-radio">
      <label><input type="radio" name="ai-mode" value="auto" checked></label>
      <label><input type="radio" name="ai-mode" value="local"></label>
      <label><input type="radio" name="ai-mode" value="cloud"></label>
    </div>
    <div id="local-model-row"><select id="local-model-select"></select></div>
    <button id="btn-refresh-ollama"></button>
    <button id="btn-refresh-ollama-inline"></button>
    <button id="btn-install-ollama"></button>
    <div id="routing-grid"></div>`;
}

let routingWrites;

beforeEach(async () => {
  vi.resetModules();
  document.body.innerHTML = settingsMarkup();
  routingWrites = [];
  window.escapeHtml = (s) => String(s);
  window.showToast = vi.fn();
  globalThis.AIRouter = {
    getOllamaStatus: () => ({ online: false, models: [], model: '' }),
    isOllamaAvailable: () => false,
    listModels: async () => [],
    getModel: () => '',
    setModel: vi.fn(),
    setPreferLocal: vi.fn(),
    setForceCloud: vi.fn(),
    getPreferLocal: () => false,
    getForceCloud: () => false,
    refreshOllamaStatus: async () => false,
    getRoutingPrefs: () => ({}),
    setRoutingPrefs: (p) => routingWrites.push(p),
  };
  globalThis.TabManager = { createTab: vi.fn() };
  await import('../../src/renderer/js/ai-settings.js');
});

describe('AISettings re-render', () => {
  it('wires the static controls once however often Settings is opened', async () => {
    for (let i = 0; i < 4; i++) await window.AISettings.renderAISettings();
    const local = document.querySelector('input[name="ai-mode"][value="local"]');
    local.checked = true;
    local.dispatchEvent(new Event('change', { bubbles: true }));
    expect(AIRouter.setPreferLocal).toHaveBeenCalledTimes(1);
    expect(window.showToast).toHaveBeenCalledTimes(1);
  });

  it('fires one refresh per click on either refresh button', async () => {
    const spy = vi.spyOn(AIRouter, 'refreshOllamaStatus');
    for (let i = 0; i < 3; i++) await window.AISettings.renderAISettings();
    document.getElementById('btn-refresh-ollama').click();
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('still re-wires the routing grid, which is rebuilt each render', async () => {
    await window.AISettings.renderAISettings();
    await window.AISettings.renderAISettings();
    const sel = document.querySelector('#routing-grid select:not([disabled])');
    expect(sel).toBeTruthy();
    sel.value = sel.options[sel.options.length - 1].value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    // Rebuilt markup means fresh nodes, so exactly one write — never zero.
    expect(routingWrites.length).toBe(1);
  });
});

describe('Ollama install dialog', () => {
  it('never stacks overlays, and the Close button closes the live one', async () => {
    await window.AISettings.renderAISettings();
    const open = () => document.getElementById('btn-install-ollama').click();
    open(); open(); open();
    const overlays = document.querySelectorAll('.sync-modal-overlay');
    expect(overlays.length).toBe(1);
    overlays[0].querySelector('#close-install-modal').click();
    expect(document.querySelectorAll('.sync-modal-overlay').length).toBe(0);
  });

  it('closes on Escape', async () => {
    await window.AISettings.renderAISettings();
    document.getElementById('btn-install-ollama').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelectorAll('.sync-modal-overlay').length).toBe(0);
  });
});
