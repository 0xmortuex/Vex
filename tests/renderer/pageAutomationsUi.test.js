// @vitest-environment jsdom
//
// Page automations, the window side: the Settings section, the approval prompt, the step list and editor, the run
// pill and what is handed to the Inbox. The main process is a mock; the rules are the real ones.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ROOT = require('path').resolve(__dirname, '../../src/renderer/js');
const flush = () => new Promise(r => setTimeout(r, 0));

let api, groups, cmds, inbox, handlers, state;
function load() {
  localStorage.clear();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  globalThis.AutoModel = window.AutoModel = require(ROOT + '/automations-model.js');
  globalThis.AutoGuest = window.AutoGuest = require(ROOT + '/automations-guest.js');
  state = { enabled: true, killed: false, recs: [], running: null, pending: [], undelivered: [], limits: {}, osSupported: true };
  api = {
    state: vi.fn(async () => state), setEnabled: vi.fn(async () => true), kill: vi.fn(async () => true), rearm: vi.fn(async () => true),
    save: vi.fn(async (r) => ({ ...r, id: r.id || 'a1' })), remove: vi.fn(async () => ({ ok: true })), run: vi.fn(async () => ({ runId: 'r1' })), stop: vi.fn(async () => true),
    decide: vi.fn(async () => true), runs: vi.fn(async () => []), runGet: vi.fn(), ack: vi.fn(async () => 1), exportOne: vi.fn(), importText: vi.fn(), onEvent: vi.fn(),
  };
  window.vex = { automations: api };
  groups = { register: vi.fn() };
  globalThis.VexSettingsGroups = window.VexSettingsGroups = groups;
  cmds = { set: vi.fn() };
  globalThis.VexModuleCommands = window.VexModuleCommands = cmds;
  inbox = { add: vi.fn(() => true), handle: vi.fn() };
  globalThis.AttentionInbox = inbox;
  window.VexIcons = { svg: (n) => '<svg data-icon="' + n + '"></svg>' };
  window.showToast = vi.fn();
  window.vexConfirm = vi.fn(async () => true);
  window.ProtectSettings = {
    toggle: ({ text, checked, onChange }) => { const l = document.createElement('label'); const i = document.createElement('input'); i.type = 'checkbox'; i.checked = !!checked; i.addEventListener('change', () => onChange(i.checked)); l.append(i, text); return l; },
    button: (t, fn) => { const b = document.createElement('button'); b.textContent = t; b.addEventListener('click', fn); return b; },
  };
  delete require.cache[require.resolve(ROOT + '/page-automations.js')];
  return require(ROOT + '/page-automations.js').VexAutomations;
}

const rec = (extra) => AutoModel.normalizeRecording({
  name: 'Grades', partition: 'persist:main', mode: 'hidden',
  steps: [
    { type: 'open', url: 'https://example.com/' },
    { type: 'type', value: 'S-1234', target: { role: 'textbox', name: 'Student ID', tag: 'input', css: '#sid' } },
    { type: 'type', value: 'hunter2', target: { role: 'textbox', name: 'Password', tag: 'input', type: 'password', css: '#pw' } },
    { type: 'click', target: { role: 'button', name: 'Search', tag: 'button' } },
    { type: 'click', target: { role: 'button', name: 'Submit appeal', tag: 'button' } },
  ],
  ...extra,
});
const buttons = (root = document) => [...root.querySelectorAll('button')];
const byText = (t, root = document) => buttons(root).find(b => b.textContent.trim() === t);

