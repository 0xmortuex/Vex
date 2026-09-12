// @vitest-environment jsdom
//
// Regression cover for a batch of confirmed faults in the smaller settings
// panels. Each block names the behaviour that was wrong, not just the code
// path, because every one of these shipped looking like it worked.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');   // window.escapeHtml
require('../../src/renderer/js/vex-icons.js');   // window.VexIcons

let toasts;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = '';
  toasts = [];
  window.showToast = (message, type, duration) => toasts.push({ message, type, duration });
  window.vexConfirm = vi.fn(async () => true);
});
afterEach(() => { vi.restoreAllMocks(); });

const lastToast = () => toasts[toasts.length - 1] || {};

// A localStorage whose writes fail, for the "don't claim you saved it" cases.
function breakStorage() {
  const original = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    if (String(key).startsWith('vex.')) throw new Error('QuotaExceededError');
    return original.call(this, key, value);
  });
}

// ---------------------------------------------------------------------------
describe('accessibility: the reading ruler cleans up after itself', () => {
  const { AccessibilityPack } = require('../../src/renderer/js/accessibility.js');

  // Collects every script AccessibilityPack injects into a guest page.
  function fakeWebview() {
    const scripts = [];
    return { scripts, executeJavaScript: (js) => { scripts.push(js); return Promise.resolve(); } };
  }

  it('removes the mousemove listener when the ruler is turned off, not just the bar', () => {
    const wv = fakeWebview();
    AccessibilityPack.cfg.ruler = true;
    AccessibilityPack.applyTo(wv);
    AccessibilityPack.cfg.ruler = false;
    AccessibilityPack.applyTo(wv);

    const [on, off] = wv.scripts;
    expect(on).toContain("document.addEventListener('mousemove',mv)");
    // The teardown closure is what makes off→on→off idempotent.
    expect(on).toContain("window.__vexRulerOff=function()");
    expect(on).toContain("document.removeEventListener('mousemove',mv)");
    expect(off).toContain('window.__vexRulerOff()');
  });

  // The original guard was `window.__vexRuler`, which the off script reset to 0
  // while leaving the listener attached — so the next "on" added another one.
  it('does not re-arm behind a flag that the off path clears without unbinding', () => {
    const wv = fakeWebview();
    AccessibilityPack.cfg.ruler = true;
    AccessibilityPack.applyTo(wv);
    expect(wv.scripts[0]).toContain('if(!window.__vexRulerOff)');
    expect(wv.scripts[0]).not.toContain('window.__vexRuler=1');
  });

  // Running the real injected snippets against jsdom proves the cycle, rather
  // than only asserting on their text.
  it('leaves exactly one listener after three off→on cycles', () => {
    const wv = fakeWebview();
    let added = 0, removed = 0;
    const doc = document;
    const realAdd = doc.addEventListener.bind(doc), realRemove = doc.removeEventListener.bind(doc);
    doc.addEventListener = (t, f, c) => { if (t === 'mousemove') added++; return realAdd(t, f, c); };
    doc.removeEventListener = (t, f, c) => { if (t === 'mousemove') removed++; return realRemove(t, f, c); };
    try {
      for (let i = 0; i < 3; i++) {
        AccessibilityPack.cfg.ruler = true; AccessibilityPack.applyTo(wv);
        AccessibilityPack.cfg.ruler = false; AccessibilityPack.applyTo(wv);
      }
      // eslint-disable-next-line no-eval
      wv.scripts.forEach(js => eval(js));
    } finally {
      doc.addEventListener = realAdd; doc.removeEventListener = realRemove;
    }
    expect(added).toBe(3);
    expect(added - removed).toBe(0);
    expect(document.getElementById('vex-ruler')).toBeNull();
  });

  it('says so when a preference could not be saved instead of silently applying it', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    AccessibilityPack.renderPanel(host);
    breakStorage();
    host.querySelector('#a11y-ruler').checked = true;
    host.querySelector('#a11y-ruler').dispatchEvent(new Event('change'));
    expect(lastToast().type).toBe('error');
    expect(lastToast().message).toMatch(/could not be saved/i);
  });
});

