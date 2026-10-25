// @vitest-environment jsdom
//
// Vex's own folder browser, the page side (src/renderer/folder-viewer) and the window's part of it (js/folder-viewer-host.js,
// js/webview.js): the words in two languages, the colours (only the interface's tokens), the order of a folder, the page's markup,
// the Markdown reader, and the address mapping. What it looks like and how it behaves in the real window is checked by driving a real
// Vex (the scripts are described in the report); jsdom cannot resolve var() or real computed styles.

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'src', 'renderer', 'folder-viewer');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const files = fs.readdirSync(DIR).filter((f) => /\.(js|html|css)$/.test(f));

let strings;
async function load() { strings = await import('../../src/renderer/folder-viewer/strings.js'); }

describe('the words: every sentence has Turkish, and the table has nothing left over', () => {
  const lit = (s) => { try { return new Function('return ' + s)(); } catch { return null; } };
  async function sentences() {
    const found = new Set();
    for (const f of files.filter((n) => /\.(js|html)$/.test(n) && n !== 'strings-tr.js')) {
      const src = read(f);
      for (const m of src.matchAll(/(?<![\w.$])t\(\s*('(?:[^'\\\n]|\\.)*')/g)) { const v = lit(m[1]); if (v) found.add(v); }
      for (const m of src.matchAll(/data-i18n(?:-title|-aria|-placeholder)?="([^"]*)"/g)) found.add(m[1]);
    }
    const { KIND_LABELS } = await import('../../src/renderer/folder-viewer/kinds.js');
    for (const l of KIND_LABELS) found.add(l);
    return found;
  }
  it('every sentence has a Turkish one', async () => {
    const { TR } = await import('../../src/renderer/folder-viewer/strings-tr.js');
    const missing = [...await sentences()].filter((s) => s && !(s in TR));
    expect(missing).toEqual([]);
  });
  it('no Turkish sentence is left from one that went', async () => {
    const { TR } = await import('../../src/renderer/folder-viewer/strings-tr.js');
    const live = await sentences();
    expect(Object.keys(TR).filter((k) => !live.has(k))).toEqual([]);
  });
  it('a Turkish sentence keeps every {name} the English has, and says something different', async () => {
    const { TR } = await import('../../src/renderer/folder-viewer/strings-tr.js');
    const same = new Set(['Program', '{name}: {size}']);
    for (const [en, tr] of Object.entries(TR)) {
      expect((tr.match(/\{\w+\}/g) || []).sort()).toEqual((en.match(/\{\w+\}/g) || []).sort());
      if (!same.has(en) && en.length > 3) expect(tr, en).not.toBe(en);
      expect(tr.trim()).not.toBe('');
    }
  });
  it('t() translates in Turkish, falls back to English, and fills the {names}', async () => {
    await load();
    strings.setLang('tr');
    expect(strings.t('Delete')).toBe('Sil');
    expect(strings.t('{n} items', { n: 3 })).toBe('3 öğe');
    expect(strings.t('a sentence nobody wrote')).toBe('a sentence nobody wrote');
    expect(document.documentElement.lang).toBe('tr');
    strings.setLang('en');
    expect(strings.t('Delete')).toBe('Delete');
    expect(strings.t('{n} items', { n: 3 })).toBe('3 items');
    strings.setLang('tr-TR');
    expect(strings.getLang()).toBe('tr');
    strings.setLang('en');
  });
  it('the page\'s static text is translated', async () => {
    await load();
    document.body.innerHTML = '<button data-i18n-title="Refresh (F5)" data-i18n-aria="Refresh"></button><span data-i18n="Name">Name</span><input data-i18n-placeholder="Filter this folder (Ctrl+F)">';
    strings.setLang('tr');
    strings.applyStatic(document);
    expect(document.querySelector('button').title).toBe('Yenile (F5)');
    expect(document.querySelector('button').getAttribute('aria-label')).toBe('Yenile');
    expect(document.querySelector('span').textContent).toBe('Ad');
    expect(document.querySelector('input').getAttribute('placeholder')).toBe('Bu klasörde süz (Ctrl+F)');
    strings.setLang('en');
  });
  it('the settings and catalogue words of the window have Turkish (TABLE.tr)', () => {
    const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
    const host = fs.readFileSync(path.join(ROOT, 'src/renderer/js/folder-viewer-host.js'), 'utf8');
    const wanted = new Set();
    for (const m of host.matchAll(/(?:G\.note|G\.button|showToast\?\.|createTextNode)\(\s*('(?:[^'\\\n]|\\.)*')/g)) { const v = lit(m[1]); if (v) wanted.add(v.trim()); }
    for (const m of host.matchAll(/box\.checked \? ('(?:[^'\\\n]|\\.)*') : ('(?:[^'\\\n]|\\.)*')/g)) { wanted.add(lit(m[1])); wanted.add(lit(m[2])); }
    wanted.add('Folder browser');
    wanted.add('Settings for the page that shows your folders');
    wanted.add('Show folders in Vex\'s own folder browser');
    const catalog = fs.readFileSync(path.join(ROOT, 'src/renderer/js/feature-catalog.js'), 'utf8');
    const what = /id: 'folder-browser'[\s\S]*?what: ('(?:[^'\\\n]|\\.)*')/.exec(catalog);
    wanted.add(lit(what[1]));
    const missing = [...wanted].filter((s) => s && !(s in VexI18nUI.TABLE.tr));
    expect(missing).toEqual([]);
  });
});

describe('sizes, dates, names and paths', () => {
  it('writes sizes as a person reads them, in the page\'s language', async () => {
    await load();
    const f = await import('../../src/renderer/folder-viewer/format.js');
    strings.setLang('en');
    expect(f.formatSize(0)).toBe('0 B');
    expect(f.formatSize(1023)).toBe('1,023 B');
    expect(f.formatSize(1024)).toBe('1 KB');
    expect(f.formatSize(1536 * 1024)).toBe('1.5 MB');
    expect(f.formatSize(250 * 1024 * 1024)).toBe('250 MB');
    expect(f.formatSize(-1)).toBe('');
    strings.setLang('tr');
    expect(f.formatSize(1536 * 1024)).toBe('1,5 MB');
    expect(f.formatSize(2.5 * 1024 ** 3)).toBe('2,5 GB');
    strings.setLang('en');
  });
  it('folds Turkish letters by Turkish rules, so the filter and type-ahead find İstanbul and ısı', async () => {
    await load();
    const f = await import('../../src/renderer/folder-viewer/format.js');
    strings.setLang('tr');
    expect(f.fold('İSTANBUL')).toBe('istanbul');
    expect(f.fold('ISI')).toBe('ısı');
    strings.setLang('en');
  });
  it('splits a name from its extension for renaming', async () => {
    const f = await import('../../src/renderer/folder-viewer/format.js');
    expect(f.splitName('rapor.final.docx')).toEqual(['rapor.final', '.docx']);
    expect(f.splitName('.gitignore')).toEqual(['.gitignore', '']);
    expect(f.splitName('Makefile')).toEqual(['Makefile', '']);
  });
  it('turns what is typed in the path bar into a folder address, or nothing', async () => {
    const f = await import('../../src/renderer/folder-viewer/format.js');
    expect(f.typedToFileUrl('C:\\Users\\Çağrı\\Belgeler')).toBe('file:///C:/Users/%C3%87a%C4%9Fr%C4%B1/Belgeler/');
    expect(f.typedToFileUrl('d:')).toBe('file:///D:/');
    expect(f.typedToFileUrl('"C:/Program Files"')).toBe('file:///C:/Program%20Files/');
    expect(f.typedToFileUrl('\\\\server\\share\\dir')).toBe('file://server/share/dir/');
    expect(f.typedToFileUrl('file:///C:/a%20b')).toBe('file:///C:/a%20b/');
    expect(f.typedToFileUrl('not a path')).toBe(null);
    expect(f.typedToFileUrl('')).toBe(null);
  });
  it('makes the breadcrumb from a folder address', async () => {
    const f = await import('../../src/renderer/folder-viewer/format.js');
    const c = f.crumbsOf('file:///C:/Users/Ay%C5%9Fe/Masa%C3%BCst%C3%BC/', 'This PC');
    expect(c.map((x) => x.label)).toEqual(['This PC', 'C:', 'Users', 'Ayşe', 'Masaüstü']);
    expect(c[0].url).toBe('file:///');
    expect(c[2].url).toBe('file:///C:/Users/');
    const u = f.crumbsOf('file://srv/share/x/', 'This PC');
    expect(u.map((x) => x.label)).toEqual(['This PC', '\\\\srv', 'share', 'x']);
    expect(u[2].url).toBe('file://srv/share/');
  });
});

describe('what a file is', () => {
  it('opens a web-viewable file in a tab, any other in Windows, and never opens a program by itself', async () => {
    const k = await import('../../src/renderer/folder-viewer/kinds.js');
    expect(k.openModeOf('a', true)).toBe('folder');
    for (const n of ['p.html', 'p.pdf', 'p.PNG', 'x.txt', 'v.mp4', 'a.json']) expect(k.openModeOf(n, false), n).toBe('tab');
    for (const n of ['x.docx', 'x.zip', 'notes.md', 'data.csv', 'noext']) expect(k.openModeOf(n, false), n).toBe('external');
    for (const n of ['setup.exe', 'run.bat', 'do.ps1', 'a.lnk', 'a.msi', 'a.vbs', 'x.hta', 'a.reg', 'a.cmd', 'a.scr', 'a.jar', 'a.url', 'disk.iso']) expect(k.openModeOf(n, false), n).toBe('runnable');
  });
  it('holds the same list of runnable kinds as the main process (file-check.js RUNNABLE)', async () => {
    const k = await import('../../src/renderer/folder-viewer/kinds.js');
    const { RUNNABLE } = require('../../src/main/file-check.js');
    const mine = [...k.RUNNABLE_EXT];
    expect(mine.filter((e) => !RUNNABLE.test('x.' + e))).toEqual([]);
    const theirs = RUNNABLE.source.replace(/^\\\.\(/, '').replace(/\)\$$/, '').split('|').map((e) => e.toLowerCase());
    expect(theirs.filter((e) => !k.RUNNABLE_EXT.has(e))).toEqual([]);
  });
  it('makes pictures for the same kinds as the main process does', async () => {
    const k = await import('../../src/renderer/folder-viewer/kinds.js');
    const m = require('../../src/main/folder-viewer.js');
    expect([...k.THUMB_EXT].sort()).toEqual([...m.THUMB_EXT].sort());
  });
  it('gives every kind an icon the icon set has', async () => {
    const k = await import('../../src/renderer/folder-viewer/kinds.js');
    const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
    const used = new Set(['folder', 'file']);
    for (const n of ['a.jpg', 'a.pdf', 'a.md', 'a.txt', 'a.html', 'a.mp3', 'a.mp4', 'a.zip', 'a.xlsx', 'a.docx', 'a.pptx', 'a.lnk', 'a.iso', 'a.exe', 'a.bat', 'a.dll', 'a.py', 'a.json', 'a.ttf']) used.add(k.kindOf(n, false).icon);
    expect([...used].filter((i) => !VexIcons.has(i))).toEqual([]);
    // Every icon the page names in its code exists too.
    const named = new Set();
    for (const f of files.filter((n) => /\.(js|html)$/.test(n))) {
      const src = read(f);
      for (const m of src.matchAll(/\b(?:icon|iconSpan)\(\s*'([a-z][a-z0-9-]+)'/g)) named.add(m[1]);
      for (const m of src.matchAll(/\? '(table|list|grid|eye|eye-off)'/g)) named.add(m[1]);
      for (const m of src.matchAll(/data-icon="([a-z0-9-]+)"/g)) named.add(m[1]);
      for (const m of src.matchAll(/icon: '([a-z][a-z0-9-]+)'/g)) named.add(m[1]);
    }
    expect([...named].filter((i) => !VexIcons.has(i))).toEqual([]);
  });
  it('names the type of a file', async () => {
    const k = await import('../../src/renderer/folder-viewer/kinds.js');
    expect(k.kindOf('Rapor.PDF', false).label).toBe('PDF document');
    expect(k.kindOf('x.weirdext', false)).toMatchObject({ label: '{ext} file', args: { ext: 'WEIRDEXT' } });
    expect(k.kindOf('Boş klasör', true).label).toBe('Folder');
  });
});

describe('the order of a folder', () => {
  async function folder(names) {
    const st = await import('../../src/renderer/folder-viewer/state.js');
    await load();
    strings.setLang('en');
    const data = st.createData();
    st.loadEntries(data, names.map((n) => (typeof n === 'string' ? { n, d: 0, h: 0 } : n)));
    return { st, data };
  }
  const order = (st, data, opts) => Array.from(st.buildView(data, { filter: '', hidden: true, sort: 'name', dir: 1, ...opts }, (kd) => kd.label), (i) => data.entries[i].n);
  it('puts folders first, then files in natural order (file2 before file10)', async () => {
    const { st, data } = await folder(['file10.txt', { n: 'zeta', d: 1, h: 0 }, 'file2.txt', { n: 'alfa', d: 1, h: 0 }, 'File1.txt']);
    expect(order(st, data)).toEqual(['alfa', 'zeta', 'File1.txt', 'file2.txt', 'file10.txt']);
    expect(order(st, data, { dir: -1 })).toEqual(['zeta', 'alfa', 'file10.txt', 'file2.txt', 'File1.txt']);
  });
  it('sorts by size and by date with the name as the tie-break, and keeps folders first', async () => {
    const { st, data } = await folder(['b.txt', 'a.txt', { n: 'dir', d: 1, h: 0 }, 'c.txt']);
    const at = (n) => data.byName.get(n);
    data.size[at('b.txt')] = 5; data.size[at('a.txt')] = 5; data.size[at('c.txt')] = 1;
    expect(order(st, data, { sort: 'size' })).toEqual(['dir', 'c.txt', 'a.txt', 'b.txt']);
    expect(order(st, data, { sort: 'size', dir: -1 })).toEqual(['dir', 'b.txt', 'a.txt', 'c.txt']);
    data.mtime[at('b.txt')] = 300; data.mtime[at('a.txt')] = 100; data.mtime[at('c.txt')] = 200;
    expect(order(st, data, { sort: 'date' })).toEqual(['dir', 'a.txt', 'c.txt', 'b.txt']);
  });
  it('hides hidden entries unless asked, and filters by the page\'s own lower case (Turkish İ)', async () => {
    const { st, data } = await folder([{ n: '.secret', d: 0, h: 1 }, 'İstanbul.txt', 'ısı.txt', 'Ankara.txt']);
    expect(order(st, data, { hidden: false })).not.toContain('.secret');
    expect(order(st, data, { hidden: true })).toContain('.secret');
    strings.setLang('tr');
    expect(order(st, data, { filter: 'istanbul' })).toEqual(['İstanbul.txt']);
    expect(order(st, data, { filter: 'ISI' })).toEqual(['ısı.txt']);
    strings.setLang('en');
  });
  it('sorts Turkish names by the Turkish alphabet (ç after c, ş after s, ı before i)', async () => {
    const { st, data } = await folder(['Çilek', 'Cam', 'Şeker', 'Sut', 'ısı', 'iş']);
    strings.setLang('tr');
    expect(order(st, data)).toEqual(['Cam', 'Çilek', 'ısı', 'iş', 'Sut', 'Şeker']);
    strings.setLang('en');
  });
  it('orders 100,000 entries quickly enough to type in the filter', async () => {
    const names = Array.from({ length: 100000 }, (_, i) => 'f' + String((i * 7919) % 100000).padStart(6, '0') + '.txt');
    const { st, data } = await folder(names);
    const t0 = performance.now();
    st.buildView(data, { filter: '', hidden: true, sort: 'name', dir: 1 }, (kd) => kd.label);
    const ms = performance.now() - t0;
    expect(data.view.length).toBe(100000);
    expect(data.entries[data.view[0]].n).toBe('f000000.txt');
    expect(ms).toBeLessThan(6000);
  });
});

describe('the Markdown reader is safe', () => {
  it('shows scripts, handlers and links as text, never as markup', async () => {
    const { renderMarkdown } = await import('../../src/renderer/folder-viewer/md.js');
    const root = renderMarkdown('# Hi <img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n[click](javascript:alert(1))\n\n![pic](http://x/y.png)\n\n**bold** and *it* and `code`\n\n- one\n- two\n\n```\n<b>raw</b>\n```\n> quote');
    expect(root.querySelector('script, img, a, iframe')).toBe(null);
    expect(root.textContent).toContain('<script>alert(1)</script>');
    expect(root.querySelector('h1').textContent).toContain('<img src=x onerror=alert(1)>');
    expect(root.querySelector('strong').textContent).toBe('bold');
    expect(root.querySelector('em').textContent).toBe('it');
    expect(root.querySelectorAll('li').length).toBe(2);
    expect(root.querySelector('pre code').textContent).toBe('<b>raw</b>');
    expect(root.querySelector('blockquote')).not.toBe(null);
    expect(root.querySelector('.md-link').textContent).toBe('click');
    expect(root.querySelector('.md-url').textContent).toContain('javascript:alert(1)');
  });
  it('never loops on odd input', async () => {
    const { renderMarkdown } = await import('../../src/renderer/folder-viewer/md.js');
    for (const s of ['', '#', '# ', '- ', '1)', '>', '```', '~~~\nx', '***', '\u0000', '[', '`', '**', '_a_ _b']) expect(() => renderMarkdown(s)).not.toThrow();
  });
});

describe('the colours are the interface\'s own', () => {
  const css = read('viewer.css');
  it('uses only tokens the window sends, its own --fv-* names and the engine\'s own', () => {
    const { VexFolderViewer } = require('../../src/renderer/js/folder-viewer-host.js');
    const sent = new Set(VexFolderViewer.THEME_VARS);
    const own = /^--fv-/;
    const used = new Set([...css.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].map((m) => m[1]));
    expect([...used].filter((n) => !sent.has(n) && !own.test(n))).toEqual([]);
  });
  it('every token it sends exists in the interface\'s own stylesheets', () => {
    const { VexFolderViewer } = require('../../src/renderer/js/folder-viewer-host.js');
    const all = ['theme-tokens.css', 'gui-browser.css', 'fonts.css', 'app.css'].map((f) => fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'css', f), 'utf8')).join('\n');
    const absent = VexFolderViewer.THEME_VARS.filter((n) => !all.includes(n + ':') && !all.includes(n + ' :'));
    expect(absent.filter((n) => !['--vex-font-display', '--b-ring-w', '--on-primary'].includes(n))).toEqual([]);
  });
  it('writes no colour of its own (the fallbacks inside var() and the dialog\'s black scrim apart)', () => {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const literal = [...body.matchAll(/(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\))/g)].map((m) => m[1]);
    const allowed = new Set(['#fff', '#ffffff', '#000', '#f3f3f3', '#ececec', '#1b1b1b', '#d0d0d0', '#b3261e', '#1e3a5f', '#8a4a0c', 'rgba(0, 0, 0, 0.25)']);
    expect([...new Set(literal)].filter((c) => !allowed.has(c))).toEqual([]);
  });
  it('keeps the font and radius tokens, and leaves motion off for people who ask', () => {
    expect(css).toMatch(/var\(--vex-font-base/);
    expect(css).toMatch(/var\(--vex-font-display/);
    expect(css).toMatch(/var\(--vex-font-mono/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none/);
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/gradient|backdrop-filter|blur\(/);
  });
  it('makes every control at least 28 pixels', () => {
    expect(css).toMatch(/--fv-ctl: 32px/);
    expect(css).toMatch(/--fv-row: 32px/);
    expect(css).toMatch(/\.fv-crumb \{[^}]*height: 28px/);
    expect(css).toMatch(/\.fv-btn-text \{[^}]*min-height: 30px/);
    expect(css).toMatch(/\.fv-menu-item \{[^}]*min-height: 30px/);
    expect(css).toMatch(/\.fv-place \{[^}]*min-height: 30px/);
  });
});

describe('the page\'s own markup', () => {
  const html = read('viewer.html');
  it('is a document with a language, a skip link, labelled regions and a polite status area', () => {
    expect(html).toMatch(/<html lang="en">/);
    expect(html).toMatch(/class="fv-skip" href="#fv-wrap"/);
    expect(html).toMatch(/role="toolbar"/);
    expect(html).toMatch(/role="grid"/);
    expect(html).toMatch(/aria-live="polite"/);
    expect(html).toMatch(/<aside id="fv-places"[^>]*aria-label/);
    expect(html).toMatch(/<aside id="fv-pane"[^>]*aria-label/);
  });
  it('gives every button a name: its words, an aria-label or a title it is given', () => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const bad = [];
    for (const b of doc.querySelectorAll('button')) {
      const named = b.textContent.trim() || b.getAttribute('aria-label') || b.getAttribute('data-i18n-aria') || b.getAttribute('data-i18n-title') || b.getAttribute('title') || b.getAttribute('data-i18n');
      if (!named) bad.push(b.id || b.outerHTML.slice(0, 60));
    }
    expect(bad).toEqual([]);
    for (const i of doc.querySelectorAll('input')) expect(i.getAttribute('aria-label') || i.getAttribute('data-i18n-aria'), i.id).toBeTruthy();
  });
  it('has every element the code looks up', () => {
    const app = read('app.js');
    const ids = new Set([...app.matchAll(/'(fv-[a-z-]+)'/g)].map((m) => m[1]).concat([...app.matchAll(/\$id\('(fv-[a-z-]+)'\)/g)].map((m) => m[1])));
    const have = new Set([...html.matchAll(/id="(fv-[a-z-]+)"/g)].map((m) => m[1]));
    // ids the code makes itself, or only uses as a class or attribute value
    const own = new Set(['fv-focus', 'fv-r', 'fv-dlg-title', 'fv-dlg-body', 'fv-app']);
    expect([...ids].filter((i) => !have.has(i) && !own.has(i) && !/^fv-(row|tile|name|cell|ico|label|arrow|c-)/.test(i) && !app.includes(`class: '${i}`) && !app.includes(`'${i} `))).toEqual([]);
  });
  it('links only what main serves, loads the icons first, loads a11y.css last, and has no inline script', () => {
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
    const hrefs = [...html.matchAll(/(?:href|src)="([^"#]*)"/g)].map((m) => m[1]).filter(Boolean);
    expect(hrefs.filter((h) => !/^\/(css|app)\//.test(h) && h !== '/icons.js')).toEqual([]);
    expect(html.indexOf('/icons.js')).toBeLessThan(html.indexOf('/app/app.js'));
    const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
    expect(sheets[sheets.length - 1]).toBe('/css/a11y.css');
  });
  it('builds every file name into the page as text, never as markup', () => {
    const app = read('app.js') + read('pane.js');
    // innerHTML is only ever given the icon set's own markup.
    for (const m of app.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)) expect(m[1], m[0]).toMatch(/icon\(/);
    expect(read('ui.js')).not.toMatch(/innerHTML\s*=\s*(?!icon\(|svg;)\S/);
  });
  it('asks main only for names inside the folder, never for a path', () => {
    const app = read('app.js');
    for (const m of app.matchAll(/host\.(\w+)\(\s*\{([^}]*)\}/g)) expect(m[2], m[0]).not.toMatch(/\bpath\b|\bdir\b|\burl\b/);
  });
});

describe('what the window does about it (js/webview.js, js/folder-viewer-host.js)', () => {
  const viewer = 'vex-files://browse/?u=' + encodeURIComponent('file:///C:/Users/Ay%C5%9Fe/');
  it('keeps the folder\'s own address for a viewer address, the same in main, the window and the host', () => {
    const { WebviewManager } = require('../../src/renderer/js/webview.js');
    const { VexFolderViewer } = require('../../src/renderer/js/folder-viewer-host.js');
    const main = require('../../src/main/folder-viewer.js');
    for (const u of [viewer, 'vex-files://browse/?u=file%3A%2F%2F%2F', 'vex-files://browse/?u=https%3A%2F%2Fevil.test%2F', 'vex-files://browse/m/abc', 'vex-files://browse/', 'https://example.com/', 'vex-files://other/?u=file%3A%2F%2F%2F', '']) {
      const a = WebviewManager.folderOriginal(u), b = VexFolderViewer.original(u), c = main.parseViewerUrl(u);
      expect(a, u).toBe(b);
      expect(a, u).toBe(c ? c.fileUrl : null);
    }
    expect(WebviewManager.folderOriginal(viewer)).toBe('file:///C:/Users/Ay%C5%9Fe/');
    expect(WebviewManager.folderOriginal('vex-files://browse/?u=https%3A%2F%2Fevil.test%2F')).toBe(null);
  });
  it('is on until it is switched off, and tells main', async () => {
    const calls = [];
    window.vex = { folderviewSetEnabled: (on) => { calls.push(on); return Promise.resolve({ ok: true }); } };
    localStorage.removeItem('vex.folderBrowser.prefs');
    const { VexFolderViewer } = require('../../src/renderer/js/folder-viewer-host.js');
    expect(VexFolderViewer.enabled()).toBe(true);
    VexFolderViewer.setEnabled(false);
    expect(VexFolderViewer.enabled()).toBe(false);
    expect(calls.at(-1)).toBe(false);
    VexFolderViewer.setEnabled(true);
    expect(VexFolderViewer.enabled()).toBe(true);
    expect(calls.at(-1)).toBe(true);
    delete window.vex;
  });
  it('opens a file the page names, as a leaf of the folder the tab shows, and refuses anything else', () => {
    const { VexFolderViewer } = require('../../src/renderer/js/folder-viewer-host.js');
    expect(VexFolderViewer.entryUrl('file:///C:/a/', 'b c.txt')).toBe('file:///C:/a/b%20c.txt');
    expect(VexFolderViewer.entryUrl('file:///C:/a', 'Çok.txt')).toBe('file:///C:/a/%C3%87ok.txt');
    for (const bad of ['..', '.', 'a/b', 'a\\b', 'C:x', '', 'x\u0000', 'a'.repeat(300), null, 5]) expect(() => VexFolderViewer.entryUrl('file:///C:/a/', bad), String(bad)).toThrow();
    const sent = [];
    const wv = { getURL: () => viewer, loadURL: (u) => { sent.push(['here', u]); return Promise.resolve(); }, send: () => {} };
    window.TabManager = { createTab: (u, activate) => sent.push(['tab', u, activate]) };
    expect(VexFolderViewer.handleMessage(wv, { partition: 'persist:main' }, { channel: 'folderview:open', args: [{ name: 'x.pdf', mode: 'tab' }] })).toBe(true);
    expect(VexFolderViewer.handleMessage(wv, {}, { channel: 'folderview:open', args: [{ name: 'x.pdf', mode: 'background' }] })).toBe(true);
    expect(VexFolderViewer.handleMessage(wv, {}, { channel: 'folderview:open', args: [{ name: 'x.pdf' }] })).toBe(true);
    expect(sent).toEqual([['tab', 'file:///C:/Users/Ay%C5%9Fe/x.pdf', true], ['tab', 'file:///C:/Users/Ay%C5%9Fe/x.pdf', false], ['here', 'file:///C:/Users/Ay%C5%9Fe/x.pdf']]);
    expect(VexFolderViewer.handleMessage(wv, {}, { channel: 'something:else', args: [] })).toBe(false);
    delete window.TabManager;
  });
  it('sends the theme the page needs, and only the tokens it lists', () => {
    const { VexFolderViewer } = require('../../src/renderer/js/folder-viewer-host.js');
    document.body.style.setProperty('--bg', '#123456');
    const p = VexFolderViewer.themePayload();
    expect(p.vars['--bg']).toBe('#123456');
    expect(Object.keys(p.vars).every((k) => VexFolderViewer.THEME_VARS.includes(k))).toBe(true);
    expect(Object.keys(p.attrs)).toEqual(['data-theme', 'data-scheme', 'data-gui-style', 'data-gui-family']);
  });
});

describe('the virtual list', () => {
  beforeEach(() => { globalThis.ResizeObserver = class { observe() {} disconnect() {} }; });
  it('makes only the rows in view of a folder of 100,000, keeps the active one, and can jump anywhere', async () => {
    const { VirtualList } = await import('../../src/renderer/folder-viewer/vlist.js');
    document.body.innerHTML = '<div id="s"><div id="c"></div></div>';
    const s = document.getElementById('s'), c = document.getElementById('c');
    Object.defineProperty(s, 'clientHeight', { value: 640, configurable: true });
    Object.defineProperty(s, 'clientWidth', { value: 900, configurable: true });
    const bound = [];
    const list = new VirtualList({ scroller: s, content: c, createNode: () => document.createElement('div'), bindNode: (n, i) => { n.textContent = 'row ' + i; bound.push(i); } });
    list.configure({ count: 100000, grid: false, rowHeight: 32 });
    expect(c.style.height).toBe(3200000 + 'px');
    expect(c.children.length).toBeLessThan(40);
    list.setPinned(5);
    s.scrollTop = 1600000;
    list.update();
    expect(c.children.length).toBeLessThan(45);
    expect(list.nodeAt(5)).not.toBe(null);          // the active row survives being scrolled away
    expect(list.nodeAt(50000)).not.toBe(null);
    list.scrollToIndex(99999);
    expect(list.nodeAt(99999)).not.toBe(null);
    list.configure({ count: 100000, grid: true, tileW: 132, tileH: 144 });
    expect(list.perRow).toBe(Math.floor(900 / 132));
    expect(c.children.length).toBeLessThan(80);
  });
});
