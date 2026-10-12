// @vitest-environment jsdom
//
// Hand-built modals (the theme picker, Ollama install, persona and boost editors,
// AI Compose, developer dashboard, device picker, welcome card) were not dialogs to
// a screen reader, and nine more were dialogs that opened with focus left on the
// toolbar button behind them. VexFocusTrap.adopt, and an observer that adopts any
// aria-modal that appears, give them one set of rules.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const fresh = (p) => { const r = require.resolve(path.join(ROOT, p)); delete require.cache[r]; return require(r); };

describe('VexFocusTrap.adopt: a hand-built modal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((fn) => { fn(); return 1; });
    fresh('src/renderer/js/vex-dialog.js');
  });
  afterEach(() => vi.restoreAllMocks());

  it('is a dialog with a name, modal, with focus inside', () => {
    document.body.innerHTML = '<button id="opener">Open</button>';
    const opener = document.getElementById('opener');
    opener.focus();
    const overlay = document.createElement('div');
    overlay.innerHTML = '<div id="card"><input id="in"><button>OK</button></div>';
    document.body.appendChild(overlay);
    const card = overlay.firstElementChild;
    window.VexFocusTrap.adopt(card, { label: 'Edit thing' });
    expect(card.getAttribute('role')).toBe('dialog');
    expect(card.getAttribute('aria-modal')).toBe('true');
    expect(card.getAttribute('aria-label')).toBe('Edit thing');
    expect(document.activeElement).toBe(document.getElementById('in'));
    // Tab at the last control wraps inside it (the document-level trap now sees it)
    const ok = card.querySelector('button');
    ok.focus();
    const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    ok.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(document.getElementById('in'));
  });

  it('gives focus back to what had it when the modal goes, even removed with its overlay', async () => {
    document.body.innerHTML = '<button id="opener">Open</button>';
    const opener = document.getElementById('opener');
    opener.focus();
    const overlay = document.createElement('div');
    overlay.innerHTML = '<div><input></div>';
    document.body.appendChild(overlay);
    window.VexFocusTrap.adopt(overlay.firstElementChild);
    expect(document.activeElement.tagName).toBe('INPUT');
    overlay.remove();
    await new Promise(r => setTimeout(r, 0));
    expect(document.activeElement).toBe(opener);
  });

  it('any aria-modal that appears is adopted: focus goes in, and back to the opener when it goes', async () => {
    document.body.innerHTML = '<button id="opener">Open</button>';
    const opener = document.getElementById('opener');
    opener.focus();
    const overlay = document.createElement('div');
    overlay.innerHTML = '<div role="dialog" aria-modal="true" aria-label="Thing"><button id="x">Close</button></div>';
    document.body.appendChild(overlay);
    await new Promise(r => setTimeout(r, 0));          // the observer
    expect(document.activeElement.id).toBe('x');
    overlay.remove();
    await new Promise(r => setTimeout(r, 0));
    expect(document.activeElement).toBe(opener);
  });

  it('a modal that took focus by itself still gives it back to what had it before', async () => {
    document.body.innerHTML = '<button id="opener">Open</button>';
    const opener = document.getElementById('opener');
    opener.focus();                                    // seen by the focusin tracker
    const overlay = document.createElement('div');
    overlay.innerHTML = '<div role="dialog" aria-modal="true" aria-label="Thing"><input id="own"></div>';
    document.body.appendChild(overlay);
    document.getElementById('own').focus();            // its own code, before the observer runs
    await new Promise(r => setTimeout(r, 0));
    expect(document.activeElement.id).toBe('own');
    overlay.remove();
    await new Promise(r => setTimeout(r, 0));
    expect(document.activeElement).toBe(opener);
  });

  it('keeps a role it already has, and leaves focus alone when something inside has it', () => {
    const el = document.createElement('div');
    el.setAttribute('role', 'alertdialog');
    el.innerHTML = '<button id="a">a</button><button id="b">b</button>';
    document.body.appendChild(el);
    document.getElementById('b').focus();
    window.VexFocusTrap.adopt(el);
    expect(el.getAttribute('role')).toBe('alertdialog');
    expect(document.activeElement.id).toBe('b');
  });

  it('refuses something that is not an element', () => {
    expect(() => window.VexFocusTrap.adopt(null)).toThrow(/needs the dialog element/);
  });

  it('every hand-built modal that was a plain div says it is a dialog, modal and named, in its markup', () => {
    // The observer above gives each one focus and the return of it; what only
    // the markup can give is the role, the name and the modal flag.
    const marks = {
      'src/renderer/js/theme-picker.js': /modal\.setAttribute\('role', 'dialog'\);\s+modal\.setAttribute\('aria-modal', 'true'\);\s+modal\.setAttribute\('aria-label', 'Choose a theme'\)/,
      'src/renderer/js/ai-settings.js': /role="dialog" aria-modal="true" aria-label="Install Ollama for local AI"/,
      'src/renderer/js/personas-settings.js': /role="dialog" aria-modal="true" aria-label="Persona editor"/,
      'src/renderer/js/boosts.js': /role="dialog" aria-modal="true" aria-label="Boost this site"/,
      'src/renderer/js/compose-chains.js': /role="dialog" aria-modal="true" aria-label="AI Compose"/,
      'src/renderer/js/dev-mode.js': /class="dd-shell" role="dialog" aria-modal="true" aria-label="Developer dashboard"/,
      'src/renderer/js/hid-picker.js': /role="dialog" aria-modal="true" aria-label="Connect a device"/,
      'src/renderer/js/app.js': /role="dialog" aria-modal="true" aria-label="Welcome to Vex"/,
    };
    for (const [file, re] of Object.entries(marks)) expect(read(file), file).toMatch(re);
  });
});
