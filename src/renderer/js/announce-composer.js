// === Announcement composer with crosspost preview (T3-050) =========================
//
// One text for a release or an event, written once, shown as it will look on each
// place you post it, with how many characters each takes. COPY-OUT is the whole
// feature: Vex composes and previews; YOU paste it into Discord, a Roblox group,
// GitHub and wherever else. It posts nowhere by itself, on a schedule or at a time.
//
//   - per-target preview: the text adapted (Markdown kept for Discord and GitHub, turned
//     into plain text for places that show none), its length against the target's limit,
//     how far over, and a copy button for each;
//   - a checklist per draft: tick the places you have posted;
//   - "Remind me to post": a reminder at the hour you choose. It reminds. It does not send;
//   - a "share to community" queue: links you tag as good, each with a caption you write,
//     turned into one weekly draft;
//   - ONE exception to copy-out, only if you ask for it: if you give the address of a
//     webhook of your OWN Discord server, "Post to my Discord" can send the text there,
//     after a confirm that shows the exact message that will be sent. The address is
//     sealed by the operating system in the main process (main/comms-tools.js) and never
//     comes back to this window, to storage, to Vex Sync, to a backup or to a log.
//
// A staged send (Wave 5): "Stage a post for a time" keeps this text and a reminder for the hour you choose. At
// that hour a toast says "Time to post" with a "Review and send" button; the button opens the same confirm that
// shows the exact message, and only its Send sends. It never sends by itself, so a toast ignored or a Vex that
// was closed at the hour sends nothing: the staged post waits, marked as missed, until you send or remove it.
// It needs the webhook of your own server to be saved first.
//
// The limits are the places' published limits and they change; each is editable. A text
// that does not fit is never cut for you: the preview says how far over it is.
const AnnounceComposer = {
  KEY: 'vex.announceComposer',
  MAX_DRAFTS: 30,
  MAX_QUEUE: 40,
  MAX_STAGED: 10,
  MAX_TEXT: 20000,
  // Defaults. Markdown: 'keep' (the place renders it) or 'plain' (it shows the symbols as they are).
  TARGETS: [
    { id: 'discord', label: 'Discord message', limit: 2000, markdown: 'keep' },
    { id: 'discord-embed', label: 'Discord embed text', limit: 4096, markdown: 'keep' },
    { id: 'roblox-shout', label: 'Roblox group shout', limit: 255, markdown: 'plain' },
    { id: 'roblox-description', label: 'Roblox game description', limit: 1000, markdown: 'plain' },
    { id: 'github-release', label: 'GitHub release notes', limit: 125000, markdown: 'keep' },
    { id: 'x', label: 'X post', limit: 280, markdown: 'plain', linkCost: 23 },
    { id: 'bluesky', label: 'Bluesky post', limit: 300, markdown: 'plain' },
    { id: 'telegram', label: 'Telegram message', limit: 4096, markdown: 'plain' },
  ],

  _now() { return Date.now(); },

  // ---- state -------------------------------------------------------------------------------
  state() {
    const s = CommsStore.record(this.KEY, { on: true, drafts: [], queue: [], limits: {}, allowEveryone: false, staged: [] }, 'announcement drafts');
    return {
      staged: Array.isArray(s.staged) ? s.staged.filter(x => x && typeof x.id === 'string' && typeof x.text === 'string' && Number.isFinite(x.at)) : [],
      on: s.on !== false,
      drafts: Array.isArray(s.drafts) ? s.drafts.filter(d => d && typeof d.id === 'string') : [],
      queue: Array.isArray(s.queue) ? s.queue.filter(q => q && typeof q.id === 'string') : [],
      limits: s.limits && typeof s.limits === 'object' && !Array.isArray(s.limits) ? s.limits : {},
      allowEveryone: s.allowEveryone === true,
    };
  },
  _save(s) { CommsStore.write(this.KEY, s); CommsStore.emit('vex:announce-composer'); },
  enabled() { return this.state().on; },
  setEnabled(on) { const s = this.state(); s.on = !!on; this._save(s); },

  targets() {
    const lim = this.state().limits;
    return this.TARGETS.map(t => ({ ...t, limit: Number.isFinite(lim[t.id]) && lim[t.id] > 0 ? lim[t.id] : t.limit, custom: Number.isFinite(lim[t.id]) && lim[t.id] > 0 }));
  },
  setLimit(id, n) {
    if (!this.TARGETS.some(t => t.id === id)) throw new Error('No such place: ' + id);
    const s = this.state();
    if (n == null || n === '') delete s.limits[id];
    else {
      const v = Math.floor(Number(n));
      if (!(v >= 10 && v <= 1000000)) throw new Error('A limit is a number of characters from 10 to 1000000');
      s.limits[id] = v;
    }
    this._save(s);
  },

  // ---- adapting and measuring (pure) ----------------------------------------------------------
  // The same text for a place that shows no Markdown: symbols removed, links kept as plain addresses.
  toPlain(text) {
    return String(text)
      .replace(/```[a-z]*\n?([\s\S]*?)```/gi, '$1')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 $2')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*(?!\*)/g, '$1$2')
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/^>\s?/gm, '')
      .replace(/^\s*[-*]\s+/gm, '- ');
  },
  // What a place counts. X counts every address as 23 characters whatever its length.
  length(text, target) {
    if (!target.linkCost) return [...text].length;
    let n = 0, last = 0;
    for (const m of text.matchAll(/https?:\/\/\S+/g)) { n += [...text.slice(last, m.index)].length + target.linkCost; last = m.index + m[0].length; }
    return n + [...text.slice(last)].length;
  },
  // -> { id, label, text, length, limit, over, fits, plain }
  render(text, target) {
    const body = CommsStore.block(text, this.MAX_TEXT);
    const out = target.markdown === 'plain' ? this.toPlain(body) : body;
    const length = this.length(out, target);
    return { id: target.id, label: target.label, text: out, length, limit: target.limit, over: Math.max(0, length - target.limit), fits: length <= target.limit, plain: target.markdown === 'plain' };
  },
  preview(text) { return this.targets().map(t => this.render(text, t)); },

  // ---- drafts ------------------------------------------------------------------------------------
  drafts() { return this.state().drafts.slice().sort((a, b) => b.updatedAt - a.updatedAt); },
  draft(id) { return this.state().drafts.find(d => d.id === id) || null; },
  save({ id, title, text, done } = {}) {
    if (!this.enabled()) throw new Error('The announcement composer is switched off in Settings');
    CommsStore.needKept('A draft');
    const body = CommsStore.block(text, this.MAX_TEXT);
    if (!body) throw new Error('Write the announcement first');
    const s = this.state();
    let d = id ? s.drafts.find(x => x.id === id) : null;
    if (!d) {
      if (s.drafts.length >= this.MAX_DRAFTS) throw new Error('At most ' + this.MAX_DRAFTS + ' drafts. Delete one first.');
      d = { id: CommsStore.id('an'), done: {}, createdAt: this._now() };
      s.drafts.push(d);
    }
    d.title = CommsStore.line(title, 80) || CommsStore.line(body.split('\n')[0], 60) || 'Untitled';
    d.text = body;
    if (done && typeof done === 'object') d.done = Object.fromEntries(Object.entries(done).filter(([k, v]) => this.TARGETS.some(t => t.id === k) && v === true));
    d.updatedAt = this._now();
    this._save(s);
    return d;
  },
  setDone(id, targetId, on) {
    if (!this.TARGETS.some(t => t.id === targetId)) throw new Error('No such place: ' + targetId);
    const s = this.state();
    const d = s.drafts.find(x => x.id === id);
    if (!d) throw new Error('That draft is gone');
    if (on) d.done[targetId] = true; else delete d.done[targetId];
    this._save(s);
  },
  remove(id) {
    const s = this.state();
    const next = s.drafts.filter(d => d.id !== id);
    if (next.length === s.drafts.length) return false;
    s.drafts = next; this._save(s);
    return true;
  },

  // ---- copy-out -------------------------------------------------------------------------------------
  async copy(text, targetId) {
    const t = this.targets().find(x => x.id === targetId);
    if (!t) throw new Error('No such place: ' + targetId);
    const r = this.render(text, t);
    await CommsStore.copy(r.text);
    return r;
  },

  // A reminder to post, at the time you choose. It reminds; nothing is sent.
  async remind(title, when) {
    if (typeof VexQuickReminder === 'undefined') throw new Error('Reminders are not loaded');
    if (!(when instanceof Date) || Number.isNaN(when.getTime())) throw new Error('That is not a real time');
    return VexQuickReminder.create('Post the announcement: ' + CommsStore.line(title, 100) + ' (open Ctrl+K, Announcement composer)', when);
  },

  // ---- a staged send: the toast at the hour, the confirm for the send -----------------------------------------
  staged() { return this.state().staged.slice().sort((a, b) => a.at - b.at); },
  async stage(title, text, when) {
    if (!this.enabled()) throw new Error('The announcement composer is switched off in Settings');
    CommsStore.needKept('A staged post');
    if (!(when instanceof Date) || Number.isNaN(when.getTime()) || when.getTime() <= this._now() + 60000) throw new Error('Choose a time that is still ahead');
    const r = this.render(text, this.targets().find(x => x.id === 'discord'));
    if (!r.text.trim()) throw new Error('Write the announcement first');
    if (!r.fits) throw new Error('This is ' + r.over + ' characters over the ' + r.limit + ' Discord takes in one message. Shorten it first.');
    const status = await this.webhookStatus();
    if (!status.has) throw new Error('There is no webhook saved. Add the address of your own server\'s webhook in Settings first.');
    const s = this.state();
    if (s.staged.length >= this.MAX_STAGED) throw new Error('At most ' + this.MAX_STAGED + ' staged posts. Remove one first.');
    const rec = { id: CommsStore.id('st'), title: CommsStore.line(title, 80) || CommsStore.line(r.text.split('\n')[0], 60) || 'Announcement', text: CommsStore.block(text, this.MAX_TEXT), at: when.getTime(), askedAt: 0 };
    s.staged.push(rec);
    this._save(s);
    // The reminder is the back-up for a Vex that is closed at the hour; it reminds and sends nothing.
    if (typeof VexQuickReminder !== 'undefined') await this.remind(rec.title, when);
    return rec;
  },
  unstage(id) {
    const s = this.state();
    const next = s.staged.filter(x => x.id !== id);
    if (next.length === s.staged.length) return false;
    s.staged = next; this._save(s);
    return true;
  },
  // Staged posts whose hour has come and that have not been announced yet. Pure given the list.
  dueStaged(now = this._now(), list = this.state().staged) { return list.filter(x => x.at <= now && !x.askedAt); },
  // The toast at the hour. -> how many were announced.
  tickStaged(now = this._now()) {
    if (!this.enabled()) return 0;
    const due = this.dueStaged(now);
    if (!due.length) return 0;
    if (typeof VexAttention === 'undefined') throw new Error('The attention gate is not loaded');
    const s = this.state();
    for (const d of due) {
      const rec = s.staged.find(x => x.id === d.id);
      rec.askedAt = now;
      const title = 'Time to post: ' + rec.title;
      // You staged it for this hour, so it is the "asked" class and is not held back by a quiet mode. It still sends nothing.
      VexAttention.notify({ feature: 'announce-composer', label: 'Announcements', urgency: 'asked', id: 'staged:' + rec.id, title, body: 'Review it and send it, or leave it: nothing is sent unless you press Send.', action: { label: 'Review and send', key: 'send:' + rec.id } },
        () => window.showToast?.(title, 'info', 60000, { action: { label: 'Review and send', run: () => this.sendStaged(rec.id).catch(err => window.showToast?.(err.message, 'error')) } }));
    }
    this._save(s);
    return due.length;
  },
  // The button: the same confirm as "Post to my Discord" (it shows the exact message); a staged post leaves the list only when sent.
  async sendStaged(id) {
    const rec = this.state().staged.find(x => x.id === id);
    if (!rec) throw new Error('That staged post is gone');
    const r = await this.post(rec.text);
    if (r.sent) this.unstage(id);
    return r;
  },

  // ---- the share-to-community queue ---------------------------------------------------------------------
  queue() { return this.state().queue; },
  queueLink({ url, title = '', caption = '' } = {}) {
    CommsStore.needKept('A queued link');
    const href = String(url == null ? '' : url).trim();
    if (!/^https?:\/\//i.test(href)) throw new Error('A link starts with https://');
    try { new URL(href); } catch { throw new Error('That is not a web address'); }
    const s = this.state();
    if (s.queue.some(q => q.url === href)) throw new Error('That link is already in the queue');
    if (s.queue.length >= this.MAX_QUEUE) throw new Error('At most ' + this.MAX_QUEUE + ' links wait in the queue. Make this week\'s post first.');
    const rec = { id: CommsStore.id('sq'), url: href, title: CommsStore.line(title, 120), caption: CommsStore.line(caption, 280), addedAt: this._now() };
    s.queue.push(rec); this._save(s);
    return rec;
  },
  setCaption(id, caption) {
    const s = this.state();
    const q = s.queue.find(x => x.id === id);
    if (!q) throw new Error('That link is gone');
    q.caption = CommsStore.line(caption, 280); this._save(s);
  },
  unqueue(id) {
    const s = this.state();
    const next = s.queue.filter(q => q.id !== id);
    if (next.length === s.queue.length) return false;
    s.queue = next; this._save(s);
    return true;
  },
  // The weekly post from the queue (text only; nothing is cleared until you say so).
  weeklyText(heading = 'This week\'s good finds') {
    const q = this.queue();
    if (!q.length) throw new Error('The queue is empty');
    return '**' + heading + '**\n' + q.map(i => '- ' + [i.caption || i.title, i.url].filter(Boolean).join(' ')).join('\n');
  },
  clearQueue() { const s = this.state(); const n = s.queue.length; s.queue = []; this._save(s); return n; },

  // ---- the optional webhook (the one place that is not copy-out) ---------------------------------------------
  _bridge() {
    const v = typeof window !== 'undefined' && window.vex;
    if (!v || typeof v.commsWebhookSend !== 'function') throw new Error('The webhook is not available in this build');
    return v;
  },
  async webhookStatus() { return this._bridge().commsWebhookStatus(); },
  async saveWebhook(url) { return this._bridge().commsWebhookSet(String(url == null ? '' : url).trim()); },
  async clearWebhook() { return this._bridge().commsWebhookClear(); },
  allowEveryone() { return this.state().allowEveryone; },
  setAllowEveryone(on) { const s = this.state(); s.allowEveryone = !!on; this._save(s); },
  // The exact body main sends (main/comms-tools.js buildPayload; a test holds the two equal).
  payloadText(content, allowEveryone) {
    return JSON.stringify({ content, allowed_mentions: { parse: allowEveryone ? ['everyone'] : [] } });
  },

  // Post the text to the owner's own webhook. The confirm shows the exact payload; "Cancel" sends nothing.
  // -> { sent: true, status } or { sent: false } when the person declined.
  async post(text, { allowEveryone = this.allowEveryone() } = {}) {
    if (!this.enabled()) throw new Error('The announcement composer is switched off in Settings');
    CommsStore.needKept('A post to your webhook');
    const t = this.targets().find(x => x.id === 'discord');
    const r = this.render(text, t);
    if (!r.text.trim()) throw new Error('Write the announcement first');
    if (!r.fits) throw new Error('This is ' + r.over + ' characters over the ' + r.limit + ' Discord takes in one message. Shorten it first; Vex will not cut it for you.');
    const status = await this.webhookStatus();
    if (!status.has) throw new Error('There is no webhook saved. Add the address of your own server\'s webhook in Settings first.');
    if (typeof window.vexConfirm !== 'function') throw new Error('The confirm box is not loaded, so nothing is sent');
    const yes = await window.vexConfirm({
      title: 'Post to your Discord now?',
      message: 'This exact message will be sent once to ' + status.label + '. Nothing else is sent.\n\n' + this.payloadText(r.text, allowEveryone),
      okLabel: 'Send', cancelLabel: 'Cancel',
    });
    if (!yes) return { sent: false };
    const res = await this._bridge().commsWebhookSend({ content: r.text, allowEveryone: !!allowEveryone });
    if (typeof VexUsage !== 'undefined') VexUsage.touch('announce-composer');
    return { sent: true, status: res.status };
  },
};

if (typeof window !== 'undefined') {
  window.AnnounceComposer = AnnounceComposer;
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof AttentionInbox !== 'undefined') {
      AttentionInbox.handle('announce-composer', (key) => {
        const m = /^send:(.+)$/.exec(String(key));
        if (!m) throw new Error('Unknown action ' + key);
        AnnounceComposer.sendStaged(m[1]).catch(err => window.showToast?.(err.message, 'error'));
      });
    }
    if (typeof VexJobs !== 'undefined') {
      VexJobs.every('Staged announcement', 30000, () => { try { AnnounceComposer.tickStaged(); } catch (err) { window.VexProblems?.note('Announcements', 'Could not announce a staged post', err); } }, { when: 'ui', feature: 'announce-composer' });
    }
  });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { AnnounceComposer };
