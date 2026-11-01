// @vitest-environment jsdom
//
// Share my look (js/share-look.js): a look goes out as a .vexlook file or a vex://look link and comes back in through strict checks.
// Real theme packs, icon packs, skins, fonts, ThemeManager and CustomThemes are loaded; only the look (gui-style), the wallpaper store and
// the theme studio are small stand-ins (they need a whole window).
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (f) => fs.readFileSync(path.resolve(__dirname, '../../src/renderer', f), 'utf8');
const run = (src, ret) => new Function(src + '\n;return ' + ret + ';')();

let S, TM, Packs, Custom, studio, gui, wp, F, Skins;
const LOOKS = ['classic', 'firefox', 'chrome', 'glass', 'neobrutal', 'terminal', 'fluent'];
const ATTRS = ['data-pk-tabs', 'data-pk-bar', 'data-pk-surface', 'data-pk-density'];

function stubs() {
  gui = { look: 'classic', colors: 'look', fail: false,
    styles: () => LOOKS.slice(), get() { return this.look; }, getColors() { return this.colors; },
    async set(s) { if (this.fail && s === 'terminal') throw new Error('the look broke'); this.look = s; }, setColors(m) { this.colors = m; } };
  window.VexGuiStyle = gui;
  const items = [
    { id: 'aurora-borealis', title: 'Aurora', source: 'generated' },
    { id: 'dusk-dunes', title: 'Dusk dunes', source: 'generated' },
    { id: 'photo-listed-one', title: 'A listed photo', source: 'catalogue' },
  ];
  wp = { cur: null, items,
    list() { return this.items; }, get(id) { return this.items.find((x) => x.id === id) || (/^photo-/.test(id) ? { id, stub: true } : null); },
    current() { return this.cur; }, async apply(id, p) { this.cur = { id, dim: (p && p.dim) || 0, blur: (p && p.blur) || 0, auto: true }; return this.cur; },
    async remove() { this.cur = null; } };
  window.VexWallpapers = wp;
  studio = {
    records: () => Custom.list(), record: (id) => Custom.list().find((r) => r.id === id) || null,
    async addTheme({ name, colors }, { wear = true } = {}) {
      const list = Custom.list();
      const id = Custom.newId(list.map((r) => r.id));
      const rec = Custom.validateRecord({ id, name, colors: Custom.complete(colors), updated: 1 });
      list.push(rec); Custom.saveList(list);
      TM.THEMES.push({ id, label: name, accent: rec.colors.primary, user: true, mock: {} });
      if (wear) TM.applyTheme(id);
      return rec;
    },
    async remove(id) {
      Custom.saveList(Custom.list().filter((r) => r.id !== id));
      const i = TM.THEMES.findIndex((t) => t.id === id);
      if (i >= 0) TM.THEMES.splice(i, 1);
    },
  };
  window.ThemeStudio = studio;
}

beforeEach(() => {
  localStorage.clear();
  for (const a of ATTRS) document.documentElement.removeAttribute(a);
  document.documentElement.removeAttribute('data-icon-pack');
  delete window.VexIconPacks; delete window.VexThemePacks; delete window.VexShareLook;
  window.VexIcons = run(read('js/vex-icons.js'), 'VexIcons');
  TM = run(read('js/theme-manager.js'), 'ThemeManager'); window.ThemeManager = TM;
  Custom = run(read('js/theme-custom.js'), 'CustomThemes'); window.CustomThemes = Custom;
  F = run(read('js/fonts.js').replace(/^const VexFonts/m, 'var VexFonts'), 'VexFonts'); window.VexFonts = F;
  Skins = run(read('js/skins.js').replace(/^const VexSkins/m, 'var VexSkins'), 'VexSkins'); window.VexSkins = Skins;
  run(read('js/icon-packs.js'), '0');
  run(read('js/theme-packs.js'), '0');
  Packs = window.VexThemePacks;
  stubs();
  run(read('js/share-look.js'), '0');
  S = window.VexShareLook;
});

