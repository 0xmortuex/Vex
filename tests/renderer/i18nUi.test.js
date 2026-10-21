// @vitest-environment jsdom
//
// Translating the interface.
//
// The wizard has always offered Turkish, but only the wizard and the start
// page ever spoke it — every other label in Vex stayed English. This adds the
// chrome.
//
// The risky part is the approach: matching the ENGLISH string rather than
// tagging a thousand elements. That is what makes it possible at all across
// dozens of files, and it is also how you accidentally "translate" a person's
// bookmark called "History". So most of this file is about what it must NOT
// touch.

import { describe, it, expect, beforeEach } from 'vitest';

const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');

const tr = () => localStorage.setItem('vex.lang', JSON.stringify('tr'));
const en = () => localStorage.setItem('vex.lang', JSON.stringify('en'));

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('choosing a language', () => {
  it('is English until you say otherwise', () => {
    expect(VexI18nUI.locale()).toBe('en');
  });

  it('reads the language the wizard stored, quoted or not', () => {
    tr();
    expect(VexI18nUI.locale()).toBe('tr');
    localStorage.setItem('vex.lang', 'tr');          // older, unquoted form
    expect(VexI18nUI.locale()).toBe('tr');
  });

  it('falls back to English for a language it has no table for', () => {
    localStorage.setItem('vex.lang', JSON.stringify('de'));
    expect(VexI18nUI.locale()).toBe('en');
  });
});

describe('what it translates', () => {
  beforeEach(tr);

  it('translates a toolbar button\'s tooltip and leaves the markup alone', () => {
    document.body.innerHTML = '<div id="top-bar"><button id="b" title="Back"><svg></svg></button></div>';
    VexI18nUI.apply();
    const b = document.getElementById('b');
    expect(b.getAttribute('title')).toBe('Geri');
    expect(b.querySelector('svg')).toBeTruthy();      // untouched
  });

  it('translates a text-only label', () => {
    document.body.innerHTML = '<div id="icon-sidebar"><span>Settings</span></div>';
    VexI18nUI.apply();
    expect(document.querySelector('#icon-sidebar span').textContent).toBe('Ayarlar');
  });

  it('leaves an element that has children to its children', () => {
    document.body.innerHTML = '<div id="top-bar"><div id="wrap">Settings<b>!</b></div></div>';
    VexI18nUI.apply();
    expect(document.getElementById('wrap').innerHTML).toContain('<b>!</b>');
  });

  it('translates every piece of a sentence that a <kbd> breaks up, and puts each back in English', () => {
    document.body.innerHTML = '<div id="top-bar"><p id="p">Select text on any page, then <kbd>Ctrl+K</kbd> (or right-click). Highlights reappear when you revisit the page.</p></div>';
    const p = document.getElementById('p');
    // Each piece has its own entry, as in the real Settings text.
    VexI18nUI.TABLE.tr['Select text on any page, then'] = 'Herhangi bir sayfada metin seçin, sonra';
    VexI18nUI.TABLE.tr['(or right-click). Highlights reappear when you revisit the page.'] = '(ya da sağ tıklayın). Vurgular sayfayı yeniden ziyaret ettiğinizde tekrar görünür.';
    VexI18nUI.apply();
    expect(p.textContent).toContain('Herhangi bir sayfada metin seçin, sonra');
    expect(p.textContent).toContain('(ya da sağ tıklayın). Vurgular');
    expect(p.querySelector('kbd').textContent).toBe('Ctrl+K');
    en();
    VexI18nUI.apply();
    expect(p.textContent).toBe('Select text on any page, then Ctrl+K (or right-click). Highlights reappear when you revisit the page.');
    delete VexI18nUI.TABLE.tr['Select text on any page, then'];
    delete VexI18nUI.TABLE.tr['(or right-click). Highlights reappear when you revisit the page.'];
  });

  it('translates placeholders and aria-labels', () => {
    document.body.innerHTML = '<div id="top-bar"><input placeholder="Search or enter address" aria-label="Search"></div>';
    VexI18nUI.apply();
    const i = document.querySelector('input');
    expect(i.getAttribute('placeholder')).toBe('Arayın veya adres girin');
    expect(i.getAttribute('aria-label')).toBe('Ara');
  });

  it('leaves anything not in the table exactly as it was', () => {
    document.body.innerHTML = '<div id="top-bar"><span>Quantum flux capacitor</span></div>';
    VexI18nUI.apply();
    expect(document.querySelector('span').textContent).toBe('Quantum flux capacitor');
  });
});

