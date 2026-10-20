// @vitest-environment jsdom
//
// The setup wizard coming back by itself (js/onboarding.js maybeOfferAgain): a month after it last ran or was offered, and when Vex was
// uninstalled by hand and installed again; never after an update. The uninstaller note itself (build/installer.nsh) needs the real
// installer to run, and is NOT proven here; what is pinned down is everything the app does with it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
require('../../src/renderer/js/geo-search.js');
require('../../src/renderer/js/typed-address.js');
globalThis.SponsorSkip = require('../../src/renderer/js/sponsor-skip.js').SponsorSkip;
const { Onboarding } = require('../../src/renderer/js/onboarding.js');
globalThis.VexSimpleMode = require('../../src/renderer/js/simple-mode.js').VexSimpleMode;

const DAY = 86400000;
const NOW = new Date(2026, 9, 20, 12, 0, 0).getTime();
let relaunch, marker;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  globalThis.WebviewManager = { webviews: new Map() };
  localStorage.setItem('vex.onboardingDone', 'true');
  relaunch = vi.spyOn(Onboarding, 'relaunch').mockImplementation(() => {});
  marker = vi.fn(async () => false);
  window.vex = { takeUninstallMarker: marker };
  delete window.VexTabPolicy;
});
afterEach(() => { relaunch.mockRestore(); vi.useRealTimers(); delete window.vex; delete window.VexTabPolicy; });

describe('a month after it last ran', () => {
  it('is not offered before a month is up', async () => {
    Onboarding.noteRan(NOW - 29 * DAY);
    expect(await Onboarding.maybeOfferAgain({ now: NOW })).toBeNull();
    vi.advanceTimersByTime(5000);
    expect(relaunch).not.toHaveBeenCalled();
  });
  it('is offered once a month has passed, as the short version, and starts the next month', async () => {
    Onboarding.noteRan(NOW - 31 * DAY);
    expect(await Onboarding.maybeOfferAgain({ now: NOW })).toBe('month');
    vi.advanceTimersByTime(2000);
    expect(relaunch).toHaveBeenCalledWith({ pace: 'quick' });
    expect(Onboarding.lastRan()).toBe(NOW);
    relaunch.mockClear();
    expect(await Onboarding.maybeOfferAgain({ now: NOW + DAY })).toBeNull();   // not again tomorrow
  });
  it('is exactly thirty days', () => {
    expect(Onboarding.monthDue(NOW, NOW - 30 * DAY)).toBe(true);
    expect(Onboarding.monthDue(NOW, NOW - 30 * DAY + 1)).toBe(false);
  });
  it('a profile from before this starts its month on its first start, and nobody is surprised', async () => {
    expect(Onboarding.lastRan()).toBe(0);
    expect(await Onboarding.maybeOfferAgain({ now: NOW })).toBeNull();
    expect(Onboarding.lastRan()).toBe(NOW);
    vi.advanceTimersByTime(5000);
    expect(relaunch).not.toHaveBeenCalled();
  });
  it('can be switched off in Settings, and back on', async () => {
    Onboarding.setAgainOn(false);
    expect(Onboarding.againOn()).toBe(false);
    Onboarding.noteRan(NOW - 90 * DAY);
    expect(await Onboarding.maybeOfferAgain({ now: NOW })).toBeNull();
    Onboarding.setAgainOn(true);
    expect(Onboarding.againOn()).toBe(true);
    expect(await Onboarding.maybeOfferAgain({ now: NOW })).toBe('month');
  });
  it('is on until someone says otherwise', () => {
    expect(Onboarding.againOn()).toBe(true);
  });
  it('finishing or skipping the setup restarts the month', () => {
    Onboarding.noteRan(NOW - 40 * DAY);
    const before = Onboarding.lastRan();
    Onboarding.finish();
    expect(Onboarding.lastRan()).toBeGreaterThan(before);
  });
});

describe('after Vex was uninstalled by hand', () => {
  it('offers the setup even though a month has not passed, and reads the note once', async () => {
    Onboarding.noteRan(NOW - DAY);
    marker.mockResolvedValueOnce(true);
    expect(await Onboarding.maybeOfferAgain({ now: NOW })).toBe('uninstall');
    vi.advanceTimersByTime(2000);
    expect(relaunch).toHaveBeenCalledWith({ pace: 'quick' });
    expect(marker).toHaveBeenCalledTimes(1);
  });
  it('offers it even when the monthly offer is switched off (only the month is a choice)', async () => {
    Onboarding.setAgainOn(false);
    Onboarding.noteRan(NOW - DAY);
    marker.mockResolvedValueOnce(true);
    expect(await Onboarding.maybeOfferAgain({ now: NOW })).toBe('uninstall');
  });
  it('does nothing when there is no note, which is what every update looks like', async () => {
    Onboarding.noteRan(NOW - DAY);
    marker.mockResolvedValue(false);
    expect(await Onboarding.maybeOfferAgain({ now: NOW })).toBeNull();
    vi.advanceTimersByTime(5000);
    expect(relaunch).not.toHaveBeenCalled();
  });
  it('says so when the note cannot be read, rather than guessing', async () => {
    marker.mockRejectedValueOnce(new Error('disk said no'));
    await expect(Onboarding.maybeOfferAgain({ now: NOW })).rejects.toThrow('disk said no');
  });
  it('works where there is no way to ask (a browser tab of the page, an older build)', async () => {
    delete window.vex;
    Onboarding.noteRan(NOW - 31 * DAY);
    expect(await Onboarding.maybeOfferAgain({ now: NOW })).toBe('month');
  });
});