const base = () => S.capture();
const mut = (fn) => { const l = JSON.parse(JSON.stringify(base())); fn(l); return l; };
const state = () => ({
  colours: TM.getCurrentTheme(), icons: window.VexIconPacks.current().id, design: Packs.current().design, pack: Packs.current().pack,
  font: F.current().id, mono: F.currentMono().id, look: gui.look, colorMode: gui.colors, wall: wp.cur && wp.cur.id,
  skin: [Skins.pattern().id, Skins.shape().id, Skins.glow().id, Skins.strength().id],
  store: Object.keys(localStorage).sort().map((k) => k + '=' + localStorage.getItem(k)).filter((x) => !x.startsWith('vex.shareLook') && !x.startsWith('vex.customThemes')),
});

describe('capture and the file', () => {
  it('captures only look fields, and the file is rebuilt from checked values', () => {
    const look = base();
    expect(Object.keys(look).every((k) => S.FIELDS.includes(k))).toBe(true);
    const text = S.toFile(look);
    expect(JSON.parse(text).format).toBe('vex-look');
    expect(S.parse(text)).toEqual(look);
  });

  it('round-trips every theme pack through a file and a link, and wearing it gives the pack back', async () => {
    for (const p of Packs.PACKS) {
      Packs.applyPack(p.id);
      gui.look = p.look;
      const look = S.capture('Ana');
      expect(look.pack).toBe(p.id);
      const fromFile = S.parse(S.toFile(look));
      const fromLink = S.parse(S.toLink(look));
      expect(fromFile).toEqual(look);
      expect(fromLink).toEqual(look);
      expect(S.toLink(look).length).toBeLessThan(S.LINK_PREFIX.length + 2800);
      // Another state, then the look.
      Packs.reset(); TM.applyTheme('oxford'); gui.look = 'classic';
      const r = await S.apply(fromLink);
      expect(r.skipped).toEqual([]);
      const s = state();
      expect(s.colours).toBe(p.colours);
      expect(s.icons).toBe(p.icons);
      expect(s.design).toBe(p.design);
      expect(s.pack).toBe(p.id);
      expect(s.look).toBe(p.look);
      expect(s.font).toBe(p.fonts ? p.fonts.ui : F.current().id);
      localStorage.removeItem(S.UNDO_KEY);
    }
  });

  it('a look with colours of its own fits a link, adds a theme once, and wears it', async () => {
    const colors = { background: '#101820', surface: '#1b2733', text: '#e8eef5', muted: '#9fb0c0', primary: '#4fb3ff', success: '#3ddc97', warning: '#f5c542', danger: '#ff6b6b', border: '#2c3b4a' };
    const look = mut((l) => { l.colours = { name: 'Harbour', colors }; });
    const link = S.toLink(look);
    expect(new TextEncoder().encode(JSON.stringify(look)).length).toBeLessThan(S.LINK_MAX);
    const parsed = S.parse(link);
    await S.apply(parsed);
    expect(studio.records().length).toBe(1);
    expect(TM.getCurrentTheme()).toBe(studio.records()[0].id);
    await S.apply(parsed);
    expect(studio.records().length).toBe(1);        // the same colours are reused, not added again
  });

  it('colours that read badly are fixed to 4.5:1 on the way in', () => {
    const colors = { background: '#20242a', surface: '#2a2f36', text: '#555566', muted: '#444455', primary: '#333344' };
    const look = S.validate(mut((l) => { l.colours = { name: 'Murk', colors }; }));
    const checks = Custom.checks(look.colours.colors);
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(look.colours.colors.background).toBe('#20242a');         // the background is never moved
  });

  it('colours that cannot be made readable are refused', () => {
    const colors = { background: '#808080', surface: '#808080', text: '#808080', primary: '#808080' };
    expect(() => S.validate(mut((l) => { l.colours = { name: 'Grey', colors }; }))).toThrow(/cannot be made readable/);
  });
});

