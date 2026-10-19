// @vitest-environment jsdom
//
// "Welcome back" (js/whats-new-me.js): for someone returning after a long time, who says which version they last used and
// sees what changed since. A Turkish-only long-time member found Vex hard to follow after years away.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let VexWhatsNewMe, openSection, dialogCloses;

// Twelve releases, newest first. Only some carry words that map to a Settings section.
const mk = (v, title, lead) => ({ version: v, name: 'v' + v + ' — ' + title, body: '- **' + lead + '**: detail.' });
const RELEASES = [
  mk('36.49.6', 'Bookmarks', 'Battery saver holds more'),
  mk('36.44.1', 'Switches', 'Something with no settings'),
  mk('36.25.1', 'Play room', 'Pet gets a new hat'),
  mk('36.12.6', 'Streaming', 'AI News in English by default'),
  mk('22.22.1', 'News', 'Another change'),
  mk('22.10.8', 'Tabs', 'A tab change'),
  mk('22.5.0', 'Look', 'A look change'),
  mk('21.99.8', 'Speed', 'A speed change'),
  mk('21.80.0', 'Sync', 'A sync change'),
  mk('21.50.2', 'Vault', 'A vault change'),
  mk('21.20.0', 'Notes', 'A notes change'),
  mk('20.86.6', 'Old', 'Something old'),
];

function setLang(lang) { globalThis.VexI18nUI = { locale: () => lang }; }
function setComputerLanguage(l) { Object.defineProperty(window.navigator, 'language', { value: l, configurable: true }); }
const bodyOf = () => document.querySelector('#welcome-body');
const buttons = () => [...bodyOf().querySelectorAll('button')];
const button = (text) => buttons().find(b => b.textContent === text);
// Only the results area: the picker above it legitimately lists every version.
const texts = () => [...bodyOf().querySelector('[aria-live]').querySelectorAll('div, span, strong')].map(n => n.textContent);

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  document.body.innerHTML = '<div id="settings-battery"></div><div id="settings-ainews"></div>';
  window.showToast = vi.fn();
  openSection = vi.fn();
  dialogCloses = vi.fn();
  globalThis.SettingsUI = { openSection };
  setLang('en');
  setComputerLanguage('en-US');
  ({ VexUpdateNotes: globalThis.VexUpdateNotes } = fresh(JS + 'update-log.js'));
  globalThis.VexSettingsGroups = {
    register: () => {},
    button: (text, fn) => { const b = document.createElement('button'); b.textContent = text; b.addEventListener('click', fn); return b; },
    note: (t) => { const d = document.createElement('div'); d.textContent = t; return d; },
    dialog: ({ title, sub }) => {
      const overlay = document.createElement('div');
      overlay.id = 'welcome-dialog'; overlay.dataset.title = title; overlay.dataset.sub = sub;
      const body = document.createElement('div'); body.id = 'welcome-body';
      overlay.appendChild(body); document.body.appendChild(overlay);
      return { overlay, body, close: () => { dialogCloses(); overlay.remove(); } };
    },
  };
  globalThis.VexSimpleMode = { mode: vi.fn(() => 'full'), set: vi.fn() };
  globalThis.Onboarding = { setLanguage: vi.fn() };
  window.VexWhatsNew = { open: vi.fn() };
  window.vex = { getAppVersion: async () => '36.49.6', getReleaseList: async () => RELEASES };
  ({ VexWhatsNewMe } = fresh(JS + 'whats-new-me.js'));
  delete globalThis.VexRegistry;
});
afterEach(() => { delete globalThis.VexI18nUI; delete globalThis.VexSimpleMode; delete globalThis.Onboarding; delete window.VexWhatsNew; });

