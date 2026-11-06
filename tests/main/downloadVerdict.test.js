// The Safe Download Assistant's verdict (src/main/download-verdict.js): a pure function of facts, tested as a table.
import { describe, it, expect } from 'vitest';

const { judge, analyzeName, cleanSettings } = require('../../src/main/download-verdict');

const SIGNED = { status: 'Valid', signer: 'Example Software Ltd', timestamped: true };
const GITHUB = { url: 'https://github.com/o/r/releases/download/v1/setup.exe', scheme: 'https', host: 'github.com', threat: false, lookalike: '', noClick: false, sites: ['github.com'], modHost: false };
const f = (over) => ({ name: 'a.bin', size: 1000, checked: true, note: '', detected: '', archive: null, signature: null, source: null, ...over });
const zip = (entries, extra = {}) => ({ kind: 'zip', listed: true, entries, truncated: false, note: '', encryptedNames: false, ...extra });
const e = (name, size = 100, packed = 100, flags = 0) => ({ name, size, packed, flags, method: 0 });
const ids = (v) => v.reasons.map(r => r.id);
const GB = 1024 ** 3;

describe('green: no warning signs', () => {
  const benign = [
    ['a plain PDF', f({ name: 'report.pdf', detected: 'pdf' })],
    ['a PDF from a normal host', f({ name: 'report.pdf', detected: 'pdf', source: GITHUB })],
    ['a JPEG', f({ name: 'photo.jpg', detected: 'jpeg' })],
    ['an MP4 over https', f({ name: 'clip.mp4', detected: 'mp4', source: { ...GITHUB, url: 'https://cdn.example.org/clip.mp4', host: 'cdn.example.org' } })],
    ['a plain text file', f({ name: 'notes.txt', detected: '' })],
    ['a signed installer from a normal host', f({ name: 'setup.exe', detected: 'program', signature: SIGNED, source: GITHUB })],
    ['a signed msi', f({ name: 'app.msi', detected: 'ole', signature: null, source: GITHUB })],
    ['an Office document (a zip inside, not listed)', f({ name: 'budget.docx', detected: 'zip' })],
    ['a plain http picture', f({ name: 'x.png', detected: 'png', source: { ...GITHUB, scheme: 'http' } })],
    ['a big game archive of already-compressed data', f({ name: 'game.zip', detected: 'zip', archive: zip([e('data/a.pak', 5 * GB, 5 * GB), e('data/b.pak', 4 * GB, 4 * GB), e('readme.txt', 10, 10)]) })],
    ['a source-code zip with scripts among many files', f({ name: 'project.zip', detected: 'zip', archive: zip([e('src/a.js'), e('src/b.js'), e('src/c.js'), e('build.ps1'), e('README.md'), e('package.json'), e('LICENSE')]) })],
  ];
  for (const [label, facts] of benign) {
    it(label, () => {
      const v = judge(facts);
      expect(v.level, JSON.stringify(v.reasons)).toBe('green');
      expect(v.canQuarantine).toBe(false);
      expect(v.top).toBeNull();
    });
  }
  it('says "no warning signs", not "safe"', () => {
    const v = judge(f({ name: 'a.pdf', detected: 'pdf' }));
    expect(v.headline.en).toBe('No warning signs found');
    expect(v.headline.en.toLowerCase()).not.toContain('safe');
  });
});

