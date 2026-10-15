// === Timeline, living bookmarks, reading queue, one box, link triage: wiring =
//
// The five modules (session-timeline.js, smart-bookmarks.js, reading-queue.js,
// one-box.js, link-triage.js) each stand on their own. This one attaches them
// from outside, once, after every script has loaded, so index.html needs only
// script tags and no existing file needs more than it already has:
//
//   * commands      -> pushed onto CommandBar.commands (Ctrl+K)
//   * one box       -> VexOneBox.install() wraps VexQuickCommands.results
//   * mail subjects -> VexMail.inbox is wrapped to tell the timeline (only
//                      when its "mail subjects" switch is on)
//   * Settings      -> one group of its own, added to the Settings panel here
//   * brief         -> each module's { id, title, build(), isEnabled() } section
//                      is registered with VexBrief when that registry exists
//
// Nothing here edits today.js or the start page.
const TimelineActions = {
  // The commands, in the shape CommandBar.commands uses.
  commands() {
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    return [
      { id: 'timeline', label: 'Timeline', hint: 'What you did, by day: pages, notes, saved links, recordings, games — click a moment to reopen its tabs', icon: 'history', isPrimary: true,
        action: () => { try { return VexTimeline.open({ by: 'day' }); } catch (e) { fail(e); } } },
      { id: 'timeline-week', label: 'Timeline by Week', hint: 'The same, one block per week', icon: 'history',
        action: () => { try { return VexTimeline.open({ by: 'week' }); } catch (e) { fail(e); } } },
      { id: 'living-bookmarks', label: 'Living Bookmarks', hint: 'Bookmarks Vex keeps the text of and looks at again: still the same, changed or gone', icon: 'bookmark', isPrimary: true,
        action: () => { try { return SmartBookmarks.open(); } catch (e) { fail(e); } } },
      { id: 'keep-bookmark-alive', label: 'Keep This Bookmark Alive', hint: 'Save the text of this bookmarked page now and check it again from time to time', icon: 'bookmark',
        action: async () => { try { await SmartBookmarks.keepActive(); } catch (e) { fail(e); } } },
      { id: 'read-minutes', label: 'I Have Some Minutes to Read', hint: 'Say how long you have; Vex lists the saved links that fit', icon: 'book', isPrimary: true,
        action: async () => {
          try {
            const v = await vexPrompt({ title: 'How long do you have?', message: 'Minutes — for example 15.', value: '15', okLabel: 'Show what fits' });
            if (v == null) return;
            const m = Math.floor(Number(String(v).trim()));
            if (!(m > 0) || m > ReadingQueue.MAX_BUDGET) throw new Error('Give a number of minutes from 1 to ' + ReadingQueue.MAX_BUDGET);
            ReadingQueue.open({ minutes: m });
          } catch (e) { fail(e); }
        } },
      { id: 'read-finished', label: 'Mark This Page as Finished Reading', hint: 'Counts it as read in your Read Later tally', icon: 'check',
        action: () => { try { const it = ReadingQueue.finishActive(); window.showToast?.('Marked finished: ' + (it.title || it.url)); } catch (e) { fail(e); } } },
    ];
  },

  registerCommands(bar) {
    const target = bar || (typeof CommandBar !== 'undefined' ? CommandBar : null);
    if (!target || !Array.isArray(target.commands)) return 0;
    let n = 0;
    for (const c of this.commands()) {
      if (target.commands.some(x => x.id === c.id)) continue;
      target.commands.push(c);
      n++;
    }
    return n;
  },

  sections() {
    const out = [];
    const take = (obj) => { if (obj) out.push({ defaultOn: true, order: 100, icon: 'sparkles', ...obj }); };
    if (typeof VexTimeline !== 'undefined') take(VexTimeline.section);
    if (typeof SmartBookmarks !== 'undefined') take(SmartBookmarks.section);
    if (typeof ReadingQueue !== 'undefined') take(ReadingQueue.section);
    return out;
  },

  registerSections(brief) {
    if (!brief || typeof brief.register !== 'function') return 0;
    let n = 0;
    for (const s of this.sections()) {
      brief.register({ ...s, build: async (ctx) => (typeof s.isEnabled === 'function' && !s.isEnabled() ? null : s.build(ctx)) });
      n++;
    }
    return n;
  },

  _wrapMail() {
    if (typeof VexMail === 'undefined' || VexMail._timelineWrapped || typeof VexMail.inbox !== 'function') return false;
    const original = VexMail.inbox.bind(VexMail);
    VexMail.inbox = async function (id, limit, before) {
      const r = await original(id, limit, before);
      try { if (typeof VexTimeline !== 'undefined') VexTimeline.noteMail(r && r.messages, String(id || '')); }
      catch (err) { window.VexProblems?.note('Timeline', 'Could not note the mail subjects', err); }
      return r;
    };
    VexMail._timelineWrapped = true;
    return true;
  },

  // ---- Settings -------------------------------------------------------------
  renderSettings(container) {
    if (!container) return;
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    container.textContent = '';
    const toggle = (label, info, on, set) => {
      const row = el('div', 'setting-toggle-row');
      const name = el('span', '', label);
      name.style.flex = '1';
      const lab = el('label', 'toggle');
      const input = document.createElement('input');
      input.type = 'checkbox'; input.checked = !!on; input.setAttribute('aria-label', label);
      input.addEventListener('change', () => {
        try { set(input.checked); } catch (err) { input.checked = !input.checked; window.showToast?.(err.message, 'error'); }
      });
      lab.append(input, el('span', 'toggle-slider'));
      row.append(name, lab);
      container.appendChild(row);
      if (info) container.appendChild(el('div', 'setting-info', info));
    };
    const heading = (text) => { const h = el('div', 'setting-info', text); h.style.cssText = 'font-weight:650;margin-top:10px'; container.appendChild(h); };
    const button = (text, fn) => { const b = el('button', 'btn-secondary', text); b.type = 'button'; b.style.marginTop = '6px'; b.addEventListener('click', fn); container.appendChild(b); };

    container.appendChild(el('p', 'setting-info', 'Everything here stays on this PC. Nothing is sent anywhere, and private and Tor tabs are never used.'));

    if (typeof VexTimeline !== 'undefined') {
      heading('Timeline');
      const p = VexTimeline.prefs();
      toggle('Remember which tabs were open', 'Every ten minutes, when the set of open tabs changed, so a click on the timeline can reopen that moment. Only page addresses and titles; private and Tor tabs are never kept.', p.tabs, (v) => VexTimeline.setPref('tabs', v));
      toggle('Note game sessions', 'When a game started and ended.', p.games, (v) => VexTimeline.setPref('games', v));
      toggle('Note GitHub results Vex told me about', 'Finished runs and new releases from GitHub watches.', p.github, (v) => VexTimeline.setPref('github', v));
      toggle('Note mail subjects I looked at', 'The subject and time of messages shown in Vex Mail. Off unless you turn it on; bodies and addresses are never kept.', p.mail, (v) => VexTimeline.setPref('mail', v));
      button('Open the timeline', () => VexTimeline.open());
      button('Forget what the timeline recorded', async () => {
        const ok = await window.vexConfirm({ title: 'Forget the timeline log?', message: 'This removes the open-tab, game, GitHub and mail records the timeline kept. Your history, notes and bookmarks are not touched.', okLabel: 'Forget', danger: true });
        if (ok) { VexTimeline.forgetLog(); window.showToast?.('The timeline log is cleared'); }
      });
    }

    if (typeof SmartBookmarks !== 'undefined') {
      heading('Living bookmarks');
      const p = SmartBookmarks.prefs();
      toggle('Check bookmarks I keep alive, in the background', 'Looks again at only the bookmarks you chose, a few at a time and never while a game runs. Off until you turn it on.', p.enabled, (v) => SmartBookmarks.setPrefs({ enabled: v }));
      const row = el('div', 'setting-toggle-row');
      const name = el('span', '', 'How often');
      name.style.flex = '1';
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', 'How often to look again');
      for (const [h, label] of Object.entries(SmartBookmarks.INTERVALS)) {
        const o = document.createElement('option');
        o.value = h; o.textContent = 'About every ' + label; o.selected = Number(h) === p.hours;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => { try { SmartBookmarks.setPrefs({ hours: Number(sel.value) }); } catch (err) { window.showToast?.(err.message, 'error'); } });
      row.append(name, sel);
      container.appendChild(row);
      button('Open living bookmarks', () => SmartBookmarks.open());
    }

    if (typeof ReadingQueue !== 'undefined') {
      heading('Reading queue');
      container.appendChild(el('div', 'setting-info', 'Ctrl+K › "I have some minutes to read", or type "I have 20 minutes".'));
      button('What fits in 15 minutes', () => ReadingQueue.open({ minutes: 15 }));
    }

    if (typeof VexOneBox !== 'undefined') {
      heading('One box');
      toggle('Read more sentences in Ctrl+K', '"note: idea", "open GitHub PRs", "I have 20 minutes", "timeline". Each shows what it understood first and only adds or opens things.', VexOneBox.enabled(), (v) => VexOneBox.setEnabled(v));
    }

    if (typeof LinkTriage !== 'undefined') {
      heading('Pasted links');
      toggle('Offer title, site and reading time for a pasted link', 'In Notes and the AI box. Asked only when you press Add details; https only, no cookies, no referrer.', LinkTriage.enabled(), (v) => LinkTriage.setEnabled(v));
    }
  },

  mountSettings() {
    const panel = document.getElementById('panel-settings');
    if (!panel || document.getElementById('settings-timeline-actions')) return false;
    const group = document.createElement('div');
    group.className = 'setting-group';
    group.id = 'settings-timeline-actions';
    const label = document.createElement('label');
    label.className = 'setting-label';
    label.textContent = 'Timeline, bookmarks and reading';
    const body = document.createElement('div');
    body.id = 'timeline-actions-content';
    group.append(label, body);
    (panel.querySelector('.panel-content') || panel).appendChild(group);
    this.renderSettings(body);
    if (typeof IntersectionObserver === 'function') {
      new IntersectionObserver((entries) => { if (entries.some(e => e.isIntersecting)) this.renderSettings(body); }).observe(group);
    }
    return true;
  },

  init() {
    if (this._inited) return;
    this._inited = true;
    const guard = (what, fn) => { try { fn(); } catch (err) { window.VexProblems?.note('Timeline actions', what, err); } };
    guard('Commands could not be added', () => this.registerCommands());
    guard('The one box could not be attached', () => { if (typeof VexOneBox !== 'undefined') VexOneBox.install(); });
    guard('Mail subjects could not be hooked', () => this._wrapMail());
    guard('The brief sections could not be added', () => { if (typeof VexBrief !== 'undefined') this.registerSections(VexBrief); });
    guard('The Settings group could not be added', () => this.mountSettings());
    guard('The timeline could not start', () => { if (typeof VexTimeline !== 'undefined') VexTimeline.start(); });
    guard('Living bookmarks could not start', () => { if (typeof SmartBookmarks !== 'undefined') SmartBookmarks.start(); });
    guard('Link triage could not start', () => { if (typeof LinkTriage !== 'undefined') LinkTriage.start(); });
  },
};

if (typeof window !== 'undefined') {
  window.TimelineActions = TimelineActions;
  if (typeof document !== 'undefined') {
    const go = () => { try { TimelineActions.init(); } catch (err) { console.error('[TimelineActions]', err); } };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else setTimeout(go, 0);
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { TimelineActions };
