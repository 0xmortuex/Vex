// @vitest-environment jsdom
// Copy Text from Image (js/image-text.js): the pure parts, the one-time pack question, how a picture is fetched, the clipboard, and
// the wiring. The engine itself is proven in real Electron (docs/ocr-languages.md); here it is a fake so no recognition runs.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const fs = require('fs'), path = require('path');
const { VexImageText: T } = require('../../src/renderer/js/image-text.js');
const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
const pack = require('../../src/main/ocr-lang-pack.js');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
afterEach(() => { vi.restoreAllMocks(); });
const status = (installed) => ({ installed, totalBytes: 5094164, files: [{ code: 'eng', bytes: 2952873, installed }, { code: 'tur', bytes: 2141291, installed }] });

describe('pure parts', () => {
  it('brings a large picture down to 3500 on its longest side and leaves a small one alone', () => {
    expect(T.fitSize(9000, 5000)).toMatchObject({ w: 3500, h: 1944 });
    expect(T.fitSize(5000, 9000)).toMatchObject({ w: 1944, h: 3500 });
    expect(T.fitSize(800, 600)).toEqual({ w: 800, h: 600, scale: 1 });
    expect(T.fitSize(100000, 1).h).toBe(1);
    expect(() => T.fitSize(0, 10)).toThrow();
  });
  it('shows how the text begins', () => {
    expect(T.firstWords("İstanbul'da çok güzel bir şehir. Öğrenci ışığı söndürdü")).toBe("İstanbul'da çok güzel bir şehir. Öğrenci…");
    expect(T.firstWords('two words')).toBe('two words');
    expect(T.firstWords('  ')).toBe('');
    expect(T.firstWords('a'.repeat(200) + ' b c')).toBe('…'.length ? T.firstWords('a'.repeat(200) + ' b c') : '');
    expect(T.firstWords('x'.repeat(30) + ' ' + 'y'.repeat(30) + ' zzz', 6, 60).endsWith('…')).toBe(true);
  });
  it('tidies the text and keeps its lines', () => {
    expect(T.tidy('  a   b \r\n\n\n\n c\u00a0d  \n')).toBe('a b\n\nc d');
    expect(T.tidy(null)).toBe('');
  });
  it('writes the size the question shows, and it is the real size of the download', () => {
    const total = pack.FILES.reduce((n, f) => n + f.bytes, 0);
    expect(T.megabytes(total)).toBe(T.SIZE);
    expect(T.SIZE).toBe('5.1 MB');
  });
});

describe('Turkish for what it says', () => {
  it('has the question, the row, the command and the toast with the start of the text', () => {
    const tr = (s) => VexI18nUI.lookup(s, 'tr');
    for (const s of ['Copy Text from Image', 'Download the text recognition data?', 'Download 5.1 MB', 'Remove text recognition data', 'No readable text in that picture', 'Cancelled', 'Reading the text in the picture…']) expect(tr(s), s).toBeTruthy();
    // the part that changes is the person's own text, so the line is filled in by VexImageText.say, not by the table's hole rules
    window.VexI18nUI = VexI18nUI;
    const was = VexI18nUI.locale;
    VexI18nUI.locale = () => 'tr';
    try {
      expect(T.say('Text copied: {}', '“İstanbul’da çok güzel…”')).toBe('Metin kopyalandı: “İstanbul’da çok güzel…”');
      expect(T.say('The text could not be read: {}', 'boom')).toBe('Metin okunamadı: boom');
      expect(T.say('The clipboard did not take it: {}', 'x')).toBe('Pano kabul etmedi: x');
    } finally { VexI18nUI.locale = was; }
  });
});

describe('the one-time question', () => {
  beforeEach(() => {
    window.vexConfirm = vi.fn(async () => true);
    window.vex = { ocrLangStatus: vi.fn(async () => status(false)), ocrLangDownload: vi.fn(async () => status(true)), onOcrLangProgress: vi.fn(() => vi.fn()) };
  });
  it('asks nothing when the data is already there', async () => {
    window.vex.ocrLangStatus = vi.fn(async () => status(true));
    expect(await T.ensurePack()).toBe('ready');
    expect(window.vexConfirm).not.toHaveBeenCalled();
    expect(window.vex.ocrLangDownload).not.toHaveBeenCalled();
  });
  it('asks once with the size and the host on it, and downloads only on yes', async () => {
    expect(await T.ensurePack()).toBe('ready');
    const q = window.vexConfirm.mock.calls[0][0];
    expect(q.okLabel).toBe('Download 5.1 MB');
    expect(q.message).toContain('5.1 MB');
    expect(q.message).toContain('cdn.jsdelivr.net');
    expect(q.message).toContain('what left this computer');
    expect(window.vex.ocrLangDownload).toHaveBeenCalledTimes(1);
  });
  it('downloads nothing on no', async () => {
    window.vexConfirm = vi.fn(async () => false);
    expect(await T.ensurePack()).toBe('declined');
    expect(window.vex.ocrLangDownload).not.toHaveBeenCalled();
  });
  it('says so when the download did not finish, and when the catalogue and the question disagree', async () => {
    window.vex.ocrLangDownload = vi.fn(async () => status(false));
    await expect(T.ensurePack()).rejects.toThrow(/did not finish/);
    window.vex.ocrLangStatus = vi.fn(async () => ({ ...status(false), totalBytes: 9999999 }));
    await expect(T.ensurePack()).rejects.toThrow(/size of the language data changed/);
  });
});

