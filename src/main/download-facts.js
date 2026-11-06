// === Safe Download Assistant: reading the facts about a finished download ===========
//
// download-verdict.js judges; this file only gathers, and it reads very little:
//
//   - the first 64 KB of the file (its real type, from the bytes at the start),
//   - for a zip, the central directory at the END of the file (sizes and names, zip64 included), never the data,
//   - for a RAR or 7z, the headers through main/archive-list.js (plain JavaScript, nothing is unpacked),
//   - for a Windows program, its Authenticode signature, read by Windows PowerShell without running the file,
//   - where it came from: the address, the redirect chain, and three lookups that all run on this computer
//     (the dangerous-site list, the look-alike-name check, the registrable domain of each hop).
//
// A 2 GB file costs the same as a 2 KB one: no read ever starts anywhere but the beginning or the end. Nothing leaves the computer.
const { detect, DOC_ENDING } = require('./file-content-check');
const { OFFICE_ZIP, SIGNABLE_EXT, extOf } = require('./download-verdict');

const HEAD = 64 * 1024;
const MAX_DIR = 12 * 1024 * 1024;       // a zip64 directory of 100,000 names is about 8 MB
const MAX_ENTRIES = 100000;
// Zips that are other things (documents, packages): listing them says nothing useful.
const NO_LIST = new Set(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub', 'svg', 'apk', 'xpi', 'crx', 'vsix', 'nupkg', 'msix', 'appx', 'docm', 'xlsm', 'pptm']);
// Sites that hand out game mods: a plain .zip from one of them earns the one-line mod caution.
const MOD_HOSTS = ['curseforge.com', 'modrinth.com', 'nexusmods.com', 'moddb.com', 'gamebanana.com', 'spigotmc.org', 'planetminecraft.com', 'mod.io', 'steamcommunity.com', 'roblox.com'];
// Hosts of one company that a download hops between on a normal day (github.com -> githubusercontent.com): one site, not three.
const SITE_GROUPS = [
  ['github.com', 'githubusercontent.com', 'githubassets.com', 'github.io'],
  ['google.com', 'googleusercontent.com', 'gstatic.com', 'googleapis.com', 'drive.google.com', 'withgoogle.com'],
  ['dropbox.com', 'dropboxusercontent.com'],
  ['discord.com', 'discordapp.com', 'discordapp.net', 'discord.gg'],
  ['microsoft.com', 'windowsupdate.com', 'azureedge.net', 'windows.net', 'live.com', 'onedrive.com', '1drv.ms', 'sharepoint.com'],
  ['mediafire.com', 'mediafire.net'],
  ['sourceforge.net', 'sf.net', 'fastly.net'],
  ['cloudflare.com', 'cloudflarestorage.com', 'r2.dev', 'cloudfront.net', 'amazonaws.com'],
  ['mozilla.org', 'mozilla.net', 'mozilla.com'],
  ['steampowered.com', 'steamstatic.com', 'steamcontent.com', 'valvesoftware.com'],
  ['roblox.com', 'rbxcdn.com'],
  ['curseforge.com', 'forgecdn.net', 'curse.com'],
  ['modrinth.com', 'modrinth.net'],
];

// ---- a zip's central directory (with zip64) ---------------------------------------------------------------------------------
function readAt(fs, fd, length, position) {
  const buf = Buffer.alloc(length);
  let got = 0;
  while (got < length) {
    const n = fs.readSync(fd, buf, got, length - got, position + got);
    if (n <= 0) break;
    got += n;
  }
  return got === length ? buf : buf.subarray(0, got);
}
const big = (v) => { const n = Number(v); if (!Number.isSafeInteger(n)) throw new Error('a size in the zip is out of range'); return n; };

// -> { entries: [{ name, flags, method, packed, size }], note, truncated }
function zipDirectory(fs, fd, fileSize) {
  const tailLen = Math.min(fileSize, 65557 + 20);
  const tail = readAt(fs, fd, tailLen, fileSize - tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 5 && tail[i + 3] === 6) { eocd = i; break; }
  if (eocd < 0) return { entries: [], note: 'the end of the zip is missing or damaged', truncated: false };
  const count = tail.readUInt16LE(eocd + 10);
  let dirSize = tail.readUInt32LE(eocd + 12), dirOffset = tail.readUInt32LE(eocd + 16);
  if (count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) return { entries: [], note: 'the zip64 end record is missing', truncated: false };
    const z64At = big(tail.readBigUInt64LE(loc + 8));
    if (z64At + 56 > fileSize) return { entries: [], note: 'the zip64 end record is outside the file', truncated: false };
    const z = readAt(fs, fd, 56, z64At);
    if (z.length < 56 || z.readUInt32LE(0) !== 0x06064b50) return { entries: [], note: 'the zip64 end record is damaged', truncated: false };
    dirSize = big(z.readBigUInt64LE(40)); dirOffset = big(z.readBigUInt64LE(48));
  }
  if (dirSize > MAX_DIR) return { entries: [], note: 'the file list is too large to read here', truncated: false };
  if (dirOffset + dirSize > fileSize) return { entries: [], note: 'the file list is outside the file', truncated: false };
  const dir = readAt(fs, fd, dirSize, dirOffset);
  const entries = [];
  let p = 0, truncated = false;
  while (p + 46 <= dir.length && dir.readUInt32LE(p) === 0x02014b50) {
    if (entries.length >= MAX_ENTRIES) { truncated = true; break; }
    const flags = dir.readUInt16LE(p + 8), method = dir.readUInt16LE(p + 10);
    let packed = dir.readUInt32LE(p + 20), size = dir.readUInt32LE(p + 24);
    const nl = dir.readUInt16LE(p + 28), el = dir.readUInt16LE(p + 30), cl = dir.readUInt16LE(p + 32);
    if (p + 46 + nl + el > dir.length) break;
    if (size === 0xffffffff || packed === 0xffffffff) {
      let q = p + 46 + nl; const end = q + el;
      while (q + 4 <= end) {
        const id = dir.readUInt16LE(q), len = dir.readUInt16LE(q + 2);
        if (id === 1) {
          let r = q + 4;
          if (size === 0xffffffff && r + 8 <= q + 4 + len) { size = big(dir.readBigUInt64LE(r)); r += 8; }
          if (packed === 0xffffffff && r + 8 <= q + 4 + len) { packed = big(dir.readBigUInt64LE(r)); }
          break;
        }
        q += 4 + len;
      }
    }
    const name = dir.toString((flags & 0x800) !== 0 ? 'utf8' : 'latin1', p + 46, p + 46 + nl);
    entries.push({ name, flags, method, packed, size });
    p += 46 + nl + el + cl;
  }
  return { entries, note: '', truncated };
}