describe('type against content', () => {
  it('a Windows program wearing a .pdf name is red', () => {
    const v = judge(f({ name: 'invoice.pdf', detected: 'program' }));
    expect(v.level).toBe('red');
    expect(ids(v)).toContain('disguised-program');
    expect(v.canQuarantine).toBe(true);
    expect(v.top.id).toBe('disguised-program');
  });
  it.each(['jpg', 'png', 'mp4', 'txt', 'docx', 'mp3'])('a program named .%s is red', (ext) => {
    expect(judge(f({ name: 'holiday.' + ext, detected: 'program' })).level).toBe('red');
  });
  it('a script wearing a document name is red', () => { expect(judge(f({ name: 'a.pdf', detected: 'script' })).level).toBe('red'); });
  it('a .jar named .pdf is red', () => {
    const v = judge(f({ name: 'doc.pdf', detected: 'zip', archive: zip([e('META-INF/MANIFEST.MF'), e('Main.class')]) }));
    expect(v.level).toBe('red');
    expect(ids(v)).toContain('disguised-program');
  });
  it('a zip named .jpg is amber', () => {
    const v = judge(f({ name: 'cat.jpg', detected: 'zip', archive: zip([e('a.txt')]) }));
    expect(v.level).toBe('amber');
    expect(ids(v)).toContain('disguised-archive');
  });
  it('a .exe that is really a picture is amber', () => {
    expect(ids(judge(f({ name: 'setup.exe', detected: 'png' })))).toContain('not-a-program');
    expect(judge(f({ name: 'setup.exe', detected: 'png' })).level).toBe('amber');
  });
  it('double extension: invoice.pdf.exe is red', () => {
    const v = judge(f({ name: 'invoice.pdf.exe', detected: 'program' }));
    expect(v.level).toBe('red');
    expect(ids(v)).toContain('double-extension');
  });
  it.each(['photo.jpg.scr', 'cv.docx.bat', 'movie.mp4.vbs', 'a.txt.js', 'x.pdf.lnk', 'x.png.hta', 'notes.txt  .exe'])('double extension %s is red', (name) => {
    expect(judge(f({ name })).level).toBe('red');
  });
  it('an honest file with two dots is not a double extension', () => {
    expect(judge(f({ name: 'app.v1.2.exe', detected: 'program', signature: SIGNED })).level).toBe('green');
    expect(judge(f({ name: 'archive.tar.gz', detected: 'gzip' })).level).toBe('green');
    expect(judge(f({ name: 'file.exe.pdf', detected: 'pdf' })).level).toBe('green');
  });
  it('a right-to-left override is red for a program and amber otherwise', () => {
    const rlo = 'invoice\u202Efdp.exe';
    const v = judge(f({ name: rlo, detected: 'program' }));
    expect(v.level).toBe('red');
    expect(ids(v)).toContain('hidden-direction');
    expect(v.reasons.find(r => r.id === 'hidden-direction').en).toContain('.exe');
    expect(judge(f({ name: 'note\u202Etxt.pdf', detected: 'pdf' })).level).toBe('amber');
    expect(judge(f({ name: 'a\u2066b.exe', detected: 'program' })).level).toBe('red');
  });
  it('a very long or padded name that hides a program ending is amber', () => {
    expect(ids(judge(f({ name: 'x'.repeat(130) + '.exe', detected: 'program', signature: SIGNED })))).toContain('long-name');
    expect(ids(judge(f({ name: 'report' + ' '.repeat(40) + '.exe', detected: 'program', signature: SIGNED })))).toContain('long-name');
    expect(judge(f({ name: 'x'.repeat(130) + '.txt' })).level).toBe('green');
  });
  it('analyzeName reports the real ending', () => {
    expect(analyzeName('invoice.pdf.exe')).toMatchObject({ ext: 'exe', decoy: 'pdf', runnable: true });
    expect(analyzeName('a.b')).toMatchObject({ ext: 'b', decoy: '', runnable: false });
    expect(analyzeName('noext')).toMatchObject({ ext: '', runnable: false });
    expect(analyzeName('x\u202Ey.exe').bidi).toBe(true);
  });
  it('a real PDF is reported as matching its name', () => {
    expect(ids(judge(f({ name: 'a.pdf', detected: 'pdf' })))).toContain('type-matches');
  });
});

describe('archives', () => {
  it('a zip bomb is red and is never previewed', () => {
    const v = judge(f({ name: 'free.zip', detected: 'zip', archive: zip([e('zeros.bin', 40 * GB, 40 * 1024 * 1024)]) }));
    expect(v.level).toBe('red');
    expect(ids(v)).toContain('zip-bomb');
    expect(v.noPreview).toBe(true);
  });
  it.each([
    ['one huge text file at 1000:1', [e('a.txt', 200 * 1024 * 1024, 150 * 1024)]],
    ['several files totalling 3 GB at 500:1', [e('a', GB, 2 * 1024 * 1024), e('b', GB, 2 * 1024 * 1024), e('c', GB, 2 * 1024 * 1024)]],
    ['a single 5 GB entry from a few KB', [e('x', 5 * GB, 20 * 1024)]],
  ])('bomb shape: %s', (_l, entries) => { expect(judge(f({ name: 'a.zip', detected: 'zip', archive: zip(entries) })).noPreview).toBe(true); });
  it('a large honest archive is not a bomb', () => {
    const v = judge(f({ name: 'a.zip', detected: 'zip', archive: zip([e('movie.mkv', 8 * GB, 7.9 * GB), e('notes.txt', 100, 60)]) }));
    expect(v.noPreview).toBe(false);
    expect(v.level).toBe('green');
  });
  it('path traversal names are red', () => {
    for (const name of ['../../Windows/evil.dll', '..\\..\\x.txt', '/etc/passwd', 'C:\\Windows\\a.txt', 'a/../../b.txt']) {
      const v = judge(f({ name: 'pack.zip', detected: 'zip', archive: zip([e('ok.txt'), e(name)]) }));
      expect(v.level, name).toBe('red');
      expect(ids(v)).toContain('path-traversal');
    }
    expect(judge(f({ name: 'pack.zip', detected: 'zip', archive: zip([e('a/b/c.txt'), e('..hidden/x.txt')]) })).level).toBe('green');
  });
  it('a program with a document ending hidden inside is red', () => {
    const v = judge(f({ name: 'p.zip', detected: 'zip', archive: zip([e('readme.txt'), e('Invoice.pdf.exe')]) }));
    expect(v.level).toBe('red');
    expect(ids(v)).toContain('double-extension-inside');
  });
  it('a password-locked zip holding a program is red', () => {
    const v = judge(f({ name: 'p.zip', detected: 'zip', archive: zip([e('setup.exe', 100, 100, 1)]) }));
    expect(v.level).toBe('red');
    expect(ids(v)).toContain('locked-program');
  });
  it('a password-locked archive with no program is amber; relaxed makes it a note', () => {
    const facts = f({ name: 'p.zip', detected: 'zip', archive: zip([e('doc.txt', 100, 100, 1)]) });
    expect(judge(facts).level).toBe('amber');
    expect(judge(facts, { strictness: 'relaxed' }).level).toBe('green');
  });
  it('a rar or 7z that hides even its names behind a password is amber', () => {
    const v = judge(f({ name: 'p.rar', detected: 'rar', archive: { kind: 'rar', listed: false, entries: [], truncated: false, note: '', encryptedNames: true } }));
    expect(v.level).toBe('amber');
    expect(ids(v)).toContain('password-archive');
  });
  it('a zip that holds only one program is amber; with companions it is a plain note', () => {
    expect(judge(f({ name: 'p.zip', detected: 'zip', archive: zip([e('setup.exe')]) })).level).toBe('amber');
    const many = judge(f({ name: 'p.zip', detected: 'zip', archive: zip([e('setup.exe'), e('data.bin'), e('readme.txt'), e('help.pdf'), e('lib.dat'), e('x.cfg')]) }));
    expect(many.level).toBe('green');
    expect(ids(many)).toContain('program-in-archive');
    expect(judge(f({ name: 'p.zip', detected: 'zip', archive: zip([e('setup.exe'), e('data.bin'), e('readme.txt'), e('help.pdf'), e('lib.dat'), e('x.cfg')]) }), { strictness: 'strict' }).level).toBe('amber');
  });
  it('a shortcut or script in a small archive is amber', () => {
    expect(ids(judge(f({ name: 'p.zip', detected: 'zip', archive: zip([e('read me.lnk'), e('a.txt')]) })))).toContain('shortcut-or-script');
  });
  it('an archive whose file list cannot be read says so, and is not called clean on that account alone', () => {
    const v = judge(f({ name: 'p.zip', detected: 'zip', archive: { kind: 'zip', listed: false, entries: [], truncated: false, note: 'the end of the zip is missing or damaged', encryptedNames: false } }));
    expect(ids(v)).toContain('archive-unlisted');
  });
  it('an absurd number of files is amber', () => {
    const entries = Array.from({ length: 60000 }, (_v, i) => e('f' + i + '.txt', 10, 10));
    expect(ids(judge(f({ name: 'p.zip', detected: 'zip', archive: zip(entries) })))).toContain('many-files');
  });
  it('a hidden direction character in a program name inside is red', () => {
    expect(judge(f({ name: 'p.zip', detected: 'zip', archive: zip([e('doc\u202Efdp.exe'), e('a.txt')]) })).level).toBe('red');
  });
});