describe('what it must never touch', () => {
  beforeEach(tr);

  it('does not reach into a page', () => {
    document.body.innerHTML = '<div id="top-bar"><webview><span>Settings</span></webview></div>';
    VexI18nUI.apply();
    expect(document.querySelector('webview span').textContent).toBe('Settings');
  });

  it('leaves everything outside the chrome alone', () => {
    // A tab title, a bookmark, a heading on a page — all of which can read
    // "History" without meaning Vex's History panel.
    document.body.innerHTML = '<div id="page-content"><span>History</span></div>';
    VexI18nUI.apply();
    expect(document.querySelector('#page-content span').textContent).toBe('History');
  });

  it('does not translate the same element twice', () => {
    document.body.innerHTML = '<div id="top-bar"><span>Settings</span></div>';
    VexI18nUI.apply();
    VexI18nUI.apply();
    VexI18nUI.apply();
    expect(document.querySelector('span').textContent).toBe('Ayarlar');
    expect(document.querySelector('span').dataset.i18nText).toBe('Settings');
  });
});

describe('the tab list', () => {
  it('has its own label translated, and its tabs\' titles left exactly as the pages wrote them', () => {
    tr();
    document.body.innerHTML = '<div id="top-tab-bar"><div id="top-tabs-list" aria-label="Tabs"><div class="top-tab"><span class="tab-title">Settings</span></div></div></div>';
    VexI18nUI.apply();
    expect(document.getElementById('top-tabs-list').getAttribute('aria-label')).toBe('Sekmeler');
    expect(document.querySelector('.tab-title').textContent).toBe('Settings');   // a page called "Settings" stays so
    en();
    VexI18nUI.apply();
    expect(document.getElementById('top-tabs-list').getAttribute('aria-label')).toBe('Tabs');
  });
});

describe('templates', () => {
  const look = (t) => VexI18nUI.lookup(t, 'tr');
  it('the template with the most fixed text wins over a general one', () => {
    expect(look('0 summaries kept')).toBe('0 özet tutuluyor');   // not the general "{1} kept{2}"
  });
  it('a number written with a plus sign is a changing part like any other', () => {
    expect(look('2.34 GB now · +1.57 GB over 1 min · low 793 MB, high 2.34 GB')).toBe('2.34 GB şu an · 1 dakikada +1.57 GB · en düşük 793 MB, en yüksek 2.34 GB');
  });
});

describe('dates and times', () => {
  const d = new Date(2026, 9, 20, 22, 36);
  it('a date written without a language follows Vex in Turkish, and a named language is kept', () => {
    VexI18nUI.followLanguageForDates();
    tr();
    expect(d.toLocaleDateString([], { month: 'long' })).toBe('Ekim');
    expect(d.toLocaleDateString(undefined, { month: 'long' })).toBe('Ekim');
    expect(d.toLocaleDateString('en-US', { month: 'long' })).toBe('October');
  });
  it('is untouched in English', () => {
    VexI18nUI.followLanguageForDates();
    en();
    expect(d.toLocaleDateString([], { month: 'long' })).not.toBe('Ekim');
  });
});

