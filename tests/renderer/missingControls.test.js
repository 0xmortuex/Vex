// @vitest-environment jsdom
//
// Features whose only on/off switch lived in Feature usage now have a real control in their own Settings
// section, bound to the SAME flag the feature, its commands and the Feature usage adapter read. Each test
// renders the section the way Settings does, flips the visible switch, and reads the flag back.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let SG, defs;
function boot() {
  localStorage.clear();
  vi.resetModules();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  globalThis.VexSettingsGroup = fresh(JS + 'settings-group.js').VexSettingsGroup;
  SG = fresh(JS + 'vex-settings-groups.js').VexSettingsGroups;
  SG._defs.clear();
  globalThis.VexSettingsGroups = SG;
  window.VexSettingsGroups = SG;
  defs = SG._defs;
}
function section(id) {
  const def = defs.get(id);
  expect(def, 'section ' + id + ' registered').toBeTruthy();
  const el = document.createElement('div');
  if (def.build) def.build(el); else def.render(el);
  document.body.appendChild(el);
  return el;
}
const box = (el, label) => {
  const b = [...el.querySelectorAll('input[type=checkbox]')].find(i => i.getAttribute('aria-label') === label);
  expect(b, 'switch "' + label + '"').toBeTruthy();
  return b;
};
const flip = (b) => { b.checked = !b.checked; b.dispatchEvent(new Event('change')); };

beforeEach(boot);

describe('a visible switch for the flag the feature really reads', () => {
  it('Password page check', () => {
    const { CredentialInterlock: C } = fresh(JS + 'credential-interlock.js');
    const b = box(section('credential-interlock'), 'Ask before I type a password on a lookalike address');
    expect(b.checked).toBe(true);
    flip(b);
    expect(localStorage.getItem('vex.credGuard.enabled')).toBe('0');
    expect(C.enabled()).toBe(false);
    flip(b);
    expect(C.enabled()).toBe(true);
  });

  it('Update self-test', () => {
    const { VexSelfTest: T } = fresh(JS + 'post-update-selftest.js');
    const el = section('update-self-test');
    const b = box(el, 'Check after each update');
    flip(b);
    expect(T.enabled()).toBe(false);
    expect(localStorage.getItem(T.ENABLED_KEY)).toBe('0');
    expect([...el.querySelectorAll('button')].map(x => x.textContent)).toContain('Run the check now');
  });

  it('Sign-in: why you were signed out gets a section, a switch and the explainer button', () => {
    const { VexSignoutWhy: W } = fresh(JS + 'signout-why-ui.js');
    window.vex = { signoutWhy: vi.fn(async () => ({ lines: [], watching: 2, windowDays: 30, domain: '' })) };
    window.vexAlert = vi.fn(async () => {});
    const el = section('signout-why');
    expect(defs.get('signout-why').title.startsWith('Sign-in')).toBe(true);   // the manifest group, so Feature usage hides the right section
    flip(box(el, 'Say why, once, after a saved password signs me in again'));
    expect(W.enabled()).toBe(false);
    el.querySelector('button').click();
    return Promise.resolve().then(() => expect(window.vex.signoutWhy).toHaveBeenCalled());
  });

  it('Release check: a master switch for the flag the command and adapter read, and the hold switch follows it', () => {
    const { VexReleaseChecklist: R } = fresh(JS + 'release-checklist.js');
    const el = section('release-check');
    const master = box(el, 'Use the release check');
    const hold = box(el, 'Hold this version\'s new features until I tick them');
    expect(master.checked).toBe(true);
    expect(hold.disabled).toBe(false);
    flip(master);
    expect(localStorage.getItem(R.PREF)).toBe('off');
    expect(R.enabled()).toBe(false);
    expect(hold.disabled).toBe(true);
    flip(master);
    expect(R.enabled()).toBe(true);
    expect(hold.disabled).toBe(false);
  });

  it('What am I signed in to / If something went wrong: the switch also stops the tool', async () => {
    const { VexSignedIn: S } = fresh(JS + 'signed-in-ui.js');
    const { VexIncident: I } = fresh(JS + 'incident-playbooks.js');
    flip(box(section('signed-in'), 'Use this tool'));
    flip(box(section('incident-playbooks'), 'Use the checklists'));
    expect(S.enabled()).toBe(false);
    expect(I.enabled()).toBe(false);
    await expect(S.open()).rejects.toThrow(/switched off.*Settings > What am I signed in to/);
    await expect(S.killPrompt()).rejects.toThrow(/switched off/);
    await expect(I.open()).rejects.toThrow(/switched off.*Settings > If something went wrong/);
  });

  it('First-use cards', () => {
    const { VexFeatureSheet: F } = fresh(JS + 'feature-sheet.js');
    globalThis.VexRegistry = { all: () => [] };
    const el = section('feature-sheet');
    const b = box(el, 'Show a short card the first time I use a new feature');
    flip(b);
    expect(F.enabled()).toBe(false);
    expect(localStorage.getItem(F.PREF)).toBe('off');
  });

  it('Long documents, Knowledge citations, Volume kept per site', () => {
    const { VexLongDoc: L } = fresh(JS + 'longdoc-engine.js');
    const { VexAnswerCitations: A } = fresh(JS + 'answer-citations.js');
    const { MasterVolume: V } = fresh(JS + 'master-volume.js');
    flip(box(section('longdoc-engine'), 'Read long texts in pieces'));
    flip(box(section('answer-citations'), 'Check answers against their sources'));
    flip(box(section('site-volume'), 'Remember the volume for each site'));
    expect(L.enabled()).toBe(false);
    expect(A.enabled()).toBe(false);
    expect(V.siteMemoryEnabled()).toBe(false);
    for (const [id, group] of [['longdoc-engine', 'Long documents'], ['answer-citations', 'Knowledge'], ['site-volume', 'Volume']]) {
      expect(defs.get(id).title.startsWith(group), id).toBe(true);
    }
  });
});
