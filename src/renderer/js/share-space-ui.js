// === Share a space: the screens (js/share-space.js holds the file format, the checks, Apply and Undo) ===========================================
//
//   Share this space     the tabs of this workspace as a list the person ticks, what was left out and why, what was changed in an address,
//                        and three ways out: a .vexspace file, a vex://space link, plain text
//   Share this group     the same for the tabs of one tab group (the group's right-click menu)
//   Open a space         a .vexspace file from the file chooser, or dropped on Vex's own toolbar / tab strip / panels
//   a pasted link        a vex://space?d=... link pasted into Ctrl+K or the address bar, or opened from another program, opens the same review
//   the review           every address with its real host name, flags for look-alikes and reported dangerous sites, what to add (tabs, groups,
//                        sidebar folders, look), then Apply or Cancel. NOTHING is opened or loaded before Apply; Apply makes a new workspace
//                        and offers Undo at once.
//
// Opened from the Workspaces menu, the tab group menu and Ctrl+K. The file is read here with a file input and written with a download (as
// Share my look does): no path ever reaches the main process. The only thing asked of main is main/space-check.js (the look-alike and
// dangerous-site check of the addresses), which never loads one.
const VexShareSpaceUI = {
  _wired: false,

  _need() {
    if (!window.VexShareSpace) throw new Error('Share a space is not loaded');
    window.VexShareSpace.requireOn();
    if (typeof VexSettingsGroups === 'undefined') throw new Error('The Settings dialogs are not loaded');
  },

  _fail(err) {
    console.error('[ShareSpace]', err);
    window.showToast?.((err && err.message) || 'That did not work', 'error', 6000);
  },

  _copy(text, done) {
    return navigator.clipboard.writeText(text).then(() => window.showToast?.(done, 'info', 2000));
  },

  fileName(space) {
    const slug = String(space.name || 'my-space').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'my-space';
    return slug + '.vexspace';
  },

  // A sentence with holes ({1}, {2}): the sentence is one text with an entry of its own in the Turkish table, the holes are filled as they are.
  _fmt(template, ...args) {
    return template.replace(/\{(\d)\}/g, (_m, n) => String(args[Number(n) - 1]));
  },

  _el(tag, css, text) {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
  },

  // "Label: text" as two pieces, so the label is translated and the text (a group's name, an address, a change) is added as it is.
  _note(label, text, colour) {
    const line = this._el('span', 'display:block;color:' + colour);
    line.append(this._el('span', '', label), document.createTextNode(' '), this._el('span', '', text));
    return line;
  },

  // A tick box with its words; the label is the whole row so it is easy to hit and read out.
  _tick(id, checked, disabled) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.id = id;
    box.checked = !!checked;
    box.disabled = !!disabled;
    box.style.cssText = 'margin:2px 8px 0 0;flex:none';
    return box;
  },

  _bar() { return this._el('div', 'display:flex;gap:6px;flex-wrap:wrap;margin-top:12px'); },

  // ---- Share ---------------------------------------------------------------------------------------------------------------------------------
  share(opts) {
    this._need();
    const S = window.VexShareSpace;
    const o = opts || {};
    const col = S.collect({ groupId: o.groupId });
    const id = 'vex-share-space';
    const group = !!o.groupId;
    const { body } = VexSettingsGroups.dialog({
      id, title: group ? 'Share this group' : 'Share this space',
      sub: group ? 'The tabs of this group as one small file or link.' : 'The tabs of this workspace as one small file or link. Nothing is sent anywhere.',
    });
    body.appendChild(VexSettingsGroups.note('Only the web addresses and titles you leave ticked go out. Never cookies, logins, form data, history, passwords, notes or anything else. The file is plain text: open it in any editor to see exactly what is in it.'));

    // What was left out, and why.
    if (col.excluded.total) {
      const left = this._el('div', 'margin:8px 0;font-size:12.5px');
      left.setAttribute('role', 'status');
      left.appendChild(this._el('div', 'font-weight:600', 'Left out of this space: ' + col.excluded.total));
      const ul = this._el('ul', 'margin:3px 0 0 18px;padding:0;color:var(--text-muted)');
      for (const r of col.excluded.reasons) {
        const li = this._el('li', '');
        li.append(this._el('span', '', r.count + ' × '), this._el('span', '', r.text));
        ul.appendChild(li);
      }
      left.appendChild(ul);
      body.appendChild(left);
    }
    if (!col.items.length) {
      body.appendChild(VexSettingsGroups.note('There is nothing in this ' + (group ? 'group' : 'workspace') + ' that can be shared.'));
      return;
    }

    const nameLabel = this._el('label', 'display:block;font-size:12px;color:var(--text-muted);margin:8px 0 4px', 'Name of the space');
    const name = document.createElement('input');
    name.type = 'text'; name.className = 'set-input'; name.maxLength = S.NAME_MAX; name.id = id + '-name'; name.value = col.name || '';
    nameLabel.htmlFor = name.id;
    body.append(nameLabel, name);

    // The tabs: untick any. A tab whose address was changed says what was taken out; one with a long code in it starts unticked.
    const list = this._el('div', 'margin:10px 0 4px;max-height:240px;overflow:auto;border:1px solid var(--border,#333);border-radius:8px;padding:4px 8px');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Tabs to share');
    const counter = this._el('div', 'font-size:12.5px;margin:4px 0');
    counter.setAttribute('role', 'status');
    counter.setAttribute('aria-live', 'polite');
    const boxes = [];
    col.items.forEach((it, i) => {
      const row = this._el('label', 'display:flex;align-items:flex-start;padding:5px 0;font-size:12.5px;cursor:pointer');
      const box = this._tick(id + '-tab-' + i, it.include);
      boxes.push({ box, it });
      const text = this._el('span', 'min-width:0;overflow-wrap:anywhere');
      text.appendChild(this._el('span', 'font-weight:600', it.title));
      text.appendChild(this._el('span', 'display:block;color:var(--text-muted)', it.url));
      if (it.group) text.appendChild(this._note('Group:', it.group, 'var(--text-muted)'));
      for (const c of it.changes) text.appendChild(this._note('Changed:', c, 'var(--warning,#d4a017)'));
      for (const w of it.warnings) text.appendChild(this._note('Careful:', w, 'var(--warning,#d4a017)'));
      row.append(box, text);
      list.appendChild(row);
    });
    const ticked = () => boxes.filter((b) => b.box.checked).map((b) => b.it.key);
    const update = () => {
      const n = ticked().length;
      counter.textContent = this._fmt('Tabs ticked: {1} of {2}', n, S.TAB_MAX);
      for (const b of boxes) b.box.disabled = !b.box.checked && n >= S.TAB_MAX;
      for (const b of buttons) b.disabled = n === 0;
    };
    body.append(list, counter);

    // Extras.
    const opt = (key, label, checked, disabled, hint) => {
      const row = this._el('label', 'display:flex;align-items:flex-start;padding:3px 0;font-size:12.5px;cursor:pointer');
      const box = this._tick(id + '-' + key, checked, disabled);
      const t = this._el('span', '', label);
      if (hint) t.appendChild(this._el('span', 'display:block;color:var(--text-muted)', hint));
      row.append(box, t);
      body.appendChild(row);
      return box;
    };
    const hasGroups = col.items.some((it) => it.group);
    const groups = hasGroups ? opt('groups', 'Keep the tab groups', true, false) : null;
    const look = group ? null : opt('look', 'Include my look', false, false, 'Colours, design, icons, fonts and your wallpaper choice, never a picture of your own.');
    const side = group || !col.hasSidebar ? null : opt('sidebar', 'Include my sidebar folders', false, false, 'The layout of your sidebar folders. Panels you do not have are ignored by whoever opens it.');

    const choices = () => ({
      include: ticked(), name: name.value, groups: groups ? groups.checked : false,
      look: !!(look && look.checked), sidebar: !!(side && side.checked),
    });
    const bar = this._bar();
    const run = (fn) => async () => { try { await fn(S.build(col, choices())); } catch (err) { this._fail(err); } };
    const buttons = [
      VexSettingsGroups.button('Save as a file', run(async (space) => {
        const text = S.toFile(space);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        a.download = this.fileName(space);
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        window.showToast?.('Saved the space file', 'info', 2500);
      }), { primary: true }),
      VexSettingsGroups.button('Copy link', run(async (space) => this._copy(await S.toLink(space), 'Link copied'))),
      VexSettingsGroups.button('Copy as text', run(async (space) => this._copy(await S.toText(space), 'Text copied'))),
    ];
    bar.append(...buttons);
    body.appendChild(bar);
    boxes.forEach((b) => b.box.addEventListener('change', update));
    update();
    name.focus({ preventScroll: true });
  },

  // ---- Open ----------------------------------------------------------------------------------------------------------------------------------
  pickFile() {
    this._need();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.vexspace,.json,application/json';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.remove();
      if (file) this.openFile(file).catch((err) => this._fail(err));
    });
    document.body.appendChild(input);
    input.click();
  },

  async openFile(file) {
    this._need();
    if (!file) throw new Error('No file');
    if (file.size > window.VexShareSpace.FILE_MAX) throw new Error('That file is too big to be a space (' + Math.round(window.VexShareSpace.FILE_MAX / 1024) + ' KB at most)');
    return this.openText(await file.text(), 'file');
  },

  // A file's text or a vex://space link. Throws (and says why) on anything that is not exactly a space. Nothing is opened.
  async openText(text, from) {
    this._need();
    const report = await window.VexShareSpace.parse(text);
    this.review(report, from || (window.VexShareSpace.isLink(text) ? 'link' : 'file'));
    return report;
  },

  // ---- The review ----------------------------------------------------------------------------------------------------------------------------
  review(report, from) {
    this._need();
    const S = window.VexShareSpace;
    const space = report.space;
    const d = S.describe(space);
    const id = 'vex-share-space-review';
    const { body, close } = VexSettingsGroups.dialog({ id, title: d.title, sub: from === 'link' ? 'From a link you opened, not verified. Nothing has been opened yet.' : 'From a file you opened, not verified. Nothing has been opened yet.' });
    body.appendChild(VexSettingsGroups.note('Look over every address. Nothing loads until you press Add, and it goes into a new workspace of its own: nothing of yours is replaced.'));

    const summary = this._el('div', 'font-size:12.5px;margin:6px 0');
    summary.textContent = 'Tabs: ' + d.tabs + ', groups: ' + d.groups + ', sites: ' + d.sites;
    body.appendChild(summary);
    if (report.truncated) body.appendChild(this._el('div', 'font-size:12.5px;margin:4px 0;color:var(--warning,#d4a017)', 'Only the first ' + S.TAB_MAX + ' tabs are kept; ' + report.truncated + ' more were left out.'));
    if (report.refused.length) {
      const box = this._el('div', 'font-size:12.5px;margin:4px 0;color:var(--warning,#d4a017)');
      box.appendChild(this._el('div', 'font-weight:600', 'Refused: ' + report.refused.length));
      const ul = this._el('ul', 'margin:3px 0 0 18px;padding:0');
      for (const r of report.refused.slice(0, 10)) ul.appendChild(this._el('li', '', 'Tab ' + r.n + (r.host ? ' (' + r.host + ')' : '') + ': ' + r.reason));
      box.appendChild(ul);
      body.appendChild(box);
    }
    if (report.cleaned.length) {
      const box = this._el('div', 'font-size:12.5px;margin:4px 0;color:var(--text-muted)');
      box.appendChild(this._el('div', 'font-weight:600', 'Cleaned on the way in: ' + report.cleaned.length));
      const ul = this._el('ul', 'margin:3px 0 0 18px;padding:0');
      for (const c of report.cleaned.slice(0, 10)) ul.appendChild(this._el('li', '', 'Tab ' + c.n + ' (' + c.host + '): ' + c.changes.join('; ')));
      box.appendChild(ul);
      body.appendChild(box);
    }

    // The addresses, with the real host name of each. The checks (look-alike, reported dangerous) come from main and fill the rows in.
    const list = this._el('div', 'margin:10px 0 4px;max-height:260px;overflow:auto;border:1px solid var(--border,#333);border-radius:8px;padding:4px 8px');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Tabs in this space');
    const status = this._el('div', 'font-size:12.5px;margin:4px 0');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const rows = space.tabs.map((t, i) => {
      const u = new URL(t.url);
      const row = this._el('label', 'display:flex;align-items:flex-start;padding:5px 0;font-size:12.5px;cursor:pointer');
      const box = this._tick(id + '-tab-' + i, false, true);
      const text = this._el('span', 'min-width:0;overflow-wrap:anywhere');
      text.appendChild(this._el('span', 'font-weight:600', t.title || u.hostname));
      const host = this._el('span', 'display:block');
      host.appendChild(this._el('b', '', u.hostname));
      host.appendChild(document.createTextNode(u.pathname + u.search + u.hash));
      text.appendChild(host);
      if (t.group != null) text.appendChild(this._note('Group:', space.groups[t.group].name, 'var(--text-muted)'));
      const flags = this._el('span', 'display:block');
      text.appendChild(flags);
      row.append(box, text);
      list.appendChild(row);
      return { box, flags, t, host: u.hostname };
    });
    body.append(list, status);

    // What to add.
    const opt = (key, label, checked, disabled, hint) => {
      const row = this._el('label', 'display:flex;align-items:flex-start;padding:3px 0;font-size:12.5px;cursor:pointer');
      const box = this._tick(id + '-' + key, checked, disabled);
      const t = this._el('span', '', label);
      if (hint) t.appendChild(this._el('span', 'display:block;color:var(--text-muted)', hint));
      row.append(box, t);
      body.appendChild(row);
      return box;
    };
    const tabsOn = opt('tabs', 'Add the tabs as a new workspace', space.tabs.length > 0, !space.tabs.length, 'They stay asleep until you open them.');
    const groupsOn = space.groups.length ? opt('groups', 'Keep the tab groups', true, false) : null;
    const sideOn = space.sidebar ? opt('sidebar', 'Use its sidebar folders', false, false, 'This replaces how your sidebar folders are laid out. Undo puts yours back.') : null;
    const lookOn = space.look ? opt('look', 'Wear its look', false, false, 'This replaces your colours, design, icons and fonts. Undo puts yours back.') : null;
    if (groupsOn) tabsOn.addEventListener('change', () => { groupsOn.disabled = !tabsOn.checked; });

    const bar = this._bar();
    const picked = () => rows.map((r, i) => (r.box.checked ? i : -1)).filter((i) => i >= 0);
    const go = async (openAfter) => {
      applyBtn.disabled = true; openBtn.disabled = true; cancel.disabled = true;
      try {
        const what = { tabs: tabsOn.checked, groups: groupsOn ? groupsOn.checked : false, sidebar: !!(sideOn && sideOn.checked), look: !!(lookOn && lookOn.checked) };
        const r = await S.apply(space, what, picked());
        close();
        for (const s of r.skipped) window.showToast?.(s, 'info', 5000);
        if (openAfter && r.workspaceId) await S.open(r.workspaceId);
        const message = 'Added ' + d.title + (r.workspaceId ? ' as a new workspace (' + r.count + ' tabs)' : '');
        if (typeof VexUndo !== 'undefined') VexUndo.offer({ message, undo: () => S.undo().catch((err) => { this._fail(err); throw err; }) });
        else window.showToast?.(message, 'info', 4000);
      } catch (err) {
        applyBtn.disabled = false; openBtn.disabled = false; cancel.disabled = false;
        this._fail(err);
      }
    };
    const applyBtn = VexSettingsGroups.button('Add', () => go(false), { primary: true });
    const openBtn = VexSettingsGroups.button('Add and open', () => go(true));
    const cancel = VexSettingsGroups.button('Cancel', close);
    applyBtn.disabled = true; openBtn.disabled = true;
    bar.append(applyBtn, openBtn, cancel);
    body.appendChild(bar);

    const settle = (checks) => {
      let flagged = 0;
      rows.forEach((r, i) => {
        const c = checks[i];
        const bad = [];
        if (!c || c.error) bad.push('Could not be checked' + (c && c.error ? ': ' + c.error : ''));
        else {
          if (c.threat) bad.push('Reported as a dangerous site (' + c.threat.host + ')');
          if (c.lookalike) bad.push('Looks like ' + (c.lookalike.resembles || 'another site') + ' but is not: ' + (c.lookalike.line || c.lookalike.kind));
          if (c.punycode) bad.push('The name is written in punycode (' + c.host + ') and would show as ' + c.unicode);
        }
        if (bad.length) flagged++;
        for (const b of bad) r.flags.appendChild(this._el('span', 'display:block;color:var(--danger,#e5484d);font-weight:600', b));
        r.box.disabled = false;
        r.box.checked = !bad.length;                        // a flagged address starts unticked: the person decides
        r.box.addEventListener('change', () => { applyBtn.disabled = openBtn.disabled = !picked().length && !(sideOn && sideOn.checked) && !(lookOn && lookOn.checked); });
      });
      status.textContent = flagged ? 'Addresses checked: ' + flagged + ' need a careful look and are unticked.' : 'Addresses checked: nothing suspicious found.';
      applyBtn.disabled = openBtn.disabled = !picked().length && !(sideOn && sideOn.checked) && !(lookOn && lookOn.checked);
    };
    if (!rows.length) { status.textContent = 'This space has no tabs.'; applyBtn.disabled = openBtn.disabled = !(sideOn || lookOn); }
    else {
      status.textContent = 'Checking the addresses...';
      this._check(rows.map((r) => r.t.url)).then(settle, (err) => {
        // Unchecked addresses are never added: the rows stay locked and the person is told why.
        status.textContent = this._fmt('Could not check the addresses ({1}), so none can be added.', (err && err.message) || 'unknown');
        this._fail(err);
      });
    }
    cancel.focus({ preventScroll: true });
  },

  _check(urls) {
    if (!window.vex || !window.vex.space || typeof window.vex.space.check !== 'function') return Promise.reject(new Error('the address check is not available'));
    return window.vex.space.check(urls);
  },

  undo() {
    this._need();
    if (!window.VexShareSpace.hasUndo()) { window.showToast?.('There is no shared space to undo', 'info', 2500); return Promise.resolve(); }
    return window.VexShareSpace.undo().then(() => window.showToast?.('The shared space was taken out again', 'info', 2500));
  },

  // ---- Where it is reached from --------------------------------------------------------------------------------------------------------------
  _isLink(v) { return window.VexShareSpace && window.VexShareSpace.isLink(v); },

  // A space link pasted in the address bar or in Ctrl+K opens the review at once.
  _watchBox(input, after) {
    if (!input) return;
    input.addEventListener('input', () => {
      if (!this._isLink(input.value)) return;
      const text = input.value;
      after(input);
      this.openText(text, 'link').catch((err) => this._fail(err));
    });
  },

  wire() {
    if (this._wired) return;
    this._wired = true;
    this._watchBox(document.getElementById('command-input'), (input) => { input.value = ''; if (typeof CommandBar !== 'undefined') CommandBar.close(); });
    this._watchBox(document.getElementById('url-input'), (input) => {
      const tab = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
      input.value = tab ? TabManager.urlBarText(tab) : '';
      input.blur();
    });

    // A .vexspace dropped on Vex's own surfaces; any other file is left alone (the drag-over is accepted only).
    document.addEventListener('dragover', (e) => {
      if (e.defaultPrevented || !e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      e.preventDefault();
    });
    document.addEventListener('drop', (e) => {
      if (e.defaultPrevented || !e.dataTransfer || !e.dataTransfer.files) return;
      const file = Array.from(e.dataTransfer.files).find((f) => /\.vexspace$/i.test(f.name));
      if (!file) return;
      e.preventDefault();
      this.openFile(file).catch((err) => this._fail(err));
    });

    // The Workspaces menu and the tab group menu call these through the two functions below, which wait for this file to load.
    if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
      const r = (c) => VexExtras.registerCommand({ ...c, action: () => { try { const p = c.run(); if (p && p.catch) p.catch((err) => this._fail(err)); } catch (err) { this._fail(err); } } });
      r({ id: 'share-space', label: 'Share a Space', hint: 'Send the tabs of this workspace to a friend as a small file or link, after you look over every address', icon: 'users', run: () => this.share() });
      r({ id: 'open-space', label: 'Open a Space', hint: 'Open a .vexspace file from a friend (or paste their vex://space link here), look over every address, then add it as a new workspace', icon: 'folder-open', run: () => this.pickFile() });
      r({ id: 'undo-shared-space', label: 'Undo shared space', hint: 'Take out the workspace (and sidebar folders or look) you added from a shared space', icon: 'undo', run: () => this.undo() });
    }
  },
};
if (typeof window !== 'undefined') window.VexShareSpaceUI = VexShareSpaceUI;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexShareSpaceUI };
if (typeof document !== 'undefined') VexShareSpaceUI.wire();
