// === Community and chat tools: the screens, the commands and the Settings section ====
//
// One place for everything the person SEES of these ten features. The logic lives in
// the modules; this only draws and wires. Every action reports a failure in a toast.
//
//   Timezone helper             js/tz-helper.js            Ctrl+K "Timezone helper"
//   Unread to task              js/unread-task.js          right-click a selection; "Make a task" on a kept notification
//   Meeting links               js/meeting-links.js        Ctrl+K "Meeting links"
//   Discord noise tools         js/discord-noise.js        Ctrl+K "Discord noise tools"
//   Announcement composer       js/announce-composer.js    Ctrl+K "Announcement composer"
//   Community metrics           js/community-metrics.js    Ctrl+K "Community numbers"
//   Chat link harvester         js/link-harvester.js       Ctrl+K "Collect links"
//   Discord status line         js/discord-status.js       Settings, Community and chat tools
//   Moderator chores kit        js/mod-kit.js              Ctrl+K "Moderator kit"
//   Vencord bridge              js/vencord-bridge.js       Ctrl+K "Discord mentions (bridge)"
//
// Nothing here reads a chat, posts, replies or changes anything on a site. The one
// exception is the optional announcement webhook of the owner's own server, which
// only ever sends after a confirm that shows the exact message.
const CommsToolsUI = {
  _fail(err) {
    console.error('[CommsTools]', err);
    window.showToast?.((err && err.message) || String(err), 'error');
  },
  _guard(fn) {
    try { const r = fn(); if (r && typeof r.catch === 'function') r.catch((e) => this._fail(e)); } catch (e) { this._fail(e); }
  },
  _el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; },
  _btn(text, fn, opts) { return VexSettingsGroups.button(text, () => this._guard(fn), opts); },
  _note(text) { return VexSettingsGroups.note(text); },
  _heading(body, text) { body.appendChild(this._el('div', 'setting-label', text)); },
  _ago(ms) {
    const d = Date.now() - ms;
    if (d < 90 * 1000) return 'just now';
    if (d < 3600 * 1000) return Math.round(d / 60000) + ' min ago';
    if (d < 24 * 3600 * 1000) return Math.round(d / 3600000) + ' h ago';
    return Math.round(d / 86400000) + ' d ago';
  },
  _when(ms) { return ms ? new Date(ms).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; },
  _input(placeholder, label, value) {
    const i = this._el('input', 'input');
    i.type = 'text'; i.placeholder = placeholder || ''; i.setAttribute('aria-label', label); if (value != null) i.value = value;
    return i;
  },
  _area(placeholder, label, rows = 6) {
    const a = this._el('textarea', 'input');
    a.rows = rows; a.placeholder = placeholder || ''; a.setAttribute('aria-label', label);
    a.style.cssText = 'width:100%;resize:vertical;font:inherit;box-sizing:border-box';
    return a;
  },
  _row(...kids) { const r = this._el('div', 'setting-row'); r.append(...kids); return r; },
  _box(title, sub) {
    const b = this._el('div', 'setting-group');
    if (title) b.appendChild(this._el('div', 'setting-label', title));
    if (sub) b.appendChild(this._note(sub));
    return b;
  },
  async _copy(text, what) { await CommsStore.copy(text); window.showToast?.('Copied' + (what ? ': ' + what : '')); },
  _redrawOpen(prop, dialogId) {
    if (typeof this[prop] === 'function' && document.getElementById(dialogId)) this._guard(() => this[prop]());
  },
  _toggle(body, label, get, set) {
    const row = this._el('div', 'setting-toggle-row');
    const lab = this._el('label', 'toggle');
    const input = document.createElement('input');
    input.type = 'checkbox'; input.checked = !!get(); input.setAttribute('aria-label', label);
    input.addEventListener('change', () => {
      const want = input.checked;
      Promise.resolve().then(() => set(want)).then(() => { input.checked = !!get(); }).catch((err) => { input.checked = !!get(); this._fail(err); });
    });
    lab.append(input, this._el('span', 'toggle-slider'));
    row.append(this._el('span', 'setting-label-text', label), lab);
    body.appendChild(row);
    return input;
  },

  // ===== T3-020 Timezone helper =====================================================================
  openTimezone(prefill) {
    if (typeof VexTimezone === 'undefined') throw new Error('The timezone helper is not loaded');
    if (!VexTimezone.enabled()) throw new Error('The timezone helper is switched off: Settings, Community and chat tools');
    const dlg = VexSettingsGroups.dialog({ id: 'tz-helper-dialog', title: 'Timezone helper', sub: 'Type a time and a place, like 21:00 Istanbul or tomorrow 9pm new york. Nothing is sent anywhere.' });
    const input = this._input('21:00 Istanbul', 'Time and place', prefill || '');
    const out = this._el('div');
    const draw = () => {
      out.textContent = '';
      const text = input.value.trim();
      if (!text) return;
      let r;
      try { r = VexTimezone.convert(text); }
      catch (err) { out.appendChild(this._note(err.message)); return; }
      if (r.assumed) out.appendChild(this._note(r.assumed));
      for (const row of r.rows) out.appendChild(this._note(row.label + ': ' + row.text));
      const box = this._box('Discord timestamp', 'Every reader sees it in their own time zone. Paste it into a message.');
      for (const [label, key] of [['Date and time', 'full'], ['Weekday, date and time', 'weekday'], ['Time only', 'short'], ['Relative (in 3 hours)', 'relative']]) {
        box.appendChild(this._row(this._el('span', '', label + '  ' + r.discord[key]), this._btn('Copy', () => this._copy(r.discord[key], r.discord[key]))));
      }
      out.appendChild(box);
    };
    input.addEventListener('input', draw);
    dlg.body.append(input, out);
    draw();
    input.focus();
    return dlg;
  },

  // ===== T3-047 Meeting links ======================================================================
  async openMeetingLinks() {
    if (typeof MeetingLinks === 'undefined') throw new Error('Meeting links are not loaded');
    if (!MeetingLinks.enabled()) throw new Error('Meeting links are switched off: Settings, Community and chat tools');
    const dlg = VexSettingsGroups.dialog({ id: 'meeting-links-dialog', title: 'Meeting links', sub: 'Call links from your calendar, kept notifications, recent mail and what you paste. Vex never opens one by itself: you press Join.' });
    let extra = [];
    const draw = async () => {
      const body = dlg.body;
      body.textContent = '';
      const now = Date.now();
      let cand = [];
      try { cand = await MeetingLinks.candidates(now); } catch (err) { body.appendChild(this._note('The calendar could not be read: ' + err.message)); }
      const soon = cand.filter(c => c.at > now - MeetingLinks.GRACE_MS && c.at < now + 24 * 3600000).sort((a, b) => a.at - b.at);
      this._heading(body, 'Next 24 hours');
      if (!soon.length) body.appendChild(this._note('No meeting with a call link in the next day.'));
      for (const c of soon) body.appendChild(this._row(this._el('span', '', this._when(c.at) + '  ' + c.title + '  (' + MeetingLinks.hostOf(c.url) + ')'), this._btn('Join in browser', () => MeetingLinks.join(c.url), { primary: true })));
      this._heading(body, 'Kept links');
      const links = MeetingLinks.links();
      if (!links.length) body.appendChild(this._note('Nothing kept yet.'));
      for (const l of links) {
        body.appendChild(this._row(this._el('span', '', l.label + (l.at ? '  ' + this._when(l.at) : '') + '  (' + MeetingLinks.hostOf(l.url) + ')'),
          this._btn('Join in browser', () => MeetingLinks.join(l.url), { primary: true }), this._btn('Remove', () => { MeetingLinks.remove(l.id); return draw(); })));
      }
      this._heading(body, 'Found just now');
      const found = [...MeetingLinks.fromNotifications(), ...extra].filter(f => !links.some(l => l.url === f.url));
      if (!found.length) body.appendChild(this._note('Nothing found in kept notifications' + (extra.length ? '' : ' or recent mail') + '.'));
      for (const f of found.slice(0, 15)) {
        body.appendChild(this._row(this._el('span', '', f.from + ': ' + f.text + '  (' + MeetingLinks.hostOf(f.url) + ')'),
          this._btn('Keep', () => { MeetingLinks.add({ url: f.url, label: f.text.slice(0, 60), from: f.from }); return draw(); })));
      }
      body.appendChild(this._row(
        this._btn('Look in my recent mail', async () => {
          const r = await MeetingLinks.fromMail();
          extra = r.found;
          window.showToast?.('Read ' + r.read + ' recent messages, found ' + r.found.length + ' call link' + (r.found.length === 1 ? '' : 's'));
          return draw();
        }),
        this._btn('Add a link', async () => {
          const url = await window.vexPrompt({ title: 'Add a call link', message: 'The https address of the meeting.', okLabel: 'Next' });
          if (!url) return;
          const when = await window.vexPrompt({ title: 'When does it start?', message: 'Optional, like 21:00 Istanbul or tomorrow 9am. Leave empty for no time.', okLabel: 'Keep' });
          let at = 0;
          if (when && when.trim()) {
            if (typeof VexTimezone === 'undefined') throw new Error('The timezone helper is not loaded');
            at = VexTimezone.parse(when).ts;
          }
          MeetingLinks.add({ url, at });
          return draw();
        }),
        this._btn('Clear old links', () => { window.showToast?.(MeetingLinks.tidy() + ' old link(s) cleared'); return draw(); })));
    };
    this._meetDraw = draw;
    await draw();
    return dlg;
  },

  // ===== T3-013 Discord noise tools ======================================================================
  openNoise() {
    if (typeof DiscordNoise === 'undefined') throw new Error('Discord noise tools are not loaded');
    if (!DiscordNoise.enabled()) throw new Error('Discord noise tools are switched off: Settings, Community and chat tools');
    const dlg = VexSettingsGroups.dialog({ id: 'discord-noise-dialog', title: 'Discord noise tools', sub: 'Rules for Vex\'s own list of kept notifications. Discord itself, its page and its toasts are never touched.' });
    const draw = () => {
      const body = dlg.body;
      body.textContent = '';
      if (typeof PanelCapture !== 'undefined' && !PanelCapture.enabled()) body.appendChild(this._note('Notifications from panels are off, so there is nothing for the rules to act on. Turn them on in Settings, Panels and messages.'));
      this._heading(body, 'Your rules');
      const rules = DiscordNoise.rules();
      if (!rules.length) body.appendChild(this._note('No rules yet.'));
      for (const r of rules) {
        const hits = (DiscordNoise.state().hits[r.id] || {}).n || 0;
        const hid = r.kind === 'hide' ? DiscordNoise.hiddenCount(r.id) : 0;
        const row = this._row(this._el('span', '', (r.kind === 'hide' ? 'Hide' : 'Mute') + ' in ' + (r.source === '*' ? 'every panel' : r.source) + ', ' + (r.field === 'any' ? 'title or text' : r.field) + ' has "' + r.match + '"' + (r.kind === 'mute' ? ' for ' + Math.round(r.ms / 3600000) + ' h' : '') + '  (' + hits + ' so far)'));
        if (hid) row.append(this._btn('Put back ' + hid, () => { DiscordNoise.restore(r.id); return draw(); }));
        row.append(this._btn('Remove', () => { DiscordNoise.removeRule(r.id); draw(); }));
        body.appendChild(row);
      }
      body.appendChild(this._row(this._btn('Add a rule', async () => {
        const kind = (await window.vexConfirm({ title: 'What should the rule do?', message: 'Hide takes a matching notification out of Vex\'s list. Mute keeps it but stops it counting as waiting for you.', okLabel: 'Hide', cancelLabel: 'Mute' })) ? 'hide' : 'mute';
        const match = await window.vexPrompt({ title: 'Look for', message: 'Words that appear in the notification (at least 3 letters), for example "joined the server".', okLabel: 'Add' });
        if (!match) return;
        DiscordNoise.addRule({ kind, match, ms: kind === 'mute' ? 24 * 3600000 : 0 });
        draw();
      }, { primary: true })));
      this._heading(body, 'Starting points');
      for (const p of DiscordNoise.PRESETS) body.appendChild(this._row(this._el('span', '', p.label), this._btn('Add', () => { DiscordNoise.addRule(p); draw(); })));
      this._heading(body, 'Quiet-worthy');
      body.appendChild(this._note('Conversations and servers that notified you at least 5 times while none of it was marked read. Vex cannot see which servers you never open; this is only what the kept notifications say. Leaving a server is yours to do on Discord.'));
      const noisy = DiscordNoise.noisiest();
      if (!noisy.length) body.appendChild(this._note('Nothing stands out.'));
      for (const g of noisy) {
        const row = this._row(this._el('span', '', (g.kind === 'server' ? 'Server' : 'Chat') + ' ' + g.label + ': ' + g.count + ' notifications, none read'));
        if (!DiscordNoise.ruleCovers(g)) { row.append(this._btn('Mute it', () => { DiscordNoise.suggestRule(g, 'mute'); draw(); })); row.append(this._btn('Hide it', () => { DiscordNoise.suggestRule(g, 'hide'); draw(); })); }
        else row.append(this._el('span', '', 'a rule covers it'));
        body.appendChild(row);
      }
    };
    this._noiseDraw = draw;
    draw();
    return dlg;
  },

  // ===== T3-050 Announcement composer ========================================================================
  async openComposer(draftId) {
    if (typeof AnnounceComposer === 'undefined') throw new Error('The announcement composer is not loaded');
    if (!AnnounceComposer.enabled()) throw new Error('The announcement composer is switched off: Settings, Community and chat tools');
    const dlg = VexSettingsGroups.dialog({ id: 'announce-composer-dialog', title: 'Announcement composer', sub: 'Write once, see it for each place, copy it out. Vex posts nothing by itself.' });
    let current = draftId ? AnnounceComposer.draft(draftId) : null;
    const title = this._input('A name for this draft', 'Draft name', current ? current.title : '');
    const area = this._area('Write the announcement. Markdown works for Discord and GitHub; places that show none get plain text.', 'Announcement text', 9);
    area.value = current ? current.text : '';
    const previews = this._el('div');
    const lists = this._el('div');
    const draw = () => {
      previews.textContent = '';
      for (const r of AnnounceComposer.preview(area.value)) {
        const box = this._box(r.label, r.length + ' of ' + r.limit + ' characters' + (r.over ? ', ' + r.over + ' over' : ', fits'));
        if (r.over) box.lastChild.style.color = 'var(--danger, #e5484d)';
        const row = this._row(this._btn('Copy for ' + r.label, () => AnnounceComposer.copy(area.value, r.id).then(() => window.showToast?.(r.over ? 'Copied, but it is ' + r.over + ' over the limit' : 'Copied for ' + r.label, r.over ? 'warn' : 'info'))));
        if (current) {
          const done = !!(current.done && current.done[r.id]);
          row.append(this._btn(done ? 'Posted (untick)' : 'I posted it here', () => { AnnounceComposer.setDone(current.id, r.id, !done); current = AnnounceComposer.draft(current.id); draw(); }));
        }
        box.appendChild(row);
        previews.appendChild(box);
      }
    };
    const redrawLists = async () => {
      lists.textContent = '';
      this._heading(lists, 'Saved drafts');
      const ds = AnnounceComposer.drafts();
      if (!ds.length) lists.appendChild(this._note('None yet.'));
      for (const d of ds) lists.appendChild(this._row(this._el('span', '', d.title + '  (' + this._ago(d.updatedAt) + ')'), this._btn('Open', () => this.openComposer(d.id)), this._btn('Delete', async () => {
        if (await window.vexConfirm({ title: 'Delete this draft?', message: d.title, okLabel: 'Delete', cancelLabel: 'Keep', danger: true })) { AnnounceComposer.remove(d.id); if (current && current.id === d.id) current = null; redrawLists(); }
      }, { danger: true })));
      this._heading(lists, 'Share to community queue');
      lists.appendChild(this._note('Good links you tag, each with a caption, become one weekly post. Nothing is posted.'));
      const q = AnnounceComposer.queue();
      if (!q.length) lists.appendChild(this._note('The queue is empty.'));
      for (const i of q) lists.appendChild(this._row(this._el('span', '', (i.caption || i.title || i.url)), this._btn('Caption', async () => {
        const c = await window.vexPrompt({ title: 'Caption', message: i.url, value: i.caption, okLabel: 'Save' });
        if (c != null) { AnnounceComposer.setCaption(i.id, c); redrawLists(); }
      }), this._btn('Remove', () => { AnnounceComposer.unqueue(i.id); redrawLists(); })));
      lists.appendChild(this._row(
        this._btn('Add a link', async () => {
          const url = await window.vexPrompt({ title: 'Add a link to the queue', message: 'The https address.', okLabel: 'Next' });
          if (!url) return;
          const cap = await window.vexPrompt({ title: 'Caption', message: 'One line about why it is good (optional).', okLabel: 'Add' });
          AnnounceComposer.queueLink({ url, caption: cap || '' }); redrawLists();
        }),
        this._btn('Make this week\'s post', () => { area.value = AnnounceComposer.weeklyText(); draw(); }, { primary: true })));
    };
    area.addEventListener('input', draw);
    const actions = this._row(
      this._btn('Save draft', () => { current = AnnounceComposer.save({ id: current && current.id, title: title.value, text: area.value }); window.showToast?.('Draft saved'); draw(); redrawLists(); }, { primary: true }),
      this._btn('Remind me to post...', async () => {
        const when = await window.vexPrompt({ title: 'Remind me to post', message: 'When? For example 21:00 Istanbul, tomorrow 9am or in 2 hours. It reminds you; it does not send.', okLabel: 'Remind me' });
        if (!when) return;
        const t = typeof VexTimezone !== 'undefined' && /\d/.test(when) ? (() => { try { return new Date(VexTimezone.parse(when).ts); } catch { return null; } })() : null;
        const date = t || (typeof VexQuickReminder !== 'undefined' ? VexQuickReminder.parseWhen(when) : null);
        if (!date) throw new Error('Vex could not read that time');
        await AnnounceComposer.remind(title.value || area.value.split('\n')[0], date instanceof Date ? date : new Date(date.at || date));
        window.showToast?.('You will be reminded');
      }),
      this._btn('Post to my Discord...', async () => {
        const r = await AnnounceComposer.post(area.value);
        window.showToast?.(r.sent ? 'Posted to your Discord' : 'Nothing was sent');
      }));
    dlg.body.append(title, area, actions, previews, lists);
    draw();
    await redrawLists();
    area.focus();
    return dlg;
  },

  // ===== T3-059 Community metrics and name watch ===============================================================
  openMetrics() {
    if (typeof CommunityMetrics === 'undefined') throw new Error('Community metrics are not loaded');
    if (!CommunityMetrics.enabled()) throw new Error('Community metrics are switched off: Settings, Community and chat tools');
    const dlg = VexSettingsGroups.dialog({ id: 'community-metrics-dialog', title: 'Community numbers', sub: 'Numbers you type or follow on public pages, with the change since last week. The Morning Brief can show them (Brief settings, Community).' });
    const draw = () => {
      const body = dlg.body;
      body.textContent = '';
      CommunityMetrics.sync();
      this._heading(body, 'Numbers');
      const ms = CommunityMetrics.metrics();
      if (!ms.length) body.appendChild(this._note('None yet. Add one, for example "Discord members".'));
      for (const m of ms) {
        const box = this._box(m.label, CommunityMetrics.describe(m));
        if (m.points.length) box.appendChild(this._note(CommunityMetrics.sparkOf(m, 30)));
        box.appendChild(this._row(
          this._btn('Enter today\'s number', async () => {
            const v = await window.vexPrompt({ title: m.label, message: 'Today\'s number.', okLabel: 'Save' });
            if (v == null || v === '') return;
            CommunityMetrics.record(m.id, typeof PageWatch !== 'undefined' ? PageWatch.firstNumber(v) : Number(v));
            draw();
          }, { primary: true }),
          m.watchId ? this._btn('Stop following the page', () => { CommunityMetrics.unwatchMetric(m.id); draw(); }) : this._btn('Follow a public page', async () => {
            const url = await window.vexPrompt({ title: 'Public page', message: 'A page anyone can open without signing in, that shows the number.', okLabel: 'Next' });
            if (!url) return;
            const pattern = await window.vexPrompt({ title: 'How to find the number', message: 'A pattern with the number in brackets, for example ([0-9,]+) members', okLabel: 'Follow' });
            if (!pattern) return;
            CommunityMetrics.watchMetric(m.id, { url, pattern });
            window.showToast?.('Following the page, checked every 6 hours');
            draw();
          }),
          this._btn('Remove', async () => {
            if (await window.vexConfirm({ title: 'Remove this number?', message: m.label + ' and its readings are deleted.', okLabel: 'Remove', cancelLabel: 'Keep', danger: true })) { CommunityMetrics.removeMetric(m.id); draw(); }
          }, { danger: true })));
        body.appendChild(box);
      }
      body.appendChild(this._row(this._btn('Add a number', async () => {
        const label = await window.vexPrompt({ title: 'Name the number', message: 'For example "Discord members" or "Repo stars".', okLabel: 'Add' });
        if (label) { CommunityMetrics.addMetric({ label }); draw(); }
      }, { primary: true })));
      this._heading(body, 'Name watch');
      body.appendChild(this._note('A saved public search address for your own name or product. It is checked every hour like any watched page, and you are told when something new appears. Public pages only; a page behind a sign-in is refused.'));
      const names = CommunityMetrics.names();
      if (!names.length) body.appendChild(this._note('No name watches.'));
      const hits = new Set(CommunityMetrics.newHits().map(h => h.rec.id));
      for (const n of names) body.appendChild(this._row(this._el('span', '', n.label + (hits.has(n.id) ? '  (new)' : '')), this._btn('Open', () => TabManager.createTab(n.url, true)), this._btn('Remove', () => { CommunityMetrics.removeName(n.id); draw(); })));
      body.appendChild(this._row(this._btn('Add a name watch', async () => {
        const label = await window.vexPrompt({ title: 'What are you looking for?', message: 'A short name, for example "my game on the forum".', okLabel: 'Next' });
        if (!label) return;
        const url = await window.vexPrompt({ title: 'Search address', message: 'The address of a public search results page for it.', okLabel: 'Watch' });
        if (!url) return;
        CommunityMetrics.addName({ label, url }); draw();
      })));
    };
    this._metricsDraw = draw;
    draw();
    return dlg;
  },

  // ===== T3-060 Chat link harvester ========================================================================
  openLinks() {
    if (typeof LinkHarvester === 'undefined') throw new Error('The link harvester is not loaded');
    if (!LinkHarvester.enabled()) throw new Error('The link harvester is switched off: Settings, Community and chat tools');
    const dlg = VexSettingsGroups.dialog({ id: 'link-harvester-dialog', title: 'Collect links', sub: 'Links from text you paste or select, and from the notifications Vex already keeps. Nothing is read from a chat by itself.' });
    let todayOnly = true;
    const draw = () => {
      const body = dlg.body;
      body.textContent = '';
      body.appendChild(this._row(
        this._btn('Paste text to collect from', async () => {
          const text = await window.vexPrompt({ title: 'Paste text', message: 'Anything with links in it.', multiline: true, wide: true, okLabel: 'Collect' });
          if (!text) return;
          const ch = await window.vexPrompt({ title: 'Which conversation?', message: 'A name to group them under (optional).', okLabel: 'Collect' });
          const r = LinkHarvester.collect(text, { source: 'Pasted', channel: ch || '' });
          window.showToast?.(r.added + ' new, ' + r.seen + ' already known');
          draw();
        }, { primary: true }),
        this._btn('Collect from kept notifications', () => {
          const r = LinkHarvester.collectFromNotifications();
          window.showToast?.('Looked at ' + r.scanned + ' notifications: ' + r.added + ' new link(s), ' + r.seen + ' already known');
          draw();
        }),
        this._btn(todayOnly ? 'Show all' : 'Show today only', () => { todayOnly = !todayOnly; draw(); })));
      const exp = LinkHarvester.expiring();
      if (exp.length) {
        this._heading(body, 'About to expire');
        for (const l of exp) body.appendChild(this._linkRow(l, draw));
      }
      this._heading(body, todayOnly ? 'Seen today, by conversation' : 'By conversation');
      const groups = LinkHarvester.byChannel({ sinceMs: todayOnly ? LinkHarvester.startOfToday() : 0 });
      if (!groups.length) body.appendChild(this._note('No links.'));
      for (const g of groups) {
        const box = this._box(g.channel + '  (' + g.source + ')');
        for (const l of g.links) box.appendChild(this._linkRow(l, draw));
        body.appendChild(box);
      }
      if (LinkHarvester.links().length) body.appendChild(this._row(this._btn('Forget all collected links', async () => {
        if (await window.vexConfirm({ title: 'Forget the links?', message: 'The collected list is emptied. This cannot be undone.', okLabel: 'Forget', cancelLabel: 'Keep', danger: true })) { LinkHarvester.clear(); draw(); }
      }, { danger: true })));
    };
    this._linksDraw = draw;
    draw();
    return dlg;
  },
  _linkRow(l, redraw) {
    const st = LinkHarvester.expiryState(l);
    const label = (LinkHarvester.fileName(l.url) || l.host || l.url).slice(0, 70) + '  (' + l.host + ')'
      + (st === 'expired' ? '  EXPIRED' : l.expiresAt ? '  expires ' + this._when(l.expiresAt) : '');
    const row = this._row(this._el('span', '', label));
    row.append(this._btn('Open', () => LinkHarvester.open(l.id)));
    row.append(this._btn(l.saved ? 'Saved' : 'Save for later', () => { LinkHarvester.saveForLater(l.id); redraw(); }));
    if (l.expiresAt && st !== 'expired') row.append(this._btn('Remind me', async () => { await LinkHarvester.remind(l.id); window.showToast?.('You will be reminded before it runs out'); }));
    row.append(this._btn('Remove', () => { LinkHarvester.remove(l.id); redraw(); }));
    return row;
  },

  // ===== T3-063 Moderator chores kit ======================================================================
  openModKit() {
    if (typeof ModKit === 'undefined') throw new Error('The moderator kit is not loaded');
    if (!ModKit.enabled()) throw new Error('The moderator kit is switched off: Settings, Community and chat tools');
    const dlg = VexSettingsGroups.dialog({ id: 'mod-kit-dialog', title: 'Moderator kit', sub: 'Notes for you only: a log, reports, templates, checklists. It takes no action on any server and keeps its records on this computer.' });
    const draw = () => {
      const body = dlg.body;
      body.textContent = '';
      const od = ModKit.overdue();
      if (od.cases || od.reports) body.appendChild(this._note(od.cases + ' case(s) and ' + od.reports + ' report(s) are older than ' + od.days + ' days. Keeping personal data longer than needed is a risk: "Erase the old ones" below.'));
      this._heading(body, 'Log an action');
      const who = this._input('Name or id', 'Who it is about');
      const action = this._el('select', 'select'); action.setAttribute('aria-label', 'Action');
      for (const a of ModKit.ACTIONS) { const o = this._el('option', '', a); o.value = a; action.appendChild(o); }
      const reason = this._input('Reason', 'Reason');
      body.append(this._row(who, action, reason));
      const look = this._el('div');
      body.appendChild(this._row(
        this._btn('Log it', () => { ModKit.log({ who: who.value, action: action.value, reason: reason.value }); window.showToast?.('Logged'); draw(); }, { primary: true }),
        this._btn('Has this person been here before?', () => {
          look.textContent = '';
          const r = ModKit.lookup(who.value);
          look.appendChild(this._note(r.count ? who.value + ': ' + r.count + ' earlier case(s), last ' + this._ago(r.last) + ' (' + Object.entries(r.byAction).map(([k, n]) => k + ' ' + n).join(', ') + ')' + (r.repeat ? '. Repeat: two or more actions.' : '') : 'No earlier case for that name.'));
          for (const c of r.cases.slice(0, 5)) look.appendChild(this._note(ModKit.logLine(c)));
        })));
      body.appendChild(look);
      this._heading(body, 'Recent cases');
      const cs = ModKit.cases().slice(0, 15);
      if (!cs.length) body.appendChild(this._note('Nothing logged.'));
      for (const c of cs) body.appendChild(this._row(this._el('span', '', ModKit.logLine(c)),
        this._btn('Remind me', async () => {
          const when = await window.vexPrompt({ title: 'Follow up when?', message: 'For example tomorrow 9am or in 3 days.', okLabel: 'Remind me' });
          if (!when) return;
          const d = typeof VexQuickReminder !== 'undefined' ? VexQuickReminder.parseWhen(when) : null;
          if (!d) throw new Error('Vex could not read that time');
          await ModKit.remind(c.id, d instanceof Date ? d : new Date(d.at || d)); window.showToast?.('You will be reminded');
        }),
        this._btn('Delete', () => { ModKit.removeCase(c.id); draw(); })));
      this._heading(body, 'Reports to look at');
      const rs = ModKit.reports();
      for (const r of rs.slice(0, 10)) body.appendChild(this._row(this._el('span', '', (r.status === 'done' ? '[done] ' : '') + (r.about ? r.about + ': ' : '') + r.text),
        this._btn(r.status === 'done' ? 'Reopen' : 'Done', () => { ModKit.setReportDone(r.id, r.status !== 'done'); draw(); }), this._btn('Delete', () => { ModKit.removeReport(r.id); draw(); })));
      if (!rs.length) body.appendChild(this._note('No reports.'));
      body.appendChild(this._row(this._btn('Add a report', async () => {
        const text = await window.vexPrompt({ title: 'What was reported?', message: 'In a line.', okLabel: 'Next' });
        if (!text) return;
        const about = await window.vexPrompt({ title: 'About whom?', message: 'Name or id (optional).', okLabel: 'Add' });
        ModKit.addReport({ text, about: about || '' }); draw();
      })));
      this._heading(body, 'Templates (copy, then paste yourself)');
      for (const t of ModKit.templates()) body.appendChild(this._row(this._el('span', '', t.name),
        this._btn('Copy', async () => {
          const name = await window.vexPrompt({ title: t.name, message: 'Their name (optional).', okLabel: 'Next' });
          const rsn = await window.vexPrompt({ title: t.name, message: 'The reason (optional).', okLabel: 'Next' });
          const rule = await window.vexPrompt({ title: t.name, message: 'The rule (optional), for example "rule 3: no spam".', okLabel: 'Copy' });
          await this._copy(ModKit.fill(t.text, { name, reason: rsn, rule }), t.name);
        }), t.preset ? this._el('span') : this._btn('Delete', () => { ModKit.removeTemplate(t.id); draw(); })));
      body.appendChild(this._row(this._btn('Add a template', async () => {
        const name = await window.vexPrompt({ title: 'Template name', okLabel: 'Next' });
        if (!name) return;
        const text = await window.vexPrompt({ title: 'Template text', message: 'You can use {name}, {reason} and {rule}.', multiline: true, wide: true, okLabel: 'Add' });
        if (text) { ModKit.addTemplate({ name, text }); draw(); }
      })));
      this._heading(body, 'Checklists');
      for (const c of ModKit.checklists()) {
        const box = this._box(c.name);
        c.items.forEach((it, i) => box.appendChild(this._row(this._btn((it.done ? '[x] ' : '[ ] ') + it.text, () => { ModKit.tick(c.id, i, !it.done); draw(); }))));
        box.appendChild(this._row(this._btn('Remove this checklist', () => { ModKit.removeChecklist(c.id); draw(); }, { danger: true })));
        body.appendChild(box);
      }
      body.appendChild(this._row(...ModKit.CHECKLIST_PRESETS.map(p => this._btn('Start: ' + p.name, () => { ModKit.startChecklist({ preset: p.name }); draw(); }))));
      this._heading(body, 'Handover and clean-up');
      body.appendChild(this._row(
        this._btn('Copy the handover note', () => this._copy(ModKit.handoverText(), 'handover note')),
        this._btn('Erase the old ones', async () => {
          if (await window.vexConfirm({ title: 'Erase old records?', message: 'Cases and reports older than ' + od.days + ' days are deleted from this computer.', okLabel: 'Erase', cancelLabel: 'Keep', danger: true })) { const r = ModKit.purgeOld(); window.showToast?.('Erased ' + r.cases + ' case(s), ' + r.reports + ' report(s)'); draw(); }
        }, { danger: true }),
        this._btn('Erase one person', async () => {
          const q = await window.vexPrompt({ title: 'Erase one person', message: 'Every case and report that mentions this name or id is deleted.', okLabel: 'Erase' });
          if (!q) return;
          const r = ModKit.forgetPerson(q); window.showToast?.('Erased ' + r.cases + ' case(s), ' + r.reports + ' report(s)'); draw();
        }, { danger: true })));
    };
    this._modDraw = draw;
    draw();
    return dlg;
  },

  // ===== T3-005 Vencord bridge ===========================================================================================
  async openBridge() {
    if (typeof VencordBridge === 'undefined') throw new Error('The Vencord bridge is not loaded');
    if (!VencordBridge.enabled()) throw new Error('The Vencord bridge is switched off: Settings, Community and chat tools');
    const dlg = VexSettingsGroups.dialog({ id: 'vencord-bridge-dialog', title: 'Discord mentions (bridge)', sub: 'Read from a file your own Vencord plugin writes (docs/vencord-bridge.md). Vex does not read Discord.' });
    const draw = async (refresh) => {
      const body = dlg.body;
      body.textContent = '';
      const st = await VencordBridge.status();
      if (!st.granted) {
        body.appendChild(this._note('No folder has been chosen. Pick the folder your Vencord plugin writes vex-bridge.json into. Vex will read that one file, read-only.'));
        body.appendChild(this._row(this._btn('Choose the folder', async () => { const r = await VencordBridge.pick(); if (r.ok) await draw(true); }, { primary: true })));
        return;
      }
      body.appendChild(this._note('Folder: ' + st.folder + (st.found ? '. File found, saved ' + this._when(st.mtime) + '.' : '. No vex-bridge.json in it yet: your plugin writes it.')));
      if (st.found && refresh !== false) {
        try { await VencordBridge.read(); } catch (err) { body.appendChild(this._note('The file could not be read: ' + err.message)); }
      }
      const data = VencordBridge.data();
      if (data) {
        if (data.skipped) body.appendChild(this._note(data.skipped + ' entr' + (data.skipped === 1 ? 'y' : 'ies') + ' in the file did not fit the format and were left out.'));
        const age = VencordBridge.age();
        if (age != null && age > 24 * 3600000) body.appendChild(this._note('The file was made ' + this._ago(data.generatedAt) + '; your plugin may not be running.'));
        const d = VencordBridge.digest();
        this._heading(body, d.lines[0]);
        const list = (title, items) => {
          this._heading(body, title);
          if (!items.length) body.appendChild(this._note('Nothing.'));
          for (const m of items.slice(0, 25)) {
            const box = this._box((VencordBridge._isNew(m.id) ? 'New  ' : '') + (m.author || 'someone') + (m.channelName ? ' in #' + m.channelName.replace(/^#/, '') : '') + (m.guildName ? ' (' + m.guildName + ')' : ''), m.text);
            box.appendChild(this._note(this._ago(m.ts)));
            const row = this._row();
            if (m.url) row.append(this._btn('Open in Discord panel', () => { if (typeof SidebarManager !== 'undefined') SidebarManager.openPanel('discord'); return this._copy(m.url, 'the link; paste it in the Discord panel'); }));
            row.append(this._btn('Make a task', () => { UnreadTask.add({ text: (m.author || '') + ': ' + m.text, source: 'Discord', url: m.url || '' }); window.showToast?.('Task added'); }));
            box.appendChild(row);
            body.appendChild(box);
          }
        };
        list('Mentions', VencordBridge.mentions());
        list('Replies to your messages', VencordBridge.replies());
        this._heading(body, 'Channel catch-up');
        if (!VencordBridge.channels().length) body.appendChild(this._note('The file has no channel messages.'));
        for (const c of VencordBridge.channels()) {
          body.appendChild(this._row(this._el('span', '', '#' + (c.name || c.channelId) + (c.guildName ? ' (' + c.guildName + ')' : '') + ': ' + c.messages.length + ' messages'),
            this._btn('Catch me up', () => { const t = VencordBridge.catchUpText(c.channelId); VexSettingsGroups.dialog({ id: 'vencord-catchup-dialog', title: 'Catch-up: #' + (c.name || c.channelId), sub: 'Counted from the file, no AI.' }).body.appendChild(this._el('pre', '', t)); }),
            this._btn('Summarize with the local AI', async () => { const t = await VencordBridge.summarizeLocal(c.channelId); VexSettingsGroups.dialog({ id: 'vencord-catchup-dialog', title: 'Summary: #' + (c.name || c.channelId), sub: 'Written by your local model; check it against the chat.' }).body.appendChild(this._el('pre', '', t)); })));
        }
        body.appendChild(this._row(this._btn('Mark everything as seen', () => { VencordBridge.markAllSeen(); draw(false); })));
      }
      body.appendChild(this._row(this._btn('Refresh', () => draw(true)), this._btn('Use another folder', async () => { const r = await VencordBridge.pick(); if (r.ok) await draw(true); }),
        this._btn('Stop using the bridge', async () => {
          if (await window.vexConfirm({ title: 'Stop using the bridge?', message: 'Vex forgets the folder and which items you have seen. The file itself is not touched.', okLabel: 'Forget', cancelLabel: 'Keep', danger: true })) { await VencordBridge.forget(); await draw(false); }
        }, { danger: true })));
    };
    this._bridgeDraw = draw;
    await draw(true);
    return dlg;
  },

  // ===== right-click on selected text ========================================================================================
  // Items for the page menu (js/webview.js). Only for text the person selected, and never in an editable box.
  textItems(selection, webview, { editable = false } = {}) {
    const sel = String(selection == null ? '' : selection).trim();
    if (!sel || editable) return [];
    const tab = (() => { try { return { title: webview.getTitle(), url: webview.getURL() }; } catch { return { title: '', url: '' }; } })();
    const items = [];
    if (typeof UnreadTask !== 'undefined' && UnreadTask.enabled()) {
      items.push({ label: 'Make a task from this', action: () => this._guard(() => { const r = UnreadTask.add({ text: sel, source: tab.title, url: tab.url }); window.showToast?.('Task added: ' + r.line.slice(0, 60)); }) });
    }
    if (typeof LinkHarvester !== 'undefined' && LinkHarvester.enabled() && /https?:\/\//i.test(sel)) {
      items.push({ label: 'Collect the links in this', action: () => this._guard(() => { const r = LinkHarvester.collect(sel, { source: tab.title || 'Page', channel: tab.title }); window.showToast?.(r.added + ' new link(s), ' + r.seen + ' already known'); }) });
    }
    if (typeof VexTimezone !== 'undefined' && VexTimezone.enabled() && sel.length <= 60 && /\d\s*(:|am|pm)|\bnoon\b|\bmidnight\b/i.test(sel)) {
      let ok = false;
      try { VexTimezone.parse(sel); ok = true; } catch { ok = false; }   // vex-allow-empty-catch: a selection that is not a time simply gets no item
      if (ok) items.push({ label: 'Convert this time', action: () => this._guard(() => this.openTimezone(sel)) });
    }
    return items;
  },

  // ===== Settings ==================================================================================================================
  render(body) {
    body.textContent = '';
    const redraw = () => this.render(body);
    const T = (label, get, set) => this._toggle(body, label, get, (v) => { set(v); });
    const open = (text, fn) => this._btn(text, fn);

    this._heading(body, 'Timezone helper');
    body.appendChild(this._note('Type "21:00 Istanbul" and get the time in your zones plus the Discord timestamp to paste.'));
    T('Use the timezone helper', () => VexTimezone.enabled(), (v) => VexTimezone.setEnabled(v));
    body.appendChild(this._row(open('Open it', () => this.openTimezone()),
      this._btn('Add a zone to the list (' + VexTimezone.zones().join(', ') + ')', async () => {
        const z = await window.vexPrompt({ title: 'Add a zone', message: 'A city or a zone name, for example Tokyo or America/New_York.', okLabel: 'Add' });
        if (z) { VexTimezone.addZone(z); redraw(); }
      })));

    this._heading(body, 'Unread to task');
    body.appendChild(this._note('Right-click selected text > "Make a task from this", or "Make a task" on a kept notification. The task goes into your To-do note with its source and a day.'));
    T('Use unread to task', () => UnreadTask.enabled(), (v) => UnreadTask.setEnabled(v));
    T('Also add each task to my Queue (needs a route on the queue bot: docs/queue-bot-add-endpoint.md)', () => UnreadTask.queueOn(), (v) => UnreadTask.setQueue(v));
    const dueSel = this._el('select', 'select'); dueSel.setAttribute('aria-label', 'Default day for a new task');
    for (const [v, t] of UnreadTask.DUES) { const o = this._el('option', '', t); o.value = v; dueSel.appendChild(o); }
    dueSel.value = UnreadTask.defaultDue();
    dueSel.addEventListener('change', () => this._guard(() => UnreadTask.setDefaultDue(dueSel.value)));
    body.appendChild(this._row(this._el('span', '', 'Default day:'), dueSel, open('Task from the selection now', () => UnreadTask.fromSelection().then(r => window.showToast?.('Task added: ' + r.line.slice(0, 60))))));

    this._heading(body, 'Meeting links and the join strip');
    body.appendChild(this._note('Shows a strip with "Join in browser" a few minutes before a meeting that has a call link. It never opens the link by itself.'));
    T('Show the join strip', () => MeetingLinks.enabled(), (v) => MeetingLinks.setEnabled(v));
    const leadSel = this._el('select', 'select'); leadSel.setAttribute('aria-label', 'Minutes before');
    for (const n of MeetingLinks.LEAD_CHOICES) { const o = this._el('option', '', n + ' minutes before'); o.value = String(n); leadSel.appendChild(o); }
    leadSel.value = String(MeetingLinks.lead());
    leadSel.addEventListener('change', () => this._guard(() => MeetingLinks.setLead(Number(leadSel.value))));
    body.appendChild(this._row(leadSel, open('Open meeting links', () => this.openMeetingLinks())));

    this._heading(body, 'Discord noise tools');
    body.appendChild(this._note('Hide or mute notifications in Vex\'s own list by your rules. Discord, its page and its toasts are not touched, and a VIP match is never hidden.'));
    T('Use noise rules', () => DiscordNoise.enabled(), (v) => DiscordNoise.setEnabled(v));
    body.appendChild(this._row(open('Open noise tools (' + DiscordNoise.rules().length + ' rules)', () => this.openNoise())));

    this._heading(body, 'Announcement composer');
    body.appendChild(this._note('Write once, preview for Discord, Roblox, GitHub and more, with the character limits, and copy it out. It posts nothing by itself.'));
    T('Use the composer', () => AnnounceComposer.enabled(), (v) => AnnounceComposer.setEnabled(v));
    body.appendChild(this._row(open('Open the composer', () => this.openComposer())));
    const hookNote = this._note('Optional: the webhook of your OWN Discord server, to post from here after a confirm. Checking...');
    body.appendChild(hookNote);
    const hookRow = this._row();
    body.appendChild(hookRow);
    AnnounceComposer.webhookStatus().then((st) => {
      hookNote.textContent = st.has ? 'A webhook is saved (' + st.label + '). It is sealed by Windows and never shown again.' : 'No webhook saved. A webhook address is a secret: anyone who has it can post to that channel.';
      hookRow.textContent = '';
      hookRow.append(this._btn(st.has ? 'Replace the webhook' : 'Add my webhook', async () => {
        const url = await window.vexPrompt({ title: 'Your webhook address', message: 'Server settings > Integrations > Webhooks > Copy Webhook URL. It is kept encrypted by Windows and is not synced or backed up.', placeholder: 'https://discord.com/api/webhooks/...', okLabel: 'Save' });
        if (url) { await AnnounceComposer.saveWebhook(url); redraw(); }
      }));
      if (st.has) hookRow.append(this._btn('Remove the webhook', async () => { await AnnounceComposer.clearWebhook(); redraw(); }, { danger: true }));
    }).catch((err) => { hookNote.textContent = 'The webhook is not available here: ' + err.message; });
    T('Let a post ping @everyone', () => AnnounceComposer.allowEveryone(), (v) => AnnounceComposer.setAllowEveryone(v));

    this._heading(body, 'Community numbers and name watch');
    body.appendChild(this._note('Numbers you type or follow on public pages, with the change since last week, and public searches for your own name. Shown in the Morning Brief if you turn that section on.'));
    T('Use community numbers', () => CommunityMetrics.enabled(), (v) => CommunityMetrics.setEnabled(v));
    body.appendChild(this._row(open('Open community numbers', () => this.openMetrics())));

    this._heading(body, 'Collect links');
    body.appendChild(this._note('Gathers links from text you paste or select and from kept notifications when you ask, and warns before a Discord file link expires.'));
    T('Use the link harvester', () => LinkHarvester.enabled(), (v) => LinkHarvester.setEnabled(v));
    body.appendChild(this._row(open('Open collected links (' + LinkHarvester.links().length + ')', () => this.openLinks())));

    this._heading(body, 'Discord status suggestions');
    body.appendChild(this._note('Vex never changes your Discord status. When Game mode or Focus starts it suggests what to set, and copies the words. The status line can show on your New Tab page.'));
    T('Suggest a status for Game and Focus', () => DiscordStatus.enabled(), (v) => DiscordStatus.setEnabled(v));
    T('Suggest it when a mode starts and ends', () => DiscordStatus.state().suggest, (v) => DiscordStatus.setSuggest(v));
    T('Keep a status line for the New Tab page', () => DiscordStatus.state().line, (v) => DiscordStatus.setLine(v));
    for (const mode of ['game', 'focus', 'back']) {
      const t = DiscordStatus.state().texts[mode];
      const sel = this._el('select', 'select'); sel.setAttribute('aria-label', 'Status for ' + mode);
      for (const s of DiscordStatus.STATUSES) { const o = this._el('option', '', s); o.value = s; sel.appendChild(o); }
      sel.value = t.status;
      sel.addEventListener('change', () => this._guard(() => DiscordStatus.setText(mode, { status: sel.value })));
      const txt = this._input(mode === 'back' ? 'no text' : 'Text, {end} is the time it ends', 'Status text for ' + mode, t.text);
      txt.addEventListener('change', () => this._guard(() => { DiscordStatus.setText(mode, { text: txt.value }); window.showToast?.('Saved'); }));
      body.appendChild(this._row(this._el('span', '', mode === 'game' ? 'Game mode:' : mode === 'focus' ? 'Focus:' : 'Back:'), sel, txt));
    }
    body.appendChild(this._row(this._btn('Set a status line for a while...', async () => {
      const text = await window.vexPrompt({ title: 'Status line', message: 'The words to show on your New Tab page.', okLabel: 'Next' });
      if (!text) return;
      const min = await window.vexPrompt({ title: 'For how long?', message: 'Minutes (1 to 1440).', value: '60', okLabel: 'Show it' });
      if (min) { DiscordStatus.setManual(text, Number(min)); window.showToast?.('Shown on the New Tab page (turn on the Status line section in the Morning Brief settings)'); }
    }), this._btn('Clear it', () => { DiscordStatus.clearManual(); window.showToast?.('Cleared'); })));

    this._heading(body, 'Moderator kit');
    body.appendChild(this._note('A log, reports, templates and checklists for when you moderate. Records about people stay on this computer, are not synced, and take no action on any server.'));
    T('Use the moderator kit', () => ModKit.enabled(), (v) => ModKit.setEnabled(v));
    T('Also add each log line to a Notes note "Mod log" (Notes may sync)', () => ModKit.state().toNote, (v) => ModKit.setToNote(v));
    body.appendChild(this._row(open('Open the moderator kit', () => this.openModKit())));

    this._heading(body, 'Vencord bridge');
    body.appendChild(this._note('Reads one JSON file that YOUR Vencord plugin writes, from a folder you choose: mentions, replies and channel catch-up. Vex does not read Discord and does not change Vencord. See docs/vencord-bridge.md.'));
    T('Use the Vencord bridge', () => VencordBridge.enabled(), (v) => VencordBridge.setEnabled(v));
    body.appendChild(this._row(open('Open the bridge', () => this.openBridge())));
  },
};

if (typeof window !== 'undefined') {
  window.CommsToolsUI = CommsToolsUI;
  // Webview.js asks for the extra right-click items by this name.
  window.CommsTools = { textItems: (sel, wv, opts) => CommsToolsUI.textItems(sel, wv, opts) };
  if (typeof document !== 'undefined') {
    for (const [ev, prop, id] of [['vex:meeting-links', '_meetDraw', 'meeting-links-dialog'], ['vex:discord-noise', '_noiseDraw', 'discord-noise-dialog'], ['vex:community-metrics', '_metricsDraw', 'community-metrics-dialog'],
      ['vex:link-harvester', '_linksDraw', 'link-harvester-dialog'], ['vex:mod-kit', '_modDraw', 'mod-kit-dialog']]) {
      document.addEventListener(ev, () => CommsToolsUI._redrawOpen(prop, id));
    }
  }
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'comms-tools', title: 'Community and chat tools', keywords: 'discord timezone time zone announcement webhook metrics members moderator mod log vencord bridge mentions meeting join zoom meet link harvester task status noise mute', render: (body) => CommsToolsUI.render(body) });
  }
}
if (typeof window !== 'undefined' && typeof CommandBar !== 'undefined' && CommandBar.commands) {
  const add = (c) => { if (!CommandBar.commands.some(x => x.id === c.id)) CommandBar.commands.push({ ...c, action: () => CommsToolsUI._guard(c.action) }); };
  add({ id: 'timezone-helper', label: 'Timezone helper', hint: 'Turn "21:00 Istanbul" into times and a Discord timestamp', icon: 'clock', action: () => CommsToolsUI.openTimezone() });
  add({ id: 'task-from-selection', label: 'Task from the selection', hint: 'Make a task from the text selected on the page, with its source', icon: 'list', action: () => UnreadTask.fromSelection().then(r => window.showToast?.('Task added: ' + r.line.slice(0, 60))) });
  add({ id: 'meeting-links', label: 'Meeting links', hint: 'Call links from calendar, notifications and mail; join in browser', icon: 'calendar', action: () => CommsToolsUI.openMeetingLinks() });
  add({ id: 'discord-noise', label: 'Discord noise tools', hint: 'Hide or mute noisy notifications in Vex\'s own list', icon: 'bell', action: () => CommsToolsUI.openNoise() });
  add({ id: 'announce-composer', label: 'Announcement composer', hint: 'Write once, preview per place with character limits, copy out', icon: 'send', action: () => CommsToolsUI.openComposer() });
  add({ id: 'community-metrics', label: 'Community numbers', hint: 'Members, stars and name watch with change since last week', icon: 'users', action: () => CommsToolsUI.openMetrics() });
  add({ id: 'link-harvester', label: 'Collect links', hint: 'Links from pasted text and kept notifications; rescue expiring files', icon: 'link', action: () => CommsToolsUI.openLinks() });
  add({ id: 'mod-kit', label: 'Moderator kit', hint: 'Log, reports, templates and checklists for moderating', icon: 'flag', action: () => CommsToolsUI.openModKit() });
  add({ id: 'vencord-bridge', label: 'Discord mentions (bridge)', hint: 'Mentions, replies and catch-up from your Vencord plugin\'s file', icon: 'message', action: () => CommsToolsUI.openBridge() });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { CommsToolsUI };