// ---------------------------------------------------------------------------
describe('focus mode: emptying the blocklist does not retire the defaults forever', () => {
  const { FocusMode } = require('../../src/renderer/js/focus-mode.js');

  it('an explicitly emptied list blocks nothing, and says so', () => {
    expect(FocusMode.blocklist()).toEqual(FocusMode.DEFAULTS);
    expect(FocusMode.isCustom()).toBe(false);

    FocusMode.saveBlocklist([]);
    expect(FocusMode.blocklist()).toEqual([]);
    expect(FocusMode.isCustom()).toBe(true);
    FocusMode.active = true; FocusMode.until = Date.now() + 60000;
    expect(FocusMode.shouldBlock('https://youtube.com/watch?v=1')).toBe(false);
    FocusMode.active = false;
  });

  it('restoreDefaults brings the built-in list back', () => {
    FocusMode.saveBlocklist([]);
    expect(FocusMode.restoreDefaults()).toBe(true);
    expect(FocusMode.blocklist()).toEqual(FocusMode.DEFAULTS);
    expect(FocusMode.isCustom()).toBe(false);
  });

  it('the panel offers Restore defaults and warns while the list is empty', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    FocusMode.saveBlocklist([]);
    FocusMode.renderPanel(host);
    expect(host.querySelector('#focus-restore')).toBeTruthy();
    expect(host.querySelector('#focus-restore').disabled).toBe(false);
    expect(host.querySelector('#focus-state').textContent).toMatch(/will not block anything/i);

    host.querySelector('#focus-restore').click();
    expect(FocusMode.blocklist()).toEqual(FocusMode.DEFAULTS);
    expect(host.querySelector('#focus-blocklist').value.split('\n')).toEqual(FocusMode.DEFAULTS);
    expect(host.querySelector('#focus-state').textContent).not.toMatch(/will not block anything/i);
  });

  it('saving an empty list reports that nothing will be blocked', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    FocusMode.renderPanel(host);
    host.querySelector('#focus-blocklist').value = '';
    host.querySelector('#focus-save').click();
    expect(lastToast().message).toMatch(/will not block anything/i);
  });

  it('does not claim a save that storage refused', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    FocusMode.renderPanel(host);
    breakStorage();
    host.querySelector('#focus-blocklist').value = 'example.com';
    host.querySelector('#focus-save').click();
    expect(lastToast().type).toBe('error');
    expect(lastToast().message).toMatch(/could not be saved/i);
  });

  it('a focus session with an empty blocklist does not promise blocking', () => {
    FocusMode.saveBlocklist([]);
    FocusMode.start(25);
    expect(lastToast().message).toMatch(/nothing is blocked/i);
    FocusMode.stop();
  });
});

// ---------------------------------------------------------------------------
describe('boosts: turning one off actually un-injects it', () => {
  const { VexBoosts } = require('../../src/renderer/js/boosts.js');

  function fakeWebview() {
    const scripts = [];
    return { scripts, executeJavaScript: (js) => { scripts.push(js); return Promise.resolve(); } };
  }

  beforeEach(() => { VexBoosts.boosts = {}; });

  it('clears the injected stylesheet for a host that no longer has a boost', () => {
    const wv = fakeWebview();
    VexBoosts.boosts['example.test'] = { zaps: ['h1'], css: 'body{color:red}', js: '' };
    VexBoosts.applyTo(wv, 'https://example.test/');
    expect(wv.scripts[0]).toContain('h1{display:none!important');

    delete VexBoosts.boosts['example.test'];
    VexBoosts.applyTo(wv, 'https://example.test/');
    // The second injection sets the tag's text to empty — it does NOT return
    // early leaving the old rules in place, which is what made "delete" look
    // like it had done nothing to pages that were already open.
    expect(wv.scripts).toHaveLength(2);
    expect(wv.scripts[1]).toContain('el.textContent=""');
    expect(wv.scripts[1]).not.toContain('display:none');
  });

  it('refreshHost re-applies across every open tab on that host only', () => {
    const a = fakeWebview(), b = fakeWebview(), other = fakeWebview();
    global.TabManager = { tabs: [
      { id: 't1', url: 'https://example.test/one' },
      { id: 't2', url: 'https://www.example.test/two' },
      { id: 't3', url: 'https://elsewhere.test/' },
    ] };
    global.WebviewManager = { webviews: new Map([['t1', a], ['t2', b], ['t3', other]]) };
    expect(VexBoosts.refreshHost('example.test')).toBe(2);
    expect(a.scripts).toHaveLength(1);
    expect(b.scripts).toHaveLength(1);
    expect(other.scripts).toHaveLength(0);
    delete global.TabManager; delete global.WebviewManager;
  });

  it('asks before deleting a boost and does nothing when the user says no', async () => {
    VexBoosts.boosts['example.test'] = { zaps: [], css: 'body{color:red}', js: '' };
    const host = document.createElement('div');
    document.body.appendChild(host);
    VexBoosts.renderPanel(host);
    window.vexConfirm.mockResolvedValueOnce(false);
    host.querySelector('[data-del]').click();
    await new Promise(r => setTimeout(r, 0));
    expect(window.vexConfirm).toHaveBeenCalled();
    expect(VexBoosts.boosts['example.test']).toBeTruthy();
  });

  it('deletes on confirmation and warns that custom JS needs a reload', async () => {
    VexBoosts.boosts['example.test'] = { zaps: [], css: '', js: 'window.x=1' };
    const host = document.createElement('div');
    document.body.appendChild(host);
    VexBoosts.renderPanel(host);
    host.querySelector('[data-del]').click();
    await new Promise(r => setTimeout(r, 0));
    expect(VexBoosts.boosts['example.test']).toBeUndefined();
    expect(lastToast().message).toMatch(/reload the page/i);
  });

  it('uses an icon, not an emoji, for the delete control', () => {
    VexBoosts.boosts['example.test'] = { zaps: [], css: 'a{}', js: '' };
    const host = document.createElement('div');
    document.body.appendChild(host);
    VexBoosts.renderPanel(host);
    const del = host.querySelector('[data-del]');
    expect(del.querySelector('svg')).toBeTruthy();
    expect(del.textContent.trim()).toBe('');
  });
});

