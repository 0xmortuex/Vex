// === Share a space: a whole working set-up as one small file or link, never anything personal ============================================
//
// A space is the tabs of one workspace (their addresses and titles), how they are grouped, optionally the sidebar folder layout and the look.
// It goes out as a .vexspace file (readable JSON, so anyone can open it in a text editor and see everything that is in it) or as
// vex://space?d=<base64url of the deflated same JSON>. There is no server and no account: the data is in the file or in the link.
//
// PRIVACY BY CONSTRUCTION. The export is built field by field from the tabs (collect()), never by copying storage, and it is rebuilt from
// the checked values on the way out (validate() returns a new object), so a field this file does not list cannot get in. Left out, and
// counted for the person: private, Tor, routed, off-the-record and container tabs, the essentials, Vex's own pages, files, anything on this
// computer or its network, an address with a name and password in it, sign-in / reset / verification pages. Every address is CLEANED first:
// parameters that look like a secret (token, session, key, auth, code, password, signature, X-Amz-*, a long random string...) and
// fragments that are not a plain anchor are removed, and the person sees each change and can untick any tab. Never in it: cookies, logins,
// form data, history, passwords, tokens, notes, favicons, scroll positions, or the tab's session.
//
// A FILE OR LINK COMING IN IS HOSTILE. A size cap before and after inflating, exactly the fields listed here and no others, a version number
// (a newer file is refused with a clear message), http(s) addresses only (javascript:, data:, file:, vex: are refused), no address with
// credentials or on a private network, the same cleaning as on the way out, at most 60 tabs (the rest are dropped and the person is told),
// and nothing is opened, loaded or evaluated until the person presses Apply in the review. The review shows the real host name of each
// address (a punycode name as punycode and as it would be drawn) and flags look-alikes and reported dangerous sites (main/space-check.js).
// A file has no signature: the review says "from a file you opened, not verified".
//
// Applying puts the tabs in a NEW workspace, asleep until visited; nothing of the person's own is replaced (the sidebar folders, which are
// one layout for the whole window, are only changed when that box is ticked, and Undo gives them back). Undo removes the new workspace.
//
//   VexShareSpace.collect({ groupId? })          -> what could be shared from this window, with what was left out and why
//   VexShareSpace.build(collection, choices)     -> a checked space
//   VexShareSpace.validate(data, env?)           -> { space, refused, cleaned, truncated } or an Error saying what is wrong
//   VexShareSpace.parse(text, env?)              -> the same, from a file's text or a vex://space link (async: inflating)
//   VexShareSpace.toFile(space) / toLink(space) / toText(space)
//   VexShareSpace.apply(space, what)             -> Promise<{ workspaceId, skipped: [] }>
//   VexShareSpace.undo() / hasUndo()
(function () {
  'use strict';
  var FORMAT = 'vex-space';
  var VERSION = 1;
  var FILE_MAX = 96 * 1024;                   // bytes of JSON, in a file and after inflating a link
  var LINK_MAX = 7000;                        // characters of link data that still travel well through chats and mail
  var LINK_PARSE_MAX = 16000;                 // the most link data that is looked at at all
  var LINK_PREFIX = 'vex://space?d=';
  var TAB_MAX = 60;
  var GROUP_MAX = 12;
  var URL_MAX = 2048;
  var TITLE_MAX = 100;
  var NAME_MAX = 40;
  var GROUP_NAME_MAX = 30;
  var SIDEBAR_GROUP_MAX = 16;
  var SIDEBAR_PANEL_MAX = 40;
  var ENABLED_KEY = 'vex.shareSpace.enabled';
  var UNDO_KEY = 'vex.shareSpace.undo';
  var FIELDS = ['format', 'version', 'name', 'color', 'groups', 'tabs', 'sidebar', 'look'];
  var TAB_FIELDS = ['url', 'title', 'group', 'pinned'];
  var GROUP_FIELDS = ['name', 'color'];
  var SIDEBAR_FIELDS = ['groups'];
  var SIDEBAR_GROUP_FIELDS = ['id', 'name', 'desc', 'icon', 'color', 'hidden', 'panels'];
  var HEX_RE = /^#[0-9a-fA-F]{6}$/;
  var PANEL_RE = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;

  var W = function () { return typeof window !== 'undefined' ? window : globalThis; };
  function need(name, obj) { if (!obj) throw new Error('Share a space needs ' + name + ' to be loaded'); return obj; }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  // ---- The switch ------------------------------------------------------------------------------------------------------------------------------
  function enabled() { try { return W().localStorage.getItem(ENABLED_KEY) !== 'false'; } catch (err) { throw new Error('Could not read the Share a space switch: ' + err.message, { cause: err }); } }
  function setEnabled(on) { W().localStorage.setItem(ENABLED_KEY, on ? 'true' : 'false'); }
  function requireOn() { if (!enabled()) throw new Error('Share a space is switched off (Settings > Feature switches)'); }

  // ---- Cleaning an address ---------------------------------------------------------------------------------------------------------------------
  // Why an address is left out, in the words the export dialog uses.
  var REASONS = {
    'private-tab': 'private, Tor or off-the-record tabs (they are meant to leave no trace)',
    'container': 'tabs in a container (their own logins stay in their container)',
    'routed': 'tabs that use a route of their own (a proxy or Tor)',
    'essential': 'essential tabs (they belong to every workspace, not to this one)',
    'vex-page': 'Vex’s own pages',
    'file': 'files on this computer',
    'internal': 'addresses on this computer or its network, and numeric addresses',
    'credentials': 'addresses with a name and password in them',
    'auth-page': 'sign-in, verification, reset and log-out pages',
    'bad-scheme': 'addresses that are not web pages',
    'too-long': 'addresses that are too long to share',
    'invalid': 'addresses that could not be read',
    'duplicate': 'the same address twice',
  };

  var SECRET_WORDS = ['token', 'tok', 'session', 'sess', 'sid', 'ssid', 'key', 'apikey', 'auth', 'authorization', 'code', 'pass', 'passwd', 'password', 'pwd',
    'secret', 'jwt', 'sig', 'signature', 'credential', 'credentials', 'cred', 'otp', 'ticket', 'nonce', 'csrf', 'xsrf', 'bearer', 'magic', 'assertion',
    'hash', 'sas', 'jsessionid', 'phpsessid', 'sessionid', 'email', 'mail', 'username', 'login', 'phone'];
  var SECRET_SUBSTR = /(token|secret|passw|session|signature|apikey|api[-_]?key|credential|jsessionid|phpsessid|authorization|bearer|csrf|xsrf)/i;
  var SECRET_PREFIX = /^(x-amz-|x-goog-|x-ms-|googleaccessid|awsaccesskeyid)/i;
  var TRACKING_NAME = /^(utm_[a-z0-9_]*|fbclid|gclid|dclid|msclkid|yclid|igshid|mc_eid|mc_cid|_hsenc|_hsmi|twclid|ttclid|li_fat_id)$/i;
  var JWT_RE = /^eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*$/;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var AUTH_PATH_RE = /\/(reset[-_ ]?password|password[-_ ]?reset|forgot[-_ ]?password|verify|verification|confirm|confirmation|activate|activation|magic[-_ ]?link|unsubscribe|oauth2?|callback|logout|log-out|signout|sign-out|authorize|saml2?|sso|redeem)(\/|$|\.)/i;
  var SHARE_PATH_RE = /\/(invite|invites|join|accept|share|shared)\/[^/]{6,}/i;
  var PRIVATE_SUFFIX_RE = /\.(local|localhost|internal|lan|home|corp|intranet|private|localdomain|onion|arpa)$/;

  function entropy(s) {
    var counts = {};
    for (var i = 0; i < s.length; i++) counts[s[i]] = (counts[s[i]] || 0) + 1;
    var h = 0;
    Object.keys(counts).forEach(function (c) { var p = counts[c] / s.length; h -= p * Math.log2(p); });
    return h;
  }
  function randomLooking(v, minLen) {
    if (v.length < minLen || !/^[A-Za-z0-9+/_=.~-]+$/.test(v) || !/[0-9]/.test(v) || !/[A-Za-z]/.test(v)) return false;
    var seps = (v.match(/[-_.]/g) || []).length;
    return seps <= v.length / 12 && entropy(v) >= 3.4;       // a slug like how-to-build-a-treehouse-2024 has many separators
  }
  function looksSecretValue(v) {
    if (!v) return false;
    if (JWT_RE.test(v) || UUID_RE.test(v) || /^[0-9a-f]{32,}$/i.test(v)) return true;
    if (/@[^\s@]+\.[^\s@]+/.test(v)) return true;                    // an e-mail address
    return randomLooking(v, 24);
  }
  function nameWords(name) { return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); }
  function secretName(name) {
    if (SECRET_PREFIX.test(name) || SECRET_SUBSTR.test(name)) return true;
    return nameWords(name).some(function (w) { return SECRET_WORDS.indexOf(w) >= 0; });
  }
  function safeDecode(s) { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch (err) { return s; } }   // a bad escape is checked as it is written

  function privateHost(host) {
    if (!host) return true;
    if (host === 'localhost' || /\.localhost$/.test(host)) return true;
    if (host.charAt(0) === '[') return true;                          // an IPv6 literal
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;            // any IPv4 literal: private ones must not leave, public ones are not a site name
    if (host.indexOf('.') < 0) return true;                           // one word: a name on the local network
    return PRIVATE_SUFFIX_RE.test(host);
  }

  // One address -> { ok: true, url, changes: [], warnings: [] } or { ok: false, code }. `changes` name what was taken out (never its value).
  function cleanUrl(raw) {
    if (typeof raw !== 'string') return { ok: false, code: 'invalid' };
    var text = raw.trim();
    if (!text) return { ok: false, code: 'invalid' };
    if (/^(vex|about|chrome|edge|devtools|view-source|vex-[a-z]+):/i.test(text)) return { ok: false, code: 'vex-page' };
    if (/^file:/i.test(text)) return { ok: false, code: 'file' };
    var u;
    try { u = new URL(text); } catch (err) { return { ok: false, code: 'invalid' }; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, code: 'bad-scheme' };
    if (u.username || u.password) return { ok: false, code: 'credentials' };
    var host = u.hostname.toLowerCase().replace(/\.+$/, '');
    if (privateHost(host)) return { ok: false, code: 'internal' };
    if (AUTH_PATH_RE.test(u.pathname)) return { ok: false, code: 'auth-page' };
    var changes = [], warnings = [];

    // The query: each parameter is kept only if neither its name nor its value looks like a secret or a tracker.
    var keep = [];
    if (u.search) {
      var parts = u.search.slice(1).split('&');
      parts.forEach(function (part) {
        if (!part) return;
        var eq = part.indexOf('=');
        var name = safeDecode(eq < 0 ? part : part.slice(0, eq));
        var value = eq < 0 ? '' : safeDecode(part.slice(eq + 1));
        if (TRACKING_NAME.test(name)) { changes.push('removed "' + name.slice(0, 30) + '" (a tracking parameter)'); return; }
        // A playlist id ("list") is long and random but public.
        if (secretName(name) || (name.toLowerCase() !== 'list' && looksSecretValue(value))) { changes.push('removed "' + name.slice(0, 30) + '" (looks like a secret)'); return; }
        keep.push(part);
      });
    }
    // The fragment: a plain anchor stays; anything else (a route with state, a token) goes.
    var hash = '';
    if (u.hash && u.hash.length > 1) {
      var frag = u.hash.slice(1);
      if (/^[A-Za-z][A-Za-z0-9_.:-]{0,59}$/.test(frag) && !randomLooking(frag, 20)) hash = '#' + frag;
      else changes.push('removed the part after # (it may hold a session or a token)');
    }
    // The path: a long random segment is how a private link works. It is kept (a shared document is a shared link) but the person is told.
    var segs = u.pathname.split('/');
    if (segs.some(function (s) { return randomLooking(safeDecode(s), 28); }) || SHARE_PATH_RE.test(u.pathname)) {
      warnings.push('this address holds a long code: anyone with the link may get in');
    }
    var out = u.protocol + '//' + u.host + u.pathname + (keep.length ? '?' + keep.join('&') : '') + hash;
    if (out.length > URL_MAX) return { ok: false, code: 'too-long' };
    return { ok: true, url: out, changes: changes, warnings: warnings, host: host };
  }

  function cleanText(s, max, what) {
    if (typeof s !== 'string') throw new Error(what + ' must be text');
    var t = s.replace(/[\u0000-\u001f\u007f<>‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max).trim() : t;
  }
  function cleanTitle(title, host) {
    var t = typeof title === 'string' ? cleanText(title, TITLE_MAX, 'A title') : '';
    // A title is text the page chose: one that carries an e-mail address, an address of its own or something that looks like a secret is
    // replaced by the site name rather than shared.
    if (!t || /[^\s@]+@[^\s@]+\.[^\s@]+/.test(t) || /https?:\/\//i.test(t) || t.split(' ').some(looksSecretValue)) return host;
    return t;
  }

  // ---- What this build knows (the sidebar's ids), injectable for tests -------------------------------------------------------------------------
  function env() {
    var SG = W().VexSidebarGroups;
    return {
      sidebar: SG ? { builtin: SG.GROUPS.map(function (g) { return g.id; }), icons: SG.ICONS.concat(SG.GROUPS.map(function (g) { return g.icon; })), colors: SG.COLORS, essentials: SG.ESSENTIALS } : null,
      look: W().VexShareLook || null,
    };
  }

  // ---- Checking a space that came in (or is about to go out) -----------------------------------------------------------------------------------
  function onlyKeys(o, allowed, what) {
    Object.keys(o).forEach(function (k) {
      if (allowed.indexOf(k) < 0) throw new Error('That space has something a space does not (' + what + ': "' + String(k).slice(0, 30) + '")');
    });
  }

  function validateSidebar(sb, e) {
    if (!isObj(sb)) throw new Error('The sidebar part of that space is not a layout');
    if (!e.sidebar) throw new Error('This Vex has no sidebar folders to put that layout in');
    onlyKeys(sb, SIDEBAR_FIELDS, 'sidebar field');
    if (!Array.isArray(sb.groups) || sb.groups.length > SIDEBAR_GROUP_MAX) throw new Error('The sidebar part of that space has no list of folders, or too many (' + SIDEBAR_GROUP_MAX + ' at most)');
    var seenPanels = {}, seenIds = {};
    var groups = sb.groups.map(function (g) {
      if (!isObj(g)) throw new Error('A sidebar folder in that space is not a folder');
      onlyKeys(g, SIDEBAR_GROUP_FIELDS, 'sidebar folder field');
      var out = {};
      if (g.id != null) {
        if (typeof g.id !== 'string' || e.sidebar.builtin.indexOf(g.id) < 0) throw new Error('A sidebar folder in that space names a built-in folder this Vex does not have');
        if (seenIds[g.id]) throw new Error('A built-in sidebar folder is listed twice in that space');
        seenIds[g.id] = true;
        out.id = g.id;
      }
      if (g.name != null) { var n = cleanText(g.name, 24, 'A folder name'); if (n) out.name = n; }
      if (g.desc != null) { var d = cleanText(g.desc, 80, 'A folder description'); if (d) out.desc = d; }
      if (g.icon != null) { if (e.sidebar.icons.indexOf(g.icon) < 0) throw new Error('A sidebar folder in that space has an icon this Vex does not have'); out.icon = g.icon; }
      if (g.color != null && g.color !== '') { if (e.sidebar.colors.indexOf(g.color) < 0) throw new Error('A sidebar folder in that space has a colour that is not in the palette'); out.color = g.color; }
      if (g.hidden != null) { if (g.hidden !== true) throw new Error('A sidebar folder’s hidden flag must be true or left out'); out.hidden = true; }
      if (!out.id && !out.name) throw new Error('A sidebar folder of your own in that space needs a name');
      if (!Array.isArray(g.panels) || g.panels.length > SIDEBAR_PANEL_MAX) throw new Error('A sidebar folder in that space has no list of panels, or too many (' + SIDEBAR_PANEL_MAX + ' at most)');
      out.panels = g.panels.map(function (p) {
        if (typeof p !== 'string' || !PANEL_RE.test(p) || e.sidebar.essentials.indexOf(p) >= 0) throw new Error('A sidebar folder in that space lists something that is not a panel');
        if (seenPanels[p]) throw new Error('The panel "' + p + '" is in two sidebar folders of that space');
        seenPanels[p] = true;
        return p;
      });
      return out;
    });
    return { groups: groups };
  }

  // Whatever came in -> { space: a NEW object holding only checked values, refused: [{ n, host, reason }], cleaned: [{ n, changes }], truncated }.
  function validate(data, e) {
    e = e || env();
    if (!isObj(data)) throw new Error('That is not a Vex space');
    onlyKeys(data, FIELDS, 'field');
    if (data.format !== FORMAT) throw new Error('That is not a Vex space');
    if (!Number.isInteger(data.version) || data.version < 1) throw new Error('That space has no version');
    if (data.version > VERSION) throw new Error('That space was made by a newer Vex: update Vex to open it');
    var space = { format: FORMAT, version: VERSION };
    if (data.name != null) { var nm = cleanText(data.name, NAME_MAX, 'The name of a space'); if (nm) space.name = nm; }
    if (data.color != null) {
      if (typeof data.color !== 'string' || !HEX_RE.test(data.color)) throw new Error('The colour of that space is not a plain hex colour');
      space.color = data.color.toLowerCase();
    }

    var rawGroups = data.groups == null ? [] : data.groups;
    if (!Array.isArray(rawGroups) || rawGroups.length > GROUP_MAX) throw new Error('That space has no list of groups, or more than ' + GROUP_MAX);
    var groups = rawGroups.map(function (g) {
      if (!isObj(g)) throw new Error('A group in that space is not a group');
      onlyKeys(g, GROUP_FIELDS, 'group field');
      var name = cleanText(g.name, GROUP_NAME_MAX, 'A group name');
      if (!name) throw new Error('A group in that space has no name');
      var out = { name: name };
      if (g.color != null) {
        if (typeof g.color !== 'string' || !HEX_RE.test(g.color)) throw new Error('A group colour in that space is not a plain hex colour');
        out.color = g.color.toLowerCase();
      }
      return out;
    });

    if (!Array.isArray(data.tabs)) throw new Error('That space has no list of tabs');
    if (data.tabs.length > TAB_MAX * 10) throw new Error('That space lists far too many tabs (' + data.tabs.length + ')');
    var tabs = [], refused = [], cleaned = [], seen = {}, truncated = 0;
    data.tabs.forEach(function (t, i) {
      var n = i + 1;
      if (!isObj(t)) throw new Error('Tab ' + n + ' of that space is not a tab');
      onlyKeys(t, TAB_FIELDS, 'tab field');
      var c = cleanUrl(t.url);
      if (!c.ok) { refused.push({ n: n, host: '', reason: REASONS[c.code] || c.code, code: c.code }); return; }
      if (seen[c.url]) { refused.push({ n: n, host: c.host, reason: REASONS.duplicate, code: 'duplicate' }); return; }
      if (tabs.length >= TAB_MAX) { truncated++; return; }
      seen[c.url] = true;
      var out = { url: c.url };
      var title = cleanTitle(t.title, c.host);
      if (title && title !== c.host) out.title = title;
      if (t.group != null) {
        if (!Number.isInteger(t.group) || t.group < 0 || t.group >= groups.length) throw new Error('Tab ' + n + ' of that space names a group that is not in it');
        out.group = t.group;
      }
      if (t.pinned != null) { if (t.pinned !== true) throw new Error('Tab ' + n + ' of that space has a pinned flag that is not true'); out.pinned = true; }
      if (c.changes.length) cleaned.push({ n: n, host: c.host, changes: c.changes });
      tabs.push(out);
    });
    // A group nobody uses is not worth carrying; groups are renumbered so the file stays tidy.
    var used = {}, order = [];
    tabs.forEach(function (t) { if (t.group != null && used[t.group] == null) { used[t.group] = order.length; order.push(t.group); } });
    space.groups = order.map(function (gi) { return groups[gi]; });
    tabs.forEach(function (t) { if (t.group != null) t.group = used[t.group]; });
    space.tabs = tabs;
    if (data.sidebar != null) space.sidebar = validateSidebar(data.sidebar, e);
    if (data.look != null) {
      var SL = need('js/share-look.js', e.look);
      space.look = SL.validate(data.look);
    }
    return { space: space, refused: refused, cleaned: cleaned, truncated: truncated };
  }

  // ---- Text <-> space -----------------------------------------------------------------------------------------------------------------------
  function utf8(s) { return new TextEncoder().encode(s); }
  function b64url(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64url(text) {
    if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('That link is damaged (it has characters a space link never has)');
    var s;
    try { s = atob(text.replace(/-/g, '+').replace(/_/g, '/')); } catch (err) { throw new Error('That link is damaged (it is not valid link data)', { cause: err }); }
    var bytes = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes;
  }
  async function pipe(bytes, stream, cap) {
    var writer = stream.writable.getWriter();
    var reader = stream.readable.getReader();
    // A damaged stream rejects both ends; the read below is where it is raised, so the write's own rejection is only consumed.
    var wrote = writer.write(bytes).then(function () { return writer.close(); }).catch(function () { /* vex-allow-empty-catch: the failure is raised by the read below */ });
    var chunks = [], total = 0;
    try {
      for (;;) {
        var r = await reader.read();
        if (r.done) break;
        total += r.value.length;
        if (cap && total > cap) { await reader.cancel(); throw new Error('That is too big to be a space (it is over ' + Math.round(cap / 1024) + ' KB once unpacked)'); }
        chunks.push(r.value);
      }
    } finally { await wrote; }
    var out = new Uint8Array(total), at = 0;
    chunks.forEach(function (c) { out.set(c, at); at += c.length; });
    return out;
  }
  function needStreams() {
    if (typeof CompressionStream === 'undefined' || typeof DecompressionStream === 'undefined') throw new Error('This Vex cannot pack or unpack links (no compression in the window). Use a file instead');
  }
  function deflate(bytes) { needStreams(); return pipe(bytes, new CompressionStream('deflate-raw'), 0); }
  function inflate(bytes) {
    needStreams();
    return pipe(bytes, new DecompressionStream('deflate-raw'), FILE_MAX).catch(function (err) {
      if (/too big/.test(err.message)) throw err;
      throw new Error('That link is damaged (it does not unpack)', { cause: err });
    });
  }

  // The space as it would be written: every field re-checked, so only listed fields can be in it.
  function checked(space, e) { return validate(space, e).space; }
  function toFile(space, e) { return JSON.stringify(checked(space, e), null, 2) + '\n'; }
  async function toLink(space, e) {
    var packed = b64url(await deflate(utf8(JSON.stringify(checked(space, e)))));
    if (packed.length > LINK_MAX) throw new Error('This space is too big for a link (' + packed.length + ' characters, ' + LINK_MAX + ' at most). Share the file instead');
    return LINK_PREFIX + packed;
  }
  function isLink(text) { return typeof text === 'string' && text.trim().indexOf(LINK_PREFIX) === 0; }
  function describe(space) {
    var who = space.name ? space.name : 'A shared space';
    var hosts = {};
    space.tabs.forEach(function (t) { hosts[new URL(t.url).hostname] = true; });
    return { title: who, tabs: space.tabs.length, groups: space.groups.length, sites: Object.keys(hosts).length,
      summary: who + ': ' + space.tabs.length + ' tabs' + (space.groups.length ? ' in ' + space.groups.length + ' groups' : '') };
  }
  async function toText(space, e) {
    var s = checked(space, e);
    return describe(s).summary + '\nOpen it in Vex: paste this into Ctrl+K or the address bar\n' + await toLink(s, e);
  }
  async function parse(text, e) {
    if (typeof text !== 'string') throw new Error('That is not a Vex space');
    var t = text.trim();
    var json;
    if (isLink(t)) {
      var rest = t.slice(LINK_PREFIX.length);
      if (rest.length > LINK_PARSE_MAX) throw new Error('That link is too big to be a space');
      var bytes = await inflate(unb64url(rest));
      try { json = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (err) { throw new Error('That link is damaged (it is not text)', { cause: err }); }
    } else {
      if (utf8(text).length > FILE_MAX) throw new Error('That file is too big to be a space (' + Math.round(FILE_MAX / 1024) + ' KB at most)');
      json = t;
    }
    var data;
    try { data = JSON.parse(json); } catch (err) { throw new Error('That is not a Vex space (it is not JSON)', { cause: err }); }
    return validate(data, e);
  }

  // ---- The window as it is now -> what could be shared -------------------------------------------------------------------------------------------
  function sidebarOf(e) {
    var SG = W().VexSidebarGroups;
    if (!SG || !e.sidebar) return null;
    var raw = SG.rawDefs();
    if (raw == null) return null;                                    // never changed: there is nothing of the person's own to share
    var defs = SG.parseDefs(raw);
    var order = Array.isArray(defs.order) ? defs.order : defs.groups.map(function (g) { return g.id; });
    var byId = {};
    defs.groups.forEach(function (g) { byId[g.id] = g; });
    var list = order.filter(function (id) { return byId[id]; }).map(function (id) { return byId[id]; });
    defs.groups.forEach(function (g) { if (list.indexOf(g) < 0) list.push(g); });
    return { groups: list.map(function (g) {
      var o = {};
      if (e.sidebar.builtin.indexOf(g.id) >= 0) o.id = g.id;
      if (g.name) o.name = g.name;
      if (g.desc) o.desc = g.desc;
      if (g.icon) o.icon = g.icon;
      if (g.color) o.color = g.color;
      if (g.hidden) o.hidden = true;
      o.panels = (g.panels || []).slice();
      return o;
    }) };
  }

  // The tabs of this window -> items the person can untick, plus a count of what was left out and why. Nothing is read from a page.
  function collect(opts) {
    opts = opts || {};
    var w = W();
    var TM = need('js/tabs.js', typeof TabManager !== 'undefined' ? TabManager : w.TabManager);
    var policy = need('js/tab-policy.js', w.VexTabPolicy);
    if (policy.isPrivateWindow) throw new Error('A private window is never shared: its tabs are meant to leave no trace');
    if (typeof VexLock !== 'undefined' && VexLock.locked && VexLock.locked()) throw new Error('Vex is locked: unlock it to share a space');
    var tabs = TM.tabs.filter(function (t) { return !opts.groupId || t.groupId === opts.groupId; });
    var groupsById = {};
    TM.groups.forEach(function (g) { groupsById[g.id] = g; });
    var excluded = {}, items = [], seen = {};
    function left(code) { excluded[code] = (excluded[code] || 0) + 1; }
    tabs.forEach(function (t) {
      var part = t.partition || 'persist:main';
      if (part !== 'persist:main') {
        if (!/^persist:/.test(part)) return left('private-tab');
        if (/^persist:container-tor-|^persist:route-/.test(part)) return left(/tor/.test(part) ? 'private-tab' : 'routed');
        if (/^persist:container-/.test(part)) return left('container');
        return left('routed');
      }
      if (t.essential) return left('essential');
      if (typeof isStartPage === 'function' && isStartPage(t.url)) return left('vex-page');   // the New Tab page
      var c = cleanUrl(t.url);
      if (!c.ok) return left(c.code);
      if (seen[c.url]) return left('duplicate');
      seen[c.url] = true;
      var g = t.groupId && groupsById[t.groupId];
      items.push({
        key: String(items.length), url: c.url, title: cleanTitle(t.title, c.host), host: c.host,
        group: g ? cleanText(g.name || '', GROUP_NAME_MAX, 'A group name') || null : null,
        groupColor: g && typeof g.color === 'string' && HEX_RE.test(g.color) ? g.color.toLowerCase() : null,
        pinned: !!t.pinned, changes: c.changes, warnings: c.warnings,
        include: !c.warnings.length,                                  // a link that holds a long code starts unticked
      });
    });
    var reasons = Object.keys(excluded).map(function (code) { return { code: code, text: REASONS[code] || code, count: excluded[code] }; });
    var ws = w.WorkspaceManager && w.WorkspaceManager.getActive ? w.WorkspaceManager.getActive() : null;
    var SG = null, e = env();
    try { SG = sidebarOf(e); } catch (err) { throw new Error('Could not read your sidebar folders: ' + err.message, { cause: err }); }
    return {
      items: items,
      excluded: { total: reasons.reduce(function (a, r) { return a + r.count; }, 0), reasons: reasons },
      name: opts.groupId && groupsById[opts.groupId] ? cleanText(groupsById[opts.groupId].name || '', NAME_MAX, 'A name') : (ws && ws.name ? cleanText(ws.name, NAME_MAX, 'A name') : ''),
      color: ws && typeof ws.color === 'string' && HEX_RE.test(ws.color) ? ws.color.toLowerCase() : null,
      hasSidebar: !!SG, sidebar: SG,
    };
  }

  // The ticked items and choices -> a checked space. This is the ONLY way a space is made from the window.
  function build(collection, choices) {
    choices = choices || {};
    var items = collection.items.filter(function (it) { return choices.include ? choices.include.indexOf(it.key) >= 0 : it.include; });
    if (items.length > TAB_MAX) throw new Error('A space holds ' + TAB_MAX + ' tabs at most: untick some');
    var groupIndex = {}, groups = [];
    var tabs = items.map(function (it) {
      var t = { url: it.url };
      if (it.title && it.title !== it.host) t.title = it.title;
      if (it.pinned) t.pinned = true;
      if (choices.groups !== false && it.group) {
        if (groupIndex[it.group] == null) {
          if (groups.length >= GROUP_MAX) throw new Error('A space holds ' + GROUP_MAX + ' groups at most');
          groupIndex[it.group] = groups.length;
          groups.push(it.groupColor ? { name: it.group, color: it.groupColor } : { name: it.group });
        }
        t.group = groupIndex[it.group];
      }
      return t;
    });
    var space = { format: FORMAT, version: VERSION, groups: groups, tabs: tabs };
    var name = choices.name != null ? choices.name : collection.name;
    if (name && String(name).trim()) space.name = name;
    if (collection.color && choices.color !== false) space.color = collection.color;
    if (choices.sidebar && collection.sidebar) space.sidebar = collection.sidebar;
    if (choices.look) space.look = need('js/share-look.js', W().VexShareLook).capture();
    return checked(space);
  }

  // ---- Remembering what Apply did, and taking it back ---------------------------------------------------------------------------------------------
  function lsGet(k) { return W().localStorage.getItem(k); }
  function saveUndo(rec) {
    try { W().localStorage.setItem(UNDO_KEY, JSON.stringify(rec)); }
    catch (err) { throw new Error('Could not remember what was added, so Undo would not work: ' + err.message, { cause: err }); }
  }
  function readUndo() {
    var raw = lsGet(UNDO_KEY);
    if (!raw) return null;
    var rec;
    try { rec = JSON.parse(raw); } catch (err) { throw new Error('The saved Undo for a shared space is damaged', { cause: err }); }
    if (!isObj(rec) || rec.v !== 1) throw new Error('The saved Undo for a shared space is damaged');
    return rec;
  }
  function hasUndo() { return !!lsGet(UNDO_KEY); }

  function freshTabId() {
    var c = W().crypto;
    if (!c || typeof c.randomUUID !== 'function') throw new Error('This window cannot make tab ids');
    return 'tab-' + c.randomUUID();
  }
  function freshGroupId(n) { return 'grp_' + Date.now().toString(36) + n.toString(36) + Math.random().toString(36).slice(2, 6); }

  // `what`: { tabs, groups, sidebar, look } (booleans). `pick`: the indexes of the tabs the person kept ticked in the review (default all).
  async function apply(space, what, pick) {
    requireOn();
    var w = W();
    var v = checked(space);
    what = what || { tabs: true, groups: true, sidebar: false, look: false };
    if (!what.tabs && !what.sidebar && !what.look) throw new Error('Choose something to add');
    var WM = need('js/workspaces.js', w.WorkspaceManager);
    if (w.VexTabPolicy && w.VexTabPolicy.isPrivateWindow) throw new Error('A private window has no workspaces to add to');
    if (hasUndo()) {
      // One shared space can be undone at a time; the earlier one is kept for good.
      w.localStorage.removeItem(UNDO_KEY);
    }
    var rec = { v: 1, label: describe(v).title, at: Date.now(), wsId: null, prevWsId: null, sidebar: null, look: false };
    var skipped = [];
    var tabs = what.tabs ? v.tabs.filter(function (t, i) { return !pick || pick.indexOf(i) >= 0; }) : [];
    if (what.tabs && !tabs.length) throw new Error('No tab is ticked');
    try {
      if (what.look) {
        if (!v.look) skipped.push('That space has no look, so yours stays');
        else { await need('js/share-look.js', w.VexShareLook).apply(v.look); rec.look = true; }
      }
      if (what.sidebar) {
        if (!v.sidebar) skipped.push('That space has no sidebar folders, so yours stay');
        else {
          var SG = need('js/sidebar-groups.js', w.VexSidebarGroups);
          rec.sidebar = { raw: SG.rawDefs() };
          var ids = [];
          var defs = { v: 1, groups: v.sidebar.groups.map(function (g, i) {
            var o = {};
            o.id = g.id || ('g_' + Math.random().toString(36).slice(2, 8) + i.toString(36));
            if (g.id) o.builtin = true;
            ['name', 'desc', 'icon', 'color', 'hidden'].forEach(function (k) { if (g[k] != null) o[k] = g[k]; });
            o.panels = g.panels.slice();
            ids.push(o.id);
            return o;
          }), order: ids };
          SG.replaceDefs(defs);
        }
      }
      if (what.tabs) {
        var ws = WM.addWorkspace(v.name || 'Shared space', v.color || (WM.COLORS && WM.COLORS[1]) || '#6366f1');
        rec.wsId = ws.id;
        var gid = [];
        var gs = what.groups === false ? [] : v.groups;
        var fallback = (typeof GROUP_COLORS !== 'undefined' && GROUP_COLORS[0]) || '#6366f1';
        ws.groups = gs.map(function (g, i) { gid[i] = freshGroupId(i); return { id: gid[i], name: g.name, color: g.color || fallback, collapsed: false }; });
        ws.stacks = [];
        ws.tabs = tabs.map(function (t) {
          var host = new URL(t.url).hostname;
          return { id: freshTabId(), url: t.url, title: t.title || host, favicon: null, partition: null, pinned: !!t.pinned,
            groupId: what.groups !== false && t.group != null ? gid[t.group] : null, stackId: null, sleeping: true, muted: false,
            originalUrl: null, scrollPosition: null, keepAwakeUntil: 0, note: '', memBeforeSleep: null };
        });
        ws.activeTabIndex = 0;
        rec.prevWsId = WM.activeId;
        WM.save();
        WM.render();
      }
      saveUndo(rec);
    } catch (err) {
      // Half a space is worse than none: what was done goes back, then the failure is raised.
      try { await rollback(rec); }
      catch (back) { throw new Error('Could not add that space (' + err.message + ') and could not fully take it back (' + back.message + ')', { cause: err }); }
      throw err;
    }
    return { workspaceId: rec.wsId, skipped: skipped, count: tabs.length };
  }

  async function rollback(rec) {
    var w = W();
    var problems = [];
    if (rec.wsId) {
      var WM = w.WorkspaceManager;
      if (WM.workspaces.some(function (x) { return x.id === rec.wsId; })) {
        if (WM.activeId === rec.wsId) {
          var back = WM.workspaces.some(function (x) { return x.id === rec.prevWsId; }) ? rec.prevWsId : (WM.workspaces.find(function (x) { return x.id !== rec.wsId; }) || {}).id;
          if (!back) problems.push('there is no other workspace to go back to');
          else await WM.switchTo(back);
        }
        if (WM.activeId === rec.wsId) problems.push('the new workspace is still open');
        else await WM.deleteWorkspace(rec.wsId);
      }
    }
    if (rec.sidebar) {
      try { w.VexSidebarGroups.restoreDefs(rec.sidebar.raw); } catch (err) { problems.push('your sidebar folders: ' + err.message); }
    }
    if (rec.look && w.VexShareLook && w.VexShareLook.hasUndo()) {
      try { await w.VexShareLook.undo(); } catch (err) { problems.push('your look: ' + err.message); }
    }
    w.localStorage.removeItem(UNDO_KEY);
    if (problems.length) throw new Error(problems.join('; '));
  }

  async function undo() {
    var rec = readUndo();
    if (!rec) throw new Error('There is no shared space to undo');
    await rollback(rec);
    return rec.label || null;
  }

  // Opens the space in its new workspace (switching to it); the person's own workspace is saved by the switch.
  async function open(workspaceId) {
    var WM = need('js/workspaces.js', W().WorkspaceManager);
    await WM.switchTo(workspaceId);
    if (WM.activeId !== workspaceId) throw new Error('Could not switch to the new workspace');
  }

  var api = {
    FORMAT: FORMAT, VERSION: VERSION, FILE_MAX: FILE_MAX, LINK_MAX: LINK_MAX, LINK_PARSE_MAX: LINK_PARSE_MAX, LINK_PREFIX: LINK_PREFIX, TAB_MAX: TAB_MAX,
    GROUP_MAX: GROUP_MAX, NAME_MAX: NAME_MAX, UNDO_KEY: UNDO_KEY, ENABLED_KEY: ENABLED_KEY, FIELDS: FIELDS, REASONS: REASONS,
    enabled: enabled, setEnabled: setEnabled, requireOn: requireOn,
    cleanUrl: cleanUrl, cleanTitle: cleanTitle, collect: collect, build: build, validate: validate, parse: parse, isLink: isLink, describe: describe,
    toFile: toFile, toLink: toLink, toText: toText, apply: apply, undo: undo, hasUndo: hasUndo, open: open,
  };
  if (typeof window !== 'undefined') window.VexShareSpace = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = { VexShareSpace: api };
})();
