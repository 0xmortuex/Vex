// @vitest-environment jsdom
//
// The friend profile card: local only, shows only what is ticked.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src/renderer/js/friend-card.js');
const fresh = () => { const r = require.resolve(SRC); delete require.cache[r]; return require(r).FriendCard; };

const good = (n) => `<svg xmlns="http://www.w3.org/2000/svg" class="vmedal" width="72" height="72" viewBox="0 0 96 96" role="img"><title>M${n}</title><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><circle cx="48" cy="48" r="40" fill="url(#g)"/></svg>`;
const DATA = {
  name: 'Sam <b>Q</b>', level: 7, title: 'ignored here',
  medals: [
    { id: 'a', title: 'First steps', svg: good(1) },
    { id: 'b', title: 'Night "owl"', svg: good(2) },
    { id: 'evil', title: 'Evil', svg: '<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9"><script>alert(1)</script></svg>' },
    { id: 'evil2', title: 'Evil2', svg: '<svg width="9" height="9" onload="x()"><rect/></svg>' },
    { id: 'evil3', title: 'Evil3', svg: '<svg width="9" height="9"><image href="https://x.example/p.png"/></svg>' },
  ],
};

let FC;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div class="settings-content"><div class="setting-group" id="settings-profiles"></div></div>';
  delete window.vex; delete window.VexMedals;
  FC = fresh();
});

describe('what the card contains', () => {
  it('holds nothing when nothing is ticked', () => {
    const s = FC.build(DATA, {});
    expect(s).toContain('Nothing is ticked yet');
    expect(s).not.toContain('Sam');
    expect(s).not.toContain('LEVEL');
    expect(s).not.toContain('First steps');
  });

  it('draws only the ticked parts', () => {
    const s = FC.build(Object.assign({}, DATA, { title: 'Night owl' }), { name: true, medals: ['a'] });
    expect(s).toContain('Sam');
    expect(s).toContain('First steps');
    expect(s).not.toContain('Night owl');       // title not ticked
    expect(s).not.toContain('Night &quot;owl&quot;');  // medal b not ticked
    expect(s).not.toContain('LEVEL');
    const t = FC.build(Object.assign({}, DATA, { title: 'Night owl' }), { level: true, title: true });
    expect(t).toContain('>7<');
    expect(t).toContain('Night owl');
    expect(t).not.toContain('Sam');
  });

  it('escapes names and titles', () => {
    const s = FC.build(DATA, { name: true });
    expect(s).toContain('Sam &lt;b&gt;Q&lt;/b&gt;');
    expect(s).not.toContain('<b>');
    expect(new DOMParser().parseFromString(s, 'image/svg+xml').querySelector('parsererror')).toBeNull();
  });

  it('drops a medal picture that is not plain drawing markup', () => {
    const s = FC.build(DATA, { medals: ['evil', 'evil2', 'evil3'] });
    expect(s).not.toMatch(/<script|onload|<image|href=|alert/);
    expect(s).toContain('Evil');   // its title still shows, with a plain ring
    expect(FC.safeSvg(good(1))).not.toBe('');
    expect(FC.safeSvg('<svg><a xlink:href="javascript:x"/></svg>')).toBe('');
    expect(FC.safeSvg('<div/>')).toBe('');
    expect(FC.safeSvg(5)).toBe('');
  });

  it('keeps gradient ids from colliding between medals', () => {
    const s = FC.build(DATA, { medals: ['a', 'b'] });
    const ids = [...s.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(2);
    expect(s).toMatch(/url\(#fc0-g\)/);
    expect(s).toMatch(/url\(#fc1-g\)/);
  });

  it('is self-contained: no links, no scripts, no external resources', () => {
    const s = FC.build(DATA, { name: true, level: true, title: true, medals: ['a', 'b'] });
    expect(s).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(s).not.toMatch(/<script|<a\b|<image|<foreignObject|href=/);
  });
});

describe('local only', () => {
  it('has no network code at all', () => {
    const src = fs.readFileSync(SRC, 'utf8');
    expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|navigator\.share/);
  });

  it('uses the profile from VexMedals when it is loaded', () => {
    window.VexMedals = {
      list: () => [{ id: 'x', title: 'Opener' }, { id: 'y', title: 'Hidden' }],
      has: (id) => id === 'x',
      profile: () => ({ name: 'Ada' }),
      levelInfo: () => ({ level: 3 }),
      artOf: () => good(9),
    };
    const d = FC.data();
    expect(d.name).toBe('Ada');
    expect(d.level).toBe(3);
    expect(d.medals.map(m => m.id)).toEqual(['x']);
  });

  it('accepts a plain data object when VexMedals is absent', () => {
    FC.setSource({ name: 'Bo', level: 2, medals: [{ id: 'q', title: 'Q', svg: good(1) }] });
    expect(FC.data().name).toBe('Bo');
  });

  it('copies a PNG through the existing image IPC, and saves an SVG through file:save-text', async () => {
    window.Image = class { set src(v) { this._s = v; setTimeout(() => this.onload && this.onload(), 0); } };
    HTMLCanvasElement.prototype.getContext = () => ({ scale() {}, drawImage() {} });
    HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AAAA';
    window.vex = { copyImageFrom: vi.fn(async () => true), saveTextFile: vi.fn(async () => ({ ok: true, path: 'C:\\x\\card.svg' })) };
    const svg = FC.build(DATA, { name: true });
    await FC.copy(svg);
    expect(window.vex.copyImageFrom).toHaveBeenCalledWith('data:image/png;base64,AAAA');
    expect(await FC.saveSvg(svg)).toBe('C:\\x\\card.svg');
    expect(window.vex.saveTextFile.mock.calls[0][2]).toBe('svg');
    expect(window.vex.saveTextFile.mock.calls[0][1]).toBe(svg);
  });

  it('says plainly when copying is not available', async () => {
    await expect(FC.copy('<svg width="1" height="1"></svg>')).rejects.toThrow(/not available/);
    await expect(FC.saveSvg('<svg/>')).rejects.toThrow(/not available/);
  });
});

describe('the Settings group', () => {
  it('is injected by the module before Profiles, with nothing ticked by default', () => {
    FC.setSource(DATA);
    const host = FC.mountSettings();
    const group = document.getElementById('settings-friend-card');
    expect(group.nextElementSibling.id).toBe('settings-profiles');
    expect(group.querySelector('.setting-label').textContent).toMatch(/Personalization/i);
    expect(host.querySelectorAll('input[type=checkbox]:checked').length).toBe(0);
    expect(host.querySelector('.friendcard-preview').innerHTML).toContain('Nothing is ticked yet');
  });

  it('updates the preview as boxes are ticked and remembers the choice', () => {
    FC.setSource(DATA);
    const host = FC.mountSettings();
    const name = host.querySelector('#fc-name');
    name.checked = true; name.dispatchEvent(new Event('change'));
    expect(host.querySelector('.friendcard-preview').innerHTML).toContain('Sam');
    expect(JSON.parse(localStorage.getItem('vex.friendCard')).name).toBe(true);
    const again = fresh();
    again.setSource(DATA);
    document.getElementById('settings-friend-card').remove();
    const h2 = again.mountSettings();
    expect(h2.querySelector('#fc-name').checked).toBe(true);
  });
});