// ---------------------------------------------------------------------------
describe('skills and chains: destructive buttons ask first', () => {
  it('a skill is only deleted after confirmation', async () => {
    const { VexSkills } = require('../../src/renderer/js/skills.js');
    VexSkills.skills = [{ id: 'sk_a', name: 'Mine', prompt: 'do it', icon: 'sparkles' }];
    const host = document.createElement('div');
    document.body.appendChild(host);
    VexSkills.renderPanel(host);

    window.vexConfirm.mockResolvedValueOnce(false);
    host.querySelector('[data-del]').click();
    await new Promise(r => setTimeout(r, 0));
    expect(VexSkills.skills).toHaveLength(1);

    host.querySelector('[data-del]').click();
    await new Promise(r => setTimeout(r, 0));
    expect(VexSkills.skills).toHaveLength(0);
  });

  it('a chain is only deleted after confirmation', async () => {
    global.CommandBar = { commands: [] };
    const { CommandChains } = require('../../src/renderer/js/compose-chains.js');
    CommandChains.chains = [{ id: 'ch1', name: 'Read it', steps: ['read', 'aloud'] }];
    const host = document.createElement('div');
    document.body.appendChild(host);
    CommandChains.renderPanel(host);

    window.vexConfirm.mockResolvedValueOnce(false);
    host.querySelector('[data-del]').click();
    await new Promise(r => setTimeout(r, 0));
    expect(CommandChains.chains).toHaveLength(1);

    host.querySelector('[data-del]').click();
    await new Promise(r => setTimeout(r, 0));
    expect(CommandChains.chains).toHaveLength(0);
    delete global.CommandBar;
  });

  it('a chain names the steps that failed instead of finishing quietly', async () => {
    global.CommandBar = { commands: [
      { id: 'ok', label: 'Fine', action: () => {} },
      { id: 'bad', label: 'Broken', action: () => { throw new Error('nope'); } },
    ] };
    const { CommandChains } = require('../../src/renderer/js/compose-chains.js');
    const res = await CommandChains.run({ name: 'C', steps: ['ok', 'bad', 'vanished'] });
    expect(res.ok).toBe(false);
    expect(res.problems).toHaveLength(2);
    expect(lastToast().type).toBe('error');
    expect(lastToast().message).toMatch(/Broken.*nope/);
    expect(lastToast().message).toMatch(/vanished.*no longer exists/);
    delete global.CommandBar;
  });
});