describe('switching back', () => {
  it('restores the exact English it started from', () => {
    tr();
    document.body.innerHTML = '<div id="top-bar"><button title="Back">Settings</button></div>';
    VexI18nUI.apply();
    expect(document.querySelector('button').textContent).toBe('Ayarlar');

    en();
    VexI18nUI.apply();
    const b = document.querySelector('button');
    expect(b.textContent).toBe('Settings');
    expect(b.getAttribute('title')).toBe('Back');
  });

  it('English does no work at all', () => {
    en();
    document.body.innerHTML = '<div id="top-bar"><span>Settings</span></div>';
    expect(VexI18nUI.apply()).toBe(0);
    expect(document.querySelector('span').textContent).toBe('Settings');
  });
});

describe('the table itself', () => {
  it('covers the words you see every day', () => {
    for (const word of ['Settings', 'History', 'Downloads', 'Bookmarks', 'Back', 'Forward',
      'Save', 'Cancel', 'Delete', 'Close', 'New Tab', 'Search']) {
      expect(VexI18nUI.lookup(word, 'tr'), word).toBeTruthy();
    }
  });

  it('never maps a string to itself, or to nothing', () => {
    for (const [english, turkish] of Object.entries(VexI18nUI.TABLE.tr)) {
      expect(turkish, english).toBeTruthy();
      expect(turkish, english + ' is untranslated').not.toBe(english);
    }
  });

  it('ignores surrounding whitespace, which markup is full of', () => {
    expect(VexI18nUI.lookup('  Settings\n  ', 'tr')).toBe('Ayarlar');
  });

  it('returns nothing for an empty string rather than a stray match', () => {
    expect(VexI18nUI.lookup('', 'tr')).toBeNull();
    expect(VexI18nUI.lookup(null, 'tr')).toBeNull();
  });
});

describe('labels that carry their shortcut', () => {
  // "Back (Alt+Left)" is the shape of nearly every toolbar tooltip. Matching
  // only the exact string left the whole toolbar English.
  it('translates the label and keeps the shortcut', () => {
    expect(VexI18nUI.lookup('Back (Alt+Left)', 'tr')).toBe('Geri (Alt+Left)');
    expect(VexI18nUI.lookup('Picture-in-Picture (Ctrl+Shift+P)', 'tr'))
      .toBe('Pencere içinde pencere (Ctrl+Shift+P)');
  });

  it('does not invent a translation for a label it does not know', () => {
    expect(VexI18nUI.lookup('Frobnicate (Ctrl+Q)', 'tr')).toBeNull();
  });

  it('is not fooled by brackets in the middle', () => {
    expect(VexI18nUI.lookup('Back (Alt+Left) and more', 'tr')).toBeNull();
  });

  it('applies it to a real tooltip', () => {
    localStorage.setItem('vex.lang', JSON.stringify('tr'));
    document.body.innerHTML = '<div id="top-bar"><button title="Back (Alt+Left)"></button></div>';
    VexI18nUI.apply();
    expect(document.querySelector('button').getAttribute('title')).toBe('Geri (Alt+Left)');
  });
});

describe('an element with its own Turkish text', () => {
  const BTN = '<div id="top-bar"><button id="ai" title="Toggle AI Panel (Ctrl+Shift+A) · Quick ask: Ctrl+J"><svg></svg><span id="lbl" data-tr-text="YZ">AI</span></button><span id="plain">AI</span></div>';
  it('shows it in Turkish, so the toolbar AI button does not wrap "Yapay zekâ" onto two lines', () => {
    tr();
    document.body.innerHTML = BTN;
    VexI18nUI.apply();
    expect(document.getElementById('lbl').textContent).toBe('YZ');
  });
  it('leaves every other "AI" on its normal Turkish translation', () => {
    tr();
    document.body.innerHTML = BTN;
    VexI18nUI.apply();
    expect(document.getElementById('plain').textContent).toBe('Yapay zekâ');
  });
  it('gives the English back when the language goes back to English', () => {
    tr();
    document.body.innerHTML = BTN;
    VexI18nUI.apply();
    en();
    VexI18nUI.apply();
    expect(document.getElementById('lbl').textContent).toBe('AI');
  });
  it('is not touched in English at all', () => {
    en();
    document.body.innerHTML = BTN;
    VexI18nUI.apply();
    expect(document.getElementById('lbl').textContent).toBe('AI');
  });
  it('translates the button\'s tooltip and keeps its shortcuts', () => {
    tr();
    document.body.innerHTML = BTN;
    VexI18nUI.apply();
    expect(document.getElementById('ai').getAttribute('title')).toBe('Yapay zekâ panelini aç veya kapat (Ctrl+Shift+A) · Hızlı soru: Ctrl+J');
  });
});

