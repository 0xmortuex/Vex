// @vitest-environment jsdom
//
// T2-014: js/vex-layer.js, the overlay layer manager and the post-close click sweep.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
let L;
beforeEach(() => {
  document.body.innerHTML = '';
  // jsdom has no layout, so no hit testing: with nothing laid out the page answers with its body.
  document.elementFromPoint = () => document.body;
  vi.resetModules();
  delete require.cache[require.resolve(JS + 'vex-layer.js')];
  L = require(JS + 'vex-layer.js').VexLayer;
  L._layers = [];
});

const div = (id) => { const d = document.createElement('div'); d.id = id; return d; };

describe('tiers and open/close', () => {
  it('opens at the tier\'s z-index, higher tiers above lower ones', () => {
    const a = L.open(div('a'), { tier: 'panel' });
    const b = L.open(div('b'), { tier: 'dialog' });
    expect(Number(b.style.zIndex)).toBeGreaterThan(Number(a.style.zIndex));
    expect(L.list().map(l => l.id)).toEqual(['a', 'b']);
  });
  it('refuses a tier it does not know', () => {
    expect(() => L.open(div('x'), { tier: 'huge' })).toThrow(/Unknown overlay tier/);
  });
  it('close() removes the element and runs onClose; a gone element drops out of the list', () => {
    const onClose = vi.fn();
    const el = L.open(div('a'), { onClose });
    expect(L.close('a')).toBe(true);
    expect(el.isConnected).toBe(false);
    expect(onClose).toHaveBeenCalled();
    const b = L.open(div('b'));
    b.remove();
    expect(L.list()).toEqual([]);
  });
  it('closeAll() closes everything and says how many, and reports one that will not close', () => {
    L.open(div('a')); L.open(div('b'));
    expect(L.closeAll()).toBe(2);
    L.open(div('c'), { onClose: () => { throw new Error('stuck'); } });
    expect(() => L.closeAll()).toThrow(/stuck/);
  });
});

describe('Escape', () => {
  const esc = () => { const e = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }); document.dispatchEvent(e); return e; };
  beforeEach(() => { document.addEventListener('keydown', (e) => L._onKey(e)); });
  it('closes the top dismissible layer, and leaves a tracked overlay to its own handler', () => {
    L.open(div('low'), { tier: 'panel' });
    L.open(div('high'), { tier: 'dialog' });
    L.track(document.body.appendChild(div('own')), { tier: 'menu' });
    const e = esc();
    expect(e.defaultPrevented).toBe(true);
    expect(document.getElementById('high')).toBe(null);
    expect(document.getElementById('own')).not.toBe(null);
  });
  it('twice in a row closes them all', () => {
    L.open(div('a')); L.open(div('b'), { dismissible: false });
    esc(); esc();
    expect(L.list()).toEqual([]);
  });
  it('does nothing for a key an overlay already handled', () => {
    L.open(div('a'));
    const e = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    e.preventDefault();
    L._onKey(e);
    expect(L.list()).toHaveLength(1);
  });
});

describe('sweep', () => {
  const fullWindow = (id, pointer) => {
    const d = div(id);
    d.style.cssText = 'position:fixed;inset:0;' + (pointer ? 'pointer-events:' + pointer + ';' : '');
    d.getBoundingClientRect = () => ({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight });
    document.body.appendChild(d);
    return d;
  };
  it('is clean when everything closed, and the wind-down veil (pointer-events:none) is allowed', () => {
    L.open(div('a'));
    fullWindow('wind-down-veil', 'none');
    const r = L.sweep();
    expect(r).toMatchObject({ closed: 1, blockers: [], ok: true });
  });
  it('names a full-window element that still takes clicks', () => {
    fullWindow('stuck-scrim');
    const r = L.sweep();
    expect(r.ok).toBe(false);
    expect(r.blockers[0]).toMatchObject({ element: 'div#stuck-scrim', covers: 100 });
  });
  it('lets the window\'s own structure cover the window', () => {
    fullWindow('webviews-container');
    expect(L.sweep().blockers).toEqual([]);
  });
  it('cancels an open vex dialog', () => {
    const o = div('dlg'); o.className = 'vex-dialog-overlay'; o._vexCancel = vi.fn(() => o.remove());
    document.body.appendChild(o);
    L.sweep();
    expect(o._vexCancel).toHaveBeenCalled();
  });
});

