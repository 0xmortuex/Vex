// === Reminders: one place to see them and add one ==============================
//
// Vex has several things that remind you of something, each with its own screen:
// the "Remind me" box (a time, or "when I open a site"), reminders tied to a page,
// follow-ups (what you owe, what you wait on), deadlines with a countdown and the
// things waiting for the end of a game. This is the Reminders tab of the Clock
// panel: ONE list of what is coming, and ONE form to add something.
//
// It is a front door, not an engine. It reads each store through the API that
// store already has, and adds through the add function that store already has:
//
//   time / site   VexQuickReminder.create  -> the main process (src/main/reminders.js),
//                 which keeps the timer, the Windows wake-up and the toast (notify:show)
//   page          VexPageReminders.add     -> 'vex.pageReminders'
//   follow-up     VexFollowUps.add         -> 'vex.followUps'
//
// No storage and no scheduler of its own. Every old entry (Ctrl+K "Remind me",
// "Page reminders", "Follow-ups", "Deadlines with countdown", the Alarms tab, the
// reminders-sync path, the saved keys) works exactly as before.
//
// Left out of the list on purpose: alarms, timers and the weekly review (the
// Alarms and Timer tabs show them), the Speech timer and game timers (a different
// job), and receipt/warranty reminders and deadline nudges, which are ordinary
// main-process reminders and so already appear as "Reminder" rows.
const VexRemindersTab = {
  // The order of the groups that have no time of their own.
  KIND_RANK: { reminder: 0, site: 1, page: 2, owe: 3, waiting: 4, deadline: 5, game: 6 },
  KIND_LABEL: { reminder: 'Reminder', site: 'Site reminder', page: 'Page reminder', owe: 'I owe', waiting: 'Waiting on', deadline: 'Deadline', game: 'After the game' },
  ADD_KINDS: [
    ['time', 'At a time'],
    ['site', 'When I open a site'],
    ['page', 'About the page in front'],
    ['owe', 'Something I owe'],
    ['waiting', 'Something I am waiting on'],
  ],
  PAGE_TRIGGERS: [['visit', 'next time I visit'], ['leave', 'when the page changes'], ['close', 'if I close the tab without Done']],
  REPEATS: [['', 'Once'], ['daily', 'Every day'], ['weekdays', 'Weekdays'], ['weekly', 'Every week']],
  _wired: false,
  _refresh: null,

  // ---- reading (every store through its own API) ---------------------------------------
  // Each reader returns an array of rows, or null when its feature is switched off.
  // A reader that cannot read its store throws; collect() names it and goes on.
  _sources() {
    const need = (name, ok) => { if (!ok) throw new Error(name + ' did not load'); };
    return {
      reminders: async () => {
        need('Reminders', typeof VexQuickReminder !== 'undefined');
        return VexQuickReminder.list();
      },
      pages: () => {
        if (typeof VexPageReminders === 'undefined') throw new Error('Page reminders did not load');
        return VexPageReminders.enabled() ? VexPageReminders.list() : null;
      },
      followUps: () => {
        if (typeof VexFollowUps === 'undefined') throw new Error('Follow-ups did not load');
        return VexFollowUps.enabled() ? VexFollowUps.list() : null;
      },
      deadlines: () => {
        if (typeof VexDeadlineLedger === 'undefined') throw new Error('Deadlines did not load');
        return VexDeadlineLedger.enabled() ? VexDeadlineLedger.list() : null;
      },
      game: () => {
        if (typeof VexWhen === 'undefined') throw new Error('The when box did not load');
        return VexWhen.enabled() ? VexWhen.pending() : null;
      },
    };
  },

  _dayMs(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d.getTime() : null;
  },
  _when(ms, now) {
    const d = new Date(ms);
    const day = new Date(ms); day.setHours(0, 0, 0, 0);
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const diff = Math.round((day.getTime() - today.getTime()) / 86400000);
    const hhmm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    const name = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    // Parts joined by " · " are translated one by one (js/i18n-ui.js), so the words stay words and the numbers stay numbers.
    return name + ' · ' + hhmm;
  },

  // -> { rows, errors }. Rows with a time come first, soonest first; the rest follow in a fixed order.
  async collect(now = Date.now(), src = this._sources()) {
    const rows = [];
    const errors = [];
    const guard = async (name, fn) => { try { await fn(); } catch (err) { errors.push(name + ': ' + ((err && err.message) || 'unavailable')); } };
    await guard('reminders', async () => {
      for (const r of (await src.reminders()) || []) {
        if (!r || r.firedAt || typeof r.message !== 'string') continue;
        // Alarms, timers and the weekly review have their own tabs.
        if (r.kind && r.kind !== 'reminder') continue;
        if (r.site) rows.push({ key: 'reminder:' + r.id, kind: 'site', id: r.id, text: r.message, sub: 'When you open · ' + r.site, at: null });
        else if (Number.isFinite(r.at)) rows.push({ key: 'reminder:' + r.id, kind: 'reminder', id: r.id, text: r.message, sub: this._when(r.at, now) + (typeof r.repeat === 'string' && r.repeat ? ' · ' + ((this.REPEATS.find(x => x[0] === r.repeat) || [0, r.repeat])[1]) : ''), at: r.at });
      }
    });
    await guard('page reminders', async () => {
      for (const r of (await src.pages()) || []) {
        if (!r || r.firedAt || r.doneAt) continue;
        const where = r.scope === 'host' ? r.host : r.url;
        const label = (this.PAGE_TRIGGERS.find(t => t[0] === r.trigger) || [0, r.trigger])[1];
        rows.push({ key: 'page:' + r.id, kind: 'page', id: r.id, text: r.text, sub: label + ' · ' + where, at: null });
      }
    });
    await guard('follow-ups', async () => {
      for (const f of (await src.followUps()) || []) {
        if (!f || f.doneAt) continue;
        const due = Number.isFinite(f.due) && f.due > 0 ? f.due : null;
        if (f.dir === 'owe') rows.push({ key: 'owe:' + f.id, kind: 'owe', id: f.id, text: f.what, sub: due ? 'Due · ' + new Date(due).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : 'No day set', at: due });
        else rows.push({ key: 'waiting:' + f.id, kind: 'waiting', id: f.id, text: f.what, sub: f.who || '', at: null });
      }
    });
    await guard('deadlines', async () => {
      for (const e of (await src.deadlines()) || []) {
        if (!e || e.doneAt) continue;
        const at = this._dayMs(e.due);
        if (at == null) continue;
        const days = Math.round((at - new Date(new Date(now).setHours(0, 0, 0, 0)).getTime()) / 86400000);
        rows.push({ key: 'deadline:' + e.id, kind: 'deadline', id: e.id, text: e.title, sub: days < 0 ? 'Days late · ' + Math.abs(days) : days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : 'Days left · ' + days, at });
      }
    });
    await guard('after the game', async () => {
      for (const w of (await src.game()) || []) {
        if (!w || w.cond !== 'game-end') continue;
        rows.push({ key: 'game:' + w.id, kind: 'game', id: w.id, text: String(w.text || ''), sub: 'When Game mode ends', at: null });
      }
    });
    rows.sort((a, b) => {
      if (a.at != null && b.at != null) return a.at - b.at;
      if (a.at != null) return -1;
      if (b.at != null) return 1;
      return this.KIND_RANK[a.kind] - this.KIND_RANK[b.kind];
    });
    return { rows, errors };
  },

  // ---- adding (each kind goes to the function that already adds it) ---------------------
  _deps() {
    return {
      quick: typeof VexQuickReminder !== 'undefined' ? VexQuickReminder : null,
      pages: typeof VexPageReminders !== 'undefined' ? VexPageReminders : null,
      followUps: typeof VexFollowUps !== 'undefined' ? VexFollowUps : null,
      activeTab: () => (typeof TabManager !== 'undefined' && typeof TabManager.getActiveTab === 'function') ? TabManager.getActiveTab() : null,
    };
  },

  // f: { text, when, repeat, site, trigger, who, due }. Throws with the reason; returns what was made.
  async add(kind, f, deps = this._deps()) {
    const need = (obj, name) => { if (!obj) throw new Error(name + ' did not load'); return obj; };
    const text = String((f && f.text) || '').trim();
    if (kind === 'time' || kind === 'site') {
      const quick = need(deps.quick, 'Reminders');
      if (kind === 'site') {
        const site = String((f && f.site) || '').trim();
        if (!site) throw new Error('Type the site, like github.com');
        const trig = quick.parseTrigger('when I open ' + site);
        const made = await quick.create(text, { site: trig.site });
        if (typeof quick._hostsChanged === 'function') quick._hostsChanged();
        return made;
      }
      const trig = quick.parseTrigger(f && f.when);
      if (trig.site) {
        const made = await quick.create(text, { site: trig.site });
        if (typeof quick._hostsChanged === 'function') quick._hostsChanged();
        return made;
      }
      return quick.create(text, trig.at, { repeat: (f && f.repeat) || undefined });
    }
    if (kind === 'page') {
      const pages = need(deps.pages, 'Page reminders');
      if (!pages.enabled()) throw new Error('Page reminders are switched off in Settings');
      const tab = deps.activeTab();
      if (!tab || !pages.normalize(tab.url)) throw new Error('Open a web page first');
      if (tab.partition && tab.partition !== 'persist:main' && !/^persist:container-/.test(tab.partition)) throw new Error('Private and Tor tabs are not watched');
      return pages.add({ text, url: tab.url, scope: 'url', trigger: (f && f.trigger) || 'visit', action: null });
    }
    if (kind === 'owe' || kind === 'waiting') {
      const fu = need(deps.followUps, 'Follow-ups');
      if (!fu.enabled()) throw new Error('Follow-ups are switched off in Settings');
      let due = 0;
      if (f && f.due) {
        due = this._dayMs(f.due);
        if (due == null) throw new Error('That is not a day: ' + f.due);
      }
      return fu.add({ dir: kind, who: (f && f.who) || '', what: text, due });
    }
    throw new Error('Unknown kind of reminder: ' + kind);
  },

  // Take one back with the store's own function. Deadlines, owed things and the game list are
  // finished or edited in their own screens, so they have no button here.
  async remove(row, deps = this._deps()) {
    if (row.kind === 'reminder' || row.kind === 'site') {
      if (!deps.quick) throw new Error('Reminders did not load');
      return deps.quick.remove(row.id);
    }
    if (row.kind === 'page') {
      if (!deps.pages) throw new Error('Page reminders did not load');
      return deps.pages.remove(row.id);
    }
    throw new Error('That one is removed in its own screen');
  },

  // The old screens, kept as they were. Each opens through the function its Ctrl+K command calls.
  OLD_DOORS: [
    ['Page reminders', () => VexPageReminders.open(), () => typeof VexPageReminders !== 'undefined'],
    ['Follow-ups', () => VexFollowUps.open(), () => typeof VexFollowUps !== 'undefined'],
    ['Deadlines', () => VexDeadlineLedger.open(), () => typeof VexDeadlineLedger !== 'undefined'],
  ],

  // ---- the tab ----------------------------------------------------------------------------
  render(body) {
    const icon = (n, sz) => (window.VexIcons && VexIcons.has(n)) ? VexIcons.svg(n, { size: sz || 13 }) : '';
    const opt = (list) => list.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    body.innerHTML = `
      <form class="ck-form" id="rt-form">
        <div class="ck-row">
          <label class="ck-hint" for="rt-kind">Remind me</label>
          <select id="rt-kind" class="ck-input">${opt(this.ADD_KINDS)}</select>
        </div>
        <input type="text" id="rt-text" class="ck-input" placeholder="What is it about?" aria-label="What is it about?" maxlength="160" required>
        <div class="ck-row" data-for="time">
          <input type="text" id="rt-when" class="ck-input" placeholder="in 2 hours, tomorrow 9am" aria-label="When" autocomplete="off">
          <select id="rt-repeat" class="ck-input ck-select-short" aria-label="Repeat">${opt(this.REPEATS)}</select>
        </div>
        <div class="ck-row" data-for="site" hidden>
          <input type="text" id="rt-site" class="ck-input" placeholder="github.com" aria-label="Site address" autocomplete="off">
        </div>
        <div class="ck-row" data-for="page" hidden>
          <select id="rt-trigger" class="ck-input" aria-label="When it should speak up">${opt(this.PAGE_TRIGGERS)}</select>
        </div>
        <div class="ck-row" data-for="owe waiting" hidden>
          <input type="text" id="rt-who" class="ck-input" placeholder="Who (needed when waiting)" aria-label="Who (needed when waiting)" maxlength="60">
          <input type="date" id="rt-due" class="ck-input" aria-label="Day (optional)">
        </div>
        <div class="ck-row ck-row-end"><span class="ck-hint" id="rt-hint"></span><button class="qr-btn qr-primary" type="submit">Add</button></div>
      </form>
      <div class="ck-list" id="rt-list" role="list" aria-label="Upcoming reminders" aria-live="polite"></div>
      <div class="ck-row" id="rt-doors"></div>`;
    const $ = (id) => body.querySelector('#' + id);
    const HINTS = {
      time: 'Rings even if Vex was closed. Windows wakes it.',
      site: 'Waits and speaks up the moment a tab lands on that site.',
      page: 'Uses the page in front. Private and Tor tabs are not watched.',
      owe: 'A day is optional. It speaks up the day before.',
      waiting: 'Comes back after 3 and 7 days with a nudge you can copy.',
    };
    const sync = () => {
      const k = $('rt-kind').value;
      body.querySelectorAll('[data-for]').forEach(el => { el.hidden = !el.dataset.for.split(' ').includes(k); });
      $('rt-hint').textContent = HINTS[k] || '';
    };
    $('rt-kind').addEventListener('change', sync);
    sync();

    const list = $('rt-list');
    const draw = async () => {
      let res;
      try { res = await this.collect(); }
      catch (err) { list.textContent = 'Could not read your reminders: ' + ((err && err.message) || ''); return; }
      list.textContent = '';
      if (!res.rows.length) { const e = document.createElement('div'); e.className = 'ck-empty'; e.textContent = 'Nothing is waiting.'; list.appendChild(e); }
      for (const r of res.rows) {
        const row = document.createElement('div');
        row.className = 'ck-item';
        row.setAttribute('role', 'listitem');
        const text = document.createElement('span'); text.className = 'ck-item-text';
        const label = document.createElement('span'); label.className = 'ck-item-label'; label.textContent = r.text;
        const sub = document.createElement('span'); sub.className = 'ck-item-sub'; sub.textContent = (this.KIND_LABEL[r.kind] || r.kind) + (r.sub ? ' · ' + r.sub : '');
        text.append(label, sub);
        row.appendChild(text);
        if (['reminder', 'site', 'page'].includes(r.kind)) {
          const x = document.createElement('button');
          x.type = 'button'; x.className = 'ck-x'; x.title = 'Remove'; x.setAttribute('aria-label', 'Remove: ' + r.text);
          x.innerHTML = icon('x', 13);
          x.addEventListener('click', async () => {
            try { await this.remove(r); window.showToast?.('Reminder removed'); }
            catch (err) { window.showToast?.((err && err.message) || 'Could not remove it', 'error'); }
            draw();
          });
          row.appendChild(x);
        }
        list.appendChild(row);
      }
      if (res.errors.length) { const e = document.createElement('div'); e.className = 'ck-hint'; e.textContent = 'Could not read: ' + res.errors.join('; '); list.appendChild(e); }
    };
    this._refresh = () => { if (body.isConnected) draw(); };

    $('rt-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const kind = $('rt-kind').value;
      const btn = ev.submitter || $('rt-form').querySelector('[type=submit]');
      btn.disabled = true;
      try {
        await this.add(kind, { text: $('rt-text').value, when: $('rt-when').value, repeat: $('rt-repeat').value, site: $('rt-site').value, trigger: $('rt-trigger').value, who: $('rt-who').value, due: $('rt-due').value });
        window.showToast?.('Reminder set');
        $('rt-text').value = ''; $('rt-when').value = ''; $('rt-site').value = ''; $('rt-who').value = ''; $('rt-due').value = '';
        $('rt-text').focus();
      } catch (err) {
        window.showToast?.((err && err.message) || 'Could not set that reminder', 'error');
      } finally { btn.disabled = false; }
      draw();
    });

    const doors = $('rt-doors');
    for (const [label, open, ok] of this.OLD_DOORS) {
      if (!ok()) continue;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'qr-btn ck-mini'; b.textContent = label;
      b.addEventListener('click', () => { try { open(); } catch (err) { window.showToast?.((err && err.message) || 'Could not open it', 'error'); } });
      doors.appendChild(b);
    }
    this._wire();
    draw();
  },

  // A reminder that fires while the tab is open leaves the list.
  _wire() {
    if (this._wired) return;
    this._wired = true;
    const b = window.vex && window.vex.reminders;
    if (b && typeof b.onFired === 'function') b.onFired(() => { if (this._refresh) this._refresh(); });
  },

  init() {
    if (this._cmd) return true;
    this._cmd = true;
    if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
      VexExtras.registerCommand({ id: 'reminders', label: 'Reminders', hint: 'Everything that will remind you, and add one: in the Clock panel', icon: 'bell', action: () => SidebarManager.openPanel('reminders') });
    }
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.VexRemindersTab = VexRemindersTab;
  VexRemindersTab.init();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexRemindersTab };
