// @vitest-environment jsdom
// Saved addresses (js/saved-addresses.js): the pure parts, the order and the refusals of the fill (a question first, only https, never a
// private tab, nothing if the page changed), the address book drawn without trusting its text, and the wiring.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const fs = require('fs'), path = require('path');
const { VexSaved: V } = require('../../src/renderer/js/saved-addresses.js');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

const ADA = { id: 'a1', label: 'Home', name: 'Ada Lovelace', street: '12 Analytical Way', city: 'London', postcode: 'N1 9GU', country: 'United Kingdom', phone: '+44 20 7946 0000' };

describe('pure parts', () => {
  it('only fills https pages, and http on this computer', () => {
    expect(V.canFillUrl('https://shop.example/checkout')).toEqual({ ok: true, host: 'shop.example' });
    expect(V.canFillUrl('http://localhost:3000/pay')).toEqual({ ok: true, host: 'localhost' });
    expect(V.canFillUrl('http://127.0.0.1/pay').ok).toBe(true);
    expect(V.canFillUrl('http://shop.example/checkout').ok).toBe(false);
    expect(V.canFillUrl('http://shop.example/checkout').reason).toMatch(/not secure/);
    expect(V.canFillUrl('file:///C:/x.html').ok).toBe(false);
    expect(V.canFillUrl('vex://newtab').ok).toBe(false);
    expect(V.canFillUrl('not a url').ok).toBe(false);
  });
  it('names the host in lower case', () => {
    expect(V.hostOf('https://Shop.Example/a?b=1')).toBe('shop.example');
    expect(V.hostOf('nonsense')).toBe('');
  });
  it('lists the labelled lines and leaves empty ones out', () => {
    expect(V.lines(ADA).map(l => l.label)).toEqual(['Name', 'Street', 'City', 'Postcode', 'Country', 'Phone']);
    expect(V.lines({ name: 'A', street: 'S', city: 'C', phone: '' }).map(l => l.key)).toEqual(['name', 'street', 'city']);
    expect(V.lines(null)).toEqual([]);
  });
  it('translates an address into the field names Form Fill uses', () => {
    expect(V.toProfile(ADA)).toEqual({ fullName: 'Ada Lovelace', address: '12 Analytical Way', city: 'London', zip: 'N1 9GU', country: 'United Kingdom', phone: '+44 20 7946 0000' });
    expect(V.toProfile({ name: 'A', street: 'S', city: 'C' })).toEqual({ fullName: 'A', address: 'S', city: 'C' });
  });
  it('writes the question with the site and every line', () => {
    const t = V.confirmText(ADA, 'shop.example');
    expect(t.split('\n')[0]).toBe('These details will be typed into the form on shop.example:');
    expect(t).toContain('Street: 12 Analytical Way');
    expect(t).toContain('Phone: +44 20 7946 0000');
  });
});

