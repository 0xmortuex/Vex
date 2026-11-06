// @vitest-environment jsdom
//
// Share a space, the screens (js/share-space-ui.js): the export dialog (what is left out, what was changed, untick any tab), the review of a
// file or link that came in (every real host name, flags, nothing opened until Add), Apply with Undo, and where it is reached from.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (f) => fs.readFileSync(path.resolve(__dirname, '../../src/renderer', f), 'utf8');
const run = (src, ret) => new Function(src + '\n;return ' + ret + ';')();

let S, UI, TM, WM, toasts, offers, created, checkAnswer;

const tab = (url, extra) => ({ id: 'tab-' + Math.random(), url, title: 'Title of ' + url, partition: null, groupId: null, pinned: false, ...extra });
const tick = () => new Promise((r) => setTimeout(r, 30));
const q = (sel) => document.querySelector(sel);
const qa = (sel) => [...document.querySelectorAll(sel)];
const button = (root, label) => qa(root + ' button').find((b) => b.textContent === label);

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<input id="command-input"><input id="url-input">';
  delete window.VexShareSpace; delete window.VexShareSpaceUI;
  toasts = []; offers = []; created = [];
  window.showToast = (m, type) => toasts.push([m, type]);
  window.VexUndo = { offer: (o) => offers.push(o) };
  window.VexSettingsGroups = {
    dialog: ({ id, title, sub }) => {
      document.getElementById(id)?.remove();
      const overlay = document.createElement('div'); overlay.id = id; overlay.dataset.title = title; overlay.dataset.sub = sub || '';
      const body = document.createElement('div'); overlay.append(body); document.body.append(overlay);
      return { overlay, body, close: () => overlay.remove() };
    },
    note: (t) => { const d = document.createElement('div'); d.textContent = t; return d; },
    button: (t, fn) => { const b = document.createElement('button'); b.textContent = t; b.addEventListener('click', fn); return b; },
  };
  TM = { groups: [{ id: 'g1', name: 'Study', color: '#22c55e' }], tabs: [
    tab('https://history.example.com/rome', { groupId: 'g1' }),
    tab('https://secret.example.com/', { partition: 'private-1' }),
    tab('https://news.example.com/a?token=ABCDEF&id=3'),
    tab('http://localhost:8080/'),
  ], createTab: (...a) => created.push(a) };
  window.TabManager = TM;
  window.VexTabPolicy = { isPrivateWindow: false };
  WM = { COLORS: ['#6366f1', '#00b4d8'], activeId: 'ws1', workspaces: [{ id: 'ws1', name: 'Personal', color: '#fff', tabs: [] }],
    getActive() { return this.workspaces[0]; }, addWorkspace(n, c) { const w = { id: 'ws2', name: n, color: c, tabs: [] }; this.workspaces.push(w); return w; },
    save() {}, render() {}, async switchTo(id) { this.activeId = id; }, async deleteWorkspace(id) { const i = this.workspaces.findIndex((w) => w.id === id); return { item: this.workspaces.splice(i, 1)[0] }; } };
  window.WorkspaceManager = WM;
  window.VexSidebarGroups = undefined;
  window.VexShareLook = undefined;
  checkAnswer = (urls) => urls.map((u) => { const h = new URL(u).hostname; return { url: u, host: h, unicode: h, punycode: false, lookalike: null, threat: null, error: null }; });
  window.vex = { space: { check: async (urls) => checkAnswer(urls) } };
  const reg = [];
  window.VexExtras = { registerCommand: (c) => { reg.push(c); return true; }, reg };
  run(read('js/share-space.js'), '0');
  S = window.VexShareSpace;
  UI = new Function(read('js/share-space-ui.js') + '\n;return VexShareSpaceUI;')();
  window.VexShareSpaceUI = UI;
});

const fileText = (over) => JSON.stringify({ format: 'vex-space', version: 1, name: 'Friend space', groups: [{ name: 'G' }], tabs: [
  { url: 'https://one.example.com/a', title: 'One', group: 0 }, { url: 'https://two.example.com/b', title: 'Two' }], ...over });

describe('the export dialog', () => {
  it('lists the tabs that can be shared, says how many were left out and why, and shows what was changed', () => {
    UI.share();
    const dlg = q('#vex-share-space');
    expect(dlg.dataset.title).toBe('Share this space');
    expect(qa('#vex-share-space input[type=checkbox]').filter((b) => b.id.includes('-tab-')).length).toBe(2);
    const text = dlg.textContent;
    expect(text).toContain('Left out of this space: 2');
    expect(text).toContain('private, Tor or off-the-record tabs');
    expect(text).toContain('addresses on this computer or its network');
    expect(text).toContain('Changed: removed "token"');
    expect(text).toContain('Tabs ticked: 2 of 60');
    expect(text).not.toContain('ABCDEF');
    expect(text).not.toContain('secret.example.com');
    expect(text).not.toContain('localhost');
  });

  it('unticking a tab changes the counter, and a space with nothing ticked cannot be saved', () => {
    UI.share();
    const boxes = qa('#vex-share-space input[type=checkbox]').filter((b) => b.id.includes('-tab-'));
    boxes[0].checked = false; boxes[0].dispatchEvent(new Event('change'));
    expect(q('#vex-share-space').textContent).toContain('Tabs ticked: 1 of 60');
    boxes[1].checked = false; boxes[1].dispatchEvent(new Event('change'));
    expect(qa('#vex-share-space button').filter((b) => ['Save as a file', 'Copy link', 'Copy as text'].includes(b.textContent)).every((b) => b.disabled)).toBe(true);
  });

  it('Copy link puts a vex://space link of only the ticked tabs on the clipboard', async () => {
    let copied = null;
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { copied = t; } }, configurable: true });
    UI.share();
    const boxes = qa('#vex-share-space input[type=checkbox]').filter((b) => b.id.includes('-tab-'));
    boxes[1].checked = false; boxes[1].dispatchEvent(new Event('change'));
    button('#vex-share-space', 'Copy link').click();
    await tick();
    // The link is compressed asynchronously (CompressionStream): wait for it (up to 3 s) instead of one fixed tick, which a slow CI runner missed.
    for (let i = 0; i < 60 && copied === null; i++) await new Promise((r) => setTimeout(r, 50));
    expect(copied.startsWith('vex://space?d=')).toBe(true);
    const back = (await S.parse(copied)).space;
    expect(back.tabs.map((t) => t.url)).toEqual(['https://history.example.com/rome']);
    expect(back.groups).toEqual([{ name: 'Study', color: '#22c55e' }]);
    expect(back.look).toBeUndefined();
  });

  it('a group shares only its own tabs', () => {
    UI.share({ groupId: 'g1' });
    expect(q('#vex-share-space').dataset.title).toBe('Share this group');
    expect(qa('#vex-share-space input[type=checkbox]').filter((b) => b.id.includes('-tab-')).length).toBe(1);
  });

  it('refuses in a private window', () => {
    window.VexTabPolicy = { isPrivateWindow: true };
    expect(() => UI.share()).toThrow(/private window/);
  });

  it('is off when the feature is switched off', () => {
    S.setEnabled(false);
    expect(() => UI.share()).toThrow(/switched off/);
    expect(() => UI.pickFile()).toThrow(/switched off/);
  });
});

describe('the review of a space that came in', () => {
  it('opens nothing: no tab is made and no workspace is added until Add is pressed', async () => {
    await UI.openText(fileText(), 'file');
    expect(q('#vex-share-space-review')).not.toBeNull();
    expect(created).toEqual([]);
    expect(WM.workspaces.length).toBe(1);
    expect(q('#vex-share-space-review').dataset.sub).toBe('From a file you opened, not verified. Nothing has been opened yet.');
  });

  it('shows the real host name of every address, in bold, and the group', async () => {
    await UI.openText(fileText(), 'file');
    await tick();
    const hosts = qa('#vex-share-space-review b').map((b) => b.textContent);
    expect(hosts).toEqual(['one.example.com', 'two.example.com']);
    expect(q('#vex-share-space-review').textContent).toContain('Group: G');
    expect(q('#vex-share-space-review').textContent).toContain('Tabs: 2, groups: 1, sites: 2');
  });

  it('flags a look-alike, punycode and a reported dangerous site, and starts them unticked', async () => {
    checkAnswer = (urls) => urls.map((u) => {
      const h = new URL(u).hostname;
      if (h.startsWith('one')) return { url: u, host: 'xn--80ak6aa92e.com', unicode: 'аррӏе.com', punycode: true, lookalike: { kind: 'homograph', resembles: 'apple.com', line: 'Written with letters from another alphabet' }, threat: null, error: null };
      return { url: u, host: h, unicode: h, punycode: false, lookalike: null, threat: { kind: 'domain', host: h }, error: null };
    });
    await UI.openText(fileText(), 'file');
    await tick();
    const text = q('#vex-share-space-review').textContent;
    expect(text).toContain('Looks like apple.com but is not');
    expect(text).toContain('punycode (xn--80ak6aa92e.com) and would show as аррӏе.com');
    expect(text).toContain('Reported as a dangerous site (two.example.com)');
    expect(text).toContain('Addresses checked: 2 need a careful look and are unticked.');
    const boxes = qa('#vex-share-space-review input[type=checkbox]').filter((b) => b.id.includes('-tab-'));
    expect(boxes.map((b) => b.checked)).toEqual([false, false]);
    expect(button('#vex-share-space-review', 'Add').disabled).toBe(true);
    boxes[0].checked = true; boxes[0].dispatchEvent(new Event('change'));
    expect(button('#vex-share-space-review', 'Add').disabled).toBe(false);
  });

  it('cannot add anything when the address check fails, and says so', async () => {
    window.vex = { space: { check: async () => { throw new Error('main said no'); } } };
    await UI.openText(fileText(), 'file');
    await tick();
    expect(q('#vex-share-space-review').textContent).toContain('Could not check the addresses (main said no), so none can be added.');
    expect(button('#vex-share-space-review', 'Add').disabled).toBe(true);
    expect(toasts.some((t) => t[1] === 'error' && /main said no/.test(t[0]))).toBe(true);
    window.vex = {};
    await UI.openText(fileText(), 'file');
    await tick();
    expect(q('#vex-share-space-review').textContent).toContain('the address check is not available');
    expect(button('#vex-share-space-review', 'Add').disabled).toBe(true);
  });

  it('lists what was refused and what was cleaned, and warns about the 60-tab cap', async () => {
    const tabs = [{ url: 'javascript:alert(1)' }, { url: 'https://ok.example.com/p?token=Z' }, ...Array.from({ length: 62 }, (_, i) => ({ url: 'https://s' + i + '.example.com/' }))];
    await UI.openText(fileText({ tabs, groups: [] }), 'file');
    await tick();
    const text = q('#vex-share-space-review').textContent;
    expect(text).toContain('Refused: 1');
    expect(text).toContain('Tab 1: addresses that are not web pages');
    expect(text).toContain('Cleaned on the way in: 1');
    expect(text).toContain('Only the first 60 tabs are kept; 3 more were left out.');
    expect(text).not.toContain('=Z');
  });

  it('Add makes the new workspace and offers Undo; Undo takes it out', async () => {
    await UI.openText(fileText(), 'file');
    await tick();
    button('#vex-share-space-review', 'Add').click();
    await tick();
    expect(q('#vex-share-space-review')).toBeNull();
    expect(WM.workspaces.map((w) => w.name)).toEqual(['Personal', 'Friend space']);
    expect(WM.workspaces[1].tabs.map((t) => t.url)).toEqual(['https://one.example.com/a', 'https://two.example.com/b']);
    expect(WM.activeId).toBe('ws1');
    expect(created).toEqual([]);
    expect(offers.length).toBe(1);
    expect(offers[0].message).toBe('Added Friend space as a new workspace (2 tabs)');
    await offers[0].undo();
    expect(WM.workspaces.map((w) => w.name)).toEqual(['Personal']);
  });

  it('Add and open also switches to the new workspace', async () => {
    await UI.openText(fileText(), 'file');
    await tick();
    button('#vex-share-space-review', 'Add and open').click();
    await tick();
    expect(WM.activeId).toBe('ws2');
  });

  it('only the ticked tabs are added', async () => {
    await UI.openText(fileText(), 'file');
    await tick();
    const boxes = qa('#vex-share-space-review input[type=checkbox]').filter((b) => b.id.includes('-tab-'));
    boxes[0].checked = false; boxes[0].dispatchEvent(new Event('change'));
    button('#vex-share-space-review', 'Add').click();
    await tick();
    expect(WM.workspaces[1].tabs.map((t) => t.url)).toEqual(['https://two.example.com/b']);
  });

  it('Cancel adds nothing', async () => {
    await UI.openText(fileText(), 'file');
    button('#vex-share-space-review', 'Cancel').click();
    expect(q('#vex-share-space-review')).toBeNull();
    expect(WM.workspaces.length).toBe(1);
  });

  it('a hostile file raises and shows no review', async () => {
    await expect(UI.openText('{"format":"vex-space","version":9,"tabs":[]}')).rejects.toThrow(/newer Vex/);
    await expect(UI.openText('{"format":"vex-space","version":1,"tabs":[{"url":"https://a.example.com/","onclick":"x"}]}')).rejects.toThrow(/tab field/);
    expect(q('#vex-share-space-review')).toBeNull();
  });

  it('draws a title with markup as text, never as markup', async () => {
    await UI.openText(fileText({ tabs: [{ url: 'https://one.example.com/', title: '<img src=x onerror=window.__pwned=1>Hi' }], groups: [] }), 'file');
    await tick();
    expect(q('#vex-share-space-review img')).toBeNull();
    expect(window.__pwned).toBeUndefined();
  });
});

describe('where it is reached from', () => {
  it('registers three Ctrl+K commands', () => {
    expect(window.VexExtras.reg.map((c) => c.id)).toEqual(['share-space', 'open-space', 'undo-shared-space']);
    expect(window.VexExtras.reg.map((c) => c.label)).toEqual(['Share a Space', 'Open a Space', 'Undo shared space']);
  });

  it('a space link pasted into Ctrl+K opens the review and clears the box', async () => {
    const link = await S.toLink((await S.parse(fileText())).space);
    const box = q('#command-input');
    box.value = link; box.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    expect(box.value).toBe('');
    expect(q('#vex-share-space-review')).not.toBeNull();
    expect(q('#vex-share-space-review').dataset.sub).toContain('link');
  });

  it('other text typed in the box is left alone', () => {
    const box = q('#url-input');
    box.value = 'hello'; box.dispatchEvent(new Event('input', { bubbles: true }));
    expect(box.value).toBe('hello');
    expect(q('#vex-share-space-review')).toBeNull();
  });

  it('a .vexspace file dropped on Vex opens the review; another file is left alone', async () => {
    const drop = (name, text) => {
      const e = new Event('drop', { bubbles: true, cancelable: true });
      e.dataTransfer = { files: [new File([text], name)], types: ['Files'] };
      document.body.dispatchEvent(e);
      return e;
    };
    expect(drop('notes.txt', 'x').defaultPrevented).toBe(false);
    const e = drop('study.vexspace', fileText());
    expect(e.defaultPrevented).toBe(true);
    await tick();
    expect(q('#vex-share-space-review')).not.toBeNull();
  });

  it('a file over the size cap is refused before it is read', async () => {
    const big = new File(['x'.repeat(S.FILE_MAX + 1)], 'big.vexspace');
    await expect(UI.openFile(big)).rejects.toThrow(/too big/);
  });

  it('Undo with nothing to undo says so', async () => {
    await UI.undo();
    expect(toasts.at(-1)[0]).toBe('There is no shared space to undo');
  });

  it('is wired into the places it is offered from', () => {
    const read2 = (f) => read(f);
    expect(read2('js/workspaces.js')).toContain('Share this space');
    expect(read2('js/tabs.js')).toContain('data-action="share-group"');
    expect(read2('js/app.js')).toContain('vex:\\/\\/space\\?d=');
    expect(read2('js/lazy-boot.js')).toContain("js/share-space.js', usage: ['share-space']");
  });
});
