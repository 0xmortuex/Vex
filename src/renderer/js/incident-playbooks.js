// === Incident playbooks: "I clicked something" (T2-090) ===========================
//
// A step-by-step checklist for the minutes after a bad click or a hacked account.
// Each step says what to do and why; some have a button that runs a real Vex action
// (list your extensions, look at the NAMES in the downloads folder, see where you are
// signed in, clear a site and open its own sign-out page). Ticks are kept on this
// computer, per checklist, and a checklist can be started again at any time.
//
// What it does NOT do: it opens, reads and scans no file (the downloads step reads
// file names, sizes and dates only), it contacts nobody, and it never ticks a step for
// you. Anything about Windows (the antivirus scan) is a step you do yourself, in Windows
// Security, because starting programs is not something a page of steps should do.
//
// The checklists are written here, in Vex, and are not downloaded. Each carries the date
// it was last checked against the services it names. More of them come as a content pack
// ('playbook' items, e.g. the built-in "vex-builtin.incident-extra"): plain data whose
// buttons can only be one of the fixed actions below, read in memory by setPackPlaybooks
// and gone when the pack is switched off. Ticks are kept per checklist id.
const VexIncident = {
  KEY: 'vex.incident.enabled',     // '0' = off
  TICKS: 'vex.incident.ticks',     // { "<playbook>": { "<step id>": ticked-at-ms } }
  FEATURE: 'incident-playbooks',
  VERIFIED: '2026-10-16',

  enabled() { try { return localStorage.getItem(this.KEY) !== '0'; } catch (err) { console.error('[Incident] the switch could not be read:', err.message); return true; } },
  setEnabled(on) { localStorage.setItem(this.KEY, on ? '1' : '0'); },

  // Steps may carry `run` (a name of an action below). `manual` ones have no button.
  PLAYBOOKS: {
    clicked: {
      title: 'I clicked something',
      sub: 'A link, a download or a page you now doubt. Go in order; tick each step when you have done it.',
      steps: [
        { id: 'stop', title: 'Close the page and stop typing', text: 'Do not type anything more on that page, and do not open the file again. If you entered a password there, treat that password as known to someone else.', manual: true },
        { id: 'downloads', title: 'Look at what is in your downloads folder', text: 'Vex lists the names of recent programs and scripts, and files whose names hide what they are. It only reads names, sizes and dates; it opens nothing.', run: 'downloads' },
        { id: 'extensions', title: 'Check your browser extensions', text: 'A fake extension can read every page. Remove any you do not remember installing.', run: 'extensions' },
        { id: 'signed-in', title: 'See where you are signed in', text: 'Open the list, pick the accounts that matter (mail, Discord, Roblox, your bank) and use "My session leaked" on them.', run: 'signedin' },
        { id: 'passwords', title: 'Change the passwords that matter, from a clean start', text: 'Start with your email, because it resets everything else. If you typed a password on the doubtful page, change that one first, and anywhere else you used it. Use the saved logins list to find them.', run: 'logins' },
        { id: 'sessions', title: 'Sign out of other devices', text: 'On each important account, use its "sign out of all devices" page. "My session leaked" opens it for you. Changing a password usually does the same.', manual: true },
        { id: '2fa', title: 'Check two-step verification and recovery details', text: 'Make sure the phone number, backup email and authenticator on the account are yours, and that two-step verification is on.', manual: true },
        { id: 'mail', title: 'Look at your email rules', text: 'In your mail settings look for forwarding addresses or filters you did not make; attackers use them to keep reading your mail.', manual: true },
        { id: 'scan', title: 'Run a Windows Security scan', text: 'Open Windows Security, Virus and threat protection, and run a Full scan. Vex does not scan files and cannot tell you a file is safe.', manual: true },
        { id: 'startup', title: 'Look at what starts with Windows', text: 'Press Ctrl+Shift+Esc, open the Startup apps tab, and disable anything you do not recognise.', manual: true },
      ],
    },
    hacked: {
      title: 'An account of mine was taken over',
      sub: 'Discord, Roblox, Steam, mail or anything else. The site decides what ends a session; these steps use its own pages.',
      steps: [
        { id: 'site', title: 'Clear that site in Vex and open its sign-out page', text: 'Pick the site. Vex removes its cookies and stored data in every container, then opens the page where the site lets you sign out of all devices.', run: 'kill' },
        { id: 'password', title: 'Change the password', text: 'Choose a new, long, unique one (the password generator in Vex can make it). If you used it anywhere else, change it there too.', run: 'logins' },
        { id: '2fa', title: 'Turn on or re-check two-step verification', text: 'Replace the authenticator or recovery codes if the attacker could have seen them.', manual: true },
        { id: 'apps', title: 'Remove apps and sessions you do not recognise', text: 'On the account, look for connected apps, bots, API tokens and logged-in devices, and remove the ones that are not yours.', manual: true },
        { id: 'mail', title: 'Check the email behind the account', text: 'If the attacker has your email they can reset everything. Change that password first and look for forwarding rules.', manual: true },
        { id: 'friends', title: 'Warn people the account may have contacted', text: 'Scams spread through the account\'s friends. A short message that links should not be trusted is enough.', manual: true },
        { id: 'extensions', title: 'Check your browser extensions', text: 'Many takeovers start from a bad extension or a downloaded cheat. Remove anything you do not remember.', run: 'extensions' },
      ],
    },
  },

  // ---- checklists from packs ------------------------------------------------------------------
  _pack: {},     // 'pack:<pack id>:<item id>' -> a checklist in the same shape as PLAYBOOKS, plus verified and packName
  setPackPlaybooks(list) {
    const next = {};
    for (const { packId, packName, item } of Array.isArray(list) ? list : []) {
      if (!item || item.type !== 'playbook') continue;
      const id = 'pack:' + packId + ':' + item.id;
      next[id] = {
        title: item.title, sub: item.sub, verified: item.verified, packName,
        steps: item.steps.map(s => (s.run && ['downloads', 'extensions', 'signedin', 'logins', 'kill'].includes(s.run)
          ? { id: s.id, title: s.title, text: s.text, run: s.run }
          : { id: s.id, title: s.title, text: s.text, manual: true })),
      };
    }
    this._pack = next;
    return Object.keys(next).length;
  },
  // One checklist by id, built in or from a pack; null when there is none.
  get(id) { return this.PLAYBOOKS[id] || this._pack[id] || null; },

  // ---- ticks (pure, tests) -----------------------------------------------------------------
  _readAll() {
    const raw = localStorage.getItem(this.TICKS);
    if (!raw) return {};
    try { const o = JSON.parse(raw); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; }
    catch (err) { throw new Error('The saved checklist ticks are not readable: ' + err.message); }
  },
  ticked(playbook) { return this._readAll()[playbook] || {}; },
  setTick(playbook, id, on) {
    const pb = this.get(playbook);
    if (!pb || !pb.steps.some(s => s.id === id)) throw new Error('No step "' + id + '" in "' + playbook + '"');
    const all = this._readAll();
    const mine = all[playbook] || {};
    if (on) mine[id] = Date.now(); else delete mine[id];
    all[playbook] = mine;
    localStorage.setItem(this.TICKS, JSON.stringify(all));
    return mine;
  },
  reset(playbook) {
    const all = this._readAll();
    delete all[playbook];
    localStorage.setItem(this.TICKS, JSON.stringify(all));
  },
  progress(playbook) {
    const p = this.get(playbook);
    if (!p) throw new Error('No checklist called "' + playbook + '"');
    const t = this.ticked(playbook);
    return { done: p.steps.filter(s => t[s.id]).length, total: p.steps.length };
  },

  // ---- the buttons ---------------------------------------------------------------------------
  // Each returns { title, lines[] } to show under the step, or null when it opened something.
  async _run(name) {
    if (!window.vex) throw new Error('Vex is not available in this window');
    if (name === 'downloads') {
      const r = await window.vex.hygieneDownloadsScan();
      const lines = [r.flagged.length
        ? r.flagged.length + (r.flagged.length === 1 ? ' name stands' : ' names stand') + ' out in ' + r.folder + ' (' + r.total + ' files, ' + r.recent + ' from the last ' + r.days + ' days). Names only; no file was opened.'
        : 'Nothing stands out by name in ' + r.folder + ' (' + r.total + ' files, ' + r.recent + ' from the last ' + r.days + ' days). That is not a virus scan: a harmless-looking name can still be a bad file.'];
      for (const f of r.flagged) lines.push(f.name + ' - ' + f.why + ' (' + new Date(f.at).toISOString().slice(0, 10) + ')');
      if (r.more) lines.push('and ' + r.more + ' more');
      return { title: 'Downloads folder', lines };
    }
    if (name === 'extensions') {
      const list = await window.vex.extensionsList();
      const lines = list.length ? list.map(e => e.name + ' ' + e.version + (e.enabled ? '' : ' (switched off)')) : ['You have no extensions installed.'];
      lines.push('Remove any you do not remember in the extensions page (the puzzle icon, or Ctrl+K and "Extensions").');
      return { title: 'Your extensions (' + list.length + ')', lines };
    }
    if (name === 'signedin') {
      if (typeof VexSignedIn === 'undefined') throw new Error('The signed-in list is not loaded');
      await VexSignedIn.open();
      return null;
    }
    if (name === 'logins') {
      if (typeof LoginsHub === 'undefined') throw new Error('The saved logins list is not loaded');
      await LoginsHub.open();
      return null;
    }
    if (name === 'kill') {
      if (typeof VexSignedIn === 'undefined') throw new Error('The signed-in list is not loaded');
      await VexSignedIn.killPrompt();
      return null;
    }
    throw new Error('Unknown step action: ' + name);
  },

  // ---- the screen -------------------------------------------------------------------------------
  list() { return [...Object.entries(this.PLAYBOOKS), ...Object.entries(this._pack)].map(([id, p]) => ({ id, title: p.title, sub: p.sub, ...this.progress(id) })); },

  async open(playbook = null) {
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    if (!playbook) return this.openChooser();
    const pb = this.get(playbook);
    if (!pb) throw new Error('No checklist called "' + playbook + '"');
    const { body } = VexSettingsGroups.dialog({ id: 'vex-incident', title: pb.title, sub: pb.sub });
    const results = {};
    const draw = () => {
      body.textContent = '';
      const p = this.progress(playbook);
      const top = document.createElement('div');
      top.className = 'vex-platform-note';
      top.textContent = p.done + ' of ' + p.total + ' done. Checked against the services it names on ' + (pb.verified || this.VERIFIED) + (pb.packName ? ' (from the pack "' + pb.packName + '")' : '') + '. Ticks stay on this computer.';
      body.appendChild(top);
      const ticks = this.ticked(playbook);
      const wrap = document.createElement('div');
      wrap.className = 'vexsr-list';
      for (const s of pb.steps) {
        const row = document.createElement('div');
        row.className = 'vexsr-rule vex-incident-step';
        row.dataset.step = s.id;
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = !!ticks[s.id];
        box.setAttribute('aria-label', 'Done: ' + s.title);
        box.addEventListener('change', () => { this.setTick(playbook, s.id, box.checked); draw(); });
        const text = document.createElement('span');
        text.className = 'vexsr-host';
        text.style.wordBreak = 'normal';
        const t = document.createElement('div'); t.textContent = s.title;
        const d = document.createElement('div'); d.className = 'vexsr-mode'; d.style.whiteSpace = 'normal'; d.textContent = s.text;
        text.append(t, d);
        const res = results[s.id];
        if (res) {
          const out = document.createElement('div');
          out.className = 'vex-incident-result';
          out.setAttribute('role', 'status');
          const h = document.createElement('strong'); h.textContent = res.title;
          out.appendChild(h);
          for (const l of res.lines) { const li = document.createElement('div'); li.textContent = l; out.appendChild(li); }
          text.appendChild(out);
        }
        row.append(box, text);
        if (s.run) {
          row.appendChild(VexSettingsGroups.button('Do it', async () => {
            try { const r = await this._run(s.run); if (r) results[s.id] = r; draw(); }
            catch (err) { window.showToast?.('Could not do that: ' + err.message, 'error'); }
          }, { label: 'Do: ' + s.title }));
        }
        wrap.appendChild(row);
      }
      body.appendChild(wrap);
      body.appendChild(VexSettingsGroups.button('Start this checklist again', async () => {
        if (await vexConfirm({ title: 'Start again?', message: 'This clears the ticks of this checklist.', okLabel: 'Clear the ticks' })) { this.reset(playbook); draw(); }
      }));
    };
    draw();
  },

  openChooser() {
    const { body, close } = VexSettingsGroups.dialog({ id: 'vex-incident-choose', title: 'Something went wrong', sub: 'Pick what happened. Each is a short checklist, in order.' });
    for (const it of this.list()) {
      const b = VexSettingsGroups.button(it.title + (it.done ? ' (' + it.done + ' of ' + it.total + ' done)' : ''), () => { close(); this.open(it.id).catch(err => window.showToast?.(err.message, 'error')); }, { primary: true });
      body.appendChild(b);
      body.appendChild(VexSettingsGroups.note(it.sub));
    }
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Step-by-step checklists for "I clicked something" and "an account of mine was taken over". They run real Vex actions where they can and tell you what to do yourself where they cannot. Nothing is scanned or sent.'));
    el.appendChild(VexSettingsGroups.button('Open the checklists', () => this.openChooser(), { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexIncident = VexIncident;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'incident-playbooks', title: 'If something went wrong', keywords: 'incident hacked clicked phishing checklist compromised account playbook', before: 'about', build: (el) => VexIncident.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'incident-playbooks', label: 'I clicked something', hint: 'A checklist for after a bad link, a doubtful download or a hacked account', icon: 'shield', action: () => VexIncident.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexIncident };
