// @vitest-environment jsdom
//
// The setup wizard's coverage of the settings that matter, and the way it
// applies them: through the real Settings controls, never a parallel store.
import { describe, it, expect, beforeEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
require('../../src/renderer/js/geo-search.js');
const { Onboarding } = require('../../src/renderer/js/onboarding.js');

// The Settings controls the wizard drives, with the same change handlers
// Settings would attach, recording what they were told.
function settingsControls() {
  const applied = {};
  const mk = (id, type, value) => {
    const el = document.createElement(type === 'select' ? 'select' : 'input');
    el.id = id;
    if (type === 'select') { for (const v of value) { const o = document.createElement('option'); o.value = String(v); el.appendChild(o); } }
    else { el.type = 'checkbox'; el.checked = !!value; }
    el.addEventListener('change', () => { applied[id] = el.type === 'checkbox' ? el.checked : el.value; });
    document.body.appendChild(el);
    return el;
  };
  mk('setting-memory-saver', 'checkbox', false); mk('setting-autosleep', 'checkbox', true);
  mk('setting-autosleep-minutes', 'select', [5, 10, 15, 30, 60, 120]); mk('setting-adblocker', 'checkbox', true);
  mk('setting-autosleep-exclude-pinned', 'checkbox', true); mk('setting-mem-ceiling', 'select', [0, 900, 1200, 1600, 2400]);
  mk('setting-tab-layout', 'select', ['vertical', 'horizontal']); mk('setting-gestures', 'checkbox', true);
  mk('setting-consent', 'checkbox', true); mk('setting-copyunlock', 'checkbox', false); mk('setting-autosave', 'checkbox', true);
  mk('setting-auto-group-suggest', 'checkbox', true); mk('setting-ai-indexing-enabled', 'checkbox', true);
  mk('setting-emailcode-hidden', 'checkbox', false); mk('setting-emailcode-autosubmit', 'checkbox', false);
  return applied;
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  Onboarding.step = 0; Onboarding._session = {}; Onboarding._perf = null;
  globalThis.WebviewManager = { webviews: new Map() };
  global.window.showToast = vi.fn();
  globalThis.PrivacyPack = { cfg: { farble: false, httpsOnly: true, doh: 'off' }, setCfg: vi.fn(async () => {}) };
});

describe('what the wizard covers', () => {
  it('asks about browsing behaviour, what Vex may read, and notifications', () => {
    const keys = Onboarding.STEPS().map(s => s.key);
    for (const k of ['browsing', 'aidata', 'notifications']) expect(keys).toContain(k);
    expect(keys.indexOf('browsing')).toBe(keys.indexOf('performance') + 1);
    expect(keys.indexOf('notifications')).toBe(keys.indexOf('done') - 1);
  });

  it('the performance step lists the nine it promises', () => {
    expect(Onboarding.PERF_FIELDS()).toHaveLength(9);
    expect(Onboarding.PERF_FIELDS().map(f => f.key)).toEqual(expect.arrayContaining(['excludePinned', 'memCeiling']));
    for (const p of Onboarding.PERF_PRESETS()) expect(Object.keys(p.values)).toEqual(expect.arrayContaining(['excludePinned', 'memCeiling']));
  });
});

describe('remembering what was done', () => {
  it('accepts both spellings a step may have written', () => {
    localStorage.setItem('vex.guiStyleChosen', '1');
    expect(Onboarding._isStepDone('look')).toBe(true);
    localStorage.setItem('vex.perfConfigured', 'true');
    expect(Onboarding._isStepDone('performance')).toBe(true);
    expect(Onboarding._isStepDone('browsing')).toBe(false);
    localStorage.setItem('vex.browsingConfigured', 'true');
    expect(Onboarding._isStepDone('browsing')).toBe(true);
  });
});

