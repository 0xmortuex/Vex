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
//   * Slides      "Grab slides" steps through a stretch of the video, takes a picture of the video
//                 area each few seconds, keeps a picture only when it differs from the last one kept
//                 (a new slide), and reads the words on each kept slide with the on-device OCR
//                 (Tesseract in this window). The result goes to a note as timestamped text.
//   * Brief       "Brief by chapter" asks YOUR LOCAL MODEL for a sentence or two per chapter from the
//                 captions of that chapter. Never the cloud; with no local model it says so.
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
  if (cmd === 'rect') {
    var r = v.getBoundingClientRect();
    return { x: Math.max(0, Math.round(r.left)), y: Math.max(0, Math.round(r.top)), width: Math.round(Math.min(r.right, innerWidth) - Math.max(0, r.left)), height: Math.round(Math.min(r.bottom, innerHeight) - Math.max(0, r.top)), time: v.currentTime, duration: v.duration || 0, paused: v.paused, protectedMedia: !!v.mediaKeys };
  }
  if (cmd === 'seekWait') {
    var target = Math.max(0, Math.min(Number(arg) || 0, v.duration || 1e9));
    v.pause();
    return new Promise(function (resolve) {
      var done = false;
      var fin = function () { if (done) return; done = true; v.removeEventListener('seeked', fin); setTimeout(function () { resolve({ time: v.currentTime }); }, 250); };
      v.addEventListener('seeked', fin);
      setTimeout(fin, 3000);
      v.currentTime = target;
    });
  }
  if (cmd === 'play') { var p = v.play(); return { playing: true, p: p ? 1 : 0 }; }
  if (cmd === 'pause') { v.pause(); return { playing: false }; }
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

  // ---- slides: frame differences and the note (pure) -------------------------------------------------------
  SLIDE: { gridW: 32, gridH: 18, threshold: 6, maxSlides: 60, maxSteps: 240, minStep: 2 },
  // RGBA pixels of a small picture -> grey levels (0 to 255), one per pixel.
  grayFromRgba(data) {
    const n = Math.floor(data.length / 4);
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
    return out;
  },
  // Mean absolute difference of two equally long grey pictures (0 to 255).
  frameDiff(a, b) {
    if (!a || !b || a.length !== b.length || !a.length) throw new Error('The two pictures are not the same size');
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / a.length;
  },
  isNewSlide(prev, cur, threshold = this.SLIDE.threshold) { return !prev || this.frameDiff(prev, cur) > threshold; },
  // Times to look at: from a to b every step seconds, at most maxSteps.
  scanTimes(a, b, step) {
    const s = Number(step);
    if (!(s >= this.SLIDE.minStep)) throw new Error('Look at least ' + this.SLIDE.minStep + ' seconds apart');
    if (!(b > a) || a < 0) throw new Error('The end must be after the start');
    const out = [];
    for (let t = a; t < b && out.length < this.SLIDE.maxSteps; t += s) out.push(Math.round(t * 100) / 100);
    return out;
  },
  // slides: [{ s, text }] -> Markdown lines with a time (a link when the page can be linked to a time).
  slidesNote(slides, link) {
    const lines = ['## Slides', ''];
    slides.forEach((x, i) => {
      const at = link ? link(x.s) : this.stamp(x.s);
      lines.push('### Slide ' + (i + 1) + ' ' + at, x.text ? x.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).join('\n') : '(no readable words)', '');
    });
    return lines.join('\n');
  },

  // ---- brief by chapter (pure parts) -------------------------------------------------------------------------
  // The caption text that falls inside chapter i, cut at maxChars.
  chapterText(lines, chapters, i, maxChars = 6000) {
    const from = chapters[i].s;
    const to = i + 1 < chapters.length ? chapters[i + 1].s : Infinity;
    return lines.filter(l => l.s >= from && l.s < to).map(l => l.t).join(' ').slice(0, maxChars);
  },
  chapterPrompt(title, text) {
    return 'Here are the captions of one chapter of a video, called "' + String(title).slice(0, 120) + '". Say what it covers in one or two plain sentences. Use only the captions. If they are too short to say, answer "Too little to say."\n\n' + text;
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
        AgentTools.saveNote(String(probe.title || 'Video').slice(0, 60) + ' (transcript)', parts.join('\n'), undefined, { origin: 'video-transcript' });
        say('Saved to Notes.');
      } catch (err) { say(err.message); }
    });
    tbar.append(search, saveNote);
    const linkFor = (s) => { let url = ''; try { url = wv.getURL(); } catch { /* vex-allow-empty-catch: a detached page; the line is saved without a link */ } return typeof VideoNotes !== 'undefined' && url ? '[' + this.stamp(s) + '](' + VideoNotes.link(url, s) + ')' : this.stamp(s); };
    const extras = document.createElement('div');
    extras.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:8px 14px;border-bottom:1px solid var(--border)';
    const out = document.createElement('div');
    out.style.cssText = 'padding:6px 14px;max-height:26vh;overflow:auto;font-size:12px';
    const stepIn = document.createElement('input'); stepIn.type = 'number'; stepIn.min = String(this.SLIDE.minStep); stepIn.value = '10'; stepIn.style.width = '64px'; stepIn.setAttribute('aria-label', 'Seconds between pictures');
    let results = null;
    extras.append(
      mk('Grab slides from A to B', guard(async () => {
        if (A == null || B == null) throw new Error('Set A and B first (Set A, then Set B and loop)');
        await this.control(wv, 'unloop');
        out.textContent = '';
        const slides = await this.grabSlides(wv, { a: A, b: B, step: Number(stepIn.value), onProgress: (i, n, k) => say('Looking at ' + i + ' of ' + n + ', ' + k + ' slide' + VexPlural.s(k) + ' so far') });
        results = { kind: 'slides', slides };
        for (const sl of slides) {
          const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:10px;margin:6px 0;align-items:flex-start';
          const im = document.createElement('img'); im.src = sl.dataUrl; im.alt = 'Slide at ' + this.stamp(sl.s); im.style.cssText = 'width:120px;border:1px solid var(--border);border-radius:4px';
          const tx = document.createElement('div'); tx.textContent = this.stamp(sl.s) + ' - ' + (sl.text || '(no readable words)');
          row.append(im, tx); out.append(row);
        }
        say(slides.length + ' slide' + VexPlural.s(slides.length) + ' found. Save them to a note.');
      })),
      stepIn, document.createTextNode('seconds apart'),
      mk('Brief by chapter (local model)', guard(async () => {
        out.textContent = '';
        const items = await this.briefByChapter(probe, { onProgress: (i, n) => say('Local model: chapter ' + i + ' of ' + n) });
        results = { kind: 'brief', items };
        for (const it of items) { const p = document.createElement('div'); p.textContent = this.stamp(it.s) + ' ' + it.t + ': ' + it.brief; p.style.margin = '4px 0'; out.append(p); }
        say('Written on this computer. Save it to a note.');
      })),
      mk('Save these to a note', guard(async () => {
        if (!results) throw new Error('Grab slides or make a brief first');
        if (typeof AgentTools === 'undefined') throw new Error('Notes are not available');
        const text = results.kind === 'slides' ? this.slidesNote(results.slides, linkFor) : this.briefNote(results.items, linkFor);
        AgentTools.saveNote(String(probe.title || 'Video').slice(0, 60) + (results.kind === 'slides' ? ' (slides)' : ' (brief)'), text);
        say('Saved to Notes.');
      })));

    body.append(controls, chapBox, tbar, extras, out, list, status);
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

  // The video area as a picture (the visible part of the window only): a region of the page, so it works for a
  // video from another site, and gives a black rectangle for protected video, which is refused up front.
  async _grab(wv) {
    const r = await this.control(wv, 'rect');
    if (r.protectedMedia) throw new Error('This video is protected, so its picture cannot be taken');
    if (!(r.width > 40 && r.height > 40)) throw new Error('Scroll the video into view first');
    if (typeof wv.capturePage !== 'function') throw new Error('This page cannot be photographed here');
    const img = await wv.capturePage({ x: r.x, y: r.y, width: r.width, height: r.height });
    if (!img || (typeof img.isEmpty === 'function' && img.isEmpty())) throw new Error('The picture came back empty');
    return { dataUrl: img.toDataURL(), rect: r };
  },
  async _gray(dataUrl) {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('The picture could not be read')); i.src = dataUrl; });
    const c = document.createElement('canvas');
    c.width = this.SLIDE.gridW; c.height = this.SLIDE.gridH;
    const g = c.getContext('2d');
    if (!g) throw new Error('A drawing surface could not be made');
    g.drawImage(img, 0, 0, c.width, c.height);
    return this.grayFromRgba(g.getImageData(0, 0, c.width, c.height).data);
  },
  async _ocr(dataUrl) {
    if (typeof DocExtract === 'undefined' || typeof DocExtract._loadOcr !== 'function') throw new Error('The text reader is not available here');
    const lib = await DocExtract._loadOcr();
    const { data } = await lib.recognize(dataUrl, 'eng');
    return String((data && data.text) || '').trim();
  },
  // Steps through a..b, keeps each picture that differs from the last kept one, reads its words.
  // -> [{ s, dataUrl, text }]. Puts the video back where it was.
  async grabSlides(wv, { a, b, step = 10, onProgress, threshold } = {}) {
    this._guard(wv);
    const times = this.scanTimes(a, b, step);
    const start = await this.control(wv, 'rect');
    const slides = [];
    let prev = null;
    const run = async () => {
      try {
        for (let i = 0; i < times.length; i++) {
          if (onProgress) onProgress(i + 1, times.length, slides.length);
          await this.control(wv, 'seekWait', times[i]);
          const shot = await this._grab(wv);
          const gray = await this._gray(shot.dataUrl);
          if (!this.isNewSlide(prev, gray, threshold)) continue;
          prev = gray;
          slides.push({ s: times[i], dataUrl: shot.dataUrl, text: await this._ocr(shot.dataUrl) });
          if (slides.length >= this.SLIDE.maxSlides) break;
        }
      } finally {
        await this.control(wv, 'seek', start.time);
        if (!start.paused) await this.control(wv, 'play');
      }
      return slides;
    };
    const r = typeof VexJobs !== 'undefined' && typeof VexJobs.heavy === 'function'
      ? await VexJobs.heavy('Video slides', run, { kind: 'ocr', feature: 'video-tools' })
      : { ran: true, value: await run() };
    if (!r.ran) throw new Error('Not now: ' + r.reason);
    if (typeof VexUsage !== 'undefined') VexUsage.touch('video-tools');
    return r.value;
  },
  // One sentence or two per chapter from the captions, by the LOCAL model only. -> [{ s, t, brief }]
  async briefByChapter(probe, { onProgress } = {}) {
    if (typeof VexStudyKit === 'undefined') throw new Error('The local model helper is not loaded');
    const lines = this.lines(probe);
    if (!lines.length) throw new Error('This page exposes no captions to brief from');
    const ch = this.chaptersFor(probe).list;
    if (ch.length < 1) throw new Error('There are no chapters to brief');
    const run = async () => {
      const out = [];
      for (let i = 0; i < ch.length; i++) {
        if (onProgress) onProgress(i + 1, ch.length);
        const text = this.chapterText(lines, ch, i);
        if (text.length < 40) { out.push({ s: ch[i].s, t: ch[i].t, brief: 'Too little to say.' }); continue; }
        const brief = await VexStudyKit.generateLocal('You summarise video captions in plain words. You never add anything that is not in them.', this.chapterPrompt(ch[i].t, text), { maxTokens: 120 });
        if (!brief) throw new Error('The local model returned nothing for "' + ch[i].t + '"');
        out.push({ s: ch[i].s, t: ch[i].t, brief });
      }
      return out;
    };
    const r = typeof VexJobs !== 'undefined' && typeof VexJobs.heavy === 'function'
      ? await VexJobs.heavy('Video brief', run, { kind: 'summary', feature: 'video-tools' })
      : { ran: true, value: await run() };
    if (!r.ran) throw new Error('Not now: ' + r.reason);
    return r.value;
  },
  briefNote(items, link) {
    return ['## Brief by chapter', ''].concat(items.map(x => '- ' + (link ? link(x.s) : this.stamp(x.s)) + ' **' + x.t + '**: ' + x.brief)).join('\n');
  },

  async openActive() {
    const wv = typeof WebviewManager !== 'undefined' && typeof TabManager !== 'undefined' ? WebviewManager.webviews.get(TabManager.activeTabId) : null;
    return this.open(wv);
  },
};

if (typeof window !== 'undefined') window.VideoTools = VideoTools;
if (typeof module !== 'undefined' && module.exports) module.exports = { VideoTools, vexVideoProbe, vexVideoControl };
