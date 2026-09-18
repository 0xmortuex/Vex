// @vitest-environment jsdom
//
// How the agent asks for permission. Three pills — "Ask /
// Plan / Auto" — did not say what they governed, and two could light at once
// (one hard-coded active in the markup, the saved one added on top). Now one
// labelled pill opens a menu that explains each choice, and the first task
// sent opens it, before anything runs. (There is no robot button any more:
// Send decides whether a message is a task — see aiSendRouting.test.js.)

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { AIPanel } = require('../../src/renderer/js/ai-panel.js');

const MARKUP = `
  <textarea id="ai-input"></textarea>
  <button id="ai-send"></button>
  <div id="ai-messages"></div>
  <div class="agent-perm">
    <button id="agent-perm-toggle" aria-expanded="false"><span id="agent-perm-label"></span></button>
    <div id="agent-perm-menu" hidden>
      <div id="agent-perm-head"></div>
      <button class="agent-perm-item" data-mode="ask"></button>
      <button class="agent-perm-item" data-mode="plan"></button>
      <button class="agent-perm-item" data-mode="auto"></button>
    </div>
  </div>`;

beforeEach(() => {
  document.body.innerHTML = MARKUP;
  localStorage.clear();
  AIPanel._pendingAgentRun = false;
  AIPanel._conversations = {}; AIPanel._viewingId = null;
  globalThis.TabManager = { activeTabId: 'tab1', tabs: [{ id: 'tab1' }], getActiveTab() { return this.tabs[0]; } };
  AIPanel.isOpen = () => true;
  globalThis.AgentLoop = { start: vi.fn(async () => {}), isRunning: () => false };
  window.showToast = vi.fn();
});

const menu = () => document.getElementById('agent-perm-menu');
const label = () => document.getElementById('agent-perm-label').textContent;
const lit = () => [...document.querySelectorAll('.agent-perm-item.active')].map(i => i.dataset.mode);

describe('the permission menu', () => {
  it('starts on Approve manually, names the choice, and lights exactly one', () => {
    AIPanel._initAgentPermission();
    expect(label()).toBe('Approve manually');
    expect(lit()).toEqual(['ask']);
    localStorage.setItem('vex.agentMode', 'auto');
    AIPanel._initAgentPermission();
    expect(label()).toBe('Auto-approve');
    expect(lit()).toEqual(['auto']);                       // never two at once
  });

  it('opens from the pill, picks a mode, remembers it, and closes', () => {
    AIPanel._initAgentPermission();
    document.getElementById('agent-perm-toggle').click();
    expect(menu().hidden).toBe(false);
    document.querySelector('.agent-perm-item[data-mode="plan"]').click();
    expect(menu().hidden).toBe(true);
    expect(label()).toBe('Plan first');
    expect(localStorage.getItem('vex.agentMode')).toBe('plan');
    expect(localStorage.getItem('vex.agentModeChosen')).toBe('1');
  });

  it('closes on a click elsewhere and on Escape, and ignores a nonsense saved mode', () => {
    localStorage.setItem('vex.agentMode', 'yolo');
    AIPanel._initAgentPermission();
    expect(label()).toBe('Approve manually');
    document.getElementById('agent-perm-toggle').click();
    document.body.click();
    expect(menu().hidden).toBe(true);
    document.getElementById('agent-perm-toggle').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(menu().hidden).toBe(true);
    expect(() => AIPanel.setAgentMode('yolo')).toThrow(/Unknown agent permission mode/);
  });
});

describe('the first task asks first', () => {
  it('on first use it opens the menu instead of running, keeps the task, and runs once a mode is picked', () => {
    AIPanel._initAgentPermission();
    document.getElementById('ai-input').value = 'rename my tab groups';
    document.getElementById('ai-send').addEventListener('click', () => AIPanel._sendChat());
    document.getElementById('ai-send').click();
    expect(AgentLoop.start).not.toHaveBeenCalled();
    expect(menu().hidden).toBe(false);                     // and the opening click did not close it again
    expect(menu().classList.contains('asking')).toBe(true);
    expect(document.getElementById('agent-perm-head').textContent).toMatch(/Before the agent starts/);
    expect(document.getElementById('ai-input').value).toBe('rename my tab groups');
    document.querySelector('.agent-perm-item[data-mode="ask"]').click();
    expect(AgentLoop.start).toHaveBeenCalledWith('rename my tab groups', 'ask');
  });

  it('dismissing the question runs nothing; after a choice the button just runs', () => {
    AIPanel._initAgentPermission();
    document.getElementById('ai-input').value = 'do a thing';
    AIPanel._sendAgent();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(AgentLoop.start).not.toHaveBeenCalled();
    expect(AIPanel._pendingAgentRun).toBe(false);
    AIPanel.setAgentMode('auto');
    AIPanel._sendAgent();
    expect(AgentLoop.start).toHaveBeenCalledWith('do a thing', 'auto');
    expect(menu().hidden).toBe(true);
  });
});
