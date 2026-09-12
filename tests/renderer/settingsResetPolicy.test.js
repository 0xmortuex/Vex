// @vitest-environment jsdom
//
// Settings › Data › "Reset to Defaults".
//
// It used to delete EVERY 'vex.*' localStorage key, which took bookmarks,
// notes, skills, boosts, the reading list, saved shortcuts and the "never save a
// password here" list with it — while the settings it claimed to reset live in
// settings.json and were left completely untouched. So it destroyed data and
// reset nothing.
//
// The fix is an explicit allow-list of preference keys in app.js. This test
// reads that list out of the source (it is the policy, and the policy is the
// thing that regressed) and checks it against both sides: no user content may
// appear on it, and every key a Settings control writes must.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appSrc = readFileSync(resolve(process.cwd(), 'src/renderer/js/app.js'), 'utf8');

function settingsPrefKeys() {
  const m = appSrc.match(/const SETTINGS_PREF_KEYS = \[([\s\S]*?)\];/);
  if (!m) throw new Error('SETTINGS_PREF_KEYS not found in app.js — the reset allow-list is gone');
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
}

// Keys that hold things the user made or collected. A reset must never touch
// these — losing them is not "back to defaults", it is data loss.
const USER_CONTENT_KEYS = [
  'vex.bookmarks', 'vex.notes', 'vex.history', 'vex.sessions', 'vex.tabs',
  'vex.skills', 'vex.boosts', 'vex.chains', 'vex.readLater', 'vex.archivedTabs',
  'vex.annotations', 'vex.pwNever', 'vex.aiMemory', 'vex.mcpServers',
  'vex.focusBlocklist', 'vex.shortcuts', 'vex.workspaceSnapshots', 'vex.downloads',
  'vex.autofillLog', 'vex.searchKeywords',
];

// Keys a control in the Settings panel writes; a reset that misses one leaves
// the setting stuck on the old value.
const PREFERENCE_KEYS = [
  'vex.searchEngine', 'vex.tabLayout', 'vex.guiStyle', 'vex.guiColors', 'vex.theme',
  'vex.memorySaver', 'vex.autoGroupSuggest', 'vex.autoAddToGroups',
  'vex.aiIndexingEnabled', 'vex.emailCodeHiddenReader', 'vex.emailCodeAutoSubmit',
  'vex.gesturesEnabled', 'vex.consentBlock', 'vex.copyUnlock',
  'vex.passkeySuppressedHosts', 'vex.a11y', 'vex.recall.enabled',
  'vex.autoArchiveDays', 'vex.locationMode', 'vex.userName', 'vex.githubUsername',
  'vex.weatherLoc', 'vex.aiWorkerUrl', 'vex.syncWorkerUrl',
  'vex.preferLocalAI', 'vex.forceCloudAI', 'vex.localAIModel', 'vex.aiRouting',
  'vex.preferOnDeviceAI', 'vex.webllmModel', 'vex.panelOverrides', 'vex.sidebarOrder',
];

describe('Reset to Defaults key policy', () => {
  it('never lists a key that holds user content', () => {
    const keys = settingsPrefKeys();
    expect(keys.filter(k => USER_CONTENT_KEYS.includes(k))).toEqual([]);
  });

  it('covers every preference a Settings control writes', () => {
    const keys = settingsPrefKeys();
    expect(PREFERENCE_KEYS.filter(k => !keys.includes(k))).toEqual([]);
  });

  it('leaves user content in place when the listed keys are cleared', () => {
    localStorage.clear();
    for (const k of USER_CONTENT_KEYS) localStorage.setItem(k, '["kept"]');
    for (const k of PREFERENCE_KEYS) localStorage.setItem(k, 'set-by-user');
    settingsPrefKeys().forEach(k => localStorage.removeItem(k));
    expect(USER_CONTENT_KEYS.filter(k => localStorage.getItem(k) === null)).toEqual([]);
    expect(PREFERENCE_KEYS.filter(k => localStorage.getItem(k) !== null)).toEqual([]);
  });

  it('does not enumerate localStorage to decide what to delete', () => {
    const handler = appSrc.slice(
      appSrc.indexOf("document.getElementById('setting-reset')"),
      appSrc.indexOf("// === Phase 12: AI History Indexing settings ==="),
    );
    expect(handler).not.toMatch(/localStorage\.key\(/);
    expect(handler).not.toMatch(/localStorage\.length/);
    // The real settings live in settings.json, so the reset has to write them.
    expect(handler).toMatch(/VexStorage\.saveSettings\(/);
  });
});

describe('settings applied at boot, not only on click', () => {
  it('pushes the stored ad-blocker choice to main at startup', () => {
    // main starts every launch with the blocker ON; without this the toggle read
    // OFF while ads were still being blocked, and OFF never survived a restart.
    const block = appSrc.slice(appSrc.indexOf('adBlockerToggle.checked = settings.adBlocker'), appSrc.indexOf('searchEngineSelect.addEventListener'));
    expect(block).toMatch(/window\.vex\.setAdBlockerState\(adBlockerToggle\.checked\)/);
  });

  it('starts the auto-save timer from the stored value at startup', () => {
    const block = appSrc.slice(appSrc.indexOf("const autosaveToggle ="), appSrc.indexOf("// Settings buttons"));
    expect(block).toMatch(/applyAutoSave\(autosaveToggle\.checked\);/);
    // and clears any previous timer before re-arming, so toggling cannot leak one
    expect(block).toMatch(/clearInterval\(window\._autoSaveInterval\)/);
  });
});
