// === Safe Download Assistant: the verdict, as a pure function of facts =========
//
// When a download finishes, Vex reads what it can know on this computer (src/main/download-facts.js: the file's
// first bytes, an archive's file list, a program's Windows signature, where it came from) and this file turns
// those facts into one colour and the concrete reasons for it, in English and Turkish:
//
//   green  no warning signs were found (this is NOT "safe": nobody can promise that)
//   amber  something is unusual; read the reasons before opening it
//   red    the file is very probably not what it says it is, or comes from a reported dangerous site
//   gray   the file could not be read, so nothing is claimed
//
// Nothing here touches the disk, the network or the clock: judge(facts, settings) always gives the same answer, which
// is what the tests hold. "Keep false alarms low": a plain PDF is green, a signed installer from an ordinary host is
// green, a mod (.jar, .dll, .lua, .rbxm) gets one short sentence and stays green.
//
// facts = {
//   name,                      the saved file's name
//   size,                      bytes
//   checked,                   false when the file could not be read at all (then `note` says why)
//   note,
//   detected,                  what the first bytes say: 'program' | 'script' | 'zip' | 'rar' | '7z' | 'gzip' | 'ole' | 'pdf' |
//                              'png' | 'jpeg' | 'gif' | 'riff' | 'mp4' | ''
//   archive,                   null, or { listed, entries: [{ name, flags, packed, size }], encryptedNames, truncated, note, kind }
//   signature,                 null (not asked), or { status, signer, timestamped }  (status is Windows' own word)
//   source,                    { url, scheme, host, threat, lookalike, noClick, sites: [registrable domains of the redirect chain], modHost }
// }
// settings = { strictness: 'relaxed' | 'normal' | 'strict', checks: { content, archives, signature, source } }
const { DOC_ENDING, DOCUMENTISH, PROGRAM_EXT, RISKY_IN_ARCHIVE, SHORTCUT_OR_SCRIPT } = require('./file-content-check');

const DEFAULT_SETTINGS = Object.freeze({ on: true, strictness: 'normal', checks: Object.freeze({ content: true, archives: true, signature: true, source: true }) });
const STRICTNESS = ['relaxed', 'normal', 'strict'];

function cleanSettings(s) {
  const o = s && typeof s === 'object' ? s : {};
  const c = o.checks && typeof o.checks === 'object' ? o.checks : {};
  return {
    on: o.on !== false,
    strictness: STRICTNESS.includes(o.strictness) ? o.strictness : 'normal',
    checks: { content: c.content !== false, archives: c.archives !== false, signature: c.signature !== false, source: c.source !== false },
  };
}