describe('strict checks on whatever comes in', () => {
  const bad = (fn, re) => expect(() => S.validate(mut(fn))).toThrow(re);

  it('refuses unknown ids from this build', () => {
    bad((l) => { l.colours = 'no-such-theme'; }, /no colour theme/);
    bad((l) => { l.pack = 'ghost'; }, /no theme pack/);
    bad((l) => { l.design = 'ghost'; }, /no design/);
    bad((l) => { l.icons = 'ghost'; }, /no icon pack/);
    bad((l) => { l.look = 'ghost'; }, /no look/);
    bad((l) => { l.guiColors = 'ghost'; }, /no colour mode/);
    bad((l) => { l.skin.shape = 'ghost'; }, /no skin shape/);
    bad((l) => { l.fonts.ui = 'ghost'; }, /no font/);
    bad((l) => { l.fonts.mono = 'segoe'; }, /no code font/);
    bad((l) => { l.wallpaper = { id: 'no-such-wall' }; }, /no wallpaper/);
  });

  it('refuses unknown fields anywhere', () => {
    bad((l) => { l.extra = 1; }, /something a look does not/);
    bad((l) => { l.skin.extra = 'x'; }, /skin field/);
    bad((l) => { l.fonts.file = 'x'; }, /font field/);
    bad((l) => { l.wallpaper = { id: 'aurora-borealis', url: 'https://evil.example/x.png' }; }, /wallpaper field/);
    bad((l) => { l.colours = { name: 'a', colors: { background: '#000000', surface: '#111111', text: '#ffffff', primary: '#ff0000', extra: '#000000' } }; }, /Unknown colour/);
    bad((l) => { l.colours = { name: 'a', colors: { background: '#000000', surface: '#111111', text: '#ffffff', primary: '#ff0000' }, image: 'data:image/png;base64,AAAA' }; }, /theme field/);
    expect(() => S.parse('{"__proto__":{"x":1},"format":"vex-look","version":1}')).toThrow(/something a look does not/);
  });

  it('refuses colours that are not plain hex, and code or addresses in their place', () => {
    for (const v of ['red', 'rgb(0,0,0)', 'url(https://evil.example/x)', '#12345', 'var(--x)', '#000000; background:url(x)', 5, null]) {
      bad((l) => { l.colours = { name: 'a', colors: { background: v, surface: '#111111', text: '#ffffff', primary: '#ff0000' } }; }, /colour|Not a colour|no background/i);
    }
  });

  it('refuses a picture of the person’s own, and wallpaper ids that are addresses', () => {
    bad((l) => { l.wallpaper = { id: 'my-0123456789ab' }; }, /never part of a look/);
    for (const id of ['https://evil.example/x.png', '../../x', 'a b', 'data:image/png;base64,AA', 'x']) bad((l) => { l.wallpaper = { id }; }, /not a wallpaper id/);
  });

  it('refuses the wrong kind of document, a newer version, and what is not JSON', () => {
    expect(() => S.parse('not json')).toThrow(/not JSON/);
    expect(() => S.parse('[]')).toThrow(/not a Vex look/);
    expect(() => S.parse('{"format":"vex-theme","version":1}')).toThrow(/not a Vex look/);
    expect(() => S.parse(JSON.stringify({ ...base(), version: 2 }))).toThrow(/newer Vex/);
    expect(() => S.parse(JSON.stringify({ ...base(), version: 0 }))).toThrow(/no version/);
    expect(() => S.parse(5)).toThrow(/not a Vex look/);
  });

  it('refuses an oversized file and an oversized or damaged link', () => {
    expect(() => S.parse(' '.repeat(S.FILE_MAX + 10) + S.toFile(base()))).toThrow(/too big/);
    const big = S.LINK_PREFIX + 'A'.repeat(4000);
    expect(() => S.parse(big)).toThrow(/too big/);
    expect(() => S.parse(S.LINK_PREFIX + 'abc$%')).toThrow(/damaged/);
    // Valid base64url of 3 KB of text.
    const bytes = new TextEncoder().encode('{"a":"' + 'x'.repeat(3000) + '"}');
    let s = ''; for (const b of bytes) s += String.fromCharCode(b);
    const link = S.LINK_PREFIX + btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(() => S.parse(link)).toThrow(/too big/);
    // Not UTF-8 text.
    expect(() => S.parse(S.LINK_PREFIX + btoa(String.fromCharCode(0xff, 0xfe, 0xfd)).replace(/=+$/, ''))).toThrow(/damaged/);
  });

  it('keeps a name as plain text of at most 30 characters', () => {
    expect(S.validate(mut((l) => { l.name = '  <img src=x onerror=alert(1)>  Ana\n'; })).name).toBe('img src=x onerror=alert(1) Ana');
    bad((l) => { l.name = 'x'.repeat(31); }, /30 characters/);
    bad((l) => { l.name = 5; }, /must be text/);
    expect(S.validate(mut((l) => { l.name = '   '; })).name).toBeUndefined();
  });

});

