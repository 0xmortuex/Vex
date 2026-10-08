// Extensions' right-click menu items and toolbar badge (chrome.contextMenus,
// chrome.action), 2026-10-08: the rules (js/ext-menu-model.js, shared by main
// and the interface) and main's keeper of them (src/main/extension-ui.js).
// Chrome's behaviour is the reference throughout.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const M = require('../../src/renderer/js/ext-menu-model.js');
const { createExtensionUi, parseColour } = require('../../src/main/extension-ui.js');

const page = (over = {}) => ({ kind: 'page', pageUrl: 'https://example.com/a', frameUrl: '', selectionText: '', linkUrl: '', srcUrl: '', mediaType: '', editable: false, ...over });
const ids = (tree) => tree.map(n => n.id);

describe('match patterns', () => {
  it('match as Chrome documents them', () => {
    expect(M.matchPattern('<all_urls>', 'https://a.com/')).toBe(true);
    expect(M.matchPattern('<all_urls>', 'chrome-extension://abc/x')).toBe(false);
    expect(M.matchPattern('*://*.example.com/*', 'https://www.example.com/x')).toBe(true);
    expect(M.matchPattern('*://*.example.com/*', 'http://example.com/')).toBe(true);
    expect(M.matchPattern('*://*.example.com/*', 'https://badexample.com/')).toBe(false);
    expect(M.matchPattern('https://example.com/docs/*', 'https://example.com/docs/a?b=1')).toBe(true);
    expect(M.matchPattern('https://example.com/docs/*', 'https://example.com/other')).toBe(false);
    expect(M.matchPattern('*://*/*.pdf', 'https://x.org/f/report.pdf')).toBe(true);
    expect(M.matchPattern('*://*/*', 'ftp://x.org/')).toBe(false);
    expect(() => M.parsePattern('example.com')).toThrow(/Invalid url pattern/);
    expect(() => M.parsePattern('https://ex*mple.com/*')).toThrow(/Invalid url pattern/);
  });
});

describe('which items show for a click', () => {
  function items() {
    const list = [];
    M.create(list, { id: 'page', title: 'On the page' });
    M.create(list, { id: 'sel', title: 'Search "%s"', contexts: ['selection'] });
    M.create(list, { id: 'link', title: 'Link', contexts: ['link'], targetUrlPatterns: ['*://*.wikipedia.org/*'] });
    M.create(list, { id: 'img', title: 'Image', contexts: ['image'] });
    M.create(list, { id: 'edit', title: 'Edit', contexts: ['editable'] });
    M.create(list, { id: 'all', title: 'Everywhere', contexts: ['all'] });
    M.create(list, { id: 'act', title: 'Button', contexts: ['action'] });
    M.create(list, { id: 'only', title: 'Only on example.org', documentUrlPatterns: ['https://example.org/*'] });
    M.create(list, { id: 'hidden', title: 'Hidden', visible: false });
    return list;
  }
  it('"page" only when nothing more specific was clicked', () => {
    const list = items();
    expect(ids(M.visibleTree(list, page()))).toEqual(['page', 'all']);
    expect(ids(M.visibleTree(list, page({ selectionText: 'hello' })))).toEqual(['sel', 'all']);
    expect(ids(M.visibleTree(list, page({ editable: true })))).toEqual(['edit', 'all']);
    expect(ids(M.visibleTree(list, page({ mediaType: 'image', srcUrl: 'https://example.com/p.png' })))).toEqual(['img', 'all']);
  });
  it('targetUrlPatterns narrow a link item; documentUrlPatterns every item', () => {
    const list = items();
    expect(ids(M.visibleTree(list, page({ linkUrl: 'https://en.wikipedia.org/wiki/X' })))).toEqual(['link', 'all']);
    expect(ids(M.visibleTree(list, page({ linkUrl: 'https://other.com/' })))).toEqual(['all']);
    expect(ids(M.visibleTree(list, page({ pageUrl: 'https://example.org/z' })))).toEqual(['page', 'all', 'only']);
  });
  it('the toolbar button menu shows "action" and "all" items, six at most', () => {
    const list = items();
    expect(ids(M.visibleTree(list, { kind: 'action' }))).toEqual(['all', 'act']);
    const many = [];
    for (let i = 0; i < 9; i++) M.create(many, { id: i, title: 'n' + i, contexts: ['action'] });
    expect(M.visibleTree(many, { kind: 'action' }).length).toBe(M.ACTION_MENU_TOP_LEVEL_LIMIT);
  });
  it('"%s" is the selected text, cut at 50 characters', () => {
    const list = items();
    const [sel] = M.visibleTree(list, page({ selectionText: 'x'.repeat(60) }));
    expect(sel.title).toBe('Search "' + 'x'.repeat(50) + '…"');
  });
  it('submenus: a child shows under its parent when its own contexts match', () => {
    const list = [];
    M.create(list, { id: 'p', title: 'Parent', contexts: ['page', 'selection'] });
    M.create(list, { id: 'c1', parentId: 'p', title: 'Child page', contexts: ['page'] });
    M.create(list, { id: 'c2', parentId: 'p', title: 'Child sel', contexts: ['selection'] });
    expect(M.visibleTree(list, page())[0].children.map(n => n.id)).toEqual(['c1']);
    expect(M.visibleTree(list, page({ selectionText: 's' }))[0].children.map(n => n.id)).toEqual(['c2']);
  });
  it('separators at either end, or twice in a row, are dropped', () => {
    const list = [];
    M.create(list, { id: 's0', type: 'separator' });
    M.create(list, { id: 'a', title: 'A' });
    M.create(list, { id: 's1', type: 'separator' });
    M.create(list, { id: 's2', type: 'separator' });
    M.create(list, { id: 'b', title: 'B' });
    M.create(list, { id: 's3', type: 'separator' });
    expect(ids(M.visibleTree(list, page()))).toEqual(['a', 's1', 'b']);
  });
});

describe('creating and changing items, as Chrome checks them', () => {
  it('refuses what Chrome refuses', () => {
    const list = [];
    M.create(list, { id: 'a', title: 'A' });
    expect(() => M.create(list, { id: 'a', title: 'again' })).toThrow('Cannot create item with duplicate id a');
    expect(() => M.create(list, { id: 'b' })).toThrow(/Title missing/);
    expect(() => M.create(list, { id: 'c', title: 'C', parentId: 'nope' })).toThrow('Cannot find menu item with id nope');
    expect(() => M.create(list, { id: 'd', title: 'D', contexts: ['nowhere'] })).toThrow(/Invalid context/);
    expect(() => M.create(list, { id: 'e', title: 'E', type: 'button' })).toThrow(/Invalid menu item type/);
    expect(() => M.create(list, { id: 'f', title: 'F', documentUrlPatterns: ['nope'] })).toThrow(/Invalid url pattern/);
    expect(() => M.update(list, 'zz', { title: 'x' })).toThrow('Cannot find menu item with id zz');
  });
  it('a number id and a string id are different items', () => {
    const list = [];
    M.create(list, { id: 1, title: 'one' });
    M.create(list, { id: '1', title: 'string one' });
    expect(list.length).toBe(2);
  });
  it('an item cannot be moved under itself or its own child', () => {
    const list = [];
    M.create(list, { id: 'a', title: 'A' });
    M.create(list, { id: 'b', title: 'B', parentId: 'a' });
    expect(() => M.update(list, 'a', { parentId: 'b' })).toThrow(/child of itself/);
    expect(() => M.update(list, 'a', { parentId: 'a' })).toThrow(/child of itself/);
  });
  it('removing an item removes everything under it', () => {
    const list = [];
    M.create(list, { id: 'a', title: 'A' });
    M.create(list, { id: 'b', title: 'B', parentId: 'a' });
    M.create(list, { id: 'c', title: 'C', parentId: 'b' });
    M.create(list, { id: 'd', title: 'D' });
    M.remove(list, 'a');
    expect(list.map(i => i.id)).toEqual(['d']);
  });
});