describe('adoption of the shared overlay helpers (T2-014)', () => {
  const fs = require('fs'), path = require('path');
  const src = (f) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'js', f), 'utf8');

  it('popover(): a menu that closes on an outside press is closed by closeAll, and removed if it ignores the press', () => {
    const closeOnOutside = document.createElement('div'); closeOnOutside.id = 'm1';
    document.body.appendChild(closeOnOutside);
    const outside = vi.fn((e) => { if (!closeOnOutside.contains(e.target)) closeOnOutside.remove(); });
    document.addEventListener('mousedown', outside, true);
    L.popover(closeOnOutside, 'm1');
    const stubborn = document.createElement('div'); stubborn.id = 'm2';
    document.body.appendChild(stubborn);
    L.popover(stubborn, 'm2');
    expect(L.list().map(l => l.id)).toEqual(['m1', 'm2']);
    expect(L.list().every(l => l.tier === 'menu' && l.dismissible === false)).toBe(true);
    expect(L.closeAll()).toBe(2);
    expect(outside).toHaveBeenCalled();
    expect(closeOnOutside.isConnected).toBe(false);
    expect(stubborn.isConnected).toBe(false);
    document.removeEventListener('mousedown', outside, true);
  });
  it('a single Escape leaves a popover to itself; a double Escape closes it', () => {
    const el = document.createElement('div'); document.body.appendChild(el);
    L.popover(el, 'p');
    const esc = () => L._onKey(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    esc();
    expect(el.isConnected).toBe(true);
    esc();
    expect(el.isConnected).toBe(false);
  });
  it('dialogs, the toast container and context menus register where they are built', () => {
    expect(src('vex-dialog.js')).toMatch(/VexLayer\.track\(overlay, \{ tier: 'dialog'/);
    expect(src('app.js')).toMatch(/VexLayer\.track\(container, \{ tier: 'toast'/);
    const tabs = src('tabs.js');
    expect(tabs).toMatch(/VexLayer\.track\(menu, \{ tier: 'menu', id: 'context-menu'/);
    expect(tabs).toMatch(/VexLayer\.track\(overlay, \{ tier: 'menu', id: 'context-menu-backdrop'/);
  });
  it('the eleven popovers with their own dismissal register as popovers', () => {
    for (const [file, id] of [['attention-inbox.js', 'attention-inbox'], ['downloads-button.js', 'downloads-menu'], ['handoff.js', 'handoff-menu'], ['horizontal-tabs.js', 'all-tabs-menu'],
      ['look-sidebar.js', 'look-sidebar-menu'], ['nav-history-menu.js', 'nav-history-menu'], ['notes-panel.js', 'notes-menu'], ['profiles-ui.js', 'profiles-menu'],
      ['strip-actions.js', 'strip-actions-menu'], ['tasks.js', 'tasks-menu'], ['toolbar-overflow.js', 'toolbar-overflow-menu']]) {
      expect(src(file), file).toContain("VexLayer.popover(");
      expect(src(file), file).toContain("'" + id + "'");
    }
  });
  it('the overlay census counts what is left and refuses to grow', () => {
    const { census } = require('../../scripts/overlay-census.js');
    const c = census();
    const base = require('../../scripts/overlay-census.json');
    expect(c.remainingJs).toBeLessThanOrEqual(base.remainingJs);
    expect(c.onLayer).toBeGreaterThanOrEqual(5);
  });
});
