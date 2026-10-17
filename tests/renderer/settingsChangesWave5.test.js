// @vitest-environment jsdom
//
// T3-038, Wave 5: "What I changed" also shows the Settings sections you open most, and the Setup Gallery
// shows what a saved setup would change before it applies it.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
let C, G;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  ({ VexChanges: C } = fresh(JS + 'settings-changes.js'));
  globalThis.VexChanges = C;
  window.showToast = vi.fn();
  delete globalThis.Onboarding;
});

describe('the sections you open most', () => {
  it('counts a chip press and lists the sections pressed twice or more, most first', () => {
    for (let i = 0; i < 3; i++) C.noteSection('appearance', 'Appearance');
    C.noteSection('downloads', 'Downloads'); C.noteSection('downloads', 'Downloads');
    C.noteSection('privacy', 'Privacy');
    expect(C.mostUsed().map(s => [s.key, s.n])).toEqual([['appearance', 3], ['downloads', 2]]);
  });
  it('is off when What I changed is off, and forgets on request', () => {
    C.setEnabled(false);
    expect(C.noteSection('appearance', 'Appearance')).toBe(false);
    C.setEnabled(true);
    C.noteSection('a', 'A'); C.noteSection('a', 'A');
    expect(C.mostUsed()).toHaveLength(1);
    C.clearSections();
    expect(C.mostUsed()).toEqual([]);
  });
  it('keeps at most 60 sections and raises on a damaged record', () => {
    for (let i = 0; i < 70; i++) C.noteSection('s' + i, 'S' + i);
    expect(Object.keys(C.sectionsRecord()).length).toBe(60);
    localStorage.setItem(C.SECTIONS_KEY, '{nope');
    expect(() => C.mostUsed()).toThrow(/could not be read/);
  });
  it('opens Settings and presses the chip with that key', () => {
    const opened = [];
    globalThis.SidebarManager = { openPanel: (id) => opened.push(id) };
    document.body.innerHTML = '<button class="set-nav-chip" data-nav-key="appearance"></button>';
    const chip = document.querySelector('.set-nav-chip');
    chip.click = vi.fn();
    C.openSectionByKey('appearance');
    expect(opened).toEqual(['settings']);
    expect(chip.click).toHaveBeenCalledTimes(1);
  });
  it('the settings chips call noteSection', () => {
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../../src/renderer/js/settings-ui.js'), 'utf8');
    expect(src.match(/SettingsUI\._countChip\(/g).length).toBe(2);
    expect(src).toMatch(/VexChanges\.noteSection\(key, name\)/);
  });
});

describe('what a saved setup would change', () => {
  const base = { theme: 'dark', glass: false, hidden: ['notes'], shortcuts: null, skin: { pattern: 'none', shape: 'round', glow: 'off', strength: 'low' }, font: { ui: 'outfit', mono: 'mono1' } };
  beforeEach(() => { globalThis.Onboarding = { _APP_PANELS: () => [{ id: 'notes', name: 'Notes' }, { id: 'spotify', name: 'Spotify' }] }; });
  it('is empty for the same setup', () => {
    expect(C.setupDiff(base, JSON.parse(JSON.stringify(base)))).toEqual([]);
  });
  it('names each part that differs', () => {
    const next = { theme: 'ocean', glass: true, hidden: ['spotify'], shortcuts: [{ name: 'A', url: 'https://a.example' }], skin: { pattern: 'dots', shape: 'round', glow: 'off', strength: 'low' }, font: { ui: 'serif', mono: 'mono1' } };
    const lines = C.setupDiff(base, next);
    expect(lines).toContain('Theme: dark to ocean');
    expect(lines).toContain('Look: Classic to Glass');
    expect(lines).toContain('Hidden panels: Spotify');
    expect(lines).toContain('Panels shown again: Notes');
    expect(lines).toContain('Shortcut bar: the stock set to 1 shortcuts');
    expect(lines).toContain('Skin pattern: none to dots');
    expect(lines).toContain('Font: outfit to serif');
    expect(lines.some(l => /Code font|Skin shape/.test(l))).toBe(false);
  });
  it('raises without two setups, and previewSetup refuses a code that is not one', () => {
    expect(() => C.setupDiff(null, base)).toThrow(/no setup/);
    globalThis.Onboarding._decodeSetupCode = () => null;
    expect(() => C.previewSetup('nonsense')).toThrow(/not a valid setup code/);
  });
  it('previewSetup compares the code with the setup in front', () => {
    globalThis.Onboarding._encodeSetupCode = () => 'current';
    globalThis.Onboarding._decodeSetupCode = (c) => (c === 'current' ? base : { ...base, theme: 'ocean' });
    expect(C.previewSetup('other')).toEqual(['Theme: dark to ocean']);
    expect(C.previewSetup('current')).toEqual([]);
  });
});

describe('the Setup Gallery asks first', () => {
  beforeEach(() => {
    window.SetupGallery = undefined;
    fresh(JS + 'setup-gallery.js');
    G = window.SetupGallery;
    window.vexConfirm = vi.fn(async () => true);
  });
  it('shows the lines in the confirm and goes ahead on Apply', async () => {
    globalThis.VexChanges = { previewSetup: () => ['Theme: dark to ocean'] };
    expect(await G._confirmApply('code', 'Gaming')).toBe(true);
    const arg = window.vexConfirm.mock.calls[0][0];
    expect(arg.title).toMatch(/Gaming/);
    expect(arg.message).toContain('- Theme: dark to ocean');
  });
  it('does not ask when nothing would change, and says so', async () => {
    globalThis.VexChanges = { previewSetup: () => [] };
    expect(await G._confirmApply('code', 'Gaming')).toBe(false);
    expect(window.vexConfirm).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalled();
  });
  it('says why when the code cannot be compared, and stops', async () => {
    globalThis.VexChanges = { previewSetup: () => { throw new Error('That is not a valid setup code'); } };
    expect(await G._confirmApply('bad', 'X')).toBe(false);
    expect(window.showToast.mock.calls[0][1]).toBe('error');
  });
  it('applies as before when the reader is not loaded', async () => {
    delete globalThis.VexChanges;
    expect(await G._confirmApply('code', 'X')).toBe(true);
  });
});
