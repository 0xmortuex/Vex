// @vitest-environment jsdom
//
// T2-014: js/vex-layer.js, the overlay layer manager and the post-close click sweep.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
let L;
beforeEach(() => {
  document.body.innerHTML = '';
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