describe('start-up', () => {
  it('registers its Settings section and the two Ctrl+K ways in; the rest appear once it is switched on', async () => {
    const V = load();
    expect(groups.register).toHaveBeenCalledTimes(1);
    expect(groups.register.mock.calls[0][0]).toMatchObject({ id: 'page-automations', title: 'Page automations' });
    expect(cmds.set.mock.calls[0][1].map(c => c.id)).toEqual(['automations:record', 'automations:open']);
    state.recs = [rec()];
    await V.refresh();
    expect(V.enabled()).toBe(true);
    const ids = cmds.set.mock.calls.at(-1)[1].map(c => c.id);
    expect(ids).toEqual(expect.arrayContaining(['automations:record', 'automations:stop', 'automations:kill']));
    expect(ids.some(i => i.startsWith('automations:run:'))).toBe(true);
    expect(api.onEvent).toHaveBeenCalledTimes(1);
  });
  it('is off by default and the switch is mirrored from main', async () => {
    const V = load();
    expect(V.enabled()).toBe(false);
    state.enabled = true; await V.refresh();
    expect(V.enabled()).toBe(true);
    V.setEnabled(false);
    expect(api.setEnabled).toHaveBeenCalledWith(false);
    expect(V.enabled()).toBe(false);
  });
});

describe('the Settings section', () => {
  it('lists each automation with Run, Edit, Export and Delete, the kill switch and the rules', async () => {
    const V = load();
    state.recs = [{ ...rec(), id: 'a1', nextAt: null, lastStatus: 'ok', os: { scheduled: false, error: null } }];
    const body = document.createElement('div'); document.body.append(body);
    V.render(body); await flush(); await flush();
    for (const t of ['Run now', 'Edit', 'Run log', 'Export', 'Delete', 'Import', 'Re-arm', 'Stop all automations (kill switch)', 'Record on the current tab']) expect(byText(t, body), t).toBeTruthy();
    expect(body.textContent).toContain('Grades');
    expect(body.textContent).toMatch(/never recorded or typed/);
    expect(body.textContent).toMatch(/CAPTCHA/);
    byText('Stop all automations (kill switch)', body).click(); await flush();
    expect(api.kill).toHaveBeenCalled();
  });
  it('says when the kill switch is on', async () => {
    const V = load();
    state.killed = true;
    const body = document.createElement('div'); document.body.append(body);
    V.render(body); await flush(); await flush();
    expect(body.textContent).toMatch(/kill switch is on/);
  });
});

describe('the approval prompt', () => {
  it('shows what is about to happen, puts focus on Stop, and sends exactly the answer pressed', () => {
    const V = load();
    V._showApproval({ runId: 'r1', name: 'Grades', index: 4, total: 5, label: 'Click "Submit appeal"', kind: 'consequence', locked: true, why: 'It looks like it sends or posts something', url: 'http://127.0.0.1:18765/home', screenshot: 'data:image/jpeg;base64,AAAA' });
    const dlg = document.querySelector('[role=alertdialog]');
    expect(dlg).toBeTruthy();
    expect(dlg.textContent).toContain('Submit appeal');
    expect(dlg.textContent).toContain('always asks');
    expect(dlg.querySelector('img').alt).toBe('The page right now');
    expect(document.activeElement.textContent.trim()).toBe('Stop the run');
    byText('Approve and run this step', dlg).click();
    byText('Skip this step', dlg).click();
    byText('Stop the run', dlg).click();
    expect(api.decide.mock.calls.map(c => c.slice(0, 2))).toEqual([['r1', 'approve'], ['r1', 'skip'], ['r1', 'stop']]);
  });
  it('Escape hides it without answering; a secret step asks for a different button', () => {
    const V = load();
    V._showApproval({ runId: 'r2', name: 'Grades', index: 2, total: 5, label: 'Type in "Password"', kind: 'fill', why: 'Fill in "Password" yourself, then continue' });
    expect(byText('I filled it in, continue')).toBeTruthy();
    document.querySelector('[role=alertdialog]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('[role=alertdialog]')).toBeNull();
    expect(api.decide).not.toHaveBeenCalled();
  });
  it('the running pill shows the name and a Stop button; "waiting for you" offers Open', () => {
    const V = load();
    V._state = { running: { runId: 'r1', recId: 'a1', name: 'Grades', step: 1, total: 5 }, pending: [] };
    V._drawRunning();
    const pill = document.getElementById('vex-auto-running');
    expect(pill.classList.contains('on')).toBe(true);
    expect(pill.textContent).toContain('Automation running: Grades (step 2/5)');
    byText('Stop', pill).click();
    expect(api.stop).toHaveBeenCalled();
    V._state.pending = [{ runId: 'r1', name: 'Grades', index: 1, total: 5, label: 'x', kind: 'pause' }];
    V._drawRunning();
    expect(pill.textContent).toContain('waiting for you');
    expect(byText('Open', pill)).toBeTruthy();
    V._state.running = null; V._drawRunning();
    expect(pill.classList.contains('on')).toBe(false);
  });
});

describe('the step list and the editor', () => {
  it('a secret step shows no value and says nothing is stored; a locked step has no Run/Ask switch', async () => {
    const V = load();
    const m = await V.openEditor(rec(), { isNew: true });
    const items = [...m.card.querySelectorAll('.vex-auto-step')];
    expect(items).toHaveLength(5);
    expect(items[2].textContent).toContain('nothing is stored');
    expect(items[2].querySelector('input[aria-label="Text to type"]')).toBeNull();
    expect(JSON.stringify([...m.card.querySelectorAll('input')].map(i => i.value))).not.toContain('hunter2');
    expect(items[1].querySelector('input[aria-label="Text to type"]').value).toBe('S-1234');
    expect(items[1].querySelector('select')).toBeTruthy();                 // a plain typed step may be Run / Ask first
    expect(items[4].textContent).toContain('Always asks');                 // Submit appeal
    expect(items[4].querySelector('select')).toBeNull();                   // and cannot be switched
    expect(items[0].querySelector('button[aria-label="Move up"]').disabled).toBe(true);
  });
  it('deleting and moving steps works, and Save sends the edited recording with the schedule', async () => {
    const V = load();
    const m = await V.openEditor(rec(), { isNew: true });
    const del = m.card.querySelectorAll('.vex-auto-step')[3].querySelector('button[aria-label="Delete this step"]');
    del.click();
    expect(m.card.querySelectorAll('.vex-auto-step')).toHaveLength(4);
    m.card.querySelector('#vex-auto-sk').value = 'daily';
    m.card.querySelector('#vex-auto-sk').dispatchEvent(new Event('change'));
    m.card.querySelector('#vex-auto-sm').value = 'skip';
    byText('Save', m.card).click(); await flush(); await flush();
    expect(api.save).toHaveBeenCalledTimes(1);
    const sent = api.save.mock.calls[0][0];
    expect(sent.steps).toHaveLength(4);
    expect(sent.schedule).toMatchObject({ kind: 'daily', missed: 'skip' });
    expect(JSON.stringify(sent)).not.toContain('hunter2');
    expect(document.querySelector('.vex-auto-ov')).toBeNull();            // closed after saving
  });
  it('adding the AI summary asks first, and it goes last', async () => {
    const V = load();
    const m = await V.openEditor(rec(), { isNew: true });
    byText('Add AI summary', m.card).click(); await flush();
    expect(window.vexConfirm).toHaveBeenCalled();
    expect(m.card.querySelectorAll('.vex-auto-step')).toHaveLength(6);
    expect(m.card.querySelectorAll('.vex-auto-step')[5].textContent).toContain('AI summary');
  });
  it('a bad step is outlined (the "Fix this step" way in)', async () => {
    const V = load();
    const m = await V.openEditor(rec(), { bad: 3 });
    expect(m.card.querySelectorAll('.vex-auto-step')[3].classList.contains('bad')).toBe(true);
  });
});

describe('recording is refused where it must be', () => {
  it('in a private or Tor tab, a routed tab, or on a page that is not http(s)', async () => {
    const V = load();
    localStorage.setItem('vex.automations.enabled', '1');
    const wv = (url, part) => ({ getURL: () => url, getAttribute: () => part });
    globalThis.TabManager = { getActiveTab: () => ({ id: 1, url: 'x' }) };
    globalThis.WebviewManager = { webviews: new Map() };
    window.VexTabPolicy = { canReadWebview: () => true };
    WebviewManager.webviews.set(1, wv('about:blank', 'persist:main'));
    await expect(V.startRecording()).rejects.toThrow(/http and https/);
    WebviewManager.webviews.set(1, wv('https://example.com/', 'persist:container-tor-abc'));
    await expect(V.startRecording()).rejects.toThrow(/not in private, Tor or routed/);
    WebviewManager.webviews.set(1, wv('https://example.com/', 'tor-1'));
    await expect(V.startRecording()).rejects.toThrow(/not in private, Tor or routed/);
    WebviewManager.webviews.set(1, wv('https://example.com/', 'persist:main'));
    window.VexTabPolicy = { canReadWebview: () => false };
    await expect(V.startRecording()).rejects.toThrow(/private, Tor or routed/);
  });
});

describe('results reach the Inbox without a value, and a note only when asked', () => {
  it('adds one row per run that says what happened, then acknowledges them', async () => {
    const V = load();
    state.recs = [{ ...rec(), id: 'a1', toInbox: true, toNote: false }];
    const runs = [
      { id: 'r1', recId: 'a1', name: 'Grades', status: 'ok', startedAt: 1, reads: [{ as: 'gpa', text: 'SECRET-GRADE 3.7' }], failure: null, summariseRequested: false },
      { id: 'r2', recId: 'a1', name: 'Grades', status: 'failed', startedAt: 2, reads: [], failure: { index: 3, reason: 'not-found', message: 'x' }, summariseRequested: false },
    ];
    await V._deliver(runs);
    expect(inbox.add).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(inbox.add.mock.calls)).not.toContain('SECRET-GRADE');
    expect(inbox.add.mock.calls.map(x => x[0].body).join(' | ')).toMatch(/not found on the page/);      // oldest first: r2 then r1 (the list arrives newest first)
    expect([...api.ack.mock.calls[0][0]].sort()).toEqual(['r1', 'r2']);
  });
  it('writes a note with the values only when the automation asks for it', async () => {
    const V = load();
    globalThis.NotesPanel = { notes: [], save: vi.fn(), renderList: vi.fn() };
    state.recs = [{ ...rec(), id: 'a1', toInbox: false, toNote: true }];
    await V._deliver([{ id: 'r1', recId: 'a1', name: 'Grades', status: 'ok', startedAt: 1, reads: [{ as: 'gpa', text: '3.7' }], failure: null, summariseRequested: false }]);
    expect(inbox.add).not.toHaveBeenCalled();
    expect(NotesPanel.notes).toHaveLength(1);
    expect(NotesPanel.notes[0].content).toContain('3.7');
    delete globalThis.NotesPanel;
  });
  it('the AI is asked only when the recording has the summary step', async () => {
    const V = load();
    const ask = vi.fn(async () => ({ result: 'GPA is 3.7.' }));
    globalThis.AIRouter = { callAI: ask };
    state.recs = [{ ...rec(), id: 'a1' }];
    await V._deliver([{ id: 'r1', recId: 'a1', name: 'Grades', status: 'ok', startedAt: 1, reads: [{ as: 'gpa', text: '3.7' }], failure: null, summariseRequested: false }]);
    expect(ask).not.toHaveBeenCalled();
    const withStep = AutoModel.normalizeRecording({ ...rec(), steps: [...rec().steps, { type: 'summarise', prompt: 'Summarise' }] });
    state.recs = [{ ...withStep, id: 'a1' }];
    await V._deliver([{ id: 'r2', recId: 'a1', name: 'Grades', status: 'ok', startedAt: 1, reads: [{ as: 'gpa', text: '3.7' }], failure: null, summariseRequested: true }]);
    expect(ask).toHaveBeenCalledTimes(1);
    delete globalThis.AIRouter;
  });
});