describe('the bookmarks bar and its shortcut editor', () => {
  it('translates "Add shortcut" and the editor box when Vex is set to Turkish', () => {
    tr();
    document.body.innerHTML = '<div id="gui-shortcuts-bar" aria-label="Shortcuts"><div class="gsc gsc-add"><span class="ic"><svg></svg></span>Add shortcut</div></div>'
      + '<div class="gsc-ed-ov"><div class="gsc-ed"><div id="t">Add shortcut</div><label>Name</label><input placeholder="e.g. Reddit">'
      + '<label>Link (URL)</label><label>Color <span id="opt">— optional, overrides the logo</span></label>'
      + '<button id="clr">Use logo instead</button><button id="d">Delete</button><button id="c">Cancel</button><button id="s">Save</button></div></div>';
    VexI18nUI.apply();
    const text = (sel) => document.querySelector(sel).textContent.trim();
    expect(text('.gsc-add')).toBe('Kısayol ekle');
    expect(document.getElementById('gui-shortcuts-bar').getAttribute('aria-label')).toBe('Kısayollar');
    expect(text('#t')).toBe('Kısayol ekle');
    expect(document.querySelector('.gsc-ed input').getAttribute('placeholder')).toBe('örn. Reddit');
    expect(document.querySelectorAll('.gsc-ed label')[1].textContent).toBe('Bağlantı (adres)');
    expect(document.querySelectorAll('.gsc-ed label')[2].firstChild.textContent.trim()).toBe('Renk');
    expect(text('#opt')).toBe('— isteğe bağlı, logonun yerine geçer');
    expect([text('#clr'), text('#d'), text('#c'), text('#s')]).toEqual(['Bunun yerine logoyu kullan', 'Sil', 'İptal', 'Kaydet']);
  });
  it('leaves them in English in English', () => {
    en();
    document.body.innerHTML = '<div id="gui-shortcuts-bar"><div class="gsc gsc-add">Add shortcut</div></div>';
    VexI18nUI.apply();
    expect(document.querySelector('.gsc-add').textContent).toBe('Add shortcut');
  });
  it('looks up the toast words for the editor', () => {
    tr();
    expect(VexI18nUI.lookup('Enter a link')).toBe('Bir bağlantı yazın');
    expect(VexI18nUI.lookup('Will use the site logo')).toBe('Sitenin logosu kullanılacak');
    expect(VexI18nUI.lookup('That is not a link Vex can save. Use a web address such as example.com')).toMatch(/^Bu, Vex’in kaydedebileceği/);
  });
});

