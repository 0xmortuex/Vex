// === Notes that point at a moment ==========================================
//
// Taking notes on a lecture, a match, a two-hour talk: the note says "he
// explains the caching bit here" and a week later "here" means watching twenty
// minutes again to find it. A note about a video is only worth having if it
// can take you back to the second it is about.
//
// So a note taken this way carries the time with it: "12:34 — the caching
// bit", written as a link, and clicking it opens the video at 12:34. One note
// per video, so a talk's notes are one page rather than twenty scattered
// lines.
const VideoNotes = {
  TAG: 'video',

  // mm:ss, or h:mm:ss once it is that long.
  stamp(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const two = (n) => String(n).padStart(2, '0');
    return h ? h + ':' + two(m) + ':' + two(sec) : m + ':' + two(sec);
  },

  // The same page, at that second. YouTube and Vimeo have their own way of
  // saying it; everything else gets the media fragment, which Chromium honours
  // for a plain <video>.
  link(url, seconds) {
    const t = Math.max(0, Math.floor(Number(seconds) || 0));
    let u;
    try { u = new URL(String(url)); } catch { return String(url || ''); }
    const host = u.hostname.replace(/^www\./, '');
    if (/^(youtube\.com|m\.youtube\.com|youtu\.be)$/.test(host)) {
      u.searchParams.set('t', t + 's');
      u.hash = '';
      return u.toString();
    }
    if (host === 'vimeo.com' || host === 'player.vimeo.com') { u.hash = '#t=' + t + 's'; return u.toString(); }
    u.hash = '#t=' + t;
    return u.toString();
  },

  // What is playing in the tab, and where it is up to.
  script() {
    return `(() => {
      // A podcast or a recorded call is worth marking a moment in too, so
      // audio counts as well as video.
      const list = [...document.querySelectorAll('video,audio')].filter(v => v.duration || v.currentTime);
      const v = list.find(x => !x.paused) || list[0];
      if (!v) return null;
      return { time: v.currentTime, duration: v.duration || 0, title: document.title };
    })()`;
  },

  _tab() {
    const tab = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(TabManager.activeTabId) : null;
    let url = '';
    try { url = (wv && wv.getURL && wv.getURL()) || (tab && tab.url) || ''; } catch { url = (tab && tab.url) || ''; }
    if (!wv || !/^https?:/i.test(url)) throw new Error('Open the video first');
    return { url, wv, title: (tab && tab.title) || '' };
  },

  async moment() {
    const t = this._tab();
    const found = await window.vexGuestEval(t.wv, this.script(), false, 6000);
    if (!found) throw new Error('There is nothing playing on this page to mark a moment in');
    return {
      url: t.url,
      title: String(found.title || t.title || '').replace(/\s*[-–—|]\s*YouTube\s*$/i, '').trim() || t.url,
      seconds: Number(found.time) || 0,
    };
  },

  // --- the note ------------------------------------------------------------

  _tasks() {
    if (typeof OpenTasks === 'undefined') throw new Error('Notes are not ready yet');
    return OpenTasks;
  },

  // A video's note is found by the video's address, which is kept on the note
  // so a retitled video does not start a second one.
  noteFor(video, notes) {
    const key = String(video.url).split('#')[0].replace(/[?&]t=[^&]*/g, '');
    return (notes || []).find(n => n && n.sourceUrl && String(n.sourceUrl) === key) || null;
  },

  line(video, text) {
    return '- [' + this.stamp(video.seconds) + '](' + this.link(video.url, video.seconds) + ') ' + String(text).replace(/\s+/g, ' ').trim();
  },

  add(video, text) {
    const t = String(text || '').trim();
    if (!t) throw new Error('Write the note first');
    const tasks = this._tasks();
    const notes = tasks.notes();
    let note = this.noteFor(video, notes);
    const now = new Date().toISOString();
    if (!note) {
      note = {
        id: 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        title: video.title,
        content: '',
        pinned: false,
        tags: [this.TAG],
        sourceUrl: String(video.url).split('#')[0].replace(/[?&]t=[^&]*/g, ''),
        sourceTitle: video.title,
        createdAt: now, updatedAt: now,
      };
      notes.unshift(note);
    }
    note.content = (note.content.replace(/\s+$/, '') + (note.content.trim() ? '\n' : '') + this.line(video, t)).replace(/^\n+/, '');
    note.updatedAt = now;
    tasks.writeNotes(notes, note.id);
    return note;
  },

  async note(text) {
    const video = await this.moment();
    const note = this.add(video, text);
    window.showToast?.('Noted at ' + this.stamp(video.seconds) + ' — the note links back to it');
    return note;
  },

  // Opens this video's note, if it has one.
  async show() {
    const t = this._tab();
    const note = this.noteFor({ url: t.url }, this._tasks().notes());
    if (!note) throw new Error('No notes on this video yet — take one with "Note This Moment"');
    if (typeof SidebarManager !== 'undefined') SidebarManager.openPanel('notes');
    if (typeof NotesPanel !== 'undefined' && NotesPanel.selectNote) NotesPanel.selectNote(note.id);
    return note.id;
  },
};

if (typeof window !== 'undefined') window.VideoNotes = VideoNotes;
if (typeof module !== 'undefined' && module.exports) module.exports = { VideoNotes };