// ---- where it came from ---------------------------------------------------------------------------------------------------
function siteGroup(reg) {
  for (let i = 0; i < SITE_GROUPS.length; i++) if (SITE_GROUPS[i].includes(reg)) return 'g' + i;
  return reg;
}
const endsWithDomain = (host, d) => host === d || host.endsWith('.' + d);

// chain: every address the download went through, first to last. -> { url, scheme, host, threat, lookalike, noClick, sites, modHost }
function sourceFacts({ url, chain, noClick, threatCheck, lookalikeOf, registrable }) {
  const urls = [];
  for (const u of [].concat(chain || [], url ? [url] : [])) if (typeof u === 'string' && u && urls[urls.length - 1] !== u && !urls.includes(u)) urls.push(u);
  const finalUrl = url || urls[urls.length - 1] || '';
  // A file with no usable address (a blob or data download) has no source facts.
  const parsed = URL.canParse(finalUrl) ? new URL(finalUrl) : null;
  if (!parsed || !/^https?:$/.test(parsed.protocol)) return null;
  const host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
  let threat = false;
  for (const u of urls) { if (threatCheck && threatCheck(u)) { threat = true; break; } }
  const look = lookalikeOf ? lookalikeOf(host) : '';
  const seen = [];
  const names = [];
  for (const u of urls) {
    if (!URL.canParse(u)) continue;
    const h = new URL(u).hostname.toLowerCase().replace(/\.+$/, '');
    if (!h) continue;
    const reg = registrable ? registrable(h) : h;
    const g = siteGroup(reg);
    if (!seen.includes(g)) { seen.push(g); names.push(reg); }
  }
  return {
    url: finalUrl.slice(0, 300),
    scheme: parsed.protocol === 'http:' ? 'http' : 'https',
    host,
    threat,
    lookalike: look || '',
    noClick: !!noClick,
    sites: names,
    modHost: MOD_HOSTS.some(d => endsWithDomain(host, d)),
  };
}

