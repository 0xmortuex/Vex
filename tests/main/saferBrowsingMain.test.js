// Wave 3 security (main side): cheat/fake-update guard (T3-010), mark of the web (T3-111),
// the Defender shortcut (T3-110) and chat-origin detection (T3-100/102).
import { describe, it, expect, vi } from 'vitest';

const ws = require('../../src/main/web-safety.js');
const { inspectName } = require('../../src/main/download-guard.js');
const { createMarkOfTheWeb } = require('../../src/main/mark-of-the-web.js');
const { createDefenderShortcut, DEFENDER_URI } = require('../../src/main/defender-shortcut.js');
const { chatOf, chatLinkFrom } = require('../../src/main/chat-origin.js');
const { createDownloadTidy } = require('../../src/main/download-tidy.js');

const judge = (filename, url, o) => ws.classifyDownload({ filename, url }, { sensitivity: 'standard', ...(o || {}) });

describe('cheat tools and fake updates (T3-010)', () => {
  it('holds an executor with an explanation, from any host', () => {
    const r = judge('Delta Executor v2.exe', 'https://cdn.discordapp.com/attachments/1/2/Delta%20Executor%20v2.exe');
    expect(r.warn).toBe(true);
    expect(r.kind).toBe('cheat-tool');
    expect(r.level).toBe('high');
    expect(r.quarantine).toBe(true);
    expect(r.reasons[0]).toMatch(/stealers/);
    // even a well-known host does not excuse the sharpest words
    expect(judge('aimbot.exe', 'https://github.com/x/y/releases/download/1/aimbot.exe').warn).toBe(true);
  });
  it('warns about a cheat archive but not an ordinary one', () => {
    expect(judge('krnl-injector.zip', 'https://files.example.org/krnl-injector.zip').kind).toBe('cheat-tool');
    expect(judge('holiday-photos.zip', 'https://files.example.org/holiday-photos.zip').warn).toBe(false);
    expect(judge('cheats.zip', 'https://files.example.org/cheats.zip').warn).toBe(false);    // too ordinary in an archive
  });
  it('lets a generic word through on a site the person uses', () => {
    expect(judge('dependency-injector.exe', 'https://github.com/x/dependency-injector.exe').warn).toBe(false);
    expect(judge('free-cracked-game.exe', 'https://unknown-host.example.org/free-cracked-game.exe').kind).toBe('cheat-tool');
  });
  it('catches a fake update from the wrong site and excuses the real one', () => {
    expect(inspectName('Chrome_Update.exe', 'download-chrome.example.xyz').kind).toBe('fake-update');
    expect(inspectName('ChromeUpdate.exe', 'dl.google.com')).toBe(null);
    expect(inspectName('browser-update.exe', 'anything.example.org').kind).toBe('fake-update');
    expect(inspectName('flash_player_update.exe', 'get.example.org').kind).toBe('fake-update');
    expect(inspectName('knowledge_update.exe', 'x.example.org')).toBe(null);          // "edge" inside a word is not Edge
    expect(inspectName('ChromeSetup.exe', 'x.example.org')).toBe(null);
    expect(judge('Discord_Update.exe', 'https://discord-app.example.xyz/Discord_Update.exe').guard).toBe('fake-update');
  });
  it('never warns when the site is on the allow list, or when Web safety is off', () => {
    expect(judge('executor.exe', 'https://mine.example.org/executor.exe', { allow: ['mine.example.org'] }).warn).toBe(false);
    expect(ws.classifyDownload({ filename: 'executor.exe', url: 'https://x.example.org/executor.exe' }, { sensitivity: 'off' }).warn).toBe(false);
  });
  it('leaves the old behaviour alone', () => {
    expect(judge('invoice.pdf.exe', 'https://x.example.org/invoice.pdf.exe').kind).toBe('disguised');
    expect(judge('notes.txt', 'https://x.example.org/notes.txt').warn).toBe(false);
  });
});

