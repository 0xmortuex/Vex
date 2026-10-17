// === Follow-up ledger: what I owe, what I am waiting on =======================
//
// "I'll send it tomorrow" and "I asked Selin for the form last week" live in
// nobody's list. This is that list, and nothing else: two columns,
//
//   I owe        something promised to someone, with a day if there is one
//   Waiting on   something asked of someone, since a day
//
// An entry is typed by you, or confirmed by you from the deadline finder (the
// "Add from this page" row shows the sentence it came from; nothing is added
// without a press). A waiting entry comes back at 3 and at 7 days with a nudge
// snippet you can copy; an "I owe" entry with a day comes back the day before it
// and on it. The channel (mail, chat, GitHub, other) is a label you choose so one
// board spans them all.
//
// Read-only on every channel: Vex never writes to your mailbox, never sends the
// nudge and never reads a chat for you. Mail is not scanned for promises (the
// compose hook for that is a Vencord-only idea that waits for the owner's
// decision on client-mod reading). Everything stays on this computer.
//
//   VexFollowUps.make({...})           pure: a validated entry
//   VexFollowUps.stage(item, now)      pure: 0, 3 or 7 for a waiting entry
//   VexFollowUps.pending(items, now)   pure: [{ item, stage }] that should speak up now
//   VexFollowUps.nudgeText(item, now)  pure: the snippet