describe('nothing personal is in the export', () => {
  it('a profile full of personal data exports none of it', () => {
    const secrets = ['hunter2-password', 'ana@example.com', 'https://bank.example/account', 'MySecretBookmarkTitle', 'ProfileNameAna', 'sk-live-TOKEN123', 'private-tab-history-entry', 'my-aaaaaaaaaaaa'];
    localStorage.setItem('vex.bookmarks', JSON.stringify([{ title: secrets[3], url: secrets[2] }]));
    localStorage.setItem('vex.history', JSON.stringify([{ url: secrets[2], title: secrets[6] }]));
    localStorage.setItem('vex.profileName', secrets[4]);
    localStorage.setItem('vex.passwords', JSON.stringify([{ user: secrets[1], pass: secrets[0] }]));
    localStorage.setItem('vex.syncToken', secrets[5]);
    localStorage.setItem('vex.notes', JSON.stringify([{ text: secrets[0] }]));
    wp.cur = { id: secrets[7], dim: 0, blur: 0, auto: true };      // a picture of his own
    Packs.applyPack('frost');
    const text = S.toFile(S.capture());
    const link = S.toLink(S.capture());
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(link.slice(S.LINK_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
    for (const s of secrets) { expect(text).not.toContain(s); expect(decoded).not.toContain(s); expect(S.toText(S.capture())).not.toContain(s); }
    expect(JSON.parse(text).wallpaper).toBeUndefined();
    expect(Object.keys(JSON.parse(text)).every((k) => S.FIELDS.includes(k))).toBe(true);
  });

  it('a custom theme goes by its colours only, never its picture', () => {
    const colors = { background: '#101820', surface: '#1b2733', text: '#e8eef5', primary: '#4fb3ff' };
    return studio.addTheme({ name: 'Mine', colors }).then(() => {
      localStorage.setItem('vex.customThemeImage', 'data:image/png;base64,AAAA');
      const look = S.capture();
      expect(Object.keys(look.colours).sort()).toEqual(['colors', 'name']);
      expect(S.toFile(look)).not.toContain('data:image');
    });
  });

  it('font choices are names, never files', () => {
    const t = S.toFile(base());
    expect(JSON.parse(t).fonts).toEqual({ ui: F.current().id, mono: F.currentMono().id });
    expect(t).not.toMatch(/\.(ttf|otf|woff2?)/i);
  });
});

describe('wearing a look and undoing it', () => {
  it('undo puts back exactly what was there', async () => {
    TM.applyTheme('sakura'); F.set('verdana'); F.setMono('courier'); Skins.set('shape', 'round'); window.VexIconPacks.set('bold');
    Packs.setDesign('capsule'); gui.look = 'chrome'; gui.colors = 'theme'; await wp.apply('dusk-dunes', { dim: 0.3, blur: 5 });
    const before = state();
    const colors = { background: '#101820', surface: '#1b2733', text: '#e8eef5', primary: '#4fb3ff' };
    const look = S.validate(mut((l) => {
      l.colours = { name: 'Harbour', colors }; l.icons = 'pixel'; l.design = 'slab'; l.look = 'terminal'; l.guiColors = 'look';
      l.fonts = { ui: 'georgia', mono: 'consolas' }; l.skin = { pattern: 'none', shape: 'heavy', glow: 'flat', strength: 'soft' }; l.wallpaper = { id: 'aurora-borealis' };
    }));
    await S.apply(look);
    expect(state()).not.toEqual(before);
    expect(state().icons).toBe('pixel');
    expect(state().wall).toBe('aurora-borealis');
    expect(S.hasUndo()).toBe(true);
    await S.undo();
    expect(state()).toEqual(before);
    expect(wp.cur.dim).toBe(0.3);
    expect(studio.records().length).toBe(0);              // the theme the look added is gone again
    expect(S.hasUndo()).toBe(false);
    expect(document.documentElement.getAttribute('data-icon-pack')).toBe('bold');
  });

  it('a look with no wallpaper leaves the wallpaper alone', async () => {
    await wp.apply('dusk-dunes');
    await S.apply(mut((l) => { delete l.wallpaper; l.icons = 'soft'; }));
    expect(wp.cur.id).toBe('dusk-dunes');
  });

  it('a photo the store does not list is skipped and said so; a listed one is worn', async () => {
    const r = await S.apply(mut((l) => { l.wallpaper = { id: 'photo-not-listed' }; }));
    expect(r.skipped.join(' ')).toMatch(/not in your wallpaper list/);
    expect(wp.cur).toBeNull();
    const r2 = await S.apply(mut((l) => { l.wallpaper = { id: 'photo-listed-one' }; }));
    expect(r2.skipped).toEqual([]);
    expect(wp.cur.id).toBe('photo-listed-one');
  });

  it('a failure half-way puts the old look back and raises the error', async () => {
    TM.applyTheme('sakura'); window.VexIconPacks.set('bold');
    const before = state();
    gui.fail = true;
    await expect(S.apply(mut((l) => { l.colours = 'midnight'; l.icons = 'pixel'; l.look = 'terminal'; }))).rejects.toThrow(/the look broke/);
    gui.fail = false;
    expect(state()).toEqual(before);
    expect(S.hasUndo()).toBe(false);
  });

  it('undo with nothing to undo says so; a damaged record is raised', async () => {
    await expect(S.undo()).rejects.toThrow(/no shared look to undo/);
    localStorage.setItem(S.UNDO_KEY, '{nope');
    await expect(S.undo()).rejects.toThrow(/damaged/);
  });

  it('the plain text holds the summary and the link', () => {
    const t = S.toText(S.capture('Ana'));
    expect(t).toMatch(/^Ana’s look: colours /);
    expect(t).toContain(S.LINK_PREFIX);
    expect(S.parse(t.split('\n').pop()).name).toBe('Ana');
  });
});

describe('the screens (js/share-look-ui.js)', () => {
  let UI, toasts, offers;
  beforeEach(() => {
    document.body.innerHTML = '<input id="command-input"><input id="url-input"><button id="setting-share-look"></button><button id="setting-open-shared-look"></button>';
    toasts = []; offers = [];
    window.showToast = (m, type) => toasts.push([m, type]);
    window.VexUndo = { offer: (o) => offers.push(o) };
    window.VexSettingsGroups = {
      dialog: ({ id, title }) => {
        document.getElementById(id)?.remove();
        const overlay = document.createElement('div'); overlay.id = id; const body = document.createElement('div'); overlay.append(body); document.body.append(overlay);
        overlay.dataset.title = title;
        return { overlay, body, close: () => overlay.remove() };
      },
      note: (t) => { const d = document.createElement('div'); d.textContent = t; return d; },
      button: (t, fn) => { const b = document.createElement('button'); b.textContent = t; b.addEventListener('click', fn); return b; },
    };
    const reg = [];
    window.VexExtras = { registerCommand: (c) => { reg.push(c); return true; }, reg };
    UI = new Function(read('js/share-look-ui.js') + '\n;return VexShareLookUI;')();
    window.VexShareLookUI = UI;
  });

  const typeInto = (id, text) => { const el = document.getElementById(id); el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); return el; };
  const dropFile = (name, text) => {
    const e = new Event('drop', { bubbles: true, cancelable: true });
    e.dataTransfer = { files: [new File([text], name)], types: ['Files'] };
    document.body.dispatchEvent(e);
    return e;
  };
  const button = (label) => [...document.querySelectorAll('#vex-share-look-review button')].find((b) => b.textContent === label);
  const tick = () => new Promise((r) => setTimeout(r, 20));

  it('a look link pasted in Ctrl+K opens the review and clears the box', () => {
    const link = S.toLink(S.capture('Ana'));
    typeInto('command-input', 'hello');
    expect(document.getElementById('vex-share-look-review')).toBeNull();
    const box = typeInto('command-input', link);
    expect(document.getElementById('vex-share-look-review').dataset.title).toBe('Ana’s look');
    expect(box.value).toBe('');
  });

  it('a look link in the address bar also opens it, and a damaged one says why instead of opening', () => {
    typeInto('url-input', S.toLink(S.capture()));
    expect(document.getElementById('vex-share-look-review')).not.toBeNull();
    document.getElementById('vex-share-look-review').remove();
    typeInto('url-input', S.LINK_PREFIX + 'a$$');
    expect(document.getElementById('vex-share-look-review')).toBeNull();
    expect(toasts.at(-1)[1]).toBe('error');
  });

  it('Apply wears the look and offers Undo; Cancel changes nothing', async () => {
    const look = S.validate(mut((l) => { l.icons = 'pixel'; }));
    UI.review(look);
    button('Cancel').click();
    expect(window.VexIconPacks.current().id).not.toBe('pixel');
    UI.review(look);
    button('Apply').click();
    await tick();
    expect(window.VexIconPacks.current().id).toBe('pixel');
    expect(document.getElementById('vex-share-look-review')).toBeNull();
    expect(offers.length).toBe(1);
    await offers[0].undo();
    expect(window.VexIconPacks.current().id).not.toBe('pixel');
  });

  it('a failing Apply keeps the screen open and says what failed', async () => {
    gui.fail = true;
    UI.review(S.validate(mut((l) => { l.look = 'terminal'; })));
    button('Apply').click();
    await tick();
    expect(document.getElementById('vex-share-look-review')).not.toBeNull();
    expect(toasts.at(-1)[0]).toMatch(/the look broke/);
  });

  it('a dropped .vexlook opens the review; any other file is left alone; a bad one is refused out loud', async () => {
    const e = dropFile('friend.vexlook', S.toFile(S.capture('Bo')));
    expect(e.defaultPrevented).toBe(true);
    await tick();
    expect(document.getElementById('vex-share-look-review').dataset.title).toBe('Bo’s look');
    document.getElementById('vex-share-look-review').remove();
    expect(dropFile('photo.png', 'x').defaultPrevented).toBe(false);
    dropFile('evil.vexlook', '{"format":"vex-look","version":1,"colours":"nope"}');
    await tick();
    expect(document.getElementById('vex-share-look-review')).toBeNull();
    expect(toasts.at(-1)[1]).toBe('error');
  });

  it('refuses a file over the cap before reading it', async () => {
    await expect(UI.openFile({ size: S.FILE_MAX + 1, text: () => { throw new Error('read'); } })).rejects.toThrow(/too big/);
  });

  it('registers the three commands, and the file name is a plain slug', () => {
    expect(window.VexExtras.reg.map((c) => c.id)).toEqual(['share-look', 'open-shared-look', 'undo-shared-look']);
    expect(UI.fileName({ name: 'Ana’s look!' })).toBe('ana-s-look.vexlook');
    expect(UI.fileName({})).toBe('my-look.vexlook');
  });

  it('the share screen offers file, link and text, and holds no personal data', () => {
    localStorage.setItem('vex.bookmarks', 'SECRET-BOOKMARK');
    UI.share();
    const el = document.getElementById('vex-share-look');
    expect([...el.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Save as a file', 'Copy link', 'Copy as text']);
    expect(el.textContent).not.toContain('SECRET-BOOKMARK');
  });
});
