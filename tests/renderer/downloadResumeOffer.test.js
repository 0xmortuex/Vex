// The one-time offer to carry unfinished downloads on after a restart (js/download-resume-offer.js).
// Pure logic with fakes: the module is loaded without a window, so it starts nothing by itself.
import { describe, it, expect, vi } from 'vitest';

const fs = require('fs');
const path = require('path');
const { VexDownloadResumeOffer: O } = require('../../src/renderer/js/download-resume-offer.js');

const BIG = 50 * 1024 * 1024;
const fakes = ({ resume = false, muted = false, suggest = true } = {}) => {
  const attention = { isMuted: vi.fn(() => muted), suggest: vi.fn(() => suggest), mute: vi.fn() };
  const api = { downloadsPrefs: vi.fn(async () => ({ ok: true, resume })), downloadsSetResume: vi.fn(async (on) => ({ ok: true, resume: on })) };
  return { attention, api };
};

describe('which interruptions are worth the offer', () => {
  it('a big, resumable, normal download is', () => {
    expect(O.worthOffering({ totalBytes: BIG, canResume: true, ephemeral: false })).toBe(true);
  });
  it.each([
    [{ totalBytes: BIG, canResume: true, ephemeral: true }],
    [{ totalBytes: BIG, canResume: false }],
    [{ totalBytes: 1024, canResume: true }],
    [{ canResume: true }],
    [undefined],
  ])('%j is not', (detail) => { expect(O.worthOffering(detail)).toBe(false); });
});

describe('offering', () => {
  it('puts one row in the Inbox with a Turn on button, and mutes the feature so it is not offered again', async () => {
    const f = fakes();
    expect(await O.offer({ totalBytes: BIG, canResume: true }, f)).toBe(true);
    expect(f.attention.suggest).toHaveBeenCalledTimes(1);
    const row = f.attention.suggest.mock.calls[0][0];
    expect(row.feature).toBe('download-resume');
    expect(row.action).toEqual({ label: 'Turn on', key: 'turn-on' });
    expect(f.attention.mute).toHaveBeenCalledWith('download-resume', 'Downloads');
    expect(f.api.downloadsSetResume).not.toHaveBeenCalled();   // the offer never changes the setting itself
  });
  it('does nothing when the setting is already on', async () => {
    const f = fakes({ resume: true });
    expect(await O.offer({ totalBytes: BIG, canResume: true }, f)).toBe(false);
    expect(f.attention.suggest).not.toHaveBeenCalled();
  });
  it('does nothing once it has been offered (muted)', async () => {
    const f = fakes({ muted: true });
    expect(await O.offer({ totalBytes: BIG, canResume: true }, f)).toBe(false);
    expect(f.api.downloadsPrefs).not.toHaveBeenCalled();
  });
  it('does not mute when the Inbox did not take the row', async () => {
    const f = fakes({ suggest: false });
    expect(await O.offer({ totalBytes: BIG, canResume: true }, f)).toBe(false);
    expect(f.attention.mute).not.toHaveBeenCalled();
  });
  it('says so when main cannot report the setting, instead of guessing', async () => {
    const f = fakes();
    f.api.downloadsPrefs = vi.fn(async () => ({ ok: false, error: 'nope' }));
    await expect(O.offer({ totalBytes: BIG, canResume: true }, f)).rejects.toThrow('nope');
  });
});

describe('the button', () => {
  it('Turn on sets the preference through main and says so', async () => {
    const f = fakes();
    const toast = vi.fn();
    expect(await O.handle('turn-on', { api: f.api, toast })).toBe(true);
    expect(f.api.downloadsSetResume).toHaveBeenCalledWith(true);
    expect(toast).toHaveBeenCalledTimes(1);
  });
  it('an unknown key does nothing', async () => {
    const f = fakes();
    expect(await O.handle('other', { api: f.api })).toBe(false);
    expect(f.api.downloadsSetResume).not.toHaveBeenCalled();
  });
  it('a refusal from main is an error, not a silent success', async () => {
    const f = fakes();
    f.api.downloadsSetResume = vi.fn(async () => ({ ok: false, error: 'refused' }));
    await expect(O.handle('turn-on', { api: f.api })).rejects.toThrow('refused');
  });
});

describe('wiring', () => {
  const root = path.resolve(__dirname, '../..');
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  it('the panel announces the interruption, this file listens, and the default stays off', () => {
    expect(read('src/renderer/js/downloads-panel.js')).toMatch(/vex:download-interrupted/);
    expect(read('src/renderer/js/download-resume-offer.js')).toMatch(/addEventListener\('vex:download-interrupted'/);
    expect(read('src/main/download-prefs.js')).toMatch(/resume: false/);
  });
  it('is a late module, not a blocking script', () => {
    expect(read('src/renderer/js/lazy-boot.js')).toMatch(/js\/download-resume-offer\.js/);
    expect(read('src/renderer/index.html')).not.toMatch(/download-resume-offer\.js/);
  });
});