describe('fill', () => {
  let wv, url, confirmCalls, toasts, formFill;
  beforeEach(() => {
    url = 'https://shop.example/checkout';
    wv = { getURL: () => url };
    globalThis.WebviewManager = { getActiveWebview: () => wv };
    globalThis.TabManager = { tabs: [{ id: 't1' }], activeTabId: 't1' };
    globalThis.VexTabPolicy = { canShareTab: () => true };
    formFill = { fill: vi.fn() };
    globalThis.FormFill = formFill;
    confirmCalls = [];
    toasts = [];
    window.showToast = (m, kind) => toasts.push([m, kind]);
    window.escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    window.vexConfirm = vi.fn(async (o) => { confirmCalls.push(o); return true; });
    window.vex = {
      addressesList: vi.fn(async () => [{ id: 'a1', label: 'Home', name: 'Ada Lovelace', city: 'London', country: 'United Kingdom' }]),
      addressesGet: vi.fn(async () => ({ ...ADA })),
      addressesSave: vi.fn(async () => ({ ok: true })),
      addressesDelete: vi.fn(async () => ({ ok: true })),
    };
  });
  afterEach(() => {
    vi.restoreAllMocks();
    for (const k of ['WebviewManager', 'TabManager', 'VexTabPolicy', 'FormFill']) delete globalThis[k];
    delete window.vex; delete window.vexConfirm; delete window.showToast; delete window.escapeHtml;
    document.body.innerHTML = '';
  });

  it('asks first, showing the site and every line, and fills only after a yes', async () => {
    const ran = await V.fill();
    expect(ran).toBe(true);
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    const q = confirmCalls[0];
    expect(q.title).toContain('shop.example');
    expect(q.html).toContain('12 Analytical Way');
    expect(q.html).toContain('+44 20 7946 0000');
    expect(formFill.fill).toHaveBeenCalledTimes(1);
    expect(formFill.fill.mock.calls[0][0]).toEqual(V.toProfile(ADA));
  });
  it('fills nothing when the question is answered no', async () => {
    window.vexConfirm = vi.fn(async () => false);
    expect(await V.fill()).toBe(false);
    expect(formFill.fill).not.toHaveBeenCalled();
  });
  it('escapes what it shows in the question', async () => {
    window.vex.addressesGet = vi.fn(async () => ({ ...ADA, street: '<img src=x onerror=alert(1)>' }));
    await V.fill();
    expect(confirmCalls[0].html).not.toContain('<img');
    expect(confirmCalls[0].html).toContain('&lt;img');
  });
  it('never fills a private, Tor or burner tab, and reads nothing first', async () => {
    globalThis.VexTabPolicy = { canShareTab: () => false };
    expect(await V.fill()).toBe(false);
    expect(window.vex.addressesList).not.toHaveBeenCalled();
    expect(window.vexConfirm).not.toHaveBeenCalled();
    expect(formFill.fill).not.toHaveBeenCalled();
  });
  it('never fills an http page', async () => {
    url = 'http://shop.example/checkout';
    expect(await V.fill()).toBe(false);
    expect(window.vex.addressesList).not.toHaveBeenCalled();
    expect(formFill.fill).not.toHaveBeenCalled();
    expect(toasts.length).toBe(1);
  });
  it('fills nothing when the page changed while the question was open', async () => {
    window.vexConfirm = vi.fn(async () => { url = 'https://evil.example/'; return true; });
    expect(await V.fill()).toBe(false);
    expect(formFill.fill).not.toHaveBeenCalled();
    expect(toasts.some(t => /changed/.test(t[0]))).toBe(true);
  });
  it('fills nothing when another tab came to the front while the question was open', async () => {
    window.vexConfirm = vi.fn(async () => { globalThis.WebviewManager = { getActiveWebview: () => ({ getURL: () => url }) }; return true; });
    expect(await V.fill()).toBe(false);
    expect(formFill.fill).not.toHaveBeenCalled();
  });
  it('with several addresses asks which one first, and fills the one picked', async () => {
    window.vex.addressesList = vi.fn(async () => [{ id: 'a1', label: 'Home' }, { id: 'b2', label: 'Work' }]);
    const pick = vi.spyOn(V, 'pick').mockResolvedValue('b2');
    await V.fill();
    expect(pick).toHaveBeenCalledWith(expect.any(Array), 'shop.example');
    expect(window.vex.addressesGet).toHaveBeenCalledWith('b2');
    expect(formFill.fill).toHaveBeenCalledTimes(1);
  });
  it('does nothing more when the choice is cancelled', async () => {
    window.vex.addressesList = vi.fn(async () => [{ id: 'a1', label: 'Home' }, { id: 'b2', label: 'Work' }]);
    vi.spyOn(V, 'pick').mockResolvedValue(null);
    expect(await V.fill()).toBe(false);
    expect(window.vex.addressesGet).not.toHaveBeenCalled();
    expect(window.vexConfirm).not.toHaveBeenCalled();
  });
  it('opens the address book when none is saved', async () => {
    window.vex.addressesList = vi.fn(async () => []);
    const manage = vi.spyOn(V, 'manage').mockResolvedValue(undefined);
    expect(await V.fill()).toBe(false);
    expect(manage).toHaveBeenCalledTimes(1);
    expect(formFill.fill).not.toHaveBeenCalled();
  });
  it('throws plainly when Form Fill is missing, after the question', async () => {
    delete globalThis.FormFill;
    await expect(V.fill()).rejects.toThrow(/Form Fill is not available/);
  });
  it('throws plainly in a window without the bridge', async () => {
    delete window.vex;
    await expect(V.fill()).rejects.toThrow(/not available in this window/);
  });
});

describe('the address book', () => {
  afterEach(() => { document.body.innerHTML = ''; delete window.vex; });
  it('draws the list from text, so a hostile label is shown and never run', async () => {
    window.vex = {
      addressesList: async () => [{ id: 'x', label: '<img src=x onerror=alert(1)>', name: '<b>N</b>', city: 'C', country: '' }],
      addressesGet: async () => null, addressesSave: async () => ({ ok: true }), addressesDelete: async () => ({ ok: true }),
    };
    await V.manage();
    const box = document.getElementById('vex-address-book');
    expect(box).not.toBeNull();
    expect(box.querySelector('img')).toBeNull();
    expect(box.querySelector('b')).toBeNull();
    expect(box.textContent).toContain('<img src=x onerror=alert(1)>');
  });
  it('saves a new address through the bridge and shows the reason when it is refused', async () => {
    const save = vi.fn(async () => ({ ok: false, error: 'An address needs a street' }));
    window.vex = { addressesList: async () => [], addressesGet: async () => null, addressesSave: save, addressesDelete: async () => ({ ok: true }) };
    await V.edit('', () => {});
    const form = document.getElementById('vex-address-edit');
    const buttons = [...form.querySelectorAll('button')];
    buttons.find(b => b.textContent === 'Save').click();
    await new Promise(r => setTimeout(r, 0));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].id).toBeUndefined();
    expect(form.textContent).toContain('An address needs a street');
  });
});

describe('wiring', () => {
  it('is a lazy module with no index.html tag, and registers two one-line commands', () => {
    expect(read('src/renderer/js/lazy-boot.js')).toContain("{ src: 'js/saved-addresses.js'");
    expect(read('src/renderer/index.html')).not.toContain('saved-addresses.js');
    const src = read('src/renderer/js/saved-addresses.js');
    expect(src).toMatch(/registerCommand\(\{ id: 'address-book', label: 'Saved Addresses'/);
    expect(src).toMatch(/registerCommand\(\{ id: 'address-fill', label: 'Fill Saved Address into This Page'/);
  });
  it('keeps its text out of web storage and out of the page', () => {
    const src = read('src/renderer/js/saved-addresses.js');
    expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(src).not.toMatch(/executeJavaScript/);
  });
  it('has a catalogue entry that opens the fill command, and a manifest with no storage key', () => {
    expect(read('src/renderer/js/feature-catalog.js')).toMatch(/\{ id: 'saved-addresses', feature: 'saved-addresses'.*cmd: 'address-fill'/);
    expect(read('src/renderer/js/feature-manifests.js')).toMatch(/id: 'saved-addresses'.*storageKeys: \[\], commands: \['address-book', 'address-fill'\]/);
  });
});