// ---------------------------------------------------------------------------
describe('location settings', () => {
  require('../../src/renderer/js/location-settings.js');

  it('rendering the panel does not write a mode the user never chose', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    expect(localStorage.getItem('vex.locationMode')).toBeNull();
    window.LocationSettings.render(host);
    expect(localStorage.getItem('vex.locationMode')).toBeNull();
    // ...and still shows Manual pre-selected, which is what main.js defaults to.
    expect(host.querySelector('input[value="manual"]').checked).toBe(true);
  });

  it('warns, visibly, that manual mode with no coordinates answers nothing', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    window.LocationSettings.render(host);
    const warn = host.querySelector('#location-unset-warning');
    expect(warn.style.display).toBe('flex');
    expect(warn.textContent).toMatch(/told it is unavailable/i);
    expect(warn.textContent).toMatch(/IP address/i);
  });

  it('hides the warning once coordinates are saved', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    window.LocationSettings.render(host);
    host.querySelector('#loc-lat').value = '41.0082';
    host.querySelector('#loc-lng').value = '28.9784';
    host.querySelector('#btn-save-location').click();
    expect(host.querySelector('#location-unset-warning').style.display).toBe('none');
    expect(lastToast().type).toBe('success');
  });

  it('does not report "Location saved" when the write failed', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    window.LocationSettings.render(host);
    breakStorage();
    host.querySelector('#loc-lat').value = '41.0082';
    host.querySelector('#loc-lng').value = '28.9784';
    host.querySelector('#btn-save-location').click();
    expect(lastToast().type).toBe('error');
    expect(lastToast().message).toMatch(/could not be saved/i);
  });

  it('ignores stored coordinates that are out of range or unparseable', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    for (const bad of [{ latitude: 999, longitude: 0 }, { latitude: 'x', longitude: 1 }, 'nonsense']) {
      localStorage.setItem('vex.manualLocation', JSON.stringify(bad));
      window.LocationSettings.render(host);
      expect(host.querySelector('#location-unset-warning').style.display).toBe('flex');
    }
  });
});

// ---------------------------------------------------------------------------
describe('leak canary', () => {
  const { LeakCanary } = (() => {
    require('../../src/renderer/js/leak-canary.js');
    return { LeakCanary: window.LeakCanary };
  })();

  function webviewReturning(emails) {
    return { executeJavaScript: async () => emails };
  }

  beforeEach(() => { LeakCanary.refresh(); });

  it('keeps scanning past an address it has already warned about', async () => {
    window.vex = { vaultList: async () => ([
      { username: 'first@mail.test', host: 'bank.test' },
      { username: 'second@mail.test', host: 'shop.test' },
    ]) };
    await LeakCanary.check(webviewReturning(['first@mail.test']), 'https://tracker.test/');
    expect(toasts).toHaveLength(1);
    // Same page, both addresses present. The already-warned first one used to
    // `return` and hide the second, still-unreported leak entirely.
    await LeakCanary.check(webviewReturning(['first@mail.test', 'second@mail.test']), 'https://tracker.test/');
    expect(toasts).toHaveLength(2);
    expect(toasts[1].message).toContain('se***@mail.test');
  });

  it('uses the toast duration slot for the duration', async () => {
    window.vex = { vaultList: async () => ([{ username: 'a@mail.test', host: 'bank.test' }]) };
    await LeakCanary.check(webviewReturning(['a@mail.test']), 'https://tracker.test/');
    expect(lastToast().type).toBe('warn');
    expect(lastToast().duration).toBe(7000);
  });

  it('ignores vault entries with no host instead of flagging every site', async () => {
    window.vex = { vaultList: async () => ([{ username: 'a@mail.test', host: '' }]) };
    await LeakCanary.check(webviewReturning(['a@mail.test']), 'https://anything.test/');
    expect(toasts).toHaveLength(0);
  });

  it('retries after a vault read failure rather than caching an empty list', async () => {
    let calls = 0;
    window.vex = { vaultList: async () => { calls++; if (calls === 1) throw new Error('locked'); return [{ username: 'a@mail.test', host: 'bank.test' }]; } };
    await LeakCanary.check(webviewReturning(['a@mail.test']), 'https://tracker.test/');
    expect(toasts).toHaveLength(0);
    await LeakCanary.check(webviewReturning(['a@mail.test']), 'https://tracker.test/');
    expect(toasts).toHaveLength(1);
  });
});