describe('a tooltip built from parts', () => {
  it('translates each part of "title · Ctrl+K: command" and keeps the rest', () => {
    tr();
    expect(VexI18nUI.lookup('Downloads · Ctrl+K: Downloads')).toBe('İndirilenler · Ctrl+K: İndirilenler');
    expect(VexI18nUI.lookup('Split Screen (Ctrl+Shift+S) · Ctrl+K: Split Screen')).toBe('Bölünmüş ekran (Ctrl+Shift+S) · Ctrl+K: Bölünmüş ekran');
  });
  it('translates the AI button\'s real tooltip, which carries the Ctrl+K suffix', () => {
    tr();
    document.body.innerHTML = '<div id="top-bar"><button id="ai" title="Toggle AI Panel (Ctrl+Shift+A) · Quick ask: Ctrl+J · Ctrl+K: Vex AI"></button></div>';
    VexI18nUI.apply();
    expect(document.getElementById('ai').getAttribute('title')).toBe('Yapay zekâ panelini aç veya kapat (Ctrl+Shift+A) · Hızlı soru: Ctrl+J · Ctrl+K: Vex Yapay Zekâ');
  });
  it('translates a part it knows and leaves one it does not', () => {
    tr();
    expect(VexI18nUI.lookup('Downloads · Something nobody translated')).toBe('İndirilenler · Something nobody translated');
  });
  it('gives up on a tooltip where no part is known', () => {
    tr();
    expect(VexI18nUI.lookup('Nothing known · Nor this')).toBeNull();
  });
  it('is not applied in English', () => {
    en();
    expect(VexI18nUI.lookup('Downloads · Ctrl+K: Downloads')).toBeNull();
  });
});

describe('text drawn after the page is up', () => {
  const settle = () => new Promise((r) => setTimeout(r, 80));
  it('translates a panel that draws itself again (the Clock and Developer panels did not)', async () => {
    tr();
    document.body.innerHTML = '<div id="panels-container"><div id="clock"></div></div>';
    document.getElementById('clock').innerHTML = '<span id="a">Settings</span><button id="b" title="Downloads">x</button>';
    await settle();
    expect(document.getElementById('a').textContent).toBe('Ayarlar');
    expect(document.getElementById('b').getAttribute('title')).toBe('İndirilenler');
  });
  it('translates a dialog or overlay when it opens, whatever its class is called', async () => {
    tr();
    document.body.innerHTML = '';
    const ov = document.createElement('div');
    ov.className = 'some-new-thing-overlay';
    ov.innerHTML = '<p id="p">Settings</p>';
    document.body.appendChild(ov);
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    dlg.innerHTML = '<p id="q">Settings</p>';
    document.body.appendChild(dlg);
    await settle();
    expect(document.getElementById('p').textContent).toBe('Ayarlar');
    expect(document.getElementById('q').textContent).toBe('Ayarlar');
  });
  it('translates a toast', async () => {
    tr();
    document.body.innerHTML = '<div id="toast-container"></div>';
    document.getElementById('toast-container').innerHTML = '<div class="toast"><span id="t">Settings</span></div>';
    await settle();
    expect(document.getElementById('t').textContent).toBe('Ayarlar');
  });
  it('translates text that changes in place', async () => {
    tr();
    document.body.innerHTML = '<div id="panels-container"><span id="s">nothing yet</span></div>';
    await settle();
    document.getElementById('s').textContent = 'Settings';
    await settle();
    expect(document.getElementById('s').textContent).toBe('Ayarlar');
  });
  it('leaves a page, and anything outside the scopes, exactly as it is', async () => {
    tr();
    document.body.innerHTML = '<div id="some-page"><span id="o">Settings</span></div>';
    document.getElementById('some-page').appendChild(Object.assign(document.createElement('b'), { id: 'o2', textContent: 'Settings' }));
    await settle();
    expect(document.getElementById('o').textContent).toBe('Settings');
    expect(document.getElementById('o2').textContent).toBe('Settings');
  });
  it('does nothing at all in English', async () => {
    en();
    document.body.innerHTML = '<div id="panels-container"></div>';
    document.getElementById('panels-container').innerHTML = '<span id="e">Settings</span>';
    await settle();
    expect(document.getElementById('e').textContent).toBe('Settings');
  });
  it('only ever replaces a text that is, whole, one of the dictionary\'s phrases', async () => {
    tr();
    document.body.innerHTML = '<div id="panels-container"></div>';
    document.getElementById('panels-container').innerHTML = '<p id="long">My Settings and other notes about Downloads</p><p id="same">Settings</p>';
    await settle();
    expect(document.getElementById('long').textContent).toBe('My Settings and other notes about Downloads');
    expect(document.getElementById('same').textContent).toBe('Ayarlar');
  });
  it('does not undo a Turkish label it wrote itself, or loop on its own edits', async () => {
    tr();
    document.body.innerHTML = '<div id="panels-container"><span id="z">Settings</span></div>';
    VexI18nUI.apply();
    await settle();
    expect(document.getElementById('z').textContent).toBe('Ayarlar');
    await settle();
    expect(document.getElementById('z').textContent).toBe('Ayarlar');
  });
});

describe('the toolbar AI button', () => {
  // Turkish speakers call it AI; "Yapay zekâ" wrapped onto two lines, and "YZ" is not what people say (told 2026-10-20).
  it('keeps the word AI in Turkish, on one line', () => {
    const html = require('fs').readFileSync('src/renderer/index.html', 'utf8');
    const m = /<span[^>]*id="?[^>]*data-tr-text="([^"]*)"[^>]*>AI<\/span>/.exec(html.replace(/\r\n/g, '\n')) || /white-space:nowrap" data-tr-text="([^"]*)">AI<\/span>/.exec(html);
    expect(m).not.toBeNull();
    expect(m[1]).toBe('AI');
    document.body.innerHTML = '<div id="top-bar"><button><span id="x" data-tr-text="AI">AI</span></button></div>';
    tr();
    VexI18nUI.apply();
    expect(document.getElementById('x').textContent).toBe('AI');
  });
});

describe('messages with a changing part (templates)', () => {
  beforeEach(tr);
  const look = (s) => VexI18nUI.lookup(s, 'tr');

  it('matches a message with a number, one or many, and a plural ending that is empty', () => {
    expect(look('Backed up 3 accounts')).toBe('3 hesap yedeklendi');
    expect(look('Backed up 1 account')).toBe('1 hesap yedeklendi');
    expect(look('Snoozed for 15 minutes')).toBe('15 dakika ertelendi');
  });
  it('keeps an error\'s own words and translates the frame around them', () => {
    expect(look('Could not copy: Permission denied')).toBe('Kopyalanamadı: Permission denied');
  });
  it('translates a known phrase inside the message, such as a feature\'s name', () => {
    expect(look('New in Vex: Text snippets. It is off until you try it.')).toBe('Vex’te yeni: Metin parçaları. Siz deneyene kadar kapalı.');
    expect(look('Vex updated to 36.69.1. Your settings from before the update are saved.')).toBe('Vex 36.69.1 sürümüne güncellendi. Güncelleme öncesi ayarlarınız kaydedildi.');
  });
  it('does not half-translate a sentence that only starts like a template', () => {
    expect(look('Copied the selection to the clipboard')).toBeNull();
    expect(look('Back (Alt+Left) and more')).toBeNull();
    expect(look('Opened the page you were on yesterday')).toBeNull();
  });
  it('does nothing in English', () => {
    en();
    expect(VexI18nUI.lookup('Backed up 3 accounts', 'en')).toBeNull();
  });
  it('a toast that appears is translated, whatever its changing part', async () => {
    document.body.innerHTML = '<div id="toast-container"></div>';
    document.getElementById('toast-container').innerHTML = '<div class="toast"><span id="t">Backed up 2 accounts</span><button id="b">If it misbehaves</button></div>';
    await new Promise((r) => setTimeout(r, 80));
    expect(document.getElementById('t').textContent).toBe('2 hesap yedeklendi');
    expect(document.getElementById('b').textContent).toBe('Sorun çıkarırsa');
  });
  it('can be rebuilt when the table changes', () => {
    VexI18nUI.TABLE.tr['Zzz test {1} done'] = 'Zzz sınama {1} bitti';
    VexI18nUI.resetTemplates();
    expect(look('Zzz test 7 done')).toBe('Zzz sınama 7 bitti');
    delete VexI18nUI.TABLE.tr['Zzz test {1} done'];
    VexI18nUI.resetTemplates();
    expect(look('Zzz test 7 done')).toBeNull();
  });
});
