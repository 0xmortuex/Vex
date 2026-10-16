// === Game cheats, exploit tools and fake updates, by the file's NAME (T3-010) ====
//
// The files a young gamer is most often handed to steal an account are not
// disguised as documents: they are what they say. "Delta Executor.exe",
// "AimbotInjector.zip", "Chrome_Update.exe" from a site that is not Google.
// The web-safety layer (web-safety.js, classifyDownload) already asks before
// keeping a program from a site with no standing; this is the part that
// recognises the vocabulary of the two scams that matter most here, so the
// question can say what is almost certainly true.
//
// Only the name and the address are read. A file's contents are never opened,
// scanned or uploaded, and nothing is looked up. A match is a reason to
// stop and read one plain sentence, never a verdict: the person can still
// download it, and can say "do not warn me about this site" (web-safety's own
// allow list, which this module does not touch).
//
// "Warn only when sure": a word has to be one that honest software essentially
// never carries, on a file that can run (or an archive that holds one).

// Programs, scripts and shortcuts Windows will run. A cheat tool is one of these
// or a compressed folder holding one.
const RUNNABLE_EXT = new Set(['exe', 'msi', 'msix', 'scr', 'bat', 'cmd', 'com', 'ps1', 'vbs', 'hta', 'lnk']);
const ARCHIVE_EXT = new Set(['zip', 'rar', '7z', 'iso', 'img']);

// Names that exist only for this. Any host: Discord's own CDN and GitHub are the
// places these are most often shared, so a well-known address does not excuse
// them. Matched inside the name with the separators taken out
// ("Delta_Executor-v2" -> "deltaexecutorv2").
const CORE = ['executor', 'executer', 'aimbot', 'wallhack', 'triggerbot', 'jjsploit', 'macsploit', 'krnl', 'fluxus'];

// Words that are right nearly always on a program, but that an honest site
// can also use (a "dependency injector" from GitHub). Whole words only, and
// only from a site that is not a known one.
const WIDE_PROGRAM = new Set(['injector', 'spoofer', 'cracked', 'crack', 'keygen', 'nulled', 'cheat', 'cheats', 'hack', 'hacks', 'exploit', 'modmenu']);
// In a compressed folder the generic words ("hacks.zip") are too ordinary to
// call; only the sharper ones count.
const WIDE_ARCHIVE = new Set(['injector', 'spoofer', 'cracked', 'keygen', 'nulled', 'modmenu']);
// Two words that belong together ("free robux", "robux generator").
const PHRASES = [/freerobux/, /robuxgenerator/, /robuxhack/, /freevbucks/, /vbucksgenerator/, /modmenu/];

// What a real update of each product is called and where it really comes from.
// A file named like an update, from anywhere else, is the scam. Domains are
// matched on the end of the host ("dl.google.com" is google.com).
const VENDORS = [
  { word: 'chrome', name: 'Chrome', domains: ['google.com', 'gstatic.com', 'googleapis.com'] },
  { word: 'firefox', name: 'Firefox', domains: ['mozilla.org', 'mozilla.net', 'mozilla.com'] },
  { word: 'opera', name: 'Opera', domains: ['opera.com'] },
  { word: 'brave', name: 'Brave', domains: ['brave.com'] },
  { word: 'edge', name: 'Edge', domains: ['microsoft.com', 'microsoftedge.com', 'windowsupdate.com', 'windows.net'] },
  { word: 'windows', name: 'Windows', domains: ['microsoft.com', 'windowsupdate.com', 'windows.com', 'windows.net'] },
  { word: 'discord', name: 'Discord', domains: ['discord.com', 'discordapp.com', 'discordapp.net'] },
  { word: 'roblox', name: 'Roblox', domains: ['roblox.com', 'rbxcdn.com'] },
  { word: 'steam', name: 'Steam', domains: ['steampowered.com', 'steamstatic.com', 'valvesoftware.com'] },
  { word: 'minecraft', name: 'Minecraft', domains: ['minecraft.net', 'mojang.com'] },
  { word: 'nvidia', name: 'NVIDIA', domains: ['nvidia.com'] },
  { word: 'java', name: 'Java', domains: ['java.com', 'oracle.com'] },
  { word: 'adobe', name: 'Adobe', domains: ['adobe.com'] },
  { word: 'zoom', name: 'Zoom', domains: ['zoom.us'] },
];
// Update-shaped names with no real owner: nobody ships a "browser update" or a
// "security update" installer, and Flash has been dead since 2020.
const GENERIC_UPDATE = ['browser', 'flash', 'flashplayer', 'security', 'system', 'antivirus'];