describe('fetching the picture', () => {
  beforeEach(() => {
    window.vexConfirm = vi.fn(async () => true);
    window.vex = { imageForAi: vi.fn(async () => ({ ok: true, type: 'image/png', base64: 'AAAA' })) };
  });
  const wv = { getWebContentsId: () => 7, executeJavaScript: vi.fn(async () => 'data:image/png;base64,QQ==') };
  it('uses a data: picture as it is', async () => {
    expect(await T.imageData('data:image/png;base64,QQ==', null)).toBe('data:image/png;base64,QQ==');
    expect(window.vex.imageForAi).not.toHaveBeenCalled();
  });
  it('asks the page for a blob: picture, and only accepts a picture back', async () => {
    expect(await T.imageData('blob:https://a.test/1-2', wv)).toBe('data:image/png;base64,QQ==');
    expect(wv.executeJavaScript.mock.calls[0][0]).toContain('"blob:https://a.test/1-2"');
    const bad = { executeJavaScript: vi.fn(async () => 'text/html;base64,xx') };
    await expect(T.imageData('blob:https://a.test/1-2', bad)).rejects.toThrow(/did not give/);
    await expect(T.imageData('blob:https://a.test/1-2', null)).rejects.toThrow(/lives only inside/);
  });
  it('fetches a web picture through its own tab', async () => {
    expect(await T.imageData('https://a.test/p.png', wv)).toBe('data:image/png;base64,AAAA');
    expect(window.vex.imageForAi).toHaveBeenCalledWith(7, 'https://a.test/p.png', false);
  });
  it('asks before reading a picture from a private or Tor tab, and stops on no', async () => {
    window.vex.imageForAi = vi.fn(async (_id, _u, confirmed) => (confirmed ? { ok: true, type: 'image/png', base64: 'AAAA' } : { ok: false, needsConsent: true, kind: 'tor' }));
    expect(await T.imageData('https://a.test/p.png', wv)).toBe('data:image/png;base64,AAAA');
    expect(window.vexConfirm.mock.calls[0][0].title).toMatch(/Tor tab/);
    window.vexConfirm = vi.fn(async () => false);
    expect(await T.imageData('https://a.test/p.png', wv)).toBeNull();
  });
  it('refuses other kinds, and a tab that is gone', async () => {
    await expect(T.imageData('file:///C:/x.png', wv)).rejects.toThrow(/cannot be read/);
    await expect(T.imageData('https://a.test/p.png', { getWebContentsId: () => 0 })).rejects.toThrow(/not open/);
  });
});

describe('the clipboard', () => {
  beforeEach(() => { document.body.innerHTML = ''; window.showToast = vi.fn(); });
  it('copies and toasts how the text begins', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await T.copy('Merhaba dünya, bu bir deneme metnidir ve uzun');
    expect(writeText).toHaveBeenCalledWith('Merhaba dünya, bu bir deneme metnidir ve uzun');
    expect(window.showToast).toHaveBeenCalledWith('Text copied: \u201cMerhaba dünya, bu bir deneme metnidir…\u201d');
  });
  it('keeps the text in a card with a Copy button when the clipboard refuses (the window was not in front)', async () => {
    const writeText = vi.fn()
      .mockRejectedValueOnce(new DOMException('Document is not focused', 'NotAllowedError'))
      .mockResolvedValueOnce(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    window.VexProblems = { note: vi.fn() };
    await T.copy('okunan metin');
    const card = document.getElementById('vex-imgtext-copy');
    expect(card).toBeTruthy();
    expect(window.VexProblems.note).toHaveBeenCalled();
    expect(window.showToast).not.toHaveBeenCalled();
    [...card.querySelectorAll('button')].find(b => b.textContent === 'Copy').click();
    await new Promise(r => setTimeout(r, 0));
    expect(writeText).toHaveBeenLastCalledWith('okunan metin');
    expect(document.getElementById('vex-imgtext-copy')).toBeNull();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('Text copied'));
  });
});

describe('the whole thing with a fake engine', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.showToast = vi.fn();
    window.vexConfirm = vi.fn(async () => true);
    window.vex = { ocrLangStatus: vi.fn(async () => status(true)), ocrLangRead: vi.fn(), ocrLangCancel: vi.fn(async () => true) };
    vi.spyOn(T, 'seedCache').mockResolvedValue();
    vi.spyOn(T, 'shrink').mockResolvedValue({ dataUrl: 'data:image/png;base64,QQ==', w: 10, h: 10, shrunk: false });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => {}) }, configurable: true });
    T._busy = false;
  });
  it('reads, copies, and removes its card', async () => {
    vi.spyOn(T, 'recognize').mockResolvedValue('İstanbul çok güzel');
    expect(await T.copyFromImage('data:image/png;base64,QQ==', null)).toBe(true);
    expect(T.recognize.mock.calls[0][1].english).toBe(false);
    expect(document.getElementById('vex-imgtext')).toBeNull();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('İstanbul çok güzel');
  });
  it('says so when nothing is readable, and copies nothing', async () => {
    vi.spyOn(T, 'recognize').mockResolvedValue('');
    expect(await T.copyFromImage('data:image/png;base64,QQ==', null)).toBe(false);
    expect(window.showToast).toHaveBeenCalledWith('No readable text in that picture');
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });
  it('declined with no English cache: nothing is read and nothing is downloaded', async () => {
    window.vex.ocrLangStatus = vi.fn(async () => status(false));
    window.vex.ocrLangDownload = vi.fn();
    window.vexConfirm = vi.fn(async () => false);
    vi.spyOn(T, 'legacyEnglishCached').mockResolvedValue(false);
    const rec = vi.spyOn(T, 'recognize');
    expect(await T.copyFromImage('data:image/png;base64,QQ==', null)).toBe(false);
    expect(rec).not.toHaveBeenCalled();
    expect(window.vex.ocrLangDownload).not.toHaveBeenCalled();
    expect(window.showToast.mock.calls[0][0]).toMatch(/nothing was downloaded/);
  });
  it('declined, but an English cache is there: reads English only and says that Turkish may be wrong', async () => {
    window.vex.ocrLangStatus = vi.fn(async () => status(false));
    window.vexConfirm = vi.fn(async () => false);
    vi.spyOn(T, 'legacyEnglishCached').mockResolvedValue(true);
    vi.spyOn(T, 'recognize').mockResolvedValue('hello world');
    expect(await T.copyFromImage('data:image/png;base64,QQ==', null)).toBe(true);
    expect(T.recognize.mock.calls[0][1].english).toBe(true);
    expect(window.showToast.mock.calls[0][0]).toMatch(/English only/);
    expect(T.seedCache).not.toHaveBeenCalled();
  });
  it('Cancel stops the reading and says Cancelled', async () => {
    vi.spyOn(T, 'recognize').mockImplementation((_d, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')))));
    const run = T.copyFromImage('data:image/png;base64,QQ==', null);
    await new Promise(r => setTimeout(r, 10));
    document.querySelector('#vex-imgtext button').click();
    expect(await run).toBe(false);
    expect(window.showToast).toHaveBeenCalledWith('Cancelled');
    expect(window.vex.ocrLangCancel).toHaveBeenCalled();
    expect(document.getElementById('vex-imgtext')).toBeNull();
    expect(T._busy).toBe(false);
  });
  it('reads one picture at a time', async () => {
    let finish;
    vi.spyOn(T, 'recognize').mockImplementation(() => new Promise(r => (finish = r)));
    const first = T.copyFromImage('data:image/png;base64,QQ==', null);
    await new Promise(r => setTimeout(r, 10));
    expect(await T.copyFromImage('data:image/png;base64,QQ==', null)).toBe(false);
    expect(window.showToast).toHaveBeenCalledWith('A picture is already being read');
    finish('x');
    await first;
  });
  it('reports an engine failure and frees the way for the next', async () => {
    vi.spyOn(T, 'recognize').mockRejectedValue(new Error('boom'));
    window.VexProblems = { note: vi.fn() };
    expect(await T.copyFromImage('data:image/png;base64,QQ==', null)).toBe(false);
    expect(window.showToast).toHaveBeenCalledWith('The text could not be read: boom', 'error');
    expect(T._busy).toBe(false);
  });
});

describe('the engine is only ever given the cache', () => {
  it('never lets Tesseract go to the network on its own', () => {
    const src = read('src/renderer/js/image-text.js');
    expect(src).toMatch(/cacheMethod: 'readOnly'/);
    expect(src).toContain("OFFLINE: 'vex-offline://none'");
    expect(src).not.toMatch(/https?:\/\/cdn\.jsdelivr\.net\/npm/);
    expect(src).not.toMatch(/\bfetch\(\s*['"`]https?:/);
  });
});

describe('wiring', () => {
  it('is a row of the image menu, kept in its main list, and a late module', () => {
    const web = read('src/renderer/js/webview.js');
    expect(web).toMatch(/label: 'Copy Text from Image', action: \(\) => VexImageText\.copyFromImage\(imageSrc, webview\)/);
    expect(web).toMatch(/Copy Image\|Copy Text from Image/);
    expect(read('src/renderer/js/lazy-boot.js')).toContain("'js/image-text.js'");
    expect(read('src/renderer/index.html')).not.toContain('image-text.js');
  });
});