describe('signature', () => {
  const exe = (signature, over) => f({ name: 'setup.exe', detected: 'program', signature, source: GITHUB, ...over });
  it('valid is green and says who signed', () => {
    const v = judge(exe(SIGNED));
    expect(v.level).toBe('green');
    expect(v.reasons.find(r => r.id === 'signature-valid').en).toContain('Example Software Ltd');
  });
  it('unsigned is amber (and a note when relaxed)', () => {
    expect(judge(exe({ status: 'NotSigned', signer: '' })).level).toBe('amber');
    expect(judge(exe({ status: 'NotSigned', signer: '' }), { strictness: 'relaxed' }).level).toBe('green');
  });
  it('a broken signature is red', () => { expect(judge(exe({ status: 'HashMismatch', signer: 'X' })).level).toBe('red'); });
  it('a signature Windows does not trust is amber', () => { expect(judge(exe({ status: 'NotTrusted', signer: 'X' })).level).toBe('amber'); });
  it('an unreadable signature is a note; strict makes it amber', () => {
    expect(judge(exe({ status: 'unknown', signer: '' })).level).toBe('green');
    expect(judge(exe({ status: 'unknown', signer: '' }), { strictness: 'strict' }).level).toBe('amber');
  });
  it('an unsigned .dll or .jar mod is not judged on signature', () => {
    expect(judge(f({ name: 'mod.dll', detected: 'program', signature: { status: 'NotSigned', signer: '' } })).level).toBe('green');
  });
  it('a tampered .dll is red', () => { expect(judge(f({ name: 'a.dll', detected: 'program', signature: { status: 'HashMismatch', signer: '' } })).level).toBe('red'); });
});

describe('source', () => {
  const pdf = (source) => f({ name: 'a.pdf', detected: 'pdf', source: { ...GITHUB, ...source } });
  const exe = (source, over) => f({ name: 'a.exe', detected: 'program', signature: SIGNED, source: { ...GITHUB, ...source }, ...over });
  it('a site on the dangerous list is red', () => {
    const v = judge(pdf({ threat: true, host: 'bad.example' }));
    expect(v.level).toBe('red');
    expect(v.reasons[0].en).toContain('bad.example');
  });
  it('a look-alike name: red for a program, amber for a document', () => {
    expect(judge(exe({ lookalike: 'discord.com', host: 'dlscord.com' })).level).toBe('red');
    expect(judge(pdf({ lookalike: 'discord.com', host: 'dlscord.com' })).level).toBe('amber');
  });
  it('plain http matters for a program, not for a picture', () => {
    expect(ids(judge(exe({ scheme: 'http' })))).toContain('plain-http');
    expect(judge(exe({ scheme: 'http' })).level).toBe('amber');
    expect(judge(pdf({ scheme: 'http' })).level).toBe('green');
  });
  it('a redirect chain through three unrelated sites: amber for a program, a note for a document', () => {
    const sites = ['a.example', 'b.example', 'c.example'];
    expect(judge(exe({ sites })).level).toBe('amber');
    expect(judge(pdf({ sites })).level).toBe('green');
    expect(ids(judge(pdf({ sites })))).toContain('redirect-chain');
    expect(judge(exe({ sites: ['a.example', 'b.example'] })).level).toBe('green');
  });
  it('a download the page started by itself', () => {
    expect(judge(exe({ noClick: true })).level).toBe('amber');
    expect(judge(pdf({ noClick: true })).level).toBe('green');
  });
  it('no source facts (a file with no address) adds nothing', () => { expect(judge(f({ name: 'a.pdf', detected: 'pdf', source: null })).level).toBe('green'); });
});