function extOf(filename) {
  const m = /\.([A-Za-z0-9]{1,12})\s*$/.exec(String(filename || ''));
  return m ? m[1].toLowerCase() : '';
}
function stem(filename) { return String(filename || '').replace(/\.[A-Za-z0-9]{1,12}\s*$/, ''); }
// "ChromeUpdate_v2" -> ["chrome", "update", "v2"]: the capitals are word breaks before the case is dropped.
function wordsOf(base) { return base.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); }
const UPDATE_WORDS = ['update', 'updates', 'updater', 'upgrade', 'patch'];
// The two words together, apart or fused ("chrome update", "chromeupdate", "update-chrome").
function together(words, a) {
  for (const u of UPDATE_WORDS) {
    if (words.includes(a) && words.includes(u)) return true;
    if (words.includes(a + u) || words.includes(u + a)) return true;
  }
  return false;
}
function endsWithDomain(host, domain) { return host === domain || host.endsWith('.' + domain); }

// → null, or { kind: 'cheat-tool' | 'fake-update', scope: 'core' | 'wide' | 'update', reason, word }
// host is the bare host the file came from (lower case), trusted: it is a known
// brand or a site the person uses (only the generic cheat words are excused there).
function inspectName(filename, host, { trusted = false } = {}) {
  const ext = extOf(filename);
  const runnable = RUNNABLE_EXT.has(ext);
  const archive = ARCHIVE_EXT.has(ext);
  if (!runnable && !archive) return null;
  const base = stem(filename);
  if (!base) return null;
  const words = wordsOf(base);
  const compact = words.join('');
  const bare = String(host || '').toLowerCase().replace(/^www\./, '');

  // 1. Names that only a cheat or exploit tool carries.
  const core = CORE.find(w => compact.includes(w));
  if (core) {
    return { kind: 'cheat-tool', scope: 'core', word: core,
      reason: `The name (“${filename}”) is how game cheat and exploit tools are named. Files like this are almost always stealers that take Discord, Roblox and browser logins, not working cheats.` };
  }
  if (!trusted) {
    const set = runnable ? WIDE_PROGRAM : WIDE_ARCHIVE;
    const wide = words.find(w => set.has(w)) || (PHRASES.find(p => p.test(compact)) ? 'phrase' : null);
    if (wide) {
      return { kind: 'cheat-tool', scope: 'wide', word: wide,
        reason: `The name (“${filename}”) uses a word from cheat, crack and free-currency downloads. Those are almost always stealers, and the site is not one you use.` };
    }
  }

  // 2. A product update that does not come from the product's own site. A
  //    well-known host does not excuse it (github.com is not Google's site).
  if (runnable) {
    for (const v of VENDORS) {
      if (!together(words, v.word)) continue;
      if (bare && v.domains.some(d => endsWithDomain(bare, d))) return null;
      return { kind: 'fake-update', scope: 'update', word: v.word,
        reason: `${v.name} updates itself or comes from ${v.domains[0]}, not from an “update” file on ${bare || 'this site'}. A fake update is one of the commonest ways malware is handed out.` };
    }
    const generic = GENERIC_UPDATE.find(g => together(words, g));
    if (generic) {
      return { kind: 'fake-update', scope: 'update', word: generic,
        reason: `Nobody ships a “${generic} update” as a download from a site. A fake update is one of the commonest ways malware is handed out.` };
    }
  }
  return null;
}

module.exports = { inspectName, RUNNABLE_EXT, ARCHIVE_EXT, CORE, WIDE_PROGRAM, WIDE_ARCHIVE, VENDORS };
