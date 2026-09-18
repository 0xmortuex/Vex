// @vitest-environment jsdom
//
// Four things that decide whether an agent can be trusted with a browser:
//
//   it can read what you already kept (it could write a note and never read
//     one, so "what did I note about X" simply failed);
//   it stays on the site you asked about — a page can say anything, and an
//     agent that follows a link into somewhere you never mentioned and starts
//     typing is the real-world risk;
//   it hands back at a sign-in, a payment or a captcha instead of typing your
//     password or fighting the wall;
//   it checks its own work — a local model has already claimed success for a
//     call that failed.

import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { AgentTools } = require('../../src/renderer/js/agent-tools.js');
const { AgentExecutor } = require('../../src/renderer/js/agent-executor.js');
const { AgentLoop, AGENT_TOOLS, SAFE_TOOLS, PAGE_ACTIONS, agentGuide } = require('../../src/renderer/js/agent-loop.js');

let calls;
function script(decisions) {
  calls = [];
  const queue = decisions.slice();
  globalThis.AIRouter = { callAI: vi.fn(async (f, req) => { calls.push(req); return { result: JSON.stringify(queue.shift() || { tool: 'finish', parameters: { summary: 'ran out' } }) }; }) };
}
const NOTES = [
  { id: 'n1', title: 'Monitor research', content: '1440p 165Hz shortlist: LG 27GP850, Dell S2722DGM', tags: ['agent'], updatedAt: '2026-09-17T10:00:00.000Z' },
  { id: 'n2', title: 'Shopping', content: 'milk\neggs', tags: [], updatedAt: '2026-09-18T10:00:00.000Z' },
];

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('vex.notes', JSON.stringify(NOTES));
  document.body.innerHTML = '<div id="ai-messages"></div>';
  globalThis.AgentTools = AgentTools;
  globalThis.WebviewManager = { getActiveWebview: () => null, webviews: new Map() };
  globalThis.TabManager = { tabs: [], groups: [], activeTabId: null };
  globalThis.DOMExtractor = { extractInteractiveElements: vi.fn() };
  globalThis.PageContext = { extractPageContext: vi.fn() };
  globalThis.Bookmarks = { items: [{ url: 'https://vex.example/docs', title: 'Vex docs', folder: 'Dev' }], has(u) { return this.items.some(b => b.url === u); }, save: vi.fn() };
  delete globalThis.AIPanel; delete globalThis.McpClient; delete window.VexTabPolicy;
  window.vexConfirm = globalThis.vexConfirm = vi.fn(async () => true);
  window.showToast = vi.fn();
  window.vex = { reminders: { list: async () => [{ id: 'r1', message: 'Call Dana', at: Date.UTC(2026, 8, 20, 9), kind: 'reminder' }, { id: 'r2', message: 'old', firedAt: 1 }] } };
});

describe('the user’s own things', () => {
  it('searches notes, reads one in full, and adds to one that exists', async () => {
    const found = await AgentExecutor.executeTool('search_notes', { query: 'monitor 1440p' });
    expect(found.result).toEqual([expect.objectContaining({ id: 'n1', title: 'Monitor research', preview: expect.stringContaining('LG 27GP850') })]);

    const read = await AgentExecutor.executeTool('read_note', { id: 'n1' });
    expect(read.result.content).toContain('Dell S2722DGM');
    expect((await AgentExecutor.executeTool('read_note', { id: 'Shopping' })).result.id).toBe('n2');   // by title too
    expect((await AgentExecutor.executeTool('read_note', { id: 'nope' })).error).toMatch(/search_notes gives the ids/);

    const added = await AgentExecutor.executeTool('append_note', { id: 'Shopping', text: 'bread' });
    expect(added.result).toBe('Added 5 characters to "Shopping"');
    expect(JSON.parse(localStorage.getItem('vex.notes')).find(n => n.id === 'n2').content).toBe('milk\neggs\nbread');
  });

  it('searches bookmarks and lists reminders that have not fired', async () => {
    expect((await AgentExecutor.executeTool('search_bookmarks', { query: 'vex docs' })).result).toEqual([{ title: 'Vex docs', url: 'https://vex.example/docs', folder: 'Dev' }]);
    const rem = await AgentExecutor.executeTool('list_reminders', {});
    expect(rem.result).toEqual([expect.objectContaining({ id: 'r1', message: 'Call Dana' })]);
    expect(rem.result.some(r => r.id === 'r2')).toBe(false);
  });

  it('reading your own things never asks, and is in the guide', () => {
    for (const t of ['search_notes', 'read_note', 'search_bookmarks', 'list_reminders']) expect(SAFE_TOOLS).toContain(t);
    expect(SAFE_TOOLS).not.toContain('append_note');       // it writes
    expect(agentGuide('auto')).toMatch(/THE USER'S OWN THINGS: search_notes/);
  });
});

describe('staying on the site you asked about', () => {
  // The page the run starts on, and anything named in the goal, are the sites
  // the user asked about. Everything else is somewhere the agent wandered to.
  let where, exec;
  const at = (url) => { where = url; };
  beforeEach(() => {
    where = 'https://github.com/vex';
    globalThis.WebviewManager.getActiveWebview = () => ({ getURL: () => where });
    globalThis.DOMExtractor.extractInteractiveElements = vi.fn(async () => ({ url: where, title: 't', elements: [] }));
    globalThis.PageContext.extractPageContext = vi.fn(async () => ({ text: '' }));
    exec = { executeTool: vi.fn(async (tool, params) => { if (tool === 'navigate') where = params.url; return { ok: true, result: 'ok' }; }) };
    globalThis.AgentExecutor = exec;
  });

  it('acts freely on the site named in the goal, and asks before another', async () => {
    script([
      { tool: 'click_text', parameters: { text: 'Issues' }, intent: 'action' },       // github: asked about
      { tool: 'navigate', parameters: { url: 'https://evil.example/pay' }, intent: 'action' },
      { tool: 'finish', parameters: { summary: 'done' } },
    ]);
    const run = AgentLoop.start('open the issues on github.com and read the newest', 'auto');
    await vi.waitFor(() => expect(document.querySelector('.agent-approve')).not.toBe(null));
    expect(document.querySelector('.agent-plan-heading').textContent).toMatch(/This acts on https:\/\/evil\.example, which you did not ask about/);
    expect(exec.executeTool).toHaveBeenCalledTimes(1);                        // the github click ran alone
    document.querySelector('.agent-approve').click();
    await run;
    expect(exec.executeTool.mock.calls.map(c => c[0])).toEqual(['click_text', 'navigate']);
  });

  it('denying it stops the run, and nothing is typed there', async () => {
    script([
      { tool: 'navigate', parameters: { url: 'https://phish.example/login' }, intent: 'action' },
      { tool: 'type_text', parameters: { selector: '#pw', text: 'hunter2' }, intent: 'action' },
    ]);
    const run = AgentLoop.start('check the issues on github.com', 'auto');
    await vi.waitFor(() => expect(document.querySelector('.agent-deny')).not.toBe(null));
    document.querySelector('.agent-deny').click();
    await run;
    expect(exec.executeTool).not.toHaveBeenCalled();
    expect(document.getElementById('ai-messages').textContent).toMatch(/Action denied by user/);
  });

  it('once allowed, that site is not asked about again', async () => {
    script([
      { tool: 'navigate', parameters: { url: 'https://shop.example/cart' }, intent: 'action' },
      { tool: 'click', parameters: { selector: '#x' }, intent: 'action' },
      { tool: 'click', parameters: { selector: '#y' }, intent: 'action' },
      { tool: 'finish', parameters: { summary: 'done' } },
    ]);
    const run = AgentLoop.start('open the issues on github.com', 'auto');
    await vi.waitFor(() => expect(document.querySelector('.agent-approve')).not.toBe(null));
    document.querySelector('.agent-approve').click();
    await run;
    expect(exec.executeTool.mock.calls.map(c => c[0])).toEqual(['navigate', 'click', 'click']);
    // The buttons become 'Approved', so count the cards themselves.
    const asks = [...document.querySelectorAll('.agent-plan-heading')].filter(h => /did not ask about/.test(h.textContent));
    expect(asks).toHaveLength(1);
  });

  it('the page it started on is not "another site" — that is what you pointed it at', async () => {
    script([{ tool: 'click', parameters: { selector: '#x' }, intent: 'action' }, { tool: 'finish', parameters: { summary: 'done' } }]);
    await AgentLoop.start('click the button for me', 'auto');               // no site named at all
    expect(exec.executeTool).toHaveBeenCalledWith('click', { selector: '#x' });
    expect(document.querySelectorAll('.agent-approve').length).toBe(0);
  });

  it('reading a page is never scoped — only acting is', () => {
    expect(PAGE_ACTIONS).toEqual(['click', 'click_text', 'type_text', 'press_key', 'select_option', 'navigate', 'new_tab']);
    for (const t of ['extract_text', 'screenshot', 'scroll', 'read_url']) expect(PAGE_ACTIONS).not.toContain(t);
    expect(agentGuide('auto')).toMatch(/Before you click or type on a DIFFERENT site/);
  });
});

describe('handing back at a sign-in or a captcha', () => {
  it('waits for the user, then carries on from the page they leave', async () => {
    const exec = { executeTool: vi.fn(async () => ({ ok: true, result: 'ok' })) };
    globalThis.AgentExecutor = exec;
    script([
      { tool: 'hand_over', parameters: { why: 'This page wants your password.' }, intent: 'safe' },
      { tool: 'finish', parameters: { summary: 'signed in and done' } },
    ]);
    const run = AgentLoop.start('check my orders', 'auto');
    await vi.waitFor(() => expect(document.querySelector('.agent-handover')).not.toBe(null));
    const card = document.querySelector('.agent-handover');
    expect(card.textContent).toMatch(/Your turn/);
    expect(card.textContent).toMatch(/This page wants your password\./);
    expect(card.textContent).toMatch(/will not type passwords, card numbers or one-time codes/);
    card.querySelector('.agent-approve').click();
    await run;
    expect(calls[1].lastToolResult.result).toMatch(/did that part and handed the page back/);
    expect(document.querySelector('.agent-final')).not.toBe(null);
  });

  it('"Stop here" ends the run', async () => {
    script([{ tool: 'hand_over', parameters: { why: 'Captcha.' }, intent: 'safe' }, { tool: 'finish', parameters: { summary: 'x' } }]);
    const run = AgentLoop.start('buy it', 'auto');
    await vi.waitFor(() => expect(document.querySelector('.agent-handover')).not.toBe(null));
    document.querySelector('.agent-handover .agent-deny').click();
    await run;
    expect(document.getElementById('ai-messages').textContent).toMatch(/Stopped — the agent was waiting for you/);
  });

  it('the tool exists and the guide forbids typing secrets', () => {
    expect(AGENT_TOOLS.find(t => t.name === 'hand_over').description).toMatch(/NEVER type a password/);
    expect(agentGuide('auto')).toMatch(/NEVER type a password, a card number or a one-time code/);
    expect(agentGuide('auto')).toMatch(/call hand_over with a short reason/);
  });
});

describe('checking its own work', () => {
  it('a note, a bookmark, a group and a timer are read back before it says done', async () => {
    const saved = await AgentExecutor.executeTool('save_note', { title: 'Findings', content: 'x' });
    expect(saved.result).toMatch(/^Saved and verified the note "Findings"/);

    globalThis.TabManager.tabs = [{ id: 't1' }, { id: 't2' }];
    globalThis.TabManager._setTabGroup = (id, g) => { TabManager.tabs.find(t => t.id === id).groupId = g; };
    globalThis.TabManager.rebuildAllTabs = vi.fn(); globalThis.TabManager.persistTabs = vi.fn();
    globalThis.VexStorage = { saveGroups: vi.fn() };
    const grouped = await AgentExecutor.executeTool('group_tabs', { name: 'Work', tabIds: ['t1', 't2'] });
    expect(grouped.result).toBe('Created and verified group "Work" with 2 tabs');

    globalThis.TabManager.activeTabId = 't1';
    globalThis.TabManager.tabs[0].url = 'https://keep.example/';
    const marked = await AgentExecutor.executeTool('add_bookmark', {});
    expect(marked.result).toMatch(/^Bookmarked and verified https:\/\/keep\.example\//);
  });

  it('a save that did not happen is a failure, not a claim of success', async () => {
    const real = AgentTools.saveNote;
    AgentTools.saveNote = () => ({ id: 'ghost', title: 'Findings' });      // "saved" nothing
    try {
      const r = await AgentExecutor.executeTool('save_note', { title: 'Findings', content: 'x' });
      expect(r).toEqual({ ok: false, error: 'The note did not save — check Memory panel › Health for the reason' });
    } finally { AgentTools.saveNote = real; }
  });

  it('a bookmark that did not stick is a failure', async () => {
    globalThis.TabManager.activeTabId = 't1';
    globalThis.TabManager.tabs = [{ id: 't1', url: 'https://keep.example/' }];
    globalThis.Bookmarks.has = () => false;                                 // never stored
    const r = await AgentExecutor.executeTool('add_bookmark', {});
    expect(r).toEqual({ ok: false, error: 'The bookmark did not save' });
  });
});

// Seen live: the agent searched its notes for "monitors" and found nothing,
// because the note says "Monitor". It repeated the search, tripped the loop
// detector, and recovered two steps later.
describe('searching your own things across a plural', () => {
  it('finds "Monitor research" when asked for monitors, and the other way round', () => {
    expect(AgentTools.searchNotes('monitors').map(n => n.id)).toEqual(['n1']);
    expect(AgentTools.searchNotes('monitor').map(n => n.id)).toEqual(['n1']);
    expect(AgentTools.searchNotes('shopping').map(n => n.id)).toEqual(['n2']);
    expect(AgentTools.searchNotes('zebras')).toEqual([]);          // still a real search
  });

  it('applies to bookmarks and history too', () => {
    expect(AgentTools.searchBookmarks('doc')).toHaveLength(1);
    expect(AgentTools.searchBookmarks('docs')).toHaveLength(1);
    localStorage.setItem('vex.history', JSON.stringify([{ url: 'https://a.example/', title: 'Great monitor review', time: Date.now() }]));
    expect(AgentTools.searchHistory('monitors')).toHaveLength(1);
  });

  it('a two-letter word is not stripped into nothing', () => {
    expect(AgentTools._hasWords('is this a test', ['is'])).toBe(true);
    expect(AgentTools._hasWords('a list of things', ['as'])).toBe(false);
  });
});

// A YouTube link used to be a dead end for research — the page is an app shell
// with no words in it — and a PDF was refused outright, which is where half of
// anything official lives.
describe('reading a video and a PDF', () => {
  it('recognises every shape of YouTube address', () => {
    expect(AgentTools.youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(AgentTools.youtubeId('https://youtu.be/abc123?t=30')).toBe('abc123');
    expect(AgentTools.youtubeId('https://www.youtube.com/shorts/xyz')).toBe('xyz');
    expect(AgentTools.youtubeId('https://www.youtube.com/embed/xyz')).toBe('xyz');
    expect(AgentTools.youtubeId('https://example.com/watch?v=x')).toBe(null);
  });

  it('reads what was said, with a timestamp every couple of minutes', async () => {
    const page = '<meta name="title" content="A talk about tabs"><script>"baseUrl":"https://www.youtube.com/api/timedtext?lang=en\u0026v=abc"</script>';
    const xml = '<transcript><text start="0.5" dur="2">Hello and welcome</text><text start="130" dur="2">Now the second part</text></transcript>';
    AgentTools._get = vi.fn(async (url) => ({ ok: true, status: 200, body: /timedtext/.test(url) ? xml : page, headers: { 'content-type': 'text/html' } }));
    const out = await AgentTools.readUrl('https://www.youtube.com/watch?v=abc');
    expect(out).toMatchObject({ kind: 'video transcript', title: 'A talk about tabs', url: 'https://www.youtube.com/watch?v=abc' });
    expect(out.text).toContain('[0:00] Hello and welcome');
    expect(out.text).toContain('[2:10] Now the second part');
  });

  it('a video with no captions says so instead of returning the page furniture', async () => {
    AgentTools._get = vi.fn(async () => ({ ok: true, status: 200, body: '<html>no tracks here</html>', headers: {} }));
    await expect(AgentTools.readUrl('https://youtu.be/nocaps')).rejects.toThrow(/no captions/);
  });

  it('pulls the words out of a PDF, and says so honestly when it cannot', async () => {
    const pdf = '%PDF-1.4\n/Title (Quarterly report)\nBT (Revenue rose by 12 percent this quarter, driven by the new product line.) Tj ET\nBT [(A second paragraph with enough words in it to clear the threshold for a real read.)] TJ ET';
    AgentTools._get = vi.fn(async () => ({ ok: true, status: 200, body: pdf, headers: { 'content-type': 'application/pdf' } }));
    const out = await AgentTools.readUrl('https://gov.example/report.pdf');
    expect(out.kind).toBe('pdf');
    expect(out.title).toBe('Quarterly report');
    expect(out.text).toContain('Revenue rose by 12 percent');
    expect(out.note).toMatch(/Only part of this PDF/);      // a short read says so

    AgentTools._get = vi.fn(async () => ({ ok: true, status: 200, body: '%PDF-1.4 (compressed streams only)', headers: { 'content-type': 'application/pdf' } }));
    await expect(AgentTools.readUrl('https://gov.example/x.pdf')).rejects.toThrow(/keeps its text compressed.*extract_text/);
  });
});