describe('checkboxes and radio groups', () => {
  it('radio items side by side are one group with one checked', () => {
    const list = [];
    M.create(list, { id: 'r1', type: 'radio', title: 'One' });
    M.create(list, { id: 'r2', type: 'radio', title: 'Two' });
    M.create(list, { id: 'r3', type: 'radio', title: 'Three', checked: true });
    expect(list.map(i => i.checked)).toEqual([false, false, true]);
    const { item, wasChecked } = M.click(list, 'r1');
    expect(wasChecked).toBe(false);
    expect(list.map(i => i.checked)).toEqual([true, false, false]);
    expect(M.clickInfo(item, page(), wasChecked)).toMatchObject({ menuItemId: 'r1', wasChecked: false, checked: true });
  });
  it('a separator ends a group; the first of a group with none checked is checked', () => {
    const list = [];
    M.create(list, { id: 'a', type: 'radio', title: 'A' });
    M.create(list, { id: 's', type: 'separator' });
    M.create(list, { id: 'b', type: 'radio', title: 'B' });
    expect(list.filter(i => i.type === 'radio').map(i => i.checked)).toEqual([true, true]);
  });
  it('a checkbox flips', () => {
    const list = [];
    M.create(list, { id: 'c', type: 'checkbox', title: 'C' });
    const r = M.click(list, 'c');
    expect([r.wasChecked, list[0].checked]).toEqual([false, true]);
    expect(() => { M.update(list, 'c', { enabled: false }); M.click(list, 'c'); }).toThrow(/switched off/);
  });
});

describe('the info an extension hears', () => {
  it('carries what was clicked, as chrome.contextMenus.OnClickData', () => {
    const list = [];
    M.create(list, { id: 'p', title: 'P', contexts: ['all'] });
    const item = M.create(list, { id: 'k', title: 'K', parentId: 'p', contexts: ['all'] });
    const ctx = M.pageContext({ pageURL: 'https://a.com/', linkURL: 'https://b.com/x', selectionText: 'hi', mediaType: 'image', srcURL: 'https://a.com/i.png', isEditable: false });
    expect(M.clickInfo(item, ctx)).toEqual({ menuItemId: 'k', parentMenuItemId: 'p', editable: false, pageUrl: 'https://a.com/', frameId: 0,
      linkUrl: 'https://b.com/x', srcUrl: 'https://a.com/i.png', mediaType: 'image', selectionText: 'hi' });
  });
  it('a picture Vex found under a link counts as an image', () => {
    const ctx = M.pageContext({ pageURL: 'https://a.com/', mediaType: 'none' }, { imageSrc: 'https://a.com/bg.jpg' });
    expect([ctx.mediaType, ctx.srcUrl]).toEqual(['image', 'https://a.com/bg.jpg']);
  });
});

describe('main keeps them per session and extension', () => {
  it('a container\'s copy of an extension has its own items', () => {
    const ui = createExtensionUi();
    ui.menusCreate('persist:main', 'e1', { id: 'x', title: 'X' });
    ui.menusCreate('persist:container-work', 'e1', { id: 'x', title: 'X in work' });
    const snap = ui.snapshot();
    expect(snap.menus['persist:main'].e1[0].title).toBe('X');
    expect(snap.menus['persist:container-work'].e1[0].title).toBe('X in work');
  });
  it('a click that no longer applies is refused; one that does flips a checkbox and tells onChange', () => {
    let changes = 0;
    const ui = createExtensionUi({ onChange: () => changes++ });
    ui.menusCreate('p', 'e', { id: 'sel', title: 'Sel', contexts: ['selection'] });
    ui.menusCreate('p', 'e', { id: 'cb', title: 'Box', type: 'checkbox' });
    expect(() => ui.menusClick('p', 'e', 'sel', page())).toThrow(/does not apply/);
    expect(() => ui.menusClick('p', 'e', 'gone', page())).toThrow(/gone/);
    const before = changes;
    const { info } = ui.menusClick('p', 'e', 'cb', page());
    expect(info).toMatchObject({ menuItemId: 'cb', checked: true, wasChecked: false, pageUrl: 'https://example.com/a' });
    expect(changes).toBe(before + 1);
  });
  it('switching an extension off forgets its items and badge everywhere', () => {
    const ui = createExtensionUi();
    ui.menusCreate('a', 'e', { id: 'x', title: 'X' });
    ui.menusCreate('b', 'e', { id: 'x', title: 'X' });
    ui.actionSet('a', 'e', 'text', '5', null);
    ui.menusCreate('a', 'other', { id: 'y', title: 'Y' });
    ui.forgetExtension('e');
    expect(ui.snapshot()).toEqual({ menus: { a: { other: [expect.objectContaining({ id: 'y' })] } }, action: {} });
  });
  it('items are saved for the extensions asked about and come back', () => {
    const ui = createExtensionUi();
    ui.menusCreate('p', 'sw', { id: 'r', title: 'R', type: 'radio' });
    ui.menusCreate('p', 'sw', { id: 'kid', title: 'Kid', parentId: 'r', documentUrlPatterns: ['https://a.com/*'] });
    ui.menusCreate('p', 'bg', { id: 'z', title: 'Z' });
    const saved = JSON.parse(JSON.stringify(ui.saved((p, id) => id === 'sw')));
    expect(Object.keys(saved.p)).toEqual(['sw']);
    const again = createExtensionUi();
    again.restore(saved);
    expect(again.snapshot().menus.p.sw.map(i => [i.id, i.parentId, i.checked])).toEqual([['r', null, true], ['kid', 'r', false]]);
  });
});