describe('mods: a short caution, never a colour of their own', () => {
  it.each(['mod.jar', 'plugin.dll', 'script.lua', 'model.rbxm'])('%s gets the one-line caution and stays green', (name) => {
    const v = judge(f({ name, detected: name.endsWith('.dll') ? 'program' : name.endsWith('.jar') ? 'zip' : '' }));
    expect(v.level).toBe('green');
    const r = v.reasons.find(x => x.id === 'mod-caution');
    expect(r.en).toBe('Mods can run code on your computer: only install them from sources you trust.');
  });
  it('a plain zip from a mod site gets it; from nowhere it does not', () => {
    expect(ids(judge(f({ name: 'pack.zip', detected: 'zip', archive: zip([e('a.txt')]), source: { ...GITHUB, modHost: true } })))).toContain('mod-caution');
    expect(ids(judge(f({ name: 'pack.zip', detected: 'zip', archive: zip([e('a.txt')]), source: GITHUB })))).not.toContain('mod-caution');
  });
  it('strict turns the mod caution into amber', () => {
    expect(judge(f({ name: 'mod.jar', detected: 'zip' }), { strictness: 'strict' }).level).toBe('amber');
  });
  it('a red verdict does not also nag about mods', () => {
    expect(ids(judge(f({ name: 'mod.jar.exe', detected: 'program' })))).not.toContain('mod-caution');
  });
});

describe('settings, unreadable files, text', () => {
  it('a file that could not be read is gray, never green', () => {
    const v = judge(f({ checked: false, note: 'EACCES' }));
    expect(v.level).toBe('gray');
    expect(v.reasons[0].en).toContain('EACCES');
  });
  it('each group of checks can be switched off', () => {
    const disguised = f({ name: 'a.pdf', detected: 'program' });
    expect(judge(disguised).level).toBe('red');
    expect(judge(disguised, { checks: { content: false } }).level).toBe('green');
    const bomb = f({ name: 'a.zip', detected: 'zip', archive: zip([e('z', 40 * GB, 1024 * 1024)]) });
    expect(judge(bomb, { checks: { archives: false } }).level).toBe('green');
    expect(judge(f({ name: 'a.exe', detected: 'program', signature: { status: 'HashMismatch', signer: '' } }), { checks: { signature: false } }).level).toBe('green');
    expect(judge(f({ name: 'a.pdf', detected: 'pdf', source: { ...GITHUB, threat: true } }), { checks: { source: false } }).level).toBe('green');
  });
  it('bad settings fall back to the defaults', () => {
    expect(cleanSettings({ strictness: 'nonsense', checks: 5 })).toEqual({ on: true, strictness: 'normal', checks: { content: true, archives: true, signature: true, source: true } });
    expect(cleanSettings(null).on).toBe(true);
    expect(cleanSettings({ on: false }).on).toBe(false);
  });
  it('is pure: the same facts give the same answer and the facts are not changed', () => {
    const facts = f({ name: 'invoice.pdf.exe', detected: 'program', source: GITHUB });
    const copy = JSON.parse(JSON.stringify(facts));
    expect(judge(facts)).toEqual(judge(facts));
    expect(facts).toEqual(copy);
  });
  it('every reason has English and Turkish text, worst first, and no emoji', () => {
    const v = judge(f({ name: 'x\u202Ey.pdf.exe', detected: 'program', signature: { status: 'HashMismatch', signer: '' }, source: { ...GITHUB, threat: true, scheme: 'http', noClick: true, sites: ['a.x', 'b.x', 'c.x'] } }));
    const rank = { red: 0, amber: 1, info: 2, ok: 3 };
    for (let i = 1; i < v.reasons.length; i++) expect(rank[v.reasons[i].level]).toBeGreaterThanOrEqual(rank[v.reasons[i - 1].level]);
    for (const r of v.reasons) {
      expect(r.en.length).toBeGreaterThan(10);
      expect(r.tr.length).toBeGreaterThan(10);
      expect(r.tr).not.toBe(r.en);
      expect(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(r.en + r.tr)).toBe(false);
    }
    for (const lv of ['green', 'amber', 'red', 'gray']) {
      const h = judge(lv === 'gray' ? f({ checked: false }) : lv === 'red' ? f({ name: 'a.pdf', detected: 'program' }) : lv === 'amber' ? f({ name: 'a.exe', detected: 'program', signature: { status: 'NotSigned' } }) : f({ name: 'a.pdf', detected: 'pdf' })).headline;
      expect(h.en && h.tr).toBeTruthy();
    }
  });
  it('a hostile name is shortened in the message, never echoed whole', () => {
    const v = judge(f({ name: 'a'.repeat(300) + '.pdf.exe', detected: 'program' }));
    expect(v.reasons.find(r => r.id === 'double-extension').en.length).toBeLessThan(400);
  });
});