describe('when it must not start', () => {
  it('not on a first run, which maybeStart owns', async () => {
    localStorage.removeItem('vex.onboardingDone');
    marker.mockResolvedValue(true);
    expect(await Onboarding.maybeOfferAgain({ now: NOW })).toBeNull();
    expect(marker).not.toHaveBeenCalled();                        // and the note is left for the real first run's turn
  });
  it('not in a private window', async () => {
    window.VexTabPolicy = { isPrivateWindow: true };
    Onboarding.noteRan(NOW - 99 * DAY);
    expect(await Onboarding.maybeOfferAgain({ now: NOW })).toBeNull();
    expect(marker).not.toHaveBeenCalled();
  });
});

describe('the short version', () => {
  it('relaunch takes the short pace when asked, and the whole wizard otherwise', () => {
    relaunch.mockRestore();
    const render = vi.spyOn(Onboarding, '_render').mockImplementation(() => {});
    document.body.innerHTML = '';
    Onboarding.relaunch({ pace: 'quick' });
    expect(Onboarding._pace).toBe('quick');
    const quick = Onboarding.activeSteps.length;
    Onboarding.relaunch();
    expect(Onboarding._pace).toBe('full');
    expect(Onboarding.activeSteps.length).toBeGreaterThan(quick);
    render.mockRestore();
    relaunch = vi.spyOn(Onboarding, 'relaunch').mockImplementation(() => {});
  });
});

describe('the wiring', () => {
  const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  it('is asked at every start, after the first-run check', () => {
    const app = read('src/renderer/js/app.js');
    expect(app).toMatch(/Onboarding\.maybeStart\(\);\n[^\n]*\n\s*if \(typeof Onboarding !== 'undefined'\) Onboarding\.maybeOfferAgain\(\)\.catch\(/);
  });
  it('has a channel in the policy, the schemas, main and the preload', () => {
    expect(read('src/main/ipc-policy.js')).toContain("'setup:take-uninstall-marker'");
    expect(read('src/main/ipc-schemas.js')).toContain("define('setup:take-uninstall-marker', []);");
    const main = read('src/main.js');
    expect(main).toContain("ipcMain.handle('setup:take-uninstall-marker'");
    expect(main).toContain("'vex-uninstalled.flag'");
    expect(main).toMatch(/err\.code === 'ENOENT'\) return false; throw err;/);        // a missing note is "no"; any other failure is said
    expect(read('src/preload.js')).toContain("takeUninstallMarker: () => ipcRenderer.invoke('setup:take-uninstall-marker')");
  });
  it('the uninstaller writes the note only for a visible uninstall, never for an update or an installer replacing an older one', () => {
    const nsh = read('build/installer.nsh');
    const macro = nsh.slice(nsh.indexOf('!macro customUnInstall'));
    expect(macro).toContain('${ifNot} ${isUpdated}');
    expect(macro).toContain('${ifNot} ${Silent}');
    expect(macro).toContain('vex-uninstalled.flag');
    // both conditions wrap the write, in that order
    expect(macro.indexOf('${ifNot} ${isUpdated}')).toBeLessThan(macro.indexOf('${ifNot} ${Silent}'));
    expect(macro.indexOf('${ifNot} ${Silent}')).toBeLessThan(macro.indexOf('FileOpen'));
    // the updater really does pass both, so an in-app update can never leave the note
    const updates = read('src/main/updates.js');
    expect(updates).toContain("['--updated', '/S', '--force-run']");
  });
  it('the note and the app agree on the folder and the file name', () => {
    expect(read('build/installer.nsh')).toContain('$APPDATA\\vex\\vex-uninstalled.flag');
    expect(read('src/main.js')).toContain("path.join(app.getPath('userData'), 'vex-uninstalled.flag')");
  });
  it('has a switch in Settings, wired and reset with the others', () => {
    expect(read('src/renderer/index.html')).toContain('id="setting-setup-again"');
    const app = read('src/renderer/js/app.js');
    expect(app).toContain("document.getElementById('setting-setup-again')");
    expect(app).toContain("'vex.setupAgainOff'");
  });
});