describe('asking which version they last used', () => {
  it('opens with a picker of every release, newest first, and "I do not remember" first', async () => {
    await VexWhatsNewMe.welcomeBack();
    const sel = document.getElementById('vex-welcome-back-version');
    expect(sel).toBeTruthy();
    const opts = [...sel.options];
    expect(opts[0].textContent).toBe('I do not remember');
    expect(opts[0].value).toBe('');
    expect(opts.slice(1).map(o => o.value)).toEqual(RELEASES.map(r => r.version));
    expect(opts[1].textContent).toBe('v36.49.6 — Bookmarks');
    expect(document.getElementById('welcome-dialog').dataset.title).toBe('Welcome back');
  });
  it('changes nothing until a button is pressed', async () => {
    await VexWhatsNewMe.welcomeBack();
    expect(VexSimpleMode.set).not.toHaveBeenCalled();
    expect(Onboarding.setLanguage).not.toHaveBeenCalled();
    expect(localStorage.getItem('vex.whatsNewMe.seen')).toBeNull();
  });
});

describe('what changed since', () => {
  it('lists the releases after the chosen one, and not the chosen one itself', async () => {
    await VexWhatsNewMe.welcomeBack();
    document.getElementById('vex-welcome-back-version').value = '36.12.6';
    button('Show what changed').click();
    const t = texts().join('\n');
    expect(t).toContain('Since v36.12.6: 3 releases. The most important changes:');
    expect(t).toContain('v36.49.6 · Bookmarks');
    expect(t).toContain('v36.25.1 · Play room');
    expect(t).not.toContain('v36.12.6 · Streaming');
    expect(t).not.toContain('v22.22.1');
  });
  it('gives a Try it button only where a Settings section exists, and it opens that section', async () => {
    await VexWhatsNewMe.welcomeBack();
    document.getElementById('vex-welcome-back-version').value = '36.12.6';
    button('Show what changed').click();
    const tries = buttons().filter(b => b.textContent === 'Try it');
    expect(tries).toHaveLength(1);                         // only "Battery saver holds more" maps to a section
    tries[0].click();
    expect(openSection).toHaveBeenCalledWith('settings-battery');
    expect(dialogCloses).toHaveBeenCalled();
  });
  it('offers the full notes since that version', async () => {
    await VexWhatsNewMe.welcomeBack();
    document.getElementById('vex-welcome-back-version').value = '22.22.1';
    button('Show what changed').click();
    button('See everything since v22.22.1').click();
    expect(window.VexWhatsNew.open).toHaveBeenCalledWith({ from: '22.22.1', to: '36.49.6' });
  });
  it('shows the newest ten releases when they do not remember', async () => {
    await VexWhatsNewMe.welcomeBack();
    button('Show what changed').click();
    expect(texts().join('\n')).toContain('The 10 newest releases. The most important changes:');
  });
  it('says so when nothing is newer', async () => {
    await VexWhatsNewMe.welcomeBack();
    document.getElementById('vex-welcome-back-version').value = '36.49.6';
    button('Show what changed').click();
    expect(texts().join('\n')).toContain('Nothing new since v36.49.6.');
  });
  it('starts on the version it is given and shows the result at once', async () => {
    await VexWhatsNewMe.welcomeBack({ from: '36.25.1' });
    expect(document.getElementById('vex-welcome-back-version').value).toBe('36.25.1');
    expect(texts().join('\n')).toContain('Since v36.25.1: 2 releases.');
  });
});

describe('the picker', () => {
  it('fills its row, so the long release titles do not push the dialog wider', async () => {
    await VexWhatsNewMe.welcomeBack();
    const sel = document.getElementById('vex-welcome-back-version');
    expect(sel.style.width).toBe('100%');
    expect(sel.style.maxWidth).toBe('100%');
  });
  it('does not mention the English release notes in English', async () => {
    await VexWhatsNewMe.welcomeBack();
    button('Show what changed').click();
    expect(texts().join('\n')).not.toContain('written in English');
  });
});