// What Windows runs (or opens as a program) when it is double-clicked. A shortcut, a script and an installer count.
const RUN_EXT = new Set(['exe', 'scr', 'com', 'pif', 'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'lnk', 'msi', 'msp', 'jar', 'dll', 'cpl', 'reg', 'msc', 'url', 'scf', 'inf', 'appx', 'msix', 'appxbundle', 'msixbundle', 'sys', 'ocx', 'application', 'gadget', 'jnlp']);
// The ones whose maker should have signed them. A .dll or .jar mod is normally unsigned, so it is not judged on that.
const SIGNABLE_EXT = new Set(['exe', 'msi', 'scr', 'msp', 'cpl', 'ocx', 'sys']);
// Files that are usually game mods: they run code, but that is what a mod is.
const MOD_EXT = new Set(['jar', 'dll', 'lua', 'luau', 'rbxm', 'rbxmx', 'rbxl', 'asi', 'mcpack', 'mcaddon', 'mrpack', 'smx', 'esp', 'esm', 'pak', 'unitypackage']);
const OFFICE_ZIP = new Set(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub', 'svg', 'jar', 'apk', 'xpi', 'crx', 'vsix', 'nupkg', 'msix', 'appx', 'docm', 'xlsm', 'pptm', 'mrpack', 'mcpack', 'mcaddon', 'rbxm', 'rbxmx', 'rbxl']);
const ARCHIVE_EXT = new Set(['zip', 'rar', '7z', 'gz', 'tgz', 'tar', 'xz', 'bz2', 'cab', 'iso', 'img']);
const KIND_FOR_EXT = { pdf: 'pdf', png: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif', mp4: 'mp4', m4a: 'mp4', mov: 'mp4', wav: 'riff', avi: 'riff', webp: 'riff' };
const KIND_LABEL = { program: ['a Windows program', 'bir Windows programı'], script: ['a script', 'bir betik'], zip: ['a zip archive', 'bir zip arşivi'], rar: ['a RAR archive', 'bir RAR arşivi'], '7z': ['a 7-Zip archive', 'bir 7-Zip arşivi'], gzip: ['a gzip archive', 'bir gzip arşivi'], ole: ['an old Office file or an installer package', 'eski bir Office dosyası ya da yükleme paketi'], pdf: ['a PDF', 'bir PDF'], png: ['a PNG picture', 'bir PNG resmi'], jpeg: ['a JPEG picture', 'bir JPEG resmi'], gif: ['a GIF picture', 'bir GIF resmi'], riff: ['a media file', 'bir ortam dosyası'], mp4: ['a video or audio file', 'bir video ya da ses dosyası'] };

// ---- the name ------------------------------------------------------------------------------------------------------------
// U+202A..202E (embeddings, overrides) and U+2066..2069 (isolates) reorder what is drawn; U+200E/200F are the marks.
const BIDI = /[\u202a-\u202e\u2066-\u2069\u200e\u200f]/;
const DECOY_EXT = '(?:pdf|docx?|xlsx?|pptx?|txt|rtf|csv|jpe?g|png|gif|bmp|webp|svg|mp[34]|mkv|avi|mov|wav|zip|rar|7z|iso|jar)';
const DECOY_RE = new RegExp('\\.(' + DECOY_EXT + ')[\\s\\u00a0\\u2000-\\u200b]*$', 'i');

function extOf(name) {
  const m = /\.([A-Za-z0-9]{1,12})$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}
function shortName(name, n = 60) {
  const s = String(name || '').replace(BIDI, '').replace(/[\u0000-\u001f]/g, '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// -> { ext, runnable, bidi, decoy, padded, long }
function analyzeName(name) {
  const raw = String(name || '');
  const ext = extOf(raw);
  const runnable = RUN_EXT.has(ext);
  const base = ext ? raw.slice(0, raw.length - ext.length - 1) : raw;
  const decoyMatch = ext && runnable ? DECOY_RE.exec(base) : null;
  // A run of spaces (or other blanks) pushes the real ending out of sight in a narrow column: "invoice.pdf          .exe".
  const padded = !!ext && runnable && /[\s\u00a0\u2000-\u200b]{5,}$/.test(base);
  return {
    ext,
    runnable,
    bidi: BIDI.test(raw),
    decoy: decoyMatch ? decoyMatch[1].toLowerCase() : '',
    padded,
    long: !!ext && runnable && raw.length > 100,
  };
}

// ---- archives ------------------------------------------------------------------------------------------------------------
const GIB = 1024 * 1024 * 1024, MIB = 1024 * 1024;
function entryExt(name) { return extOf(String(name || '').replace(/^.*[\\/]/, '')); }
function isDir(e) { return /[\\/]$/.test(e.name); }

// -> { files, total, packed, ratio }
function archiveSizes(entries) {
  const files = entries.filter(e => !isDir(e));
  const total = files.reduce((n, e) => n + (e.size || 0), 0);
  const packed = files.reduce((n, e) => n + (e.packed || 0), 0);
  return { files, total, packed, ratio: packed > 0 ? total / packed : 0 };
}
// A zip bomb is a small file that unpacks to something enormous. Honest archives of already-compressed data (video, a game) sit
// near 1; plain text and zeros reach 100 to 1000. These limits are well above any honest archive.
function isBomb({ total, packed, ratio, files }) {
  if (files.length && files.some(e => (e.size || 0) >= 4 * GIB && e.packed > 0 && e.size / e.packed >= 200)) return true;
  if (packed <= 0) return false;
  return (total >= GIB && ratio >= 100) || (total >= 100 * MIB && ratio >= 1000) || total >= 50 * GIB;
}
const TRAVERSAL = (n) => /(^|[\\/])\.\.([\\/]|$)/.test(n) || /^[A-Za-z]:|^[\\/]/.test(n);

const human = (n) => n >= GIB ? (n / GIB).toFixed(n >= 10 * GIB ? 0 : 1) + ' GB' : n >= MIB ? Math.round(n / MIB) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

// ---- the verdict ---------------------------------------------------------------------------------------------------------
const RANK = { red: 0, amber: 1, info: 2, ok: 3 };

function judge(facts, settings) {
  const s = cleanSettings(settings);
  const f = facts && typeof facts === 'object' ? facts : {};
  const name = String(f.name || '');
  const nm = analyzeName(name);
  const ext = nm.ext;
  const kind = f.detected || '';
  const reasons = [];
  // up: the level it takes on under "strict"; weak: it drops to a plain note under "relaxed".
  const add = (id, level, en, tr, o = {}) => reasons.push({ id, level, en, tr, weak: !!o.weak, up: o.up || null });

  const looksProgram = kind === 'program' || kind === 'script';
  const arch = f.archive && f.archive.listed && Array.isArray(f.archive.entries) ? f.archive : null;
  const isJar = !!arch && arch.entries.some(e => /^META-INF\/MANIFEST\.MF$/i.test(e.name) || /\.class$/i.test(e.name));
  let bomb = false;

  if (f.checked === false) {
    add('unreadable', 'info', 'Vex could not read this file, so it has not been checked' + (f.note ? ' (' + String(f.note).slice(0, 160) + ')' : '') + '.',
      'Vex bu dosyayı okuyamadı, bu yüzden denetlenmedi' + (f.note ? ' (' + String(f.note).slice(0, 160) + ')' : '') + '.');
  }

  // (a) TYPE against CONTENT
  if (s.checks.content && f.checked !== false) {
    if (nm.bidi) {
      const real = ext ? '.' + ext : 'something else';
      add('hidden-direction', nm.runnable || looksProgram ? 'red' : 'amber',
        'The name contains a hidden right-to-left character, which makes the end of the name look different from what it really is. The file really ends in ' + real + '.',
        'Adın içinde gizli bir sağdan-sola karakter var; bu, adın sonunu gerçekte olduğundan farklı gösterir. Dosya gerçekte ' + real + ' ile bitiyor.');
    }
    if (nm.decoy) {
      add('double-extension', 'red',
        '"' + shortName(name) + '" is dressed up as a ' + nm.decoy.toUpperCase() + ' but it really ends in .' + ext + ', so it is a program, not a document.',
        '"' + shortName(name) + '" bir ' + nm.decoy.toUpperCase() + ' gibi görünüyor ama gerçekte .' + ext + ' ile bitiyor; yani belge değil, bir program.');
    } else if (nm.padded || nm.long) {
      add('long-name', 'amber',
        'The name is very long or padded with blanks, which can push the real ending (.' + ext + ') out of sight.',
        'Ad çok uzun ya da boşluklarla şişirilmiş; bu, gerçek uzantıyı (.' + ext + ') gözden saklayabilir.', { weak: true });
    }
    if (DOCUMENTISH.has(ext) && ext !== 'svg') {
      if (kind === 'program') {
        add('disguised-program', 'red',
          'The name says .' + ext + ' but the file is really a Windows program. A real ' + ext.toUpperCase() + ' is never a program.',
          'Ad .' + ext + ' diyor ama dosya gerçekte bir Windows programı. Gerçek bir ' + ext.toUpperCase() + ' asla program olmaz.');
      } else if (kind === 'script') {
        add('disguised-script', 'red',
          'The name says .' + ext + ' but the file is really a script.',
          'Ad .' + ext + ' diyor ama dosya gerçekte bir betik.');
      } else if (isJar) {
        add('disguised-program', 'red',
          'The name says .' + ext + ' but the file is really a Java program (.jar).',
          'Ad .' + ext + ' diyor ama dosya gerçekte bir Java programı (.jar).');
      } else if (['zip', 'rar', '7z', 'gzip'].includes(kind) && !OFFICE_ZIP.has(ext)) {
        add('disguised-archive', 'amber',
          'The name says .' + ext + ' but the file is really ' + KIND_LABEL[kind][0] + '.',
          'Ad .' + ext + ' diyor ama dosya gerçekte ' + KIND_LABEL[kind][1] + '.');
      } else if (KIND_FOR_EXT[ext] && KIND_FOR_EXT[ext] === kind) {
        add('type-matches', 'ok', 'It really is ' + KIND_LABEL[kind][0] + ', as its name says.', 'Adının dediği gibi gerçekten ' + KIND_LABEL[kind][1] + '.');
      }
    }
    if (['exe', 'dll', 'scr', 'com', 'cpl'].includes(ext) && kind && kind !== 'program') {
      add('not-a-program', 'amber',
        'The name ends in .' + ext + ' but the file is ' + (KIND_LABEL[kind] ? KIND_LABEL[kind][0] : 'something else') + ', not a Windows program.',
        'Ad .' + ext + ' ile bitiyor ama dosya Windows programı değil, ' + (KIND_LABEL[kind] ? KIND_LABEL[kind][1] : 'başka bir şey') + '.');
    }
  }

  // (b) ARCHIVES: only the list of names is read; nothing is unpacked
  if (s.checks.archives && f.checked !== false && f.archive) {
    if (!arch) {
      if (f.archive.note) add('archive-unlisted', 'info', 'The list of files inside could not be read: ' + String(f.archive.note).slice(0, 160), 'İçindeki dosya listesi okunamadı: ' + String(f.archive.note).slice(0, 160));
      if (f.archive.encryptedNames) {
        add('password-archive', 'amber',
          'This archive is locked with a password, even for the names of what is inside. Password-locked archives are used to hide malware from scanners; open it only if the person who sent it gave you the password and you expected it.',
          'Bu arşiv, içindeki adlar dahil parolayla kilitli. Parolalı arşivler zararlı yazılımı tarayıcılardan saklamak için kullanılır; yalnızca gönderen kişi parolayı verdiyse ve bunu bekliyorsanız açın.', { weak: true });
      }
    } else {
      const sizes = archiveSizes(arch.entries);
      const { files } = sizes;
      if (isBomb(sizes)) {
        bomb = true;
        add('zip-bomb', 'red',
          'This archive is small but unpacks to about ' + human(sizes.total) + (sizes.ratio >= 2 ? ' (' + Math.round(sizes.ratio) + ' times its size)' : '') + '. That is the shape of a "zip bomb" meant to fill your disk or freeze your computer. Vex will not preview it.',
          'Bu arşiv küçük ama açılınca yaklaşık ' + human(sizes.total) + ' oluyor' + (sizes.ratio >= 2 ? ' (boyutunun ' + Math.round(sizes.ratio) + ' katı)' : '') + '. Bu, diskinizi doldurmak ya da bilgisayarınızı dondurmak için yapılan bir "zip bombası"nın biçimi. Vex bunu önizlemeyecek.');
      }
      const climb = files.find(e => TRAVERSAL(e.name));
      if (climb) {
        add('path-traversal', 'red',
          'A file inside ("' + shortName(climb.name, 70) + '") has a path that climbs out of the folder it is unpacked into, so unpacking it could overwrite files elsewhere.',
          'İçindeki bir dosyanın ("' + shortName(climb.name, 70) + '") yolu, açıldığı klasörün dışına çıkıyor; açmak başka yerlerdeki dosyaların üzerine yazabilir.');
      }
      if (files.some(e => BIDI.test(e.name) && RUN_EXT.has(entryExt(e.name)))) {
        add('hidden-direction-inside', 'red',
          'A program inside has a hidden right-to-left character in its name, which makes its ending look different from what it really is.',
          'İçindeki bir programın adında gizli bir sağdan-sola karakter var; bu, uzantısını olduğundan farklı gösterir.');
      }
      const decoy = files.find(e => DOC_ENDING.test(e.name.replace(/^.*[\\/]/, '')));
      if (decoy) {
        add('double-extension-inside', 'red',
          'Inside, "' + shortName(decoy.name.replace(/^.*[\\/]/, ''), 60) + '" is a program with a document or picture ending in front of its real one.',
          'İçindeki "' + shortName(decoy.name.replace(/^.*[\\/]/, ''), 60) + '" bir program ama gerçek uzantısının önünde belge ya da resim uzantısı var.');
      }
      const risky = files.filter(e => RISKY_IN_ARCHIVE.has(entryExt(e.name)));
      const lockedRisky = risky.filter(e => (e.flags & 1) !== 0);
      const locked = files.filter(e => (e.flags & 1) !== 0);
      if (lockedRisky.length) {
        add('locked-program', 'red',
          'This archive is locked with a password and holds a program (' + shortName(lockedRisky[0].name, 60) + '). Password-locked archives are used to hide malware from scanners, and the password is usually on the page that gave you the file.',
          'Bu arşiv parolayla kilitli ve içinde bir program var (' + shortName(lockedRisky[0].name, 60) + '). Parolalı arşivler zararlı yazılımı tarayıcılardan saklamak için kullanılır; parola da genelde dosyayı veren sayfadadır.');
      } else if (locked.length || arch.encryptedNames) {
        add('password-archive', 'amber',
          'This archive is locked with a password. Password-locked archives are used to hide malware from scanners; open it only if you expected it and trust whoever gave you the password.',
          'Bu arşiv parolayla kilitli. Parolalı arşivler zararlı yazılımı tarayıcılardan saklamak için kullanılır; yalnızca bekliyorsanız ve parolayı verene güveniyorsanız açın.', { weak: true });
      }
      const hasRead = (list) => list.length ? shortName(list[0].name.replace(/^.*[\\/]/, ''), 50) : '';
      if (!lockedRisky.length && !decoy && !climb) {
        const scripts = risky.filter(e => SHORTCUT_OR_SCRIPT.has(entryExt(e.name)));
        // A lone .js is source code far more often than a Windows script dropper; it stays a plain note below.
        if (files.length === 1 && risky.length === 1 && entryExt(risky[0].name) !== 'js') {
          add('single-program', 'amber',
            'The archive holds just one thing, a program (' + hasRead(risky) + '). That is a common way to hand out malware; real software usually comes with other files or from its own site.',
            'Arşivde yalnızca tek bir şey var, bir program (' + hasRead(risky) + '). Zararlı yazılım sık sık böyle dağıtılır; gerçek yazılım genelde başka dosyalarla ya da kendi sitesinden gelir.', { weak: true });
        } else if (files.length <= 5 && scripts.length) {
          add('shortcut-or-script', 'amber',
            'The archive holds a shortcut or a script (' + hasRead(scripts) + '). These run commands when opened and are a common way to start malware.',
            'Arşivde bir kısayol ya da betik var (' + hasRead(scripts) + '). Bunlar açılınca komut çalıştırır ve zararlı yazılımı başlatmanın yaygın bir yoludur.', { weak: true });
        } else if (risky.length) {
          add('program-in-archive', 'info',
            'The archive contains a program (' + hasRead(risky) + '). That is normal for software; run it only if you trust where it came from.',
            'Arşivde bir program var (' + hasRead(risky) + '). Yazılım için bu normaldir; yalnızca geldiği yere güveniyorsanız çalıştırın.', { up: 'amber' });
        }
      }
      // (A .jar, .apk or other package legitimately holds tens of thousands of files.)
      if (files.length > 50000 && !OFFICE_ZIP.has(ext)) {
        add('many-files', 'amber', 'The archive lists ' + files.length.toLocaleString('en-US') + ' files, far more than a normal download. Unpacking it could be very slow.', 'Arşivde ' + files.length.toLocaleString('en-US') + ' dosya var; normal bir indirmeden çok fazla. Açmak çok yavaş olabilir.', { weak: true });
      }
      if (arch.truncated) add('archive-truncated', 'info', 'Only the first part of the archive\'s file list was read.', 'Arşivin dosya listesinin yalnızca ilk kısmı okundu.');
    }
  }

  // (c) SIGNATURE (Windows Authenticode, read without running the file)
  if (s.checks.signature && f.checked !== false && f.signature && (SIGNABLE_EXT.has(ext) || (ext === 'dll' && f.signature.status === 'HashMismatch'))) {
    const sig = f.signature;
    const who = String(sig.signer || '').slice(0, 80);
    if (sig.status === 'Valid') {
      add('signature-valid', 'ok', 'Signed by ' + (who || 'a publisher') + ', and the signature is valid.', (who || 'Bir yayıncı') + ' tarafından imzalanmış ve imza geçerli.');
    } else if (sig.status === 'NotSigned') {
      add('not-signed', 'amber', 'It is a program that nobody has signed, so Windows cannot say who made it. Plenty of honest programs are unsigned; open it only if you trust the site.',
        'Kimsenin imzalamadığı bir program; bu yüzden Windows onu kimin yaptığını söyleyemez. Dürüst programların çoğu da imzasızdır; yalnızca siteye güveniyorsanız açın.', { weak: true });
    } else if (sig.status === 'HashMismatch') {
      add('signature-broken', 'red', 'The signature on this program is broken: the file was changed after it was signed.', 'Bu programın imzası bozuk: dosya imzalandıktan sonra değiştirilmiş.');
    } else if (sig.status === 'NotTrusted' || sig.status === 'UnknownError' || sig.status === 'Incompatible') {
      add('signature-untrusted', 'amber', 'It carries a signature' + (who ? ' (' + who + ')' : '') + ' but Windows does not trust it, so the name in it proves nothing.',
        'Bir imza taşıyor' + (who ? ' (' + who + ')' : '') + ' ama Windows ona güvenmiyor; içindeki ad hiçbir şeyi kanıtlamaz.');
    } else if (sig.status !== 'NotSupportedFileFormat') {
      add('signature-unknown', 'info', 'The signature could not be read' + (sig.status && sig.status !== 'unknown' ? ' (' + String(sig.status).slice(0, 40) + ')' : '') + '.',
        'İmza okunamadı' + (sig.status && sig.status !== 'unknown' ? ' (' + String(sig.status).slice(0, 40) + ')' : '') + '.', { up: 'amber' });
    }
  }

  // (d) SOURCE: where it came from
  const src = f.source && typeof f.source === 'object' ? f.source : null;
  const canRunBySource = nm.runnable || looksProgram || isJar || (!!arch && arch.entries.some(e => RISKY_IN_ARCHIVE.has(entryExt(e.name))));
  if (s.checks.source && f.checked !== false && src) {
    const host = String(src.host || '').slice(0, 80);
    if (src.threat) {
      add('dangerous-site', 'red', 'It came from ' + host + ', a site on the list of reported dangerous sites.', 'Bildirilmiş tehlikeli siteler listesindeki ' + host + ' sitesinden geldi.');
    }
    if (src.lookalike) {
      add('lookalike-site', canRunBySource ? 'red' : 'amber',
        'It came from ' + host + ', a name made to look like ' + String(src.lookalike).slice(0, 60) + '.',
        host + ' adresinden geldi; bu ad ' + String(src.lookalike).slice(0, 60) + ' gibi görünmek için yapılmış.');
    }
    if (src.scheme === 'http' && canRunBySource) {
      add('plain-http', 'amber', 'It was downloaded over plain http, so anyone on the network could have swapped the file on the way.', 'Düz http ile indirildi; yani ağdaki biri dosyayı yolda değiştirmiş olabilir.', { weak: true });
    }
    if (Array.isArray(src.sites) && src.sites.length >= 3) {
      const via = src.sites.slice(0, 4).join(' → ');
      add('redirect-chain', canRunBySource ? 'amber' : 'info', 'The link passed through several unrelated sites before the file arrived (' + via + ').', 'Bağlantı, dosya gelmeden önce birbiriyle ilgisiz birkaç siteden geçti (' + via + ').', { weak: true });
    }
    if (src.noClick) {
      add('no-click', canRunBySource || kind === 'zip' ? 'amber' : 'info', 'The page started this download by itself; you did not click it.', 'Bu indirmeyi sayfa kendiliğinden başlattı; siz tıklamadınız.', { weak: true });
    }
  }

  // (f) MODS: one short sentence, never a colour on its own
  const modByExt = MOD_EXT.has(ext) || (!!arch && arch.entries.some(e => MOD_EXT.has(entryExt(e.name)) && !isDir(e)));
  const modByHost = !!(src && src.modHost) && (ext === 'zip' || ext === 'rar' || ext === '7z');
  if ((modByExt || modByHost) && !reasons.some(r => r.level === 'red')) {
    add('mod-caution', 'info', 'Mods can run code on your computer: only install them from sources you trust.', 'Modlar bilgisayarınızda kod çalıştırabilir: yalnızca güvendiğiniz kaynaklardan kurun.', { up: 'amber' });
  }

  // strictness
  for (const r of reasons) {
    if (s.strictness === 'relaxed' && r.weak && r.level === 'amber') r.level = 'info';
    else if (s.strictness === 'strict' && r.up && r.level === 'info') r.level = r.up;
  }
  const out = reasons.map(({ id, level, en, tr }) => ({ id, level, en, tr }));
  out.sort((a, b) => RANK[a.level] - RANK[b.level]);

  let level = out.some(r => r.level === 'red') ? 'red' : out.some(r => r.level === 'amber') ? 'amber' : 'green';
  if (level === 'green' && f.checked === false) level = 'gray';
  const head = {
    green: ['No warning signs found', 'Uyarı işareti bulunamadı'],
    amber: ['Be careful with this file', 'Bu dosyada dikkatli olun'],
    red: ['Do not open this file', 'Bu dosyayı açmayın'],
    gray: ['This file could not be checked', 'Bu dosya denetlenemedi'],
  }[level];
  const top = out.find(r => r.level === 'red' || r.level === 'amber') || null;
  return {
    level,
    headline: { en: head[0], tr: head[1] },
    reasons: out,
    top: top ? { id: top.id, en: top.en, tr: top.tr } : null,
    // Red offers Quarantine; a bomb is never previewed.
    canQuarantine: level === 'red',
    noPreview: bomb,
  };
}

module.exports = { judge, analyzeName, cleanSettings, DEFAULT_SETTINGS, RUN_EXT, MOD_EXT, SIGNABLE_EXT, OFFICE_ZIP, ARCHIVE_EXT, isBomb, archiveSizes, extOf, KIND_FOR_EXT, PROGRAM_EXT };