// ---- everything -----------------------------------------------------------------------------------------------------------
// ctx: { fs, file, name, source: { url, chain, noClick, threatCheck, lookalikeOf, registrable }, signatureOf(file) -> Promise<{status,signer,timestamped}>,
//        listArchive: archive-list's listArchive + fileReader (for rar / 7z) }
async function gatherFacts(ctx) {
  const { fs, file } = ctx;
  if (!fs) throw new Error('gatherFacts needs fs');
  if (typeof file !== 'string' || !file) throw new Error('gatherFacts needs a file');
  const name = String(ctx.name || file.replace(/^.*[\\/]/, ''));
  const ext = extOf(name);
  const facts = { name, size: 0, checked: false, note: '', detected: '', archive: null, signature: null, source: null };
  facts.source = sourceFacts(ctx.source || {});
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw new Error('not a regular file');
    facts.size = st.size;
    const head = readAt(fs, fd, Math.min(HEAD, st.size), 0);
    const sig = detect(head);
    facts.checked = true;
    facts.detected = sig ? sig.kind : '';
    if (sig && sig.kind === 'zip' && st.size >= 22 && !NO_LIST.has(ext)) {
      try {
        const z = zipDirectory(fs, fd, st.size);
        facts.archive = z.entries.length ? { kind: 'zip', listed: true, entries: z.entries, truncated: z.truncated, note: '', encryptedNames: false }
          : { kind: 'zip', listed: false, entries: [], truncated: false, note: z.note, encryptedNames: false };
      } catch (err) {
        facts.archive = { kind: 'zip', listed: false, entries: [], truncated: false, note: err.message, encryptedNames: false };
      }
    } else if (sig && (sig.kind === 'rar' || sig.kind === '7z') && ctx.listArchive) {
      const { listArchive, fileReader } = ctx.listArchive;
      const r = listArchive(fileReader(fs, fd, st.size), sig.kind);
      if (!r.ok) facts.archive = { kind: sig.kind, listed: false, entries: [], truncated: false, note: String(r.error || 'the file list could not be read'), encryptedNames: false };
      else if (r.encrypted) facts.archive = { kind: sig.kind, listed: false, entries: [], truncated: false, note: '', encryptedNames: true };
      else facts.archive = { kind: sig.kind, listed: true, entries: r.entries.map(e => ({ name: e.dir ? e.name.replace(/\/?$/, '/') : e.name, flags: 0, method: 0, packed: 0, size: e.size || 0 })), truncated: !!r.truncated, note: '', encryptedNames: false };
    }
  } catch (err) {
    facts.checked = false;
    facts.note = err.message;
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
  // Only a file that really is a Windows program is asked about its signature; PowerShell reads it, nothing runs it.
  if (facts.checked && facts.detected === 'program' && (SIGNABLE_EXT.has(ext) || ext === 'dll') && typeof ctx.signatureOf === 'function') {
    const sig = await ctx.signatureOf(file);
    facts.signature = { status: String(sig && sig.status || 'unknown'), signer: String(sig && sig.signer || ''), timestamped: !!(sig && sig.timestamped) };
  }
  return facts;
}

module.exports = { gatherFacts, zipDirectory, sourceFacts, siteGroup, SITE_GROUPS, MOD_HOSTS, HEAD, DOC_ENDING, OFFICE_ZIP };
