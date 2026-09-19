// === Skip sponsor segments on YouTube (SponsorBlock) ========================
//
// SponsorBlock (sponsor.ajay.app) is a public, community-kept list of the
// parts of YouTube videos that are sponsor reads, self-promotion and "like and
// subscribe". When a YouTube video opens, Vex asks for that video's segments
// and the page jumps over one when playback reaches it, saying so for a
// moment in the corner. Only the video's id is sent — the same thing the
// SponsorBlock extension sends. Settings › Privacy turns it off.
const SponsorSkip = {
  KEY: 'vex.sponsorSkip',
  API: 'https://sponsor.ajay.app/api/skipSegments',
  CATEGORIES: ['sponsor', 'selfpromo', 'interaction'],
  _cache: new Map(),

  enabled() { try { return localStorage.getItem(this.KEY) !== 'off'; } catch { return true; } },
  setEnabled(on) { localStorage.setItem(this.KEY, on ? 'on' : 'off'); },

  // → [[start, end], ...] in seconds; [] when the video has none.
  async segments(videoId) {
    if (this._cache.has(videoId)) return this._cache.get(videoId);
    const url = this.API + '?videoID=' + encodeURIComponent(videoId) + '&categories=' + encodeURIComponent(JSON.stringify(this.CATEGORIES));
    const r = await (window.VexNet?.fetch || fetch)(url);
    let segs;
    if (r.status === 404) segs = [];                     // nobody has marked this video
    else if (!r.ok) throw new Error('SponsorBlock answered ' + r.status);
    else segs = (await r.json()).map(s => s.segment).filter(s => Array.isArray(s) && s[1] > s[0]).map(([a, b]) => [Number(a), Number(b)]);
    this._cache.set(videoId, segs);
    return segs;
  },

  // Runs INSIDE the YouTube page. The listener goes in once; each video's
  // segments replace the last (YouTube changes video without a reload).
  _pageScript(videoId, segs) {
    return `(() => {
      window.__vexSponsor = { id: ${JSON.stringify(videoId)}, segs: ${JSON.stringify(segs)} };
      if (window.__vexSponsorWired) return true;
      window.__vexSponsorWired = true;
      const say = (text) => {
        const n = document.createElement('div');
        n.textContent = text;
        n.style.cssText = 'position:fixed;right:18px;bottom:80px;z-index:2147483647;padding:8px 12px;border-radius:8px;background:rgba(0,0,0,0.82);color:#fff;font:13px system-ui;pointer-events:none';
        document.documentElement.appendChild(n);
        setTimeout(() => n.remove(), 2200);
      };
      const check = (v) => {
        const s = window.__vexSponsor;
        if (!s || !v || new URL(location.href).searchParams.get('v') !== s.id) return;
        for (const [a, b] of s.segs) {
          if (v.currentTime >= a && v.currentTime < b - 0.5) { v.currentTime = b; say('Skipped a sponsor segment (' + Math.round(b - a) + ' s)'); break; }
        }
      };
      // Playing, and seeking into a segment; the half-second look covers a
      // player that swaps its video element.
      for (const type of ['timeupdate', 'seeked']) document.addEventListener(type, (e) => { if (e.target instanceof HTMLVideoElement) check(e.target); }, true);
      setInterval(() => check(document.querySelector('video')), 500);
      return true;
    })()`;
  },

  async onNavigated({ tabId, url }) {
    if (!this.enabled()) return;
    let id = null;
    try { const u = new URL(url); if (/(^|\.)youtube\.com$/.test(u.hostname) && u.pathname === '/watch') id = u.searchParams.get('v'); } catch { id = null; }
    if (!id) return;
    const wv = WebviewManager.webviews.get(tabId);
    if (!wv) return;
    try {
      const segs = await this.segments(id);
      if (!segs.length) return;
      await window.vexGuestEval(wv, this._pageScript(id, segs));
    } catch (err) {
      window.VexProblems?.note('SponsorBlock', 'Could not get the segments for a video', err);
    }
  },

  init() {
    document.addEventListener('vex:tab-navigated', (e) => this.onNavigated(e.detail));
  },
};

if (typeof window !== 'undefined') window.SponsorSkip = SponsorSkip;
if (typeof module !== 'undefined' && module.exports) module.exports = { SponsorSkip };