describe('what it offers, and never forces', () => {
  it('offers Simple mode when Vex is in full mode, and turns it on only when pressed', async () => {
    await VexWhatsNewMe.welcomeBack();
    expect(VexSimpleMode.set).not.toHaveBeenCalled();
    button('Use Simple mode').click();
    expect(VexSimpleMode.set).toHaveBeenCalledWith('simple');
    expect(window.showToast).toHaveBeenCalledWith('Simple mode is on');
  });
  it('does not offer Simple mode when it is already on', async () => {
    VexSimpleMode.mode.mockReturnValue('simple');
    await VexWhatsNewMe.welcomeBack();
    expect(button('Use Simple mode')).toBeUndefined();
  });
  it('offers Turkish only on a Turkish computer that is not already in Turkish', async () => {
    await VexWhatsNewMe.welcomeBack();
    expect(button('Türkçe kullan')).toBeUndefined();        // an English computer
    document.getElementById('welcome-dialog').remove();
    setComputerLanguage('tr-TR');
    await VexWhatsNewMe.welcomeBack();
    button('Türkçe kullan').click();
    expect(Onboarding.setLanguage).toHaveBeenCalledWith('tr');
  });
  it('does not offer Turkish when Vex is already in Turkish', async () => {
    setComputerLanguage('tr-TR');
    setLang('tr');
    await VexWhatsNewMe.welcomeBack();
    expect(button('Türkçe kullan')).toBeUndefined();
  });
  it('Done remembers the current version and closes', async () => {
    await VexWhatsNewMe.welcomeBack();
    button('Done').click();
    expect(localStorage.getItem('vex.whatsNewMe.seen')).toBe('36.49.6');
    expect(dialogCloses).toHaveBeenCalled();
  });
});

describe('in Turkish', () => {
  it('asks and answers in Turkish when Vex is set to Turkish', async () => {
    setLang('tr');
    await VexWhatsNewMe.welcomeBack();
    expect(document.getElementById('welcome-dialog').dataset.title).toBe('Tekrar hoş geldiniz');
    expect([...document.getElementById('vex-welcome-back-version').options][0].textContent).toBe('Hatırlamıyorum');
    document.getElementById('vex-welcome-back-version').value = '36.12.6';
    button('Neyin değiştiğini göster').click();
    expect(texts().join('\n')).toContain('v36.12.6 sürümünden beri 3 sürüm yayımlandı. En önemli değişiklikler:');
    expect(texts()).toContain('Sürüm notları İngilizce yazılmıştır.');
    expect(button('Dene')).toBeTruthy();
    expect(button('Basit modu kullan')).toBeTruthy();
    expect(button('Tamam')).toBeTruthy();
  });
});

describe('when it opens by itself', () => {
  it('takes over from the update card only when eight or more releases were skipped', () => {
    expect(VexWhatsNewMe.wantsGuide(7)).toBe(false);
    expect(VexWhatsNewMe.wantsGuide(8)).toBe(true);
    expect(VexWhatsNewMe.wantsGuide(40)).toBe(true);
  });
  it('does not depend on the feature being switched on (a profile that predates it starts with it off)', async () => {
    localStorage.setItem('vex.whatsNewMe.enabled', 'off');
    expect(VexWhatsNewMe.wantsGuide(20)).toBe(true);
    await VexWhatsNewMe.welcomeBack({ from: '22.22.1', automatic: true });
    expect(document.getElementById('welcome-dialog')).toBeTruthy();
  });
  it('is refused when asked for by hand while the feature is switched off', async () => {
    localStorage.setItem('vex.whatsNewMe.enabled', 'off');
    expect(await VexWhatsNewMe.welcomeBack()).toBeNull();
    expect(window.showToast).toHaveBeenCalledWith("What's new for me is switched off in Settings", 'info');
    expect(document.getElementById('welcome-dialog')).toBeNull();
  });
  it('is wired into the update card, which gives it the version the last run was on and removes its own mark', () => {
    const src = fs.readFileSync('src/renderer/js/update-log.js', 'utf8').replace(/\r\n/g, '\n');
    expect(src).toContain('VexWhatsNewMe.wantsGuide(entries.length)');
    expect(src).toContain('VexWhatsNewMe.welcomeBack({ from: pending.from, automatic: true })');
    expect(src).toMatch(/wantsGuide\(entries\.length\)\) \{\n\s+localStorage\.removeItem\(PENDING_KEY\);/);
  });
});

describe('the command', () => {
  it('is listed in the feature manifest', () => {
    const src = fs.readFileSync('src/renderer/js/feature-manifests.js', 'utf8');
    expect(src).toContain("commands: ['whatsnew-me', 'welcome-back']");
  });
});