function fakeFs(files) {
  // files: path -> { stream?: string }
  const err = (code) => Object.assign(new Error(code), { code });
  return {
    files,
    readFileSync(p) { if (p.endsWith(':Zone.Identifier')) { const f = files.get(p.slice(0, -16)); if (!f) throw err('ENOENT'); if (f.stream == null) throw err('ENOENT'); return f.stream; } throw err('EIO'); },
    writeFileSync(p, text) { const f = files.get(p.slice(0, -16)); if (!f) throw err('ENOENT'); if (f.noStreams) throw err('EINVAL'); f.stream = text; },
    existsSync(p) { return files.has(p); },
    renameSync(a, b) { if (!files.has(a)) throw err('ENOENT'); const f = files.get(a); files.delete(a); files.set(b, f); },
  };
}
const MARK = '[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://x.example.org/\r\n';

describe('mark of the web (T3-111)', () => {
  it('reads the zone', () => {
    const m = createMarkOfTheWeb({ fs: fakeFs(new Map()), platform: 'win32' });
    expect(m.zoneOf(MARK)).toBe(3);
    expect(m.hasMark(MARK)).toBe(true);
    expect(m.hasMark('[ZoneTransfer]\r\nZoneId=0')).toBe(false);
  });
  it('keeps a mark across a move that kept it, and puts it back when the move lost it', () => {
    const files = new Map([['C:\\a\\x.exe', { stream: MARK }]]);
    const fs = fakeFs(files);
    const m = createMarkOfTheWeb({ fs, platform: 'win32' });
    expect(m.move('C:\\a\\x.exe', 'C:\\b\\x.exe', () => fs.renameSync('C:\\a\\x.exe', 'C:\\b\\x.exe'))).toEqual({ carried: true, kept: true });
    // a copy that drops the stream
    const r = m.move('C:\\b\\x.exe', 'D:\\x.exe', () => { files.set('D:\\x.exe', {}); });
    expect(r).toMatchObject({ carried: true, kept: false, restored: true });
    expect(files.get('D:\\x.exe').stream).toBe(MARK);
  });
  it('says so when the mark cannot be put back, and writes nothing for an unmarked file', () => {
    const files = new Map([['C:\\a\\x.exe', { stream: MARK }], ['C:\\a\\y.exe', {}]]);
    const fs = fakeFs(files);
    const m = createMarkOfTheWeb({ fs, platform: 'win32' });
    const r = m.move('C:\\a\\x.exe', 'E:\\x.exe', () => { files.set('E:\\x.exe', { noStreams: true }); });
    expect(r.restored).toBe(false);
    expect(r.error).toMatch(/lost its/);
    const w = vi.spyOn(fs, 'writeFileSync');
    expect(m.move('C:\\a\\y.exe', 'C:\\b\\y.exe', () => fs.renameSync('C:\\a\\y.exe', 'C:\\b\\y.exe'))).toEqual({ carried: false });
    expect(w).not.toHaveBeenCalled();
  });
  it('check() is read-only and lists the files without a mark', () => {
    const files = new Map([['C:\\d\\a.exe', { stream: MARK }], ['C:\\d\\b.exe', {}]]);
    const fs = fakeFs(files);
    const w = vi.spyOn(fs, 'writeFileSync');
    const m = createMarkOfTheWeb({ fs, platform: 'win32' });
    const r = m.check(['C:\\d\\a.exe', 'C:\\d\\b.exe', 'C:\\d\\gone.exe']);
    expect(r).toMatchObject({ supported: true, checked: 2, marked: 1, gone: 1, missingMark: ['C:\\d\\b.exe'] });
    expect(w).not.toHaveBeenCalled();
    expect(createMarkOfTheWeb({ fs, platform: 'linux' }).check(['x']).supported).toBe(false);
  });
  it('the downloads tidy-up goes through it and reports a lost mark', () => {
    const files = new Map([['C:\\dl\\a.exe', { stream: MARK }]]);
    const base = fakeFs(files);
    let log = '[]';
    const fs = {
      ...base,
      statSync: () => ({ isDirectory: () => true, mtimeMs: 0, size: 1 }),
      lstatSync: () => ({ isFile: () => true }),
      mkdirSync() {},
      renameSync: (a, b) => { if (!a.endsWith('.tmp')) base.renameSync(a, b); },   // the log is written beside and renamed over; it is not one of the downloaded files
      readdirSync: () => [{ name: 'a.exe', isFile: () => true }],
      existsSync: (p) => files.has(p) || p.endsWith('log.json'),
      readFileSync: (p) => (p.endsWith(':Zone.Identifier') ? base.readFileSync(p) : log),
      writeFileSync: (p, t) => { if (p.endsWith(':Zone.Identifier')) base.writeFileSync(p, t); else log = t; },
    };
    const motw = createMarkOfTheWeb({ fs, platform: 'win32' });
    const tidy = createDownloadTidy({ fs, logFile: 'C:\\dl\\log.json', motw, now: () => 10 * 86400000 });
    const plan = tidy.plan('C:\\dl', { minAgeDays: 1 });
    const r = tidy.apply(plan.id);
    expect(r.moved).toBe(1);
    expect(r.markLost).toEqual([]);
    const [moved] = [...files.keys()];
    expect(moved).toMatch(/Installers/);
    expect(files.get(moved).stream).toBe(MARK);
  });
});

