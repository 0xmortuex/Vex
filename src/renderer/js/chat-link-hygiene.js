// === Invite and link hygiene for chat links, and "is this safe to send" ====
//
// Two small checks that read nothing but the address. Nothing is fetched,
// nothing is looked up, and the page is never opened.
//
//   inspect(url, { openerUrl })
//     A link in Discord or Roblox is often not the link it shows: an open
//     redirect on the site's own address carries the real, unrelated
//     destination in a parameter. This unwraps those, says what kind of invite
//     it is (a server invite, a Nitro gift, a Roblox private-server link), and
//     flags the kinds that run out: a gift works once, a private-server link
//     lasts until its owner resets it, and a link that carries its own expiry
//     can already be dead.
//     What it can NOT know is whether a plain Discord invite has expired or
//     run out of uses: that is only on Discord's side. It says so.
//
//   sendVerdict(url)
//     Before a link is copied into a chat: is it a lookalike of a known site,
//     a shortener (the destination hidden), carrying tracking tags, sent
//     unencrypted, or carrying a secret in its address? Quiet when it is none
//     of those.
//
// Off until the person switches it on (Settings > Safer web). Public:
// ChatLinkHygiene.inspect, .sendVerdict, .menuItems, .enabled, .setEnabled.
const ChatLinkHygiene = {
  FEATURE: 'chat-link-hygiene',
  KEY: 'vex.safeWeb.linkHygiene',

  enabled() { try { return localStorage.getItem(this.KEY) === 'true'; } catch (err) { console.error('[ChatLinkHygiene] could not read its switch:', err); return false; } },
  setEnabled(on) { localStorage.setItem(this.KEY, on ? 'true' : 'false'); },

  FAMILIES: [
    { id: 'discord', label: 'Discord', hosts: ['discord.com', 'discordapp.com', 'discord.gg', 'discord.new', 'discord.gift', 'dis.gd', 'discordapp.net', 'discord.media'] },
    { id: 'roblox', label: 'Roblox', hosts: ['roblox.com', 'ro.blox.com', 'rbxcdn.com'] },
  ],
  // Words a fake of those names is built from. A name that has the brand AND one
  // of these, and is not the brand, is the classic "free nitro" address.
  LURE: ['gift', 'gifts', 'nitro', 'free', 'giveaway', 'robux', 'verify', 'login', 'signin', 'support', 'claim', 'promo', 'airdrop', 'drop', 'drops', 'events', 'steam', 'mod', 'mods', 'hack', 'generator'],
  // Parameters an open redirect hides its target in.
  REDIRECT_PARAMS: ['redirect_to', 'returnurl', 'return_url', 'redirect', 'redirecturl', 'url', 'next', 'continue', 'dest', 'destination', 'af_web_dp', 'target', 'u'],
  EXPIRY_PARAMS: ['expires', 'expiry', 'expires_at', 'expire', 'exp', 'ttl', 'valid_until', 'valid_till', 'validuntil'],
  ONCE_PARAMS: ['one_time', 'onetime', 'single_use', 'singleuse', 'once'],
  SHORTENERS: ['bit.ly', 't.co', 'tinyurl.com', 'goo.gl', 'is.gd', 'v.gd', 'cutt.ly', 'ow.ly', 'rb.gy', 'rebrand.ly', 'shorturl.at', 't.ly', 'tiny.cc', 'buff.ly', 'lnkd.in', 'dis.gd', 's.id', 'bl.ink', 'soo.gd', 'tr.ee', 'short.io', 'qr.ae', 'adf.ly', 'bc.vc', 'ouo.io', 'shorte.st', 'linktr.ee', 'l.ead.me', 'urlz.fr', 'hyperurl.co', 'clck.ru', 'gg.gg', 'han.gl', 'zpr.io'],

  _url(u) { try { const x = new URL(String(u)); return /^https?:$/.test(x.protocol) ? x : null; } catch { return null; } },
  _under(host, domain) { return host === domain || host.endsWith('.' + domain); },
  familyOf(url) {
    const u = typeof url === 'string' ? this._url(url) : url;
    if (!u) return null;
    const h = u.hostname.toLowerCase();
    return this.FAMILIES.find(f => f.hosts.some(d => this._under(h, d))) || null;
  },

  // Follow open-redirect wrappers on a chat site's own address to the page they
  // really send you to. Bounded; each hop is recorded.
  unwrap(url) {
    const hops = [];
    let cur = String(url || '');
    for (let i = 0; i < 4; i++) {
      const u = this._url(cur);
      if (!u || !this.familyOf(u)) break;
      // An OAuth screen shows Discord's own page; its redirect is where the app gets the result, not where this link goes.
      if (/oauth2/i.test(u.pathname)) break;
      let inner = null;
      for (const [k, v] of u.searchParams) {
        if (!this.REDIRECT_PARAMS.includes(k.toLowerCase())) continue;
        const t = this._url(v);
        if (t && t.hostname.toLowerCase() !== u.hostname.toLowerCase()) { inner = t.href; break; }
      }
      if (!inner) break;
      hops.push({ from: u.hostname, to: inner });
      cur = inner;
    }
    return { destination: cur, hops };
  },

  // What kind of invite the address is, if it is one. -> null | { kind, label, code, oneTime, expiring, expired, note }
  invite(url) {
    const u = this._url(url);
    if (!u) return null;
    const h = u.hostname.toLowerCase();
    const parts = u.pathname.split('/').filter(Boolean);
    const q = (k) => u.searchParams.get(k);
    let inv = null;
    const code = /^[A-Za-z0-9_-]{2,40}$/;
    if ((h === 'discord.gg' || h === 'www.discord.gg') && parts[0] && code.test(parts[0])) inv = { kind: 'discord-invite', label: 'Discord server invite', code: parts[0] };
    else if ((this._under(h, 'discord.com') || this._under(h, 'discordapp.com')) && parts[0] === 'invite' && parts[1] && code.test(parts[1])) inv = { kind: 'discord-invite', label: 'Discord server invite', code: parts[1] };
    else if (h === 'discord.gift' && parts[0]) inv = { kind: 'discord-gift', label: 'Discord Nitro gift', code: parts[0], oneTime: true };
    else if ((this._under(h, 'discord.com') || this._under(h, 'discordapp.com')) && parts[0] === 'gifts' && parts[1]) inv = { kind: 'discord-gift', label: 'Discord Nitro gift', code: parts[1], oneTime: true };
    else if (h === 'discord.new' && parts[0]) inv = { kind: 'discord-template', label: 'Discord server template', code: parts[0] };
    else if (this._under(h, 'roblox.com') && /^\/share(-links)?\/?$/i.test(u.pathname) && q('code')) inv = { kind: 'roblox-share', label: 'Roblox share link' + (q('type') ? ' (' + q('type') + ')' : ''), code: q('code'), expiring: true };
    else if (this._under(h, 'roblox.com') && q('privateServerLinkCode')) inv = { kind: 'roblox-private-server', label: 'Roblox private-server link', code: q('privateServerLinkCode'), expiring: true };
    else if (this._under(h, 'roblox.com') && /^\/games\/start\/?$/i.test(u.pathname) && q('gameInstanceId')) inv = { kind: 'roblox-live-server', label: 'Roblox link to one running server', code: q('gameInstanceId'), expiring: true };
    // An address that states its own expiry or single use, whatever the site.
    let carried = null;
    for (const [k, v] of u.searchParams) {
      const key = k.toLowerCase();
      if (this.EXPIRY_PARAMS.includes(key) && v) carried = { key, value: v };
      if (this.ONCE_PARAMS.includes(key) && v && !/^(0|false|no)$/i.test(v)) { inv = inv || { kind: 'link', label: 'Link' }; inv.oneTime = true; }
    }
    if (carried) {
      inv = inv || { kind: 'link', label: 'Link' };
      inv.expiring = true;
      let ms = null;
      if (/^\d{13}$/.test(carried.value)) ms = Number(carried.value);
      else if (/^\d{10}$/.test(carried.value)) ms = Number(carried.value) * 1000;
      else if (/^\d{4}-\d{2}-\d{2}/.test(carried.value)) { const t = Date.parse(carried.value); if (Number.isFinite(t)) ms = t; }
      if (ms != null) { inv.expiresAt = ms; inv.expired = ms < Date.now(); }
    }
    if (!inv) return null;
    inv.note = ({
      'discord-invite': 'Discord invites can be set to expire or to run out after a number of uses. Vex cannot tell from the address; Discord shows "invalid" if it has.',
      'discord-gift': 'A Nitro gift works once, for whoever opens it first. Real gifts come from someone you know and open on discord.com.',
      'discord-template': 'A template copies a server layout into a new server of yours. It does not join you to anyone.',
      'roblox-share': 'A share link can stop working when the person who made it changes it or it ages out.',
      'roblox-private-server': 'A private-server link works for anyone who has it until its owner resets it. Do not post it where strangers can see.',
      'roblox-live-server': 'This points at one running server, which closes when it empties, so it is only good for a short while.',
      link: inv.expired ? 'This link carries an expiry that has already passed.' : 'This link carries its own expiry or single-use mark.',
    })[inv.kind] || '';
    return inv;
  },

  // Everything worth saying about a link that came out of a chat page.
  // -> { url, destination, hops, family, openerFamily, invite, level: 'none'|'note'|'caution', lines[] }
  inspect(url, { openerUrl = '' } = {}) {
    const raw = String(url || '');
    const lines = [];
    const out = { url: raw, destination: raw, hops: [], family: null, openerFamily: null, invite: null, level: 'none', lines };
    const first = this._url(raw);
    if (!first) return out;
    out.family = this.familyOf(first);
    const opener = openerUrl ? this._url(openerUrl) : null;
    out.openerFamily = opener ? this.familyOf(opener) : null;
    const un = this.unwrap(raw);
    out.destination = un.destination;
    out.hops = un.hops;
    let level = 'none';
    const bump = (l) => { if (l === 'caution' || (l === 'note' && level === 'none')) level = l; };
    const dest = this._url(un.destination);
    const destFamily = dest ? this.familyOf(dest) : null;

    if (un.hops.length) {
      const last = dest ? dest.hostname : un.destination;
      lines.push(`This ${out.family ? out.family.label : 'site'} link is a redirect: it really goes to ${last}.`);
      bump(destFamily ? 'note' : 'caution');
    }
    if (out.openerFamily && dest && !destFamily) {
      lines.push(`It came from ${out.openerFamily.label} and leaves it for ${dest.hostname}.`);
      bump('note');
    }
    // The brand's name on someone else's address, with a lure word.
    if (dest && !destFamily) {
      const tokens = dest.hostname.toLowerCase().split(/[.-]/);
      for (const f of this.FAMILIES) {
        const brand = f.id;
        const named = tokens.some(t => t.includes(brand));
        if (named && tokens.some(t => this.LURE.includes(t)) && !this._under(dest.hostname.toLowerCase(), f.hosts[0])) {
          lines.push(`${dest.hostname} uses ${f.label}’s name with a come-on word, but it is not ${f.label}.`);
          bump('caution');
          break;
        }
      }
    }
    const inv = this.invite(un.destination) || (un.hops.length ? this.invite(raw) : null);
    if (inv) {
      out.invite = inv;
      lines.push(`${inv.label}${inv.oneTime ? ', one use' : ''}${inv.expiring ? ', may run out' : ''}. ${inv.note}`);
      bump(inv.expired ? 'caution' : 'note');
      // A gift or invite on an address that is not the site's own is the scam.
      if ((inv.kind === 'discord-gift' || inv.kind === 'discord-invite') && dest && !this.familyOf(dest)) bump('caution');
    }
    out.level = level;
    return out;
  },

  // -> { level: 'ok'|'note'|'caution', lines[], clean, changed }  Quiet ('ok', no lines) when nothing is wrong.
  sendVerdict(url) {
    const raw = String(url || '');
    const lines = [];
    let level = 'ok';
    const bump = (l) => { if (l === 'caution') level = 'caution'; else if (l === 'note' && level === 'ok') level = 'note'; };
    const u = this._url(raw);
    if (!u) return { level, lines, clean: raw, changed: false };
    const LS = globalThis.LinkSafety;
    const d = LS && typeof LS.describe === 'function' ? LS.describe(raw) : null;
    const clean = d ? d.clean : raw;
    if (d && d.lookalike) { lines.push('Careful: ' + d.lookalike.why); bump('caution'); }
    const host = u.hostname.toLowerCase();
    if (this.SHORTENERS.some(s => this._under(host, s))) { lines.push(`${host} is a link shortener, so the person you send it to cannot see where it goes.`); bump('note'); }
    if (d && d.wrapped) { lines.push('It was a redirect wrapper; the copy goes straight to the real address.'); bump('note'); }
    if (d && d.tracked) { lines.push('Its tracking tags were removed from the copy, so the person you send it to is not tied to you.'); bump('note'); }
    if (u.protocol === 'http:') { lines.push('It is not encrypted (http).'); bump('note'); }
    const secrets = this._secretParams(u);
    if (secrets.length) { lines.push(`Its address has ${secrets.join(', ')} in it. Anyone who gets the link may be able to use your sign-in.`); bump('caution'); }
    const chat = this.inspect(raw);
    for (const l of chat.lines) lines.push(l);
    if (chat.level === 'caution') bump('caution'); else if (chat.level === 'note') bump('note');
    return { level, lines, clean, changed: clean !== raw };
  },

  SECRET: /^(token|access_token|id_token|refresh_token|auth|auth_token|authorization|sid|sessionid|session_id|session|sess|api_key|apikey|secret|password|passwd|pwd|signature|jwt|otp)$/i,
  _secretParams(u) { return [...new Set([...u.searchParams.keys()].filter(k => this.SECRET.test(k)))].map(k => k + '='); },

  // Disabled info rows for a link's right-click menu: one line, only when the
  // link has something to say. The menu draws disabled items as plain text.
  menuItems(url, openerUrl) {
    if (!this.enabled()) return [];
    const r = this.inspect(url, { openerUrl });
    if (!r.lines.length) return [];
    const trim = (s) => (s.length > 90 ? s.slice(0, 87) + '...' : s);
    return [{ label: (r.level === 'caution' ? 'Careful: ' : 'Note: ') + trim(r.lines[0]), disabled: true }];
  },

  // What to say when a link is copied: -> null (nothing) | { text, kind: 'info'|'error' }.
  copyNote(url) {
    if (!this.enabled()) return null;
    const v = this.sendVerdict(url);
    if (v.level === 'ok' || !v.lines.length) return null;
    return { text: (v.level === 'caution' ? 'Before you send this: ' : 'Note: ') + v.lines[0] + (v.lines.length > 1 ? ` (+${v.lines.length - 1} more)` : ''), kind: v.level === 'caution' ? 'error' : 'info', lines: v.lines };
  },
};

if (typeof window !== 'undefined') window.ChatLinkHygiene = ChatLinkHygiene;
if (typeof module !== 'undefined' && module.exports) module.exports = { ChatLinkHygiene };