describe('the badge', () => {
  it('a tab\'s own badge wins over the default, and goes when the tab closes', () => {
    const ui = createExtensionUi();
    ui.actionSet('p', 'e', 'text', '9', null);
    ui.actionSet('p', 'e', 'text', '1', 42);
    expect(ui.actionGet('p', 'e', 'text', 42)).toBe('1');
    expect(ui.actionGet('p', 'e', 'text', 43)).toBe('9');
    ui.actionSet('p', 'e', 'text', null, 42);
    expect(ui.actionGet('p', 'e', 'text', 42)).toBe('9');
    ui.actionSet('p', 'e', 'text', '2', 42);
    ui.forgetTab(42);
    expect(ui.actionGet('p', 'e', 'text', 42)).toBe('9');
  });
  it('defaults: no text, Chrome\'s red, white text, the manifest\'s title', () => {
    const ui = createExtensionUi();
    expect(ui.actionGet('p', 'e', 'text', null)).toBe('');
    expect(ui.actionGet('p', 'e', 'bg', null)).toEqual([217, 48, 37, 255]);
    expect(ui.actionGet('p', 'e', 'color', null)).toEqual([255, 255, 255, 255]);
    expect(ui.actionGet('p', 'e', 'title', null, { title: 'Mine' })).toBe('Mine');
    expect(() => ui.actionSet('p', 'e', 'text', 5, null)).toThrow(/string/);
    expect(() => ui.actionSet('p', 'e', 'shape', 'x', null)).toThrow(/Unknown/);
  });
  it('the icon and the popup, for every tab or for one; back to the manifest\'s with none', () => {
    const ui = createExtensionUi();
    expect(ui.actionGet('p', 'e', 'icon', null, { icon: 'C:\\x\\i.png' })).toBe('C:\\x\\i.png');
    ui.actionSet('p', 'e', 'icon', 'data:image/png;base64,AAAA', 7);
    expect(ui.actionGet('p', 'e', 'icon', 7)).toBe('data:image/png;base64,AAAA');
    expect(ui.actionGet('p', 'e', 'icon', 8)).toBe(null);
    expect(() => ui.actionSet('p', 'e', 'icon', 'https://evil.example/i.png', null)).toThrow(/PNG image or a file/);
    expect(ui.actionGet('p', 'e', 'popup', null, { popup: 'popup.html' })).toBe('popup.html');
    ui.actionSet('p', 'e', 'popup', '', null);
    expect(ui.actionGet('p', 'e', 'popup', null, { popup: 'popup.html' })).toBe('');
    ui.actionSet('p', 'e', 'popup', null, null);
    expect(ui.actionGet('p', 'e', 'popup', null, { popup: 'popup.html' })).toBe('popup.html');
  });
  it('reads colours the ways extensions give them', () => {
    expect(parseColour('#f00')).toEqual([255, 0, 0, 255]);
    expect(parseColour('#00ff0080')).toEqual([0, 255, 0, 128]);
    expect(parseColour('rgb(1, 2, 3)')).toEqual([1, 2, 3, 255]);
    expect(parseColour('rgba(1,2,3,0.5)')).toEqual([1, 2, 3, 128]);
    expect(parseColour('Red')).toEqual([255, 0, 0, 255]);
    expect(parseColour([10, 20, 30, 255])).toEqual([10, 20, 30, 255]);
    expect(() => parseColour([1, 2, 3])).toThrow();
    expect(() => parseColour('blurple')).toThrow(/not a colour/);
  });
});