const VexFollowUps = {
  KEY: 'vex.followUps',
  PREF: 'vex.followUps.enabled',   // 'off' stops the nudges and hides the command
  DAY: 24 * 3600 * 1000,
  MAX: 200,
  CHANNELS: ['mail', 'chat', 'github', 'other'],
  CHANNEL_LABEL: { mail: 'Mail', chat: 'Chat', github: 'GitHub', other: 'Other' },
  JOB: 'Follow-up ledger',

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    return !!on;
  },

  // ---- pure --------------------------------------------------------------------------
  make({ dir, who, what, channel, since, due, url, now = Date.now(), id } = {}) {
    if (dir !== 'owe' && dir !== 'waiting') throw new Error('Say whether you owe it or are waiting on it');
    const text = String(what == null ? '' : what).replace(/\s+/g, ' ').trim();
    if (!text) throw new Error('Write what it is about');
    if (text.length > 160) throw new Error('Keep it to 160 characters');
    const person = String(who == null ? '' : who).replace(/\s+/g, ' ').trim();
    if (person.length > 60) throw new Error('Keep the name to 60 characters');
    if (dir === 'waiting' && !person) throw new Error('Say who you are waiting on');
    const ch = channel == null || channel === '' ? 'other' : channel;
    if (!this.CHANNELS.includes(ch)) throw new Error('Unknown channel: ' + channel);
    let link = '';
    if (url) {
      let u;
      try { u = new URL(String(url)); } catch { throw new Error('That is not a web address'); }
      if (!/^https?:$/.test(u.protocol)) throw new Error('Only a web address can be attached');
      link = u.href.slice(0, 2048);
    }
    const sinceMs = Number.isFinite(since) ? since : now;
    if (sinceMs > now + this.DAY) throw new Error('"Since" cannot be in the future');
    const dueMs = due == null || due === '' || due === 0 ? 0 : Number(due);
    if (due && !Number.isFinite(dueMs)) throw new Error('That is not a day');
    return { id: id || 'fu_' + now.toString(36) + Math.random().toString(36).slice(2, 6), dir, who: person, what: text, channel: ch, since: sinceMs, due: dueMs, url: link, doneAt: 0, nudged: 0, oweDay: '' };
  },
  ageDays(item, now = Date.now()) { return Math.max(0, Math.floor((now - item.since) / this.DAY)); },
  stage(item, now = Date.now()) {
    if (!item || item.dir !== 'waiting' || item.doneAt) return 0;
    const d = this.ageDays(item, now);
    return d >= 7 ? 7 : d >= 3 ? 3 : 0;
  },
  _dayKey(ms) { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
  // Entries that should speak up now: a waiting one that has reached a stage it has not spoken at, an "I owe"
  // one whose day is today, tomorrow or past (once a day).
  pending(items, now = Date.now()) {
    const out = [];
    for (const it of Array.isArray(items) ? items : []) {
      if (!it || it.doneAt) continue;
      if (it.dir === 'waiting') {
        const st = this.stage(it, now);
        if (st > (it.nudged || 0)) out.push({ item: it, stage: st });
      } else if (it.dir === 'owe' && it.due && it.due - now < this.DAY && it.oweDay !== this._dayKey(now)) {
        out.push({ item: it, stage: 0 });
      }
    }
    return out;
  },
  nudgeText(item, now = Date.now()) {
    if (!item || item.dir !== 'waiting') throw new Error('A nudge is for something you are waiting on');
    const since = new Date(item.since).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
    const first = item.who.split(/\s+/)[0];
    return 'Hi ' + first + ', a quick nudge about ' + item.what.replace(/[.!?]+$/, '') + ' (I asked on ' + since + '). Could you tell me where it stands? Thank you.';
  },

  // ---- storage -------------------------------------------------------------------------
  list() {
    const raw = localStorage.getItem(this.KEY);
    if (raw == null) return [];
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('Your follow-ups could not be read: ' + err.message); }
    return Array.isArray(v) ? v.filter(x => x && x.id && (x.dir === 'owe' || x.dir === 'waiting') && typeof x.what === 'string') : [];
  },
  _save(items) {
    try { localStorage.setItem(this.KEY, JSON.stringify(items.slice(0, this.MAX))); }
    catch (err) { throw new Error('Your follow-ups could not be saved: ' + err.message); }
  },
  add(fields) {
    const items = this.list();
    if (items.filter(i => !i.doneAt).length >= this.MAX) throw new Error('That is ' + this.MAX + ' open follow-ups; finish some first');
    const it = this.make(fields);
    items.unshift(it);
    this._save(items);
    if (typeof VexUsage !== 'undefined') VexUsage.touch('follow-ups');
    return it;
  },
  patch(id, p) {
    const items = this.list();
    const it = items.find(x => x.id === id);
    if (!it) throw new Error('That follow-up is gone');
    Object.assign(it, p);
    this._save(items);
    return it;
  },
  done(id, now = Date.now()) { return this.patch(id, { doneAt: now }); },
  reopen(id) { return this.patch(id, { doneAt: 0 }); },
  remove(id) {
    const items = this.list();
    if (!items.some(x => x.id === id)) throw new Error('That follow-up is gone');
    this._save(items.filter(x => x.id !== id));
  },

  // ---- speaking up ------------------------------------------------------------------------
  tick(now = Date.now()) {
    if (!this.enabled()) return 0;
    const due = this.pending(this.list(), now);
    let n = 0;
    for (const { item, stage } of due) {
      const title = item.dir === 'waiting'
        ? 'Still waiting on ' + item.who + ' (' + this.ageDays(item, now) + ' days): ' + item.what
        : 'You owe: ' + item.what + (item.due ? ' (' + new Date(item.due).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ')' : '');
      if (typeof VexAttention === 'undefined') throw new Error('The attention gate is not loaded');
      VexAttention.notify({ feature: 'follow-ups', label: 'Follow-ups', urgency: 'useful', id: item.id + ':' + (stage || this._dayKey(now)), title, action: { label: 'Open follow-ups', key: 'open' } },
        () => window.showToast?.(title, 'info', 9000, { action: { label: 'Open follow-ups', run: () => this.open() } }));
      this.patch(item.id, item.dir === 'waiting' ? { nudged: stage } : { oweDay: this._dayKey(now) });
      n++;
    }
    return n;
  },

  // ---- What is due -------------------------------------------------------------------------
  _dueRows() {
    return this.list().filter(i => !i.doneAt && i.dir === 'owe' && i.due).map(i => ({ id: 'followup:' + i.id, kind: 'followup', text: 'You owe: ' + i.what, at: i.due, hasTime: false, sub: i.who }));
  },

  // ---- the screen ----------------------------------------------------------------------------
  async _candidates() {
    if (typeof VexDeadlines === 'undefined') throw new Error('The deadline finder is not loaded, so nothing can be read from the page');
    if (!VexDeadlines.enabled()) throw new Error('The deadline finder is switched off in Settings');
    const src = await VexDeadlines.fromPage();
    return { src, found: VexDeadlines.extract(src.text) };
  },

  open() {
    if (!this.enabled()) { window.showToast?.('Follow-ups are switched off in Settings', 'info'); return; }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('follow-ups');
    const { body } = VexSettingsGroups.dialog({ id: 'vex-followups', title: 'Follow-ups', sub: 'What you owe and what you are waiting on. You add every entry; nothing is read from your mail or chats, and nothing is sent.' });
    const draw = () => {
      body.textContent = '';
      const mk = (tag, props = {}) => Object.assign(document.createElement(tag), props);
      const form = mk('div'); form.className = 'vexsr-rule'; form.style.flexWrap = 'wrap';
      const dir = mk('select'); dir.setAttribute('aria-label', 'Kind');
      dir.append(new Option('Waiting on', 'waiting'), new Option('I owe', 'owe'));
      const who = mk('input', { type: 'text', placeholder: 'Who', maxLength: 60 }); who.setAttribute('aria-label', 'Who');
      const what = mk('input', { type: 'text', placeholder: 'What about', maxLength: 160 }); what.setAttribute('aria-label', 'What about');
      const ch = mk('select'); ch.setAttribute('aria-label', 'Channel');
      for (const c of this.CHANNELS) ch.append(new Option(this.CHANNEL_LABEL[c], c));
      const due = mk('input', { type: 'date' }); due.setAttribute('aria-label', 'Due day (optional)');
      form.append(dir, who, what, ch, due, VexSettingsGroups.button('Add', () => {
        try {
          this.add({ dir: dir.value, who: who.value, what: what.value, channel: ch.value, due: due.value ? new Date(due.value + 'T17:00').getTime() : 0 });
          draw();
        } catch (err) { window.showToast?.(err.message, 'error'); }
      }, { primary: true }));
      body.appendChild(form);
      body.appendChild(VexSettingsGroups.button('Add from the page in front', async () => {
        try { await this._showCandidates(body, draw); } catch (err) { window.showToast?.(err.message, 'error'); }
      }, { label: 'Add follow-ups found on the page in front' }));

      let items;
      try { items = this.list(); } catch (err) { body.appendChild(VexSettingsGroups.note(err.message)); return; }
      const now = Date.now();
      for (const [d, title] of [['owe', 'I owe'], ['waiting', 'Waiting on']]) {
        const rows = items.filter(i => i.dir === d && !i.doneAt);
        const h = mk('div', { textContent: title + ' (' + rows.length + ')' }); h.className = 'vexsr-mode'; h.style.margin = '10px 0 4px';
        body.appendChild(h);
        if (!rows.length) body.appendChild(VexSettingsGroups.note(d === 'owe' ? 'Nothing you owe.' : 'Nothing you are waiting on.'));
        for (const it of rows) body.appendChild(this._row(it, now, draw));
      }
      const closed = items.filter(i => i.doneAt).length;
      if (closed) body.appendChild(VexSettingsGroups.note(closed + ' finished. ' + 'They stay in the list until you remove them from this computer.'));
    };
    draw();
  },

  _row(it, now, redraw) {
    const row = document.createElement('div');
    row.className = 'vexsr-rule';
    row.style.flexWrap = 'wrap';
    const text = document.createElement('span');
    text.className = 'vexsr-host';
    text.style.wordBreak = 'normal';
    const age = this.ageDays(it, now);
    text.textContent = (it.who ? it.who + ': ' : '') + it.what + '  (' + this.CHANNEL_LABEL[it.channel] + ', ' + (it.dir === 'waiting' ? (age === 0 ? 'asked today' : age + ' day' + VexPlural.s(age)) : (it.due ? 'by ' + new Date(it.due).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : 'no day')) + ')';
    row.appendChild(text);
    const act = (label, fn, o) => row.appendChild(VexSettingsGroups.button(label, () => { Promise.resolve().then(fn).then(redraw, err => window.showToast?.(err.message, 'error')); }, o));
    if (it.dir === 'waiting') act('Copy nudge', async () => { await navigator.clipboard.writeText(this.nudgeText(it)); window.showToast?.('Nudge copied. Vex does not send it.', 'info'); }, { label: 'Copy a nudge for ' + it.who });
    if (it.dir === 'owe' && it.due && it.due > now) act('Remind me', async () => {
      if (!window.vex || !window.vex.reminders) throw new Error('Reminders are not available');
      const at = Math.max(now + 60000, it.due - 8 * 3600 * 1000);
      await window.vex.reminders.create('You owe: ' + it.what, at, it.url ? { url: it.url } : undefined);
      window.showToast?.('Reminder set', 'success');
    }, { label: 'Remind me about ' + it.what });
    if (it.url) act('Open', () => { if (typeof TabManager === 'undefined') throw new Error('Tabs are not loaded'); TabManager.createTab(it.url, true); }, { label: 'Open the page for ' + it.what });
    act('Done', () => this.done(it.id), { primary: true, label: 'Mark done: ' + it.what });
    act('Remove', () => this.remove(it.id), { danger: true, label: 'Remove: ' + it.what });
    return row;
  },

  async _showCandidates(body, redraw) {
    const { src, found } = await this._candidates();
    const box = document.createElement('div');
    box.appendChild(VexSettingsGroups.note(found.length ? 'Found in ' + src.label + '. Check the sentence, then press the one that fits.' : 'Nothing that looks like a promise or a deadline in ' + src.label + '.'));
    for (const f of found) {
      const row = document.createElement('div');
      row.className = 'vexsr-rule';
      row.style.flexWrap = 'wrap';
      const t = document.createElement('span'); t.className = 'vexsr-host'; t.style.wordBreak = 'normal'; t.textContent = f.sentence;
      row.appendChild(t);
      const add = (label, dir) => row.appendChild(VexSettingsGroups.button(label, () => {
        try {
          this.add({ dir, who: '', what: f.sentence.slice(0, 160), channel: 'other', due: f.dueAt || 0, url: /^https?:/i.test(src.url || '') ? src.url : '' });
          row.remove(); redraw();
        } catch (err) { window.showToast?.(err.message, 'error'); }
      }, { primary: dir === 'owe', label: label + ': ' + f.phrase }));
      add('I owe this', 'owe');
      box.appendChild(row);
    }
    body.prepend(box);
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('A list of what you owe and what you are waiting on. A waiting entry comes back at 3 and 7 days with a nudge you can copy. You add every entry (or confirm one found on a page); nothing is read from mail or chat and nothing is sent.'));
    el.appendChild(VexSettingsGroups.button('Open follow-ups', () => this.open(), { primary: true }));
  },

  init() {
    if (this._wired) return true;
    this._wired = true;
    if (typeof AttentionInbox !== 'undefined') {
      AttentionInbox.handle('follow-ups', (key) => {
        if (key !== 'open') throw new Error('Unknown action ' + key);
        this.open();
      });
    }
    if (typeof VexDueness !== 'undefined' && typeof VexDueness.addSource === 'function') {
      VexDueness.addSource('follow-ups', { kind: 'followup', label: 'Follow-up' }, () => (this.enabled() ? this._dueRows() : []));
    }
    if (typeof VexJobs !== 'undefined') VexJobs.every(this.JOB, 30 * 60 * 1000, () => this.tick(), { feature: 'follow-ups' });
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.VexFollowUps = VexFollowUps;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'follow-ups', title: 'Follow-ups', keywords: 'follow up waiting on owe promise nudge ledger remind', before: 'about', build: (el) => VexFollowUps.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'follow-ups', label: 'Follow-ups: I owe, waiting on', hint: 'Promises you made and answers you are waiting for, with a nudge at 3 and 7 days', icon: 'flag', action: () => VexFollowUps.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexFollowUps };
