// @vitest-environment jsdom
// Ctrl+K "Ask Vex to do something…" (js/agent-command.js), AI audit 2026-10-10:
// a request it could not parse opened the AI tab manager empty, and its own
// "group" left a stack id on tabs it grouped.
import { beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.VexIcons = require('../../src/renderer/js/vex-icons.js').VexIcons;
require('../../src/renderer/js/agent-command.js');
const AgentCommand = window.AgentCommand;
const { TabAI } = require('../../src/renderer/js/tab-ai-media.js');
globalThis.TabAI = TabAI;

beforeEach(() => {
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  globalThis.TabManager = {
    activeTabId: 'a', groups: [], stacks: [],
    tabs: [
      { id: 'a', title: 'GitHub repo', url: 'https://github.com/x', stackId: 's1' },
      { id: 'b', title: 'GitHub docs', url: 'https://docs.github.com/y', stackId: 's1' },
      { id: 'c', title: 'News', url: 'https://news.example/z' },
    ],
    _setTabGroup(tabId, groupId) { const t = this.tabs.find(x => x.id === tabId); t.groupId = groupId; if (groupId) t.stackId = null; return t; },
    persistTabs: vi.fn(), rebuildAllTabs: vi.fn(),
  };
});

describe('Ask Vex to do something…', () => {
  it('hands what you typed to the AI tab manager, which plans it straight away', async () => {
    vi.useFakeTimers();
    let sent = null;
    globalThis.AIRouter = { callAI: vi.fn(async (_f, req) => { sent = req; return { result: '{"close":[],"groups":[],"explanation":"x"}' }; }) };
    AgentCommand.open();
    const m = document.getElementById('vex-agentcmd');
    AgentCommand._run(m, 'tidy up whatever is about shopping');
    await vi.advanceTimersByTimeAsync(600);
    vi.useRealTimers();
    expect(document.getElementById('tai-q').value).toBe('tidy up whatever is about shopping');
    expect(sent.message).toContain('Instruction: tidy up whatever is about shopping');
  });

  it('"group my github tabs" groups through TabManager, so the tabs leave their stack', () => {
    const plan = AgentCommand._parse('group my github tabs');
    plan.run();
    const gid = TabManager.groups[0].id;
    expect(TabManager.tabs.filter(t => t.groupId === gid).map(t => t.id)).toEqual(['a', 'b']);
    expect(TabManager.tabs[0].stackId).toBe(null);
  });
});