describe('applying through the real controls', () => {
  it('performance drives all nine, including the two new ones, and records itself as done', async () => {
    const applied = settingsControls();
    await Onboarding._perfApply({ memorySaver: true, autosleep: true, minutes: 10, excludePinned: false, memCeiling: 900, adblock: false, farble: true, httpsOnly: true, doh: 'auto' });
    expect(applied).toMatchObject({ 'setting-memory-saver': true, 'setting-autosleep-minutes': '10', 'setting-autosleep-exclude-pinned': false, 'setting-mem-ceiling': '900', 'setting-adblocker': false });
    expect(PrivacyPack.setCfg).toHaveBeenCalledWith({ farble: true, httpsOnly: true, doh: 'auto' });
    expect(localStorage.getItem('vex.perfConfigured')).toBe('true');
  });

  it('browsing shows the current values, and commits changes through Settings', async () => {
    const applied = settingsControls();
    const body = document.createElement('div'); document.body.appendChild(body);
    Onboarding._renderBody('browsing', body);
    const boxes = [...body.querySelectorAll('[data-key]')];
    expect(boxes.map(b => b.dataset.key)).toEqual(['tabLayout', 'gestures', 'consent', 'copyunlock', 'autosave', 'groupSuggest']);
    expect(body.querySelector('[data-key="tabLayout"]').value).toBe('vertical');   // read from the control
    expect(body.querySelector('[data-key="copyunlock"]').checked).toBe(false);
    body.querySelector('[data-key="tabLayout"]').value = 'horizontal'; body.querySelector('[data-key="tabLayout"]').dispatchEvent(new Event('change'));
    body.querySelector('[data-key="copyunlock"]').checked = true; body.querySelector('[data-key="copyunlock"]').dispatchEvent(new Event('change'));
    body.querySelector('[data-key="gestures"]').checked = false; body.querySelector('[data-key="gestures"]').dispatchEvent(new Event('change'));
    Onboarding._applySwitches(Onboarding.BROWSING_FIELDS(), 'browsing', 'vex.browsingConfigured');
    expect(applied).toEqual({ 'setting-tab-layout': 'horizontal', 'setting-copyunlock': true, 'setting-gestures': false });   // unchanged ones fire nothing
    expect(localStorage.getItem('vex.browsingConfigured')).toBe('true');
    expect(window.showToast).not.toHaveBeenCalled();
  });

  it('says which switches are not in this build instead of pretending', () => {
    document.body.innerHTML = '';   // no Settings controls at all
    const body = document.createElement('div'); document.body.appendChild(body);
    Onboarding._renderBody('aidata', body);
    expect([...body.querySelectorAll('[data-key]')].every(b => b.disabled)).toBe(true);
    expect(body.textContent).toContain('not available in this build');
    Onboarding._session.aidata = { aiIndexing: false };
    Onboarding._applySwitches(Onboarding.AIDATA_FIELDS(), 'aidata', 'vex.aiDataConfigured');
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/Not available in this build: AI history indexing/), 'error');
  });

  it('what Vex may read: defaults off for the inbox reader, and commits', () => {
    const applied = settingsControls();
    const body = document.createElement('div'); document.body.appendChild(body);
    Onboarding._renderBody('aidata', body);
    expect(body.querySelector('[data-key="aiIndexing"]').checked).toBe(true);
    expect(body.querySelector('[data-key="emailHidden"]').checked).toBe(false);
    body.querySelector('[data-key="aiIndexing"]').checked = false; body.querySelector('[data-key="aiIndexing"]').dispatchEvent(new Event('change'));
    Onboarding._applySwitches(Onboarding.AIDATA_FIELDS(), 'aidata', 'vex.aiDataConfigured');
    expect(applied).toEqual({ 'setting-ai-indexing-enabled': false });
  });
});

describe('the notification check', () => {
  it('reports success in words when Windows showed it', async () => {
    global.window.vex = { notify: vi.fn(async () => ({ ok: true })) };
    const body = document.createElement('div'); document.body.appendChild(body);
    Onboarding._renderBody('notifications', body);
    body.querySelector('#ob-notify-test').click();
    await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    expect(window.vex.notify).toHaveBeenCalledWith('Vex', expect.stringMatching(/test notification/));
    expect(body.querySelector('#ob-notify-status').textContent).toMatch(/Windows showed it/);
  });

  it('reports the refusal, and where to look', async () => {
    global.window.vex = { notify: vi.fn(async () => { throw new Error('Focus assist is on'); }) };
    const body = document.createElement('div'); document.body.appendChild(body);
    Onboarding._renderBody('notifications', body);
    body.querySelector('#ob-notify-test').click();
    await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    expect(body.querySelector('#ob-notify-status').textContent).toMatch(/did not show: Focus assist is on/);
    expect(body.textContent).toMatch(/Windows Settings/);
  });

  it('counts as done whether or not the test was sent', async () => {
    const overlay = document.createElement('div'); overlay.innerHTML = '<div id="ob-body"></div>'; document.body.appendChild(overlay);
    Onboarding.activeSteps = Onboarding.STEPS();
    Onboarding.step = Onboarding.activeSteps.findIndex(s => s.key === 'notifications');
    const render = vi.spyOn(Onboarding, '_render').mockImplementation(() => {});
    await Onboarding._commitAndNext('notifications', overlay);
    expect(localStorage.getItem('vex.notificationsChecked')).toBe('true');
    render.mockRestore();
  });
});
