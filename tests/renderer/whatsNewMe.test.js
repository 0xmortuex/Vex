// @vitest-environment jsdom
//
// T3-026: "What's new for me" with Try-it buttons (js/whats-new-me.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let VexWhatsNewMe, openSection;

const RELEASES = [
  { version: '22.24.6', name: 'v22.24.6 — Still mode', body: '- **Ctrl+K no longer opens a blurred screen**: fixed while kept still.\n- **Battery saver holds more**: the battery saver now holds background work too.' },
  { version: '22.22.1', name: 'v22.22.1 — News', body: '- **AI News in English by default**: and dated.\n- **Discord screen sharing works again**: after the last change.' },
  { version: '22.20.0', name: 'v22.20.0 — Old', body: '- **Something old**: nothing to see.' },
];

function page() {
  document.body.innerHTML = '<div id="settings-battery"></div><div id="settings-ainews"></div><div id="vex-sg-park-resume"></div>';
}

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  page();
  window.showToast = vi.fn();
  openSection = vi.fn();
  globalThis.SettingsUI = { openSection };
  ({ VexUpdateNotes: globalThis.VexUpdateNotes } = fresh(JS + 'update-log.js'));
  globalThis.VexSettingsGroups = {
    register: () => {},
    button: (text, fn) => { const b = document.createElement('button'); b.textContent = text; b.addEventListener('click', fn); return b; },
    note: (t) => { const d = document.createElement('div'); d.textContent = t; return d; },
    dialog: () => { const body = document.createElement('div'); document.body.appendChild(body); return { body, close: () => body.remove() }; },
  };
  window.vex = { getAppVersion: async () => '22.24.6', getReleaseList: async () => RELEASES };
  ({ VexWhatsNewMe } = fresh(JS + 'whats-new-me.js'));
  delete globalThis.VexRegistry;
});

describe('tryItFor', () => {
  it('finds a Settings section from the words of a point, only when it is on the page', () => {
    expect(VexWhatsNewMe.tryItFor('Battery saver holds more')).toBe('settings-battery');
    expect(VexWhatsNewMe.tryItFor('AI News in English by default')).toBe('settings-ainews');
    expect(VexWhatsNewMe.tryItFor('Pet gets a new hat')).toBe('');
    document.getElementById('settings-battery').remove();
    expect(VexWhatsNewMe.tryItFor('Battery saver holds more')).toBe('');
  });

  it('prefers a feature from the registry when its title is in the point and its group exists', () => {
    globalThis.VexRegistry = { all: () => [{ id: 'park-resume', title: 'Park and resume' }] };
    expect(VexWhatsNewMe.tryItFor('Park and resume now remembers the scroll position')).toBe('vex-sg-park-resume');
  });
});

describe('pending', () => {
  it('shows only the current version the first time', async () => {
    const p = await VexWhatsNewMe.pending();
    expect(p.from).toBe('');
    expect(p.releases.map(r => r.version)).toEqual(['22.24.6']);
  });

  it('shows every release after the one last looked at, newest first, and none of the older', async () => {
    VexWhatsNewMe.markSeen('22.20.0');
    const p = await VexWhatsNewMe.pending();
    expect(p.releases.map(r => r.version)).toEqual(['22.24.6', '22.22.1']);
    expect(p.releases[0].points.map(x => x.text)).toContain('Battery saver holds more');
    expect(p.releases[0].points.find(x => /Battery/.test(x.text)).section).toBe('settings-battery');
    expect(p.releases[1].points.find(x => /Discord/.test(x.text)).section).toBe('');
  });

  it('says nothing is new once everything was seen', async () => {
    VexWhatsNewMe.markSeen('22.24.6');
    expect((await VexWhatsNewMe.pending()).releases).toEqual([]);
  });

  it('raises when the release list is not available', async () => {
    window.vex = {};
    await expect(VexWhatsNewMe.pending()).rejects.toThrow(/not available/);
  });
});

describe('open', () => {
  it('draws a Try it button only for a point with a section, and it opens that section', async () => {
    VexWhatsNewMe.markSeen('22.20.0');
    await VexWhatsNewMe.open();
    const tries = [...document.querySelectorAll('button')].filter(b => b.textContent === 'Try it');
    expect(tries).toHaveLength(2);
    tries[0].click();
    expect(openSection).toHaveBeenCalledTimes(1);
    expect(['settings-battery', 'settings-ainews']).toContain(openSection.mock.calls[0][0]);
  });

  it('moves the note up only when "Mark all as seen" is pressed', async () => {
    VexWhatsNewMe.markSeen('22.20.0');
    await VexWhatsNewMe.open();
    expect(VexWhatsNewMe.seen()).toBe('22.20.0');
    [...document.querySelectorAll('button')].find(b => b.textContent === 'Mark all as seen').click();
    expect(VexWhatsNewMe.seen()).toBe('22.24.6');
  });

  it('does nothing while switched off', async () => {
    VexWhatsNewMe.setEnabled(false);
    expect(await VexWhatsNewMe.open()).toBeNull();
  });
});
