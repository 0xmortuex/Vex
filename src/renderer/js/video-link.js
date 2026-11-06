// === Copy a video link at the current time ========================================
//
// Ctrl+K "Copy Video Link at This Time", Ctrl+Alt+Shift+C, or right-click a video: copies a
// link that opens the video at the second it is on now.
//
//   YouTube     https://youtu.be/<id>?t=<s>     (with a playlist:  .../watch?v=<id>&list=<list>&t=<s>s)
//   Twitch VOD  https://www.twitch.tv/videos/<id>?t=1h2m3s
//   Vimeo       https://vimeo.com/<id>#t=<s>s
//   any other   <the page's address>#t=<s>      (a media fragment; a video element whose address carries it
//               starts there, and so does a page that reads it; a page that does not read it ignores it)
//
// A live stream, a Twitch clip and a video at its very start get the plain link, and the toast
// says so. A page with no video, or an address that is not a web page, is refused with a reason.
// The time is read from the page's main video when you press the key; nothing is kept or sent.
//
// buildLink() is pure: it takes an address, a number of seconds and whether the video is live.
const VexVideoLink = {
  FEATURE: 'video-link-time',
  EVAL_MS: 2500,

  // ---- pure ---------------------------------------------------------------------------
  // 3725 -> '1:02:05', 65 -> '1:05'
  clock(s) {
    const n = Math.max(0, Math.floor(s));
    const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), sec = n % 60;
    const two = (x) => String(x).padStart(2, '0');
    return h ? h + ':' + two(m) + ':' + two(sec) : m + ':' + two(sec);
  },
  // Twitch's own form: 1h2m3s, 2m3s, 45s
  twitchTime(s) {
    const n = Math.max(0, Math.floor(s));
    const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), sec = n % 60;
    return h ? h + 'h' + m + 'm' + sec + 's' : m ? m + 'm' + sec + 's' : sec + 's';
  },
  // Whole seconds, or null when the video is at its start (nothing to add) - or throws for a number that is not one.
  wholeSeconds(seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) throw new Error('Could not read the time of the video');
    const n = Math.floor(seconds);
    return n >= 1 ? n : null;
  },

  _fail(reason, message) { return { ok: false, reason, message }; },
  _ok(kind, url, extra) { return { ok: true, kind, url, seconds: null, note: '', ...extra }; },

  _youtubeId(u) {
    const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
    if (host !== 'youtube.com' && host !== 'youtube-nocookie.com' && host !== 'youtu.be') return null;
    const seg = u.pathname.split('/').filter(Boolean);
    let id = '';
    if (host === 'youtu.be') id = seg[0] || '';
    else if (seg[0] === 'watch') id = u.searchParams.get('v') || '';
    else if (['shorts', 'live', 'embed', 'v'].includes(seg[0])) id = seg[1] || '';
    else return { id: '', page: true };
    return { id: /^[A-Za-z0-9_-]{11}$/.test(id) ? id : '', page: true };
  },
  _twitchId(u) {
    const host = u.hostname.toLowerCase().replace(/^(www|m|player)\./, '');
    if (host === 'clips.twitch.tv') return { clip: true };
    if (host !== 'twitch.tv') return null;
    const seg = u.pathname.split('/').filter(Boolean);
    if (u.hostname.toLowerCase().startsWith('player.')) {
      const v = (u.searchParams.get('video') || '').replace(/^v/i, '');
      return /^\d+$/.test(v) ? { vod: v } : { live: true };
    }
    if (seg[0] === 'videos' && /^\d+$/.test(seg[1] || '')) return { vod: seg[1] };
    if (seg[1] === 'v' && /^\d+$/.test(seg[2] || '')) return { vod: seg[2] };
    if (seg[1] === 'clip' || seg[1] === 'clips') return { clip: true };
    return { live: true };
  },
  _vimeoId(u) {
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'vimeo.com' && host !== 'player.vimeo.com') return null;
    const seg = u.pathname.split('/').filter(Boolean);
    const i = seg.findIndex(x => /^\d{5,}$/.test(x));
    if (i < 0) return { id: '' };
    const hash = host === 'player.vimeo.com' ? (u.searchParams.get('h') || '') : (/^[0-9a-f]{8,12}$/.test(seg[i + 1] || '') ? seg[i + 1] : '');
    return { id: seg[i], hash: /^[0-9a-f]{8,12}$/.test(hash) ? hash : '' };
  },

  // -> { ok: true, kind, url, seconds, note } or { ok: false, reason, message }
  buildLink({ url, seconds, live = false } = {}) {
    let u;
    try { u = new URL(String(url)); } catch { return this._fail('not-a-page', 'This is not a page with an address Vex can link to'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return this._fail('not-a-page', 'Only a web page can be linked to at a time');
    let t;
    try { t = this.wholeSeconds(seconds); } catch (err) { return this._fail('no-time', err.message); }

    const yt = this._youtubeId(u);
    if (yt) {
      if (!yt.id) return this._fail('no-video', 'Open a video first: this YouTube page is not one video');
      const list = u.searchParams.get('list') || '';
      const plain = list ? 'https://www.youtube.com/watch?v=' + yt.id + '&list=' + encodeURIComponent(list) : 'https://youtu.be/' + yt.id;
      if (live) return this._ok('youtube', plain, { note: 'live' });
      if (t === null) return this._ok('youtube', plain, { note: 'start' });
      return this._ok('youtube', list ? plain + '&t=' + t + 's' : plain + '?t=' + t, { seconds: t });
    }

    const tw = this._twitchId(u);
    if (tw) {
      if (tw.clip) return this._ok('twitch', u.origin + u.pathname, { note: 'clip' });
      if (tw.live || live) return this._ok('twitch', tw.vod ? 'https://www.twitch.tv/videos/' + tw.vod : u.origin + u.pathname, { note: 'live' });
      const plain = 'https://www.twitch.tv/videos/' + tw.vod;
      if (t === null) return this._ok('twitch', plain, { note: 'start' });
      return this._ok('twitch', plain + '?t=' + this.twitchTime(t), { seconds: t });
    }

    const vm = this._vimeoId(u);
    if (vm) {
      if (!vm.id) return this._fail('no-video', 'Open a video first: this Vimeo page is not one video');
      const plain = 'https://vimeo.com/' + vm.id + (vm.hash ? '/' + vm.hash : '');
      if (live) return this._ok('vimeo', plain, { note: 'live' });
      if (t === null) return this._ok('vimeo', plain, { note: 'start' });
      return this._ok('vimeo', plain + '#t=' + t + 's', { seconds: t });
    }

    // Any other page: a media fragment. The fragment is kept when it is something else (a heading), added to when it is a
    // list of name=value pairs, and refused when the page uses it for its own routes (#/video/3, #!/watch).
    const bare = u.origin + u.pathname + u.search;
    if (live) return this._ok('generic', bare + u.hash, { note: 'live' });
    if (t === null) return this._ok('generic', bare + u.hash, { note: 'start' });
    const frag = u.hash.replace(/^#/, '');
    let next;
    if (!frag) next = 't=' + t;
    else if (/^[/!]/.test(frag)) return this._fail('route-fragment', 'This page uses the part of its address after # for its own navigation, so a time cannot be added to it');
    else {
      const parts = frag.split('&').filter(p => p && !/^t=/i.test(p));
      parts.push('t=' + t);
      next = parts.join('&');
    }
    return this._ok('generic', bare + '#' + next, { seconds: t });
  },

  // The sentence for the toast.
  message(r) {
    if (r.note === 'live') return 'Copied the link without a time, because this is a live stream: ' + r.url;
    if (r.note === 'clip') return 'Copied the link without a time, because a Twitch clip has no start time: ' + r.url;
    if (r.note === 'start') return 'Copied the link from the start: ' + r.url;
    return 'Copied the link at ' + this.clock(r.seconds) + ': ' + r.url;
  },

  // ---- the page ------------------------------------------------------------------------
  // Runs in a frame: the main video (a playing one first, then the biggest) with its time. -> null when there is none.
  readScript() {
    return '(() => { const list = Array.from(document.querySelectorAll("video")).filter(v => v.readyState > 0 || v.currentTime > 0 || v.duration); if (!list.length) return null; const area = (v) => { const r = v.getBoundingClientRect(); return r.width * r.height; }; list.sort((a, b) => (a.paused - b.paused) || (area(b) - area(a))); const v = list[0]; const badge = document.querySelector(".ytp-live-badge"); const ytLive = !!(badge && badge.offsetParent !== null && getComputedStyle(badge).display !== "none"); return { time: v.currentTime, duration: v.duration, live: v.duration === Infinity || ytLive, href: location.href, top: window === window.top }; })()';
  },
  // The first frame that has a video; the top frame wins a tie. -> { time, live, href, top } or null
  pick(results) {
    const found = (results || []).filter(f => f && f.ok && f.value && typeof f.value === 'object').map(f => f.value);
    return found.find(v => v.top) || found[0] || null;
  },

  async copyFromWebview(wv, fallbackUrl) {
    if (!wv) throw new Error('There is no page open');
    const r = await window.vexGuestEvalFrames(wv, this.readScript(), false, this.EVAL_MS);
    const hit = this.pick(r.results);
    if (!hit) throw new Error('There is no video on this page');
    const pageUrl = (typeof window.vexGuestUrl === 'function' ? window.vexGuestUrl(wv) : '') || fallbackUrl || '';
    // A player in a frame is linked by the frame's own address only when it is a site this knows how to link to.
    const url = hit.top ? pageUrl : hit.href;
    const built = this.buildLink({ url, seconds: hit.time, live: hit.live });
    if (!built.ok) throw new Error(built.message);
    if (!hit.top && built.kind === 'generic') throw new Error('The video is inside another site\'s frame, which has no address Vex can link to at a time');
    await navigator.clipboard.writeText(built.url);
    window.showToast?.(this.message(built), 'info');
    return built;
  },

  async copyActive() {
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    const wv = typeof WebviewManager !== 'undefined' && WebviewManager.getActiveWebview ? WebviewManager.getActiveWebview() : null;
    return this.copyFromWebview(wv);
  },
};

if (typeof window !== 'undefined') window.VexVideoLink = VexVideoLink;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexVideoLink };
