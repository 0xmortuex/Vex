// === The Inbox: one front door, three tabs =========================================
//
// Vex had three things that read as "an inbox": the bell's Attention Inbox (notices that did
// not deserve a pop-up), "One inbox" (what you captured and saved) and "Needs me" (what is
// waiting on you). They hold different kinds of item, so this does NOT merge them into one
// list. It is one window with one name and three tabs; each tab draws the existing surface,
// unchanged, from the module that owns it:
//
//   Notices         AttentionInbox.renderInto(el)      js/attention-inbox.js (the bell's list)
//   Things I saved  VexInbox.open(el)                  js/inbox.js (+ a button to Weekly triage)
//   Waiting on me   PanelsCommsUI.openNeedsMe(host)    js/panels-comms-ui.js (Needs me)
//
// Every older way in lands here on the right tab: the bell, Ctrl+K "Open the Inbox" (notices),
// Ctrl+K "Inbox" (saved), Ctrl+K "Needs me", the away summary and the Settings buttons
// (waiting). Those modules call VexInboxHub.open(tab) when this file has loaded, and keep
// their own window until it has. No store, setting, command id or count moves: the bell's
// number and dot are still AttentionInbox's, the counts on the tabs are read from the same
// three modules.
//
// This file keeps nothing in localStorage.
const VexInboxHub = {
  ID: 'vex-inbox-hub',
  TABS: [
    ['notices', 'Notices', 'Suggestions that were not worth a pop-up'],
    ['saved', 'Things I saved', 'Notes, saved pages, highlights and captures'],
    ['waiting', 'Waiting on me', 'Messages and tasks that need you'],
  ],
  // Every old surface -> the tab it now lives on. The ids are command ids, feature ids and the older names.
  ALIASES: {
    'attention-inbox': 'notices', attention: 'notices', bell: 'notices',
    'inbox-open': 'saved', 'inbox-unified': 'saved', inbox: 'saved', 'weekly-triage': 'saved',
    'needs-me': 'waiting', needsme: 'waiting',
  },
  _close: null,
  _tab: '',
  _token: 0,

  tabFor(idOrTab) {
    const key = String(idOrTab == null ? '' : idOrTab);
    if (this.TABS.some(t => t[0] === key)) return key;
    const tab = this.ALIASES[key];
    if (!tab) throw new Error('The Inbox has no tab "' + key + '"');
    return tab;
  },

  isOpen() { return typeof document !== 'undefined' && !!document.getElementById(this.ID); },
  close() { if (this._close) this._close(); },

  // The number each tab shows. Notices is the bell's own count; the other two are read the way their lists read them.
  async counts() {
    const out = { notices: 0, saved: 0, waiting: 0 };
    const problems = [];
    if (typeof AttentionInbox !== 'undefined' && AttentionInbox.enabled()) out.notices = AttentionInbox.count();
    if (typeof VexInbox !== 'undefined' && VexInbox.enabled()) {
      try { out.saved = (await VexInbox.count()).unseen; } catch (err) { problems.push('saved: ' + err.message); }
    }
    if (typeof NeedsMe !== 'undefined' && NeedsMe.enabled()) {
      try { out.waiting = (await NeedsMe.collect({})).rows.length; } catch (err) { problems.push('waiting: ' + err.message); }
    }
    return { ...out, problems };
  },

  _note(text) { return VexSettingsGroups.note(text); },

  _fill(tab, el, close) {
    if (tab === 'notices') {
      if (typeof AttentionInbox === 'undefined') throw new Error('The notices list is not loaded');
      if (!AttentionInbox.enabled()) { el.appendChild(this._note('Notices are switched off: Settings, Attention.')); return null; }
      AttentionInbox.renderInto(el);
      return null;
    }
    if (tab === 'saved') {
      if (typeof VexInbox === 'undefined') throw new Error('The saved list is not loaded');
      if (!VexInbox.enabled()) { el.appendChild(this._note('The inbox is switched off in Settings.')); return null; }
      if (typeof VexTriage !== 'undefined') {
        const bar = document.createElement('div');
        bar.className = 'setting-row';
        bar.appendChild(VexSettingsGroups.button('Weekly triage', () => {
          VexTriage.open().catch(err => window.showToast?.(err.message, 'error'));
        }, { label: 'Weekly triage: sort read later, clips and downloads' }));
        el.appendChild(bar);
      }
      return VexInbox.open(el);
    }
    if (typeof PanelsCommsUI === 'undefined' || typeof NeedsMe === 'undefined') throw new Error('Needs me is not loaded');
    if (!NeedsMe.enabled()) { el.appendChild(this._note('Needs me is switched off: Settings, Panels and messages.')); return null; }
    return PanelsCommsUI.openNeedsMe({ body: el, close });
  },

  // Opens the Inbox on `idOrTab` (a tab name or any older id in ALIASES). Throws for an unknown one.
  async open(idOrTab = 'notices') {
    const first = this.tabFor(idOrTab);
    if (typeof VexSettingsGroups === 'undefined') throw new Error('Dialogs are not loaded');
    if (typeof VexUsage !== 'undefined') VexUsage.touch('inbox-unified');
    const dlg = VexSettingsGroups.dialog({ id: this.ID, title: 'Inbox', sub: 'Three lists with three jobs. Each one is the same list it always was; nothing is moved or merged.' });
    this._close = dlg.close;
    const body = dlg.body;

    const list = document.createElement('div');
    list.className = 'ibh-tabs';
    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-label', 'Inbox sections');
    const panel = document.createElement('div');
    panel.className = 'ibh-panel';
    panel.id = this.ID + '-panel';
    panel.setAttribute('role', 'tabpanel');
    panel.tabIndex = -1;
    body.append(list, panel);
    this._style();

    const btns = {};
    const badges = {};
    for (const [id, label, hint] of this.TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ibh-tab';
      b.id = this.ID + '-tab-' + id;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', panel.id);
      b.title = hint;
      const name = document.createElement('span');
      name.textContent = label;
      const n = document.createElement('span');
      n.className = 'ibh-n';
      n.hidden = true;
      b.append(name, n);
      b.addEventListener('click', () => { show(id).catch(err => window.showToast?.(err.message, 'error')); });
      list.appendChild(b);
      btns[id] = b;
      badges[id] = n;
    }
    list.addEventListener('keydown', (e) => {
      const ids = this.TABS.map(t => t[0]);
      const at = ids.indexOf(this._tab);
      let to = -1;
      if (e.key === 'ArrowRight') to = (at + 1) % ids.length;
      else if (e.key === 'ArrowLeft') to = (at - 1 + ids.length) % ids.length;
      else if (e.key === 'Home') to = 0;
      else if (e.key === 'End') to = ids.length - 1;
      if (to < 0) return;
      e.preventDefault();
      show(ids[to], true).catch(err => window.showToast?.(err.message, 'error'));
    });

    // A fresh element per tab, so a list that redraws itself on an event never draws into a tab you left.
    const show = async (id, focusTab) => {
      this._tab = id;
      const token = ++this._token;
      for (const [tid, b] of Object.entries(btns)) {
        const on = tid === id;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
      }
      panel.setAttribute('aria-labelledby', btns[id].id);
      const el = document.createElement('div');
      el.className = 'ibh-view';
      if (id === 'waiting') el.id = 'needs-me-dialog';
      panel.replaceChildren(el);
      if (focusTab) btns[id].focus();
      try { await this._fill(id, el, dlg.close); }
      catch (err) { if (token === this._token) el.appendChild(this._note('Could not open this list: ' + err.message)); throw err; }
    };

    this.counts().then((c) => {
      if (!dlg.overlay.isConnected) return;
      for (const [id] of this.TABS) {
        badges[id].textContent = String(c[id]);
        badges[id].hidden = !c[id];
        btns[id].setAttribute('aria-label', this.TABS.find(t => t[0] === id)[1] + (c[id] ? ', ' + c[id] : ''));
      }
      if (c.problems.length) body.appendChild(this._note('Could not count: ' + c.problems.join('; ')));
    }, (err) => window.VexProblems?.note('Inbox', 'The counts could not be read', err));

    await show(first);
    return dlg;
  },

  _style() {
    if (document.getElementById('inbox-hub-style')) return;
    const st = document.createElement('style');
    st.id = 'inbox-hub-style';
    st.textContent = `
      .ibh-tabs { display:flex; gap:4px; flex-wrap:wrap; border-bottom:1px solid var(--border); margin-bottom:10px; }
      .ibh-tab { display:inline-flex; align-items:center; gap:6px; font:inherit; font-size:12.5px; color:var(--text); background:none; border:none; border-bottom:2px solid transparent; padding:6px 10px; cursor:pointer; }
      .ibh-tab:hover { background:var(--vex-hover-fill, rgba(127,127,127,.12)); }
      .ibh-tab.on { font-weight:650; border-bottom-color:var(--primary, #4f8cff); }
      .ibh-tab:focus-visible { outline:2px solid var(--primary, #4f8cff); outline-offset:-2px; }
      .ibh-n { font-size:11px; min-width:18px; text-align:center; padding:0 5px; border-radius:9px; background:var(--primary, #4f8cff); color:var(--on-primary, #fff); }
      .ibh-panel:focus { outline:none; }
    `;
    document.head.appendChild(st);
  },
};

if (typeof window !== 'undefined') window.VexInboxHub = VexInboxHub;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexInboxHub };
