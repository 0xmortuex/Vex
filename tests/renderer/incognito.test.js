// @vitest-environment jsdom
//
// Incognito and Tor are two different things (2026-10-24: Ctrl+Alt+N opened a window, "Private routing" had been left on
// Tor, and closing Tor did not stop it coming back). The mask opens a window that forgets; the onion is one Tor tab;
// the setting that sends all of Vex through Tor has its own name and says so in every incognito window.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const fs = require('fs');
const path = require('path');

require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;
const { VexIncognito } = require('../../src/renderer/js/incognito.js');
const { PrivateRouting } = require('../../src/renderer/js/private-routing.js');
const { shortcutFor, pageShortcut } = require('../../src/main/guest-shortcuts.js');

const src = (f) => fs.readFileSync(path.join(__dirname, '../../src', f), 'utf8').replace(/\r\n/g, '\n');
const html = src('renderer/index.html');
const doc = new DOMParser().parseFromString(html, 'text/html');

beforeEach(() => {
  document.body.innerHTML = '';
  window.VexTabPolicy = { isPrivateWindow: true, isCleanWindow: false };
  window.showToast = vi.fn();
  window.vex = { openPrivateWindow: vi.fn(async () => true), createTor: vi.fn(), routingGetAll: async () => ({ mode: 'direct' }) };
  delete globalThis.VexGuest;
});

describe('what the note says', () => {
  it('is honest about a direct connection: nothing saved, connection NOT hidden, Tor tab for that', () => {
    const t = VexIncognito.noteFor('direct');
    expect(t).toMatch(/does not save history, cookies or logins/);
    expect(t).toMatch(/connection is NOT hidden/);
    expect(t).toMatch(/Tor tab/);
  });
  it('says Everything in Vex, including this window, is going through Tor when the route for all of Vex is Tor', () => {
    expect(VexIncognito.noteFor('tor')).toMatch(/Everything in Vex, including this window, is going through Tor/);
    expect(VexIncognito.noteFor('tor')).not.toMatch(/NOT hidden/);
  });
  it('names the proxy when the route is a proxy, and reads anything unknown as direct', () => {
    expect(VexIncognito.noteFor('proxy')).toMatch(/going through your proxy/);
    expect(VexIncognito.noteFor(undefined)).toBe(VexIncognito.NOTE_DIRECT);
    expect(VexIncognito.noteFor('whatever')).toBe(VexIncognito.NOTE_DIRECT);
  });
});

describe('where the note shows', () => {
  it('in an incognito window, not in a normal one, a clean (screen-sharing) one or a guest one', () => {
    expect(VexIncognito.wantsNote({ isPrivateWindow: true, isCleanWindow: false }, false)).toBe(true);
    expect(VexIncognito.wantsNote({ isPrivateWindow: false }, false)).toBe(false);
    expect(VexIncognito.wantsNote({ isPrivateWindow: true, isCleanWindow: true }, false)).toBe(false);
    expect(VexIncognito.wantsNote({ isPrivateWindow: true, isCleanWindow: false }, true)).toBe(false);
    expect(VexIncognito.wantsNote(null, false)).toBe(false);
  });

  it('init shows one note, can be dismissed, and a second init does not stack another', async () => {
    window.vex.routingGetAll = async () => ({ mode: 'direct' });
    expect(await VexIncognito.init()).toBe(true);
    await VexIncognito.init();
    expect(document.querySelectorAll('#vex-incognito-note').length).toBe(1);
    const note = document.getElementById('vex-incognito-note');
    expect(note.dataset.route).toBe('direct');
    expect(note.textContent).toMatch(/connection is NOT hidden/);
    note.querySelector('button').click();
    expect(document.getElementById('vex-incognito-note')).toBeNull();
  });

  it('init says Tor when the route for all of Vex is Tor', async () => {
    window.vex.routingGetAll = async () => ({ mode: 'tor' });
    await VexIncognito.init();
    const note = document.getElementById('vex-incognito-note');
    expect(note.dataset.route).toBe('tor');
    expect(note.textContent).toMatch(/including this window, is going through Tor/);
  });

  it('init does nothing in a normal window', async () => {
    window.VexTabPolicy = { isPrivateWindow: false };
    expect(await VexIncognito.init()).toBe(false);
    expect(document.getElementById('vex-incognito-note')).toBeNull();
  });
});

describe('opening incognito', () => {
  it('opens a private window with the look and mode, and never asks for Tor', async () => {
    window.vex.openPrivateWindow = vi.fn(async () => true);
    expect(await VexIncognito.open()).toBe(true);
    expect(window.vex.openPrivateWindow).toHaveBeenCalledTimes(1);
    expect(window.vex.createTor).not.toHaveBeenCalled();
  });
  it('says why when main refuses (locked, or the policy is not agreed to yet)', async () => {
    window.vex.openPrivateWindow = vi.fn(async () => { throw new Error("Error invoking remote method 'open-private-window': Error: Vex is locked — unlock it first"); });
    expect(await VexIncognito.open()).toBe(false);
    expect(window.showToast).toHaveBeenCalledWith('Vex is locked — unlock it first', 'error');
  });
});

describe('the toolbar: two buttons, two icons', () => {
  const inc = doc.getElementById('btn-incognito');
  const tor = doc.getElementById('btn-tor');
  it('Incognito is always there, named, with the mask; Tor keeps its own onion', () => {
    expect(inc).toBeTruthy();
    expect(inc.hasAttribute('hidden')).toBe(false);
    expect(inc.getAttribute('aria-label')).toBe('New incognito window');
    expect(inc.getAttribute('title')).toMatch(/does not hide your connection/);
    expect(tor.getAttribute('aria-label')).toBe('New Tor tab');
    expect(tor.getAttribute('title')).toMatch(/not the same as incognito/);
    const body = (name) => {
      const holder = document.createElement('div');
      holder.innerHTML = window.VexIcons.svg(name, { size: 16 });
      return holder.querySelector('svg').innerHTML.replace(/\s+/g, '');
    };
    const live = (b) => { const h = document.createElement('div'); h.innerHTML = b.outerHTML; return h.querySelector('svg').innerHTML.replace(/\s+/g, ''); };
    expect(live(inc)).toBe(body('incognito'));
    expect(live(tor)).toBe(body('onion'));
    expect(live(inc)).not.toBe(live(tor));
  });
  it('is placed with the Tor button, loaded before app.js, and wired to VexIncognito', () => {
    expect(html.indexOf('id="btn-incognito"')).toBeLessThan(html.indexOf('id="btn-tor"'));
    expect(html.indexOf('js/incognito.js')).toBeGreaterThan(-1);
    expect(html.indexOf('js/incognito.js')).toBeLessThan(html.indexOf('js/app.js'));
    expect(html.indexOf('css/incognito.css')).toBeLessThan(html.indexOf('css/a11y.css'));
    expect(src('renderer/js/app.js')).toMatch(/getElementById\('btn-incognito'\)\?\.addEventListener\('click', \(\) => \{ if \(typeof VexIncognito !== 'undefined'\) VexIncognito\.open\(\); \}\)/);
  });
  it('is not hidden in the browser looks (Firefox, Chrome, Safari), and never moved into the overflow menu', () => {
    const css = src('renderer/css/gui-browser.css');
    const hidden = css.slice(css.indexOf(':is(#vex-logo'), css.indexOf('{ display: none !important; }'));
    expect(hidden).not.toMatch(/btn-incognito/);
    expect(hidden).not.toMatch(/btn-tor/);
    expect(src('renderer/js/toolbar-overflow.js')).toMatch(/NEVER = new Set\([^)]*'btn-incognito'/);
  });
});

describe('the command and the keys', () => {
  it('the command is called New Incognito Window, keeps its old id, and opens it through VexIncognito', () => {
    const cmd = src('renderer/js/command.js');
    const line = cmd.split('\n').find(l => l.includes("id: 'private'"));
    expect(line).toMatch(/label: 'New Incognito Window'/);
    expect(line).toMatch(/VexIncognito\.open\(\)/);
    expect(line).toMatch(/Ctrl\+Alt\+N/);
    expect(cmd).toMatch(/private: 'private-window'/);          // the key shown beside it still follows the registry
  });
  it('the registry keeps Ctrl+Alt+N for private-window, and the key runs VexIncognito', () => {
    const reg = src('renderer/js/shortcuts-registry.js');
    expect(reg).toMatch(/'private-window': \{ default: 'Ctrl\+Alt\+N',\s+label: 'New Incognito Window'/);
    expect(src('renderer/js/app.js')).toMatch(/register\('private-window', \(\) => VexIncognito\.open\(\)\)/);
  });
  it('Ctrl+Shift+N is NOT taken: it is Notes, in main, in the registry and from a focused page', () => {
    expect(src('renderer/js/shortcuts-registry.js')).toMatch(/'Ctrl\+Shift\+N': 'Notes'/);
    expect(pageShortcut({ key: 'N', shift: true }, { wanted: new Set() })).toEqual({ channel: 'toggle-notes' });
    // Ctrl+Alt+N from a focused page goes up as the key itself, so the registry (and a rebinding) decides.
    const hit = shortcutFor({ type: 'keyDown', key: 'n', control: true, alt: true, shift: false }, { wanted: new Set(['Ctrl+Alt+N']) });
    expect(hit).toEqual({ channel: 'guest-shortcut', args: [{ key: 'n', ctrl: true, shift: false, alt: true }] });
  });
});

describe('the route for all of Vex is no longer called Private', () => {
  it('index.html, the command, the screen and the tooltip say Route all of Vex', () => {
    expect(html).not.toMatch(/Private routing/i);
    expect(doc.getElementById('btn-routing').getAttribute('title')).toBe('Route all of Vex through Tor or a proxy');
    expect(src('renderer/js/command.js')).toMatch(/id: 'routing-all', label: 'Route All of Vex Through Tor or a Proxy'/);
    expect(src('renderer/js/command.js')).not.toMatch(/Private Routing/);
    const js = src('renderer/js/private-routing.js');
    expect(js).toMatch(/<h2>Route all of Vex through Tor or a proxy<\/h2>/);
    expect(js).not.toMatch(/'Private routing'|>Private routing</);
  });
  it('its confirm box says it stays on after Tor is closed or Vex restarted, and covers incognito windows', async () => {
    window.vexConfirm = vi.fn(async () => true);
    await PrivateRouting.confirmRoute('tor');
    const m = window.vexConfirm.mock.calls[0][0].message;
    expect(m).toMatch(/including every new incognito window/);
    expect(m).toMatch(/stays on after you close Tor or restart Vex, until you switch it back/);
  });
});

describe('Go direct after Tor is cancelled', () => {
  it('offers it when the route for all of Vex is Tor, and the button switches to direct', async () => {
    const set = [];
    window.vex.routingGetAll = async () => ({ mode: 'tor' });
    window.vex.routingSetAll = async (mode) => { set.push(mode); return { ok: true, mode }; };
    expect(await PrivateRouting.offerDirect()).toBe(true);
    const [, , , opts] = window.showToast.mock.calls[0];
    expect(opts.action.label).toBe('Go direct');
    await opts.action.run();
    expect(set).toEqual(['direct']);
  });
  it('offers nothing when all of Vex is direct (a Tor tab that was cancelled needs no such question)', async () => {
    window.vex.routingGetAll = async () => ({ mode: 'direct' });
    expect(await PrivateRouting.offerDirect()).toBe(false);
    expect(window.showToast).not.toHaveBeenCalled();
  });
  it('the Tor progress window asks for it only when Tor was started for a route (the revive), not for a Tor tab you opened', () => {
    const t = src('renderer/js/tor-session.js');
    expect(t).toMatch(/if \(api\.onCancel\) api\.onCancel\(\);/);
    const revive = t.slice(t.indexOf('_reviving() {'), t.indexOf('_revived(r) {'));
    expect(revive).toMatch(/ui\.onCancel = .*PrivateRouting\.offerDirect\(\)/);
    const open = t.slice(t.indexOf('async open() {'), t.indexOf('_stageText'));
    expect(open).not.toMatch(/offerDirect/);
  });
});
