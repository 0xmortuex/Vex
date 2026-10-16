// === Video-aware watch-later (T3-039) ========================================
//
// Read Later (js/readlater.js) already keeps links and works out how long a page takes
// to READ; the reading queue (js/reading-queue.js) already answers "I have 20 minutes"
// from those lengths. A video has no words to count, so it never got a length and never
// fit anywhere. This saves a video INTO that same list, with what only the playing page
// knows:
//
//   duration   the length of the video
//   channel    who made it (the page's own author tag)
//   progress   how far you got
//   minutes    what is LEFT (duration minus progress), which is the number the queue
//              already uses, so "I have 20 minutes" now picks videos too
//
// "Save this video for later" reads the playing <video> in the tab in front, once, from
// a click or a command (the same read the video notes use, js/video-notes.js). "Update
// progress" does it again for the same page, and a video watched to the last 5% is marked
// finished. Opening a saved video from the Library or the queue continues from where you
// were (the link carries the time). Nothing is read in the background, nothing is
// fetched, and nothing leaves this computer.
//
// The list itself is Read Later's (vex.readLater); this adds a `video` field to an item.
const VideoLater = {
  KEYS: { on: 'vex.videoLater.enabled' },
  FEATURE: 'video-later',
  DONE_AT: 0.95,

  enabled() { return VexMediaKit.flag(this.KEYS.on, true); },
  setEnabled(on) { VexMediaKit.setFlag(this.KEYS.on, !!on); },

  // ---- pure --------------------------------------------------------------------------------
  // The page's own report of what is playing → a video record, or throws why not.
  fromPage(found, url, tabTitle = '') {
    if (!found || typeof found !== 'object') throw new Error('There is nothing playing on this page to save');
    const duration = Number(found.duration), progress = Math.max(0, Number(found.time) || 0);
    const live = !Number.isFinite(duration) || duration <= 0;
    const title = String(found.title || tabTitle || url).replace(/\s*[-|]\s*YouTube\s*$/i, '').trim().slice(0, 200) || url;
    const channel = String(found.channel || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const left = live ? 0 : Math.max(0, duration - progress);
    return {
      title, channel, live,
      video: { duration: live ? 0 : Math.round(duration), progress: Math.round(progress), channel },
      minutes: live ? 0 : Math.max(1, Math.ceil(left / 60)),
    };
  },
  done(v) { return !!v && v.duration > 0 && v.progress / v.duration >= this.DONE_AT; },
  // The same video, whatever tracking is on the address: YouTube by its v=, others by origin+path.
  sameVideo(a, b) {
    const key = (x) => {
      let u;
      try { u = new URL(String(x)); } catch { return String(x); }
      const host = u.hostname.replace(/^www\./, '');
      if (host === 'youtu.be') return 'yt:' + u.pathname.slice(1);
      if (/(^|\.)youtube\.com$/.test(host) && u.searchParams.get('v')) return 'yt:' + u.searchParams.get('v');
      return host + u.pathname;
    };
    return key(a) === key(b);
  },
  label(it) {
    const v = it.video;
    if (!v) return '';
    const mm = (s) => (typeof VideoNotes !== 'undefined' ? VideoNotes.stamp(s) : String(Math.round(s / 60)) + ' min');
    if (!v.duration) return 'video, live' + (v.channel ? ', ' + v.channel : '');
    return 'video, ' + mm(v.duration) + (v.progress > 5 ? ', at ' + mm(v.progress) : '') + (v.channel ? ', ' + v.channel : '');
  },

  // ---- reading the playing page ----------------------------------------------------------------
  script() {
    return `(() => {
      const list = [...document.querySelectorAll('video')].filter(v => v.duration || v.currentTime);
      const v = list.find(x => !x.paused) || list[0];
      if (!v) return null;
      const meta = (s, a) => { const n = document.querySelector(s); return n ? (n.getAttribute(a) || '') : ''; };
      const channel = meta('span[itemprop="author"] link[itemprop="name"]', 'content') || meta('meta[itemprop="author"]', 'content')
        || meta('meta[name="author"]', 'content') || meta('meta[property="og:site_name"]', 'content');
      return { time: v.currentTime, duration: v.duration, title: document.title, channel };
    })()`;
  },
  async _read() {
    if (typeof window.vexGuestEval !== 'function') throw new Error('Reading the playing page is not available in this window');
    const page = VexMediaKit.activePage();
    if (!page.wv) throw new Error('Open the video first');
    const found = await window.vexGuestEval(page.wv, this.script(), false, 6000);
    return { page, info: this.fromPage(found, page.url, page.title) };
  },
  _items() {
    if (typeof ReadLater === 'undefined') throw new Error('Read Later is not available in this window');
    return ReadLater.items;
  },

  // ---- saving and updating ------------------------------------------------------------------------
  async saveCurrent() {
    if (!this.enabled()) throw new Error('Video watch-later is switched off in Settings');
    const { page, info } = await this._read();
    const items = this._items();
    const have = items.find(i => i.video && !i.read && this.sameVideo(i.url, page.url));
    if (have) { this._apply(have, info); ReadLater.save(); VexMediaKit.toast('Already saved, progress updated: ' + this.label(have)); return have; }
    const item = { id: VexMediaKit.uid('rl'), url: page.url, title: info.title, at: VexMediaKit._now(), read: false, minutes: info.minutes, video: info.video };
    items.unshift(item);
    ReadLater.save();
    VexMediaKit.toast('Saved to watch later (' + this.label(item) + ')');
    return item;
  },
  _apply(item, info) {
    item.video = { ...item.video, ...info.video };
    item.minutes = info.minutes;
    if (!item.title || item.title === item.url) item.title = info.title;
    if (this.done(item.video)) { item.read = true; item.finishedAt = VexMediaKit._now(); }
  },
  async updateProgress() {
    if (!this.enabled()) throw new Error('Video watch-later is switched off in Settings');
    const { page, info } = await this._read();
    const item = this._items().find(i => i.video && this.sameVideo(i.url, page.url));
    if (!item) throw new Error('This video is not in your watch-later list. Save it first.');
    this._apply(item, info);
    ReadLater.save();
    VexMediaKit.toast(item.read ? 'Finished: ' + item.title : 'Progress kept: ' + this.label(item));
    return item;
  },
  // The address that continues the video where you left off.
  resumeUrl(item) {
    const p = item.video && item.video.progress;
    if (p > 5 && typeof VideoNotes !== 'undefined') return VideoNotes.link(item.url, p - 3);
    return item.url;
  },
  videos() { return this._items().filter(i => i.video && !i.read); },

  open() {
    const K = VexMediaKit;
    const { body, close } = K.dialog({ id: 'video-later', title: 'Videos to watch', sub: 'Saved videos with what is left of each. "I have N minutes" in the reading queue picks from these too.' });
    const draw = () => {
      body.textContent = '';
      const list = this.videos();
      if (!list.length) { body.appendChild(K.info('No saved videos. Open one and use "Save this video for later" in Ctrl+K.')); return; }
      const left = list.reduce((s, i) => s + (i.minutes || 0), 0);
      body.appendChild(K.info(list.length + ' video' + (list.length === 1 ? '' : 's') + ', about ' + K.span(left * 60000) + ' left in all.'));
      for (const it of list) {
        const r = K.el('div', 'setting-row');
        r.appendChild(K.el('span', '', it.title + ' (' + this.label(it) + ', ' + (it.minutes || '?') + ' min left)'));
        r.appendChild(K.button('Continue', () => { TabManager.createTab(this.resumeUrl(it), true); close(); }, { label: 'Continue ' + it.title }));
        r.appendChild(K.button('Finished', () => { it.read = true; it.finishedAt = K._now(); ReadLater.save(); draw(); }, { label: 'Mark ' + it.title + ' finished' }));
        body.appendChild(r);
      }
    };
    draw();
  },
  render(body) {
    const K = VexMediaKit;
    body.textContent = '';
    body.appendChild(K.info('Save a playing video into Read Later with its length, channel and how far you got. The reading queue\'s "I have N minutes" then picks videos as well as articles. Read only when you ask; nothing is fetched.'));
    body.appendChild(K.switchRow('Video-aware watch-later', this.enabled(), (on) => this.setEnabled(on)));
    body.appendChild(K.button('Videos to watch', () => this.open()));
  },
  init() {
    if (this._wired) return false;
    this._wired = true;
    const run = (p) => p.catch((err) => VexMediaKit.fail(err));
    VexMediaKit.register({
      id: 'video-later', title: 'Video watch-later', keywords: 'video watch later queue minutes youtube progress',
      render: (b) => this.render(b),
      commands: [
        { id: 'video-later-save', label: 'Save this video for later', hint: 'With its length, channel and how far you got', icon: 'video', action: () => run(this.saveCurrent()) },
        { id: 'video-later-progress', label: 'Update this video\'s progress', hint: 'Keep where you are in a saved video', icon: 'play', action: () => run(this.updateProgress()) },
        { id: 'video-later-list', label: 'Videos to watch', hint: 'Saved videos and what is left of each', icon: 'list', action: () => { try { this.open(); } catch (err) { VexMediaKit.fail(err); } } },
      ],
    });
    return true;
  },
};

if (typeof window !== 'undefined') window.VideoLater = VideoLater;
if (typeof module !== 'undefined' && module.exports) module.exports = { VideoLater };
