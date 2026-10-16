// === Video transcript, chapters and loop (T2-027) ============================
//
// For the HTML5 video on the page you are on:
//   * Transcript  the captions the page already carries (text tracks) or, on a page
//                 that shows its own transcript panel, that text. Searchable;
//                 click a line to jump there. Captions only.
//   * Chapters    the page's chapter track, or the "0:00 Intro / 3:12 Setup" list in
//                 its description. N and P jump to the next / previous chapter.
//                 With neither, the captions are cut into five-minute parts.
//   * Loop        A/B loop and a frame step, for the bit you are learning.
//
// Local only, and no media is downloaded or saved: nothing is read except caption
// text and chapter titles the page already exposes, and a DRM or cross-origin video
// keeps whatever it hides. Not read from private, Tor or routed tabs.
//
// The functions that run INSIDE the page (vexVideoProbe, vexVideoControl) use nothing
// from this file; the page is only ever asked, never told what to run.

function vexVideoProbe() {
  function pickVideo() {
    var list = Array.prototype.slice.call(document.querySelectorAll('video'));
    var best = null, area = -1;
    list.forEach(function (v) { var r = v.getBoundingClientRect(); var a = r.width * r.height; if (a > area && (v.duration || v.currentTime || v.readyState)) { best = v; area = a; } });
    return best;
  }
  var v = pickVideo();
  if (!v) return Promise.resolve(null);
  function text(el) { return String(el.innerText || el.textContent || '').trim(); }
  var tracks = [], cues = [], chapterTrack = [];
  var restore = [];
  var tt = v.textTracks;
  for (var i = 0; i < tt.length; i++) {
    var t = tt[i];
    if (t.kind !== 'captions' && t.kind !== 'subtitles' && t.kind !== 'chapters') continue;
    tracks.push({ kind: t.kind, label: t.label || '', lang: t.language || '' });
    if (t.mode === 'disabled') { restore.push([t, 'disabled']); t.mode = 'hidden'; }
  }
  return new Promise(function (resolve) { setTimeout(resolve, 700); }).then(function () {
    var chosen = null;
    for (var j = 0; j < tt.length; j++) {
      var tr = tt[j];
      if (!tr.cues || !tr.cues.length) continue;
      if (tr.kind === 'chapters' && !chapterTrack.length) {
        for (var c = 0; c < tr.cues.length; c++) chapterTrack.push({ s: tr.cues[c].startTime, t: String(tr.cues[c].text || '').trim() });
      } else if ((tr.kind === 'captions' || tr.kind === 'subtitles') && (!chosen || tr.mode === 'showing')) chosen = tr;
    }
    if (chosen) {
      for (var k = 0; k < chosen.cues.length && k < 20000; k++) {
        var q = chosen.cues[k];
        cues.push({ s: q.startTime, e: q.endTime, t: String(q.text || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() });
      }
    }
    restore.forEach(function (r) { r[0].mode = r[1]; });
    // A page that shows its own transcript panel (YouTube's, when opened).
    if (!cues.length) {
      var segs = document.querySelectorAll('ytd-transcript-segment-renderer');
      for (var s = 0; s < segs.length && s < 20000; s++) {
        var ts = segs[s].querySelector('.segment-timestamp'), tx = segs[s].querySelector('.segment-text');
        if (!ts || !tx) continue;
        cues.push({ s: -1, ts: text(ts), t: text(tx) });
      }
    }
    var desc = '';
    var d = document.querySelector('#description-inner, ytd-text-inline-expander, #description, [itemprop="description"]');
    if (d) desc = text(d).slice(0, 20000);
    if (!desc) { var m = document.querySelector('meta[name="description"], meta[property="og:description"]'); if (m) desc = String(m.content || '').slice(0, 5000); }
    return { title: document.title, duration: v.duration || 0, time: v.currentTime || 0, paused: v.paused, rate: v.playbackRate, tracks: tracks, cues: cues, chapterTrack: chapterTrack, description: desc };
  });
}

// cmd: 'seek' (arg seconds) | 'now' | 'loop' (arg {a,b}) | 'unloop' | 'step' (arg +1/-1 frames) | 'rate' (arg)
function vexVideoControl(cmd, arg) {
  var list = Array.prototype.slice.call(document.querySelectorAll('video'));
  var v = null, area = -1;
  list.forEach(function (x) { var r = x.getBoundingClientRect(); var a = r.width * r.height; if (a > area && (x.duration || x.currentTime || x.readyState)) { v = x; area = a; } });
  if (!v) return null;
  if (cmd === 'seek') { v.currentTime = Math.max(0, Math.min(Number(arg) || 0, v.duration || 1e9)); return { time: v.currentTime }; }
  if (cmd === 'now') return { time: v.currentTime, duration: v.duration || 0 };
  if (cmd === 'step') { v.pause(); v.currentTime = Math.max(0, v.currentTime + (arg > 0 ? 1 : -1) / 30); return { time: v.currentTime }; }
  if (cmd === 'rate') { v.playbackRate = Math.max(0.25, Math.min(Number(arg) || 1, 4)); return { rate: v.playbackRate }; }
  if (window.__vexLoopStop) { window.__vexLoopStop(); window.__vexLoopStop = null; }
  if (cmd === 'unloop') return { loop: null };
  if (cmd === 'loop') {
    var a = Number(arg && arg.a), b = Number(arg && arg.b);
    if (!(b > a) || a < 0) return { error: 'The end must be after the start' };
    var alive = true;
    window.__vexLoopStop = function () { alive = false; };
    var frame = function () {
      if (!alive) return;
      if (v.currentTime >= b || v.currentTime < a - 0.5) v.currentTime = a;
      requestAnimationFrame(frame);
    };
    v.currentTime = a;
    requestAnimationFrame(frame);
    return { loop: { a: a, b: b } };
  }
  return null;
}

const VideoTools = {
  PREF_KEY: 'vex.videoTools.enabled',
  SEGMENT_MINUTES: 5,

  enabled() { try { return localStorage.getItem(this.PREF_KEY) !== 'false'; } catch { return true; } },
  setEnabled(on) { localStorage.setItem(this.PREF_KEY, on ? 'true' : 'false'); },

  // ---- pure ----------------------------------------------------------------------
  stamp(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const two = (n) => String(n).padStart(2, '0');
    return h ? h + ':' + two(m) + ':' + two(sec) : m + ':' + two(sec);
  },
  parseStamp(text) {
    const parts = String(text || '').trim().split(':').map(Number);
    if (parts.length < 2 || parts.length > 3 || parts.some(n => !Number.isFinite(n) || n < 0)) return null;
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  },
  // "0:00 Intro" lines of a description. At least two, in order; else [].
  parseChapters(description) {
    const out = [];
    for (const line of String(description || '').split(/\r?\n/)) {
      const m = /^\W{0,3}((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[-–—:.)]*\s*(.{1,120})$/.exec(line.trim());
      if (!m) continue;
      const s = this.parseStamp(m[1]);
      if (s == null) continue;
      if (out.length && s <= out[out.length - 1].s) continue;
      out.push({ s, t: m[2].trim() });
      if (out.length >= 200) break;
    }
    return out.length >= 2 ? out : [];
  },
  // Cut the captions into parts of N minutes, each titled by its first words.
  segmentCues(cues, minutes = this.SEGMENT_MINUTES) {
    const real = (cues || []).filter(c => c && c.s >= 0 && c.t);
    if (!real.length) return [];
    const span = minutes * 60;
    const out = [];
    for (const c of real) {
      const slot = Math.floor(c.s / span);
      if (!out.length || out[out.length - 1].slot !== slot) {
        out.push({ slot, s: c.s, t: c.t.split(/\s+/).slice(0, 8).join(' ') + (c.t.split(/\s+/).length > 8 ? '…' : '') });
      }
    }
    return out.map(({ s, t }) => ({ s, t }));
  },
  // The chapters to show, and where they came from.
  chaptersFor(probe) {
    if (probe.chapterTrack && probe.chapterTrack.length) return { source: 'the page’s chapter track', list: probe.chapterTrack };
    const fromDesc = this.parseChapters(probe.description);
    if (fromDesc.length) return { source: 'the description', list: fromDesc };
    const seg = this.segmentCues(probe.cues);
    if (seg.length > 1) return { source: 'the captions, cut every ' + this.SEGMENT_MINUTES + ' minutes', list: seg };
    return { source: '', list: [] };
  },
  // Transcript lines with a real time (a page panel's "1:23" stamp is parsed).
  lines(probe) {
    return (probe.cues || []).map(c => ({ s: c.s >= 0 ? c.s : (this.parseStamp(c.ts) == null ? 0 : this.parseStamp(c.ts)), t: c.t })).filter(c => c.t);
  },
  filter(lines, q) {
    const needle = String(q || '').trim().toLowerCase();
    return needle ? lines.filter(l => l.t.toLowerCase().includes(needle)) : lines;
  },
  // Index of the chapter holding time `t`.
  chapterAt(chapters, t) {
    let at = -1;
    for (let i = 0; i < chapters.length; i++) if (chapters[i].s <= t + 0.25) at = i;
    return at;
  },
  neighbour(chapters, t, dir) {
    const at = this.chapterAt(chapters, t);
    if (dir > 0) return at + 1 < chapters.length ? chapters[at + 1] : null;
    // Previous: a few seconds into a chapter, "previous" restarts that chapter.
    if (at >= 0 && t - chapters[at].s > 3) return chapters[at];
    return at > 0 ? chapters[at - 1] : null;
  },

  // ---- the page -------------------------------------------------------------------
  _guard(wv) {
    if (!wv) throw new Error('Open the video first');
    const policy = window.VexTabPolicy;
    if (policy && !policy.canReadWebview(wv)) throw new Error('Video tools are not used in private, Tor or routed tabs');
  },
  async probe(wv) {
    this._guard(wv);
    const r = await window.vexGuestEval(wv, '(' + vexVideoProbe.toString() + ')()', false, 8000);
    if (!r) throw new Error('There is no video on this page');
    return r;
  },
  async control(wv, cmd, arg) {
    this._guard(wv);
    const r = await window.vexGuestEval(wv, '(' + vexVideoControl.toString() + ')(' + JSON.stringify(cmd) + ',' + JSON.stringify(arg == null ? null : arg) + ')', false, 4000);
    if (!r) throw new Error('There is no video on this page');
    if (r.error) throw new Error(r.error);
    return r;
  },

  async open(wv) {
    const probe = await this.probe(wv);
    if (typeof VexUsage !== 'undefined') VexUsage.touch('video-tools');
    const lines = this.lines(probe);
    const ch = this.chaptersFor(probe);
    const { body, overlay, close } = window.PageExport._sheet('Video: transcript, chapters, loop', 'vex-videotools-overlay');
    const btn = 'font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer';
    const mk = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.style.cssText = btn; b.textContent = label; b.addEventListener('click', fn); return b; };
    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    status.style.cssText = 'padding:6px 14px;font-size:11.5px;color:var(--text-muted)';
    const say = (m) => { status.textContent = m; };
    const guard = (fn) => async (...a) => { try { await fn(...a); } catch (err) { say(err.message || String(err)); } };
    let now = probe.time;
    const seek = guard(async (s) => { const r = await this.control(wv, 'seek', s); now = r.time; say('At ' + this.stamp(r.time)); });

    // loop controls
    let A = null, B = null;
    const loopLabel = document.createElement('span');
    loopLabel.style.cssText = 'font-size:11.5px;color:var(--text-muted)';
    const drawLoop = () => { loopLabel.textContent = A == null ? 'No loop' : 'Loop ' + this.stamp(A) + (B == null ? ' to …' : ' to ' + this.stamp(B)); };
    drawLoop();
    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border)';
    controls.append(
      mk('Set A', guard(async () => { A = (await this.control(wv, 'now')).time; B = null; drawLoop(); })),
      mk('Set B and loop', guard(async () => { B = (await this.control(wv, 'now')).time; await this.control(wv, 'loop', { a: A, b: B }); drawLoop(); say('Looping ' + this.stamp(A) + ' to ' + this.stamp(B)); })),
      mk('Clear loop', guard(async () => { await this.control(wv, 'unloop'); A = B = null; drawLoop(); say('Loop cleared'); })),
      mk('Frame back', guard(() => this.control(wv, 'step', -1))),
      mk('Frame forward', guard(() => this.control(wv, 'step', 1))),
      mk('0.75x', guard(() => this.control(wv, 'rate', 0.75))),
      mk('1x', guard(() => this.control(wv, 'rate', 1))),
      loopLabel);

    // chapters
    const chapBox = document.createElement('div');
    chapBox.style.cssText = 'padding:8px 14px;border-bottom:1px solid var(--border);max-height:20vh;overflow:auto';
    const chapHead = document.createElement('div');
    chapHead.style.cssText = 'font-size:11.5px;color:var(--text-muted);margin-bottom:4px';
    chapHead.textContent = ch.list.length ? 'Chapters, from ' + ch.source + '. N next, P previous.' : 'This page exposes no chapters or captions to build them from.';
    chapBox.append(chapHead);
    const row = (s, t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.cssText = 'display:flex;gap:10px;width:100%;text-align:left;background:none;border:none;color:var(--text);font-size:12.5px;padding:3px 4px;cursor:pointer';
      const a = document.createElement('span'); a.style.cssText = 'color:var(--text-muted);min-width:48px'; a.textContent = this.stamp(s);
      const c = document.createElement('span'); c.textContent = t;
      b.append(a, c);
      b.addEventListener('click', () => seek(s));
      return b;
    };
    for (const c of ch.list) chapBox.append(row(c.s, c.t));

    // transcript
    const search = document.createElement('input');
    search.type = 'search'; search.placeholder = 'Search the transcript'; search.setAttribute('aria-label', 'Search the transcript');
    search.style.cssText = 'flex:1;min-width:120px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:12px';
    const tbar = document.createElement('div');
    tbar.style.cssText = 'display:flex;gap:8px;padding:8px 14px';
    const list = document.createElement('div');
    list.style.cssText = 'padding:0 14px 10px;max-height:34vh;overflow:auto';
    const drawLines = () => {
      list.textContent = '';
      const shown = this.filter(lines, search.value).slice(0, 600);
      if (!lines.length) { const p = document.createElement('div'); p.style.cssText = 'font-size:12px;color:var(--text-muted)'; p.textContent = 'No captions are exposed by this page. If it has its own transcript panel, open it and try again.'; list.append(p); return; }
      for (const l of shown) list.append(row(l.s, l.t));
      if (!shown.length) { const p = document.createElement('div'); p.style.cssText = 'font-size:12px;color:var(--text-muted)'; p.textContent = 'No line matches.'; list.append(p); }
    };
    search.addEventListener('input', drawLines);
    const saveNote = mk('Save to a note', () => {
      try {
        if (typeof AgentTools === 'undefined') throw new Error('Notes are not available');
        let url = ''; try { url = wv.getURL(); } catch { /* vex-allow-empty-catch: a detached page; the note is saved without links */ }
        const link = (s) => (typeof VideoNotes !== 'undefined' && url ? '[' + this.stamp(s) + '](' + VideoNotes.link(url, s) + ')' : this.stamp(s));
        const parts = [];
        if (ch.list.length) parts.push('## Chapters', ...ch.list.map(c => '- ' + link(c.s) + ' ' + c.t), '');
        if (lines.length) parts.push('## Transcript', ...lines.map(l => link(l.s) + ' ' + l.t));
        AgentTools.saveNote(String(probe.title || 'Video').slice(0, 60) + ' (transcript)', parts.join('\n'));
        say('Saved to Notes.');
      } catch (err) { say(err.message); }
    });
    tbar.append(search, saveNote);

    body.append(controls, chapBox, tbar, list, status);
    drawLines();

    overlay.addEventListener('keydown', guard(async (e) => {
      if (e.target === search || e.ctrlKey || e.metaKey || e.altKey) return;
      const dir = e.key === 'n' || e.key === 'N' ? 1 : (e.key === 'p' || e.key === 'P' ? -1 : 0);
      if (!dir) return;
      e.preventDefault();
      now = (await this.control(wv, 'now')).time;
      const target = this.neighbour(ch.list, now, dir);
      if (!target) { say(dir > 0 ? 'That is the last chapter' : 'That is the first chapter'); return; }
      await seek(target.s);
      say(this.stamp(target.s) + ' ' + target.t);
    }));
    overlay.tabIndex = -1;
    overlay.focus({ preventScroll: true });
    return close;
  },

  async openActive() {
    const wv = typeof WebviewManager !== 'undefined' && typeof TabManager !== 'undefined' ? WebviewManager.webviews.get(TabManager.activeTabId) : null;
    return this.open(wv);
  },
};

if (typeof window !== 'undefined') window.VideoTools = VideoTools;
if (typeof module !== 'undefined' && module.exports) module.exports = { VideoTools, vexVideoProbe, vexVideoControl };