describe('Windows Security shortcut (T3-110)', () => {
  it('opens one fixed address and reveals only a file Vex downloaded', async () => {
    const shell = { openExternal: vi.fn(async () => {}), showItemInFolder: vi.fn() };
    const d = createDefenderShortcut({ shell, platform: 'win32', isDownloadedFile: (p) => p === 'C:\\dl\\a.exe' });
    expect(await d.open('C:\\dl\\a.exe')).toEqual({ revealed: true });
    expect(await d.open('C:\\Windows\\system32\\cmd.exe')).toEqual({ revealed: false });
    expect(shell.openExternal).toHaveBeenCalledTimes(2);
    for (const c of shell.openExternal.mock.calls) expect(c).toEqual([DEFENDER_URI]);
    expect(shell.showItemInFolder).toHaveBeenCalledTimes(1);
  });
  it('refuses on another system', async () => {
    const d = createDefenderShortcut({ shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() }, platform: 'linux' });
    await expect(d.open('x')).rejects.toThrow(/Windows/);
  });
  it('starts no process', () => {
    const src = require('fs').readFileSync(require.resolve('../../src/main/defender-shortcut.js'), 'utf8');
    const code = src.split(/\r?\n/).filter(l => !/^\s*\/\//.test(l)).join('\n');   // the header comment names MpCmdRun to say it is not used
    expect(code).not.toMatch(/child_process|execFile|spawn\(|MpCmdRun/);
  });
});

describe('chat origin (T3-100, T3-102)', () => {
  it('names the chat from the opener address only', () => {
    expect(chatOf('https://discord.com/channels/1/2')).toBe('Discord');
    expect(chatOf('https://web.whatsapp.com/')).toBe('WhatsApp Web');
    expect(chatOf('https://www.whatsapp.com/download')).toBe('');
    expect(chatOf('https://example.org/')).toBe('');
  });
  it('a link out of a chat counts, one within the chat\'s own site does not', () => {
    expect(chatLinkFrom('https://discord.com/channels/1/2', 'https://free-robux.example.xyz/')).toBe('Discord');
    expect(chatLinkFrom('https://discord.com/channels/1/2', 'https://discord.gg/abc')).toBe('');
    expect(chatLinkFrom('https://www.roblox.com/home', 'https://www.roblox.com/games/1')).toBe('');
    expect(chatLinkFrom('https://www.roblox.com/home', 'https://bad.example.org/')).toBe('Roblox');
    expect(chatLinkFrom('https://discord.com/', 'javascript:alert(1)')).toBe('');
  });
});
