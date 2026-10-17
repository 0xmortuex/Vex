// === Response overrides and header rules: the screen and the banner ============
//
// The rules live in main (src/main/response-overrides.js, which explains every
// guard). This file is where you write them, turn them on, and where the banner
// is drawn: while overrides are ON a bar sits at the bottom of the window on every
// tab, with a button that switches them off. They are OFF every time Vex starts.
//
// A rule is one of:
//   body       answer requests matching an address pattern with text you write
//              (or a file you choose), as a given content type
//   request    set or remove one header on requests matching a pattern
//   response   set or remove one header on responses matching a pattern
// and always names the page origin it applies to (http://localhost:3000). Rules
// for another origin are ignored; banks, payment, password and sign-in sites are
// refused; private, Tor and burner tabs are never touched.
const VexOverrides = {
  ENABLED_KEY: 'vex.overrides.enabled',
  _active: false,
  _info: { origins: [], rules: [] },

  enabled() { return VexBench.flag(this.ENABLED_KEY); },
  async setEnabled(on) {
    VexBench.setFlag(this.ENABLED_KEY, on);
    if (!on && this._active) await this.setActive(false);
    this.registerCommands();
    this.drawBanner();
  },

  async _call(promise) {
    const r = await promise;
    if (!r || !r.ok) throw new Error((r && r.error) || 'That did not work');
    return r;
  },
  async load() {
    const r = await this._call(window.vex.devbenchOverridesGet());
    this._info = { origins: r.origins, rules: r.rules };
    this._active = !!r.active;
    return r;
  },
  async save(cfg) {
    const r = await this._call(window.vex.devbenchOverridesSet(cfg));
    this._info = { origins: r.origins, rules: r.rules };
    this._active = !!r.active;
    return r;
  },

  async setActive(on) {
    if (on) {
      await this.load();
      if (!this._info.rules.length || !this._info.origins.length) throw new Error('Add at least one origin and one rule first');
      const ok = await vexConfirm({
        title: 'Turn response overrides on?', okLabel: 'Turn on', danger: true,
        message: this._info.rules.length + ' rule(s) will change what pages on ' + this._info.origins.join(', ') + ' receive, until you turn them off or restart Vex. A bar stays at the bottom of the window while they are on.',
      });
      if (!ok) return false;
    }
    const r = await this._call(window.vex.devbenchOverridesActive(!!on));
    this._active = !!r.active;
    this.drawBanner();
    return this._active;
  },

  // The banner ------------------------------------------------------------------
  drawBanner() {
    const id = 'vex-overrides-banner';
    document.getElementById(id)?.remove();
    if (!this._active) { this._stopWatch(); return; }
    const bar = document.createElement('div');
    bar.id = id;
    bar.setAttribute('role', 'alert');
    bar.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:100070;display:flex;gap:10px;align-items:center;padding:8px 14px;border-radius:10px;background:#7a1d1d;color:#fff;font-size:13px;box-shadow:0 6px 24px rgba(0,0,0,.5);max-width:92vw';
    const text = document.createElement('span');
    text.textContent = 'Response overrides are ON for ' + (this._info.origins.join(', ') || 'no origin') + ' (' + this._info.rules.length + ' rule' + (this._info.rules.length === 1 ? '' : 's') + '). Pages there are not getting the real answers.';
    const off = document.createElement('button');
    off.type = 'button'; off.textContent = 'Turn off';
    off.style.cssText = 'padding:4px 12px;border-radius:7px;border:1px solid rgba(255,255,255,.5);background:rgba(255,255,255,.15);color:#fff;cursor:pointer';
    off.addEventListener('click', () => { this.setActive(false).catch(e => VexBench.fail(e)); });
    const rules = document.createElement('button');
    rules.type = 'button'; rules.textContent = 'Rules';
    rules.style.cssText = off.style.cssText;
    rules.addEventListener('click', () => { this.open().catch(e => VexBench.fail(e)); });
    bar.append(text, rules, off);
    document.body.appendChild(bar);
    if (typeof VexLayer !== 'undefined') VexLayer.track(bar, { tier: 'panel', id: 'response-overrides-ui', keep: true });
    this._startWatch();
  },
  // Main is the truth about "active"; look again now and then so the bar can never
  // outlive the setting or hide while it is on.
  _startWatch() {
    this._watching = true;
    if (this._job || typeof VexJobs === 'undefined') return;
    this._job = VexJobs.every('Overrides banner', 5000, () => this._sync().catch(e => VexProblems?.note('Response overrides', 'could not check the overrides state', e)), { feature: 'response-overrides' });
  },
  _stopWatch() { this._watching = false; if (this._job) { this._job.stop(); this._job = null; } },
  async _sync() {
    if (!this._watching) return;
    const r = await this._call(window.vex.devbenchOverridesGet());
    if (!!r.active !== this._active) { this._active = !!r.active; this._info = { origins: r.origins, rules: r.rules }; this.drawBanner(); }
  },

  // The screen --------------------------------------------------------------------
  async open() {
    await this.load();
    const dlg = VexSettingsGroups.dialog({ id: 'vex-overrides-screen', title: 'Response overrides', sub: 'Off at every start. Applies only to the origins listed here.' });
    const draw = () => {
      dlg.body.textContent = '';
      const mk = (tag, css, text) => { const el = document.createElement(tag); if (css) el.style.cssText = css; if (text != null) el.textContent = text; return el; };
      const status = mk('div', 'margin-bottom:10px', this._active ? 'ON: pages on the listed origins are getting your answers.' : 'OFF: nothing is changed.');
      const toggle = VexSettingsGroups.button(this._active ? 'Turn off' : 'Turn on...', () => this.setActive(!this._active).then(draw).catch(e => VexBench.fail(e)), { primary: !this._active, danger: this._active });
      dlg.body.append(status, toggle);

      dlg.body.appendChild(mk('h4', 'margin:14px 0 4px', 'Origins these rules may act on'));
      const origins = mk('textarea', 'width:100%;box-sizing:border-box;height:64px;font-family:monospace', this._info.origins.join('\n'));
      origins.setAttribute('aria-label', 'Origins, one per line');
      origins.placeholder = 'http://localhost:3000';
      dlg.body.append(origins, VexSettingsGroups.button('Save origins', () => this.save({ origins: origins.value.split(/\s+/).filter(Boolean), rules: this._info.rules }).then(() => { VexBench.toast('Saved'); draw(); }).catch(e => VexBench.fail(e))));

      dlg.body.appendChild(mk('h4', 'margin:14px 0 4px', 'Rules (' + this._info.rules.length + ')'));
      for (const r of this._info.rules) {
        const row = mk('div', 'display:flex;gap:8px;align-items:center;margin:4px 0');
        const what = r.kind === 'body' ? 'answer with ' + (r.file ? 'file ' + r.file.split(/[\\/]/).pop() : (r.inline.length + ' characters of ' + r.contentType))
          : (r.kind === 'reqHeader' ? 'request: ' : 'response: ') + (r.op === 'remove' ? 'remove ' + r.name : 'set ' + r.name + ': ' + r.value);
        row.appendChild(mk('span', 'flex:1;font-size:12px', r.origin + '  ' + r.pattern + '  ->  ' + what));
        row.appendChild(VexSettingsGroups.button('Remove', () => this.save({ origins: this._info.origins, rules: this._info.rules.filter(x => x.id !== r.id) }).then(draw).catch(e => VexBench.fail(e)), { danger: true }));
        dlg.body.appendChild(row);
      }
      dlg.body.appendChild(VexSettingsGroups.button('Add a rule...', () => this.addRule().then(draw).catch(e => VexBench.fail(e))));
    };
    draw();
    return dlg;
  },

  async addRule() {
    const kindAns = await vexPrompt({ title: 'Kind of rule', message: 'Type body (answer with text or a file), request (change a request header) or response (change a response header).', label: 'Kind', value: 'body' });
    if (kindAns == null) return;
    const kind = ({ body: 'body', request: 'reqHeader', response: 'resHeader' })[kindAns.trim().toLowerCase()];
    if (!kind) throw new Error('Type body, request or response');
    const origin = await vexPrompt({ title: 'Page origin', message: 'The page this rule acts on, for example http://localhost:3000. Pages elsewhere never see it.', label: 'Origin', value: this._info.origins[0] || 'http://localhost:3000' });
    if (origin == null) return;
    const pattern = await vexPrompt({ title: 'Address pattern', message: 'Which requests. * matches anything, for example http://localhost:3000/api/*', label: 'Pattern', value: origin.replace(/\/$/, '') + '/*' });
    if (pattern == null) return;
    const rule = { id: vexId('r'), kind, origin: origin.trim(), pattern: pattern.trim() };
    if (kind === 'body') {
      rule.contentType = (await vexPrompt({ title: 'Content type', label: 'Content type', value: 'application/json' })) || 'application/json';
      const useFile = await vexConfirm({ title: 'Answer with a file?', message: 'Choose a file from your computer, or cancel to type the text instead.', okLabel: 'Choose a file', cancelLabel: 'Type text' });
      if (useFile) {
        const picked = await this._call(window.vex.devbenchOverridesPickFile());
        if (picked.canceled) return;
        rule.file = picked.path;
      } else {
        const text = await vexPrompt({ title: 'The answer', message: 'Exactly what the page will receive (up to 256 KB).', label: 'Text', value: '{"ok": true}', multiline: true, wide: true });
        if (text == null) return;
        rule.inline = text;
      }
    } else {
      rule.name = await vexPrompt({ title: 'Header name', label: 'Name', value: kind === 'reqHeader' ? 'X-Test' : 'Access-Control-Allow-Origin' });
      if (!rule.name) return;
      rule.op = (await vexConfirm({ title: 'Set or remove?', message: 'Set ' + rule.name + ' to a value, or remove it.', okLabel: 'Set a value', cancelLabel: 'Remove it' })) ? 'set' : 'remove';
      if (rule.op === 'set') {
        rule.value = await vexPrompt({ title: 'Header value', label: 'Value', value: '*' });
        if (rule.value == null) return;
      }
    }
    const origins = this._info.origins.includes(rule.origin) ? this._info.origins : [...this._info.origins, rule.origin.trim()];
    await this.save({ origins, rules: [...this._info.rules, rule] });
  },

  registerCommands() {
    if (typeof VexModuleCommands === 'undefined') return false;
    VexModuleCommands.set('overrides:', this.enabled() ? [
      { id: 'overrides:open', label: 'Response overrides and header rules', icon: 'wrench', hint: 'Answer localhost requests with your own text, add a header. Off at every start.', action: VexBench.safe(() => this.open()) },
      { id: 'overrides:off', label: 'Turn response overrides off', icon: 'stop', hint: 'Stops every override at once', action: VexBench.safe(() => this.setActive(false)) },
    ] : []);
    return true;
  },
  settingsRows(box) {
    box.appendChild(VexSettingsGroup.note('Developer use only: answer a request on a page you listed (for example http://localhost:3000) with text or a file, or change one request or response header. Off at every start, never on banks, payment, password or sign-in sites, never in private or Tor tabs, and a bar shows while it is on.'));
    box.appendChild(VexSettingsGroup.button('Open rules...', () => this.open().catch(e => VexBench.fail(e))));
  },
};

if (typeof window !== 'undefined') {
  window.VexOverrides = VexOverrides;
  VexBench.register({
    id: 'response-overrides', title: 'Response overrides and header rules', hint: 'localhost only, off at every start',
    enabled: () => VexOverrides.enabled(), setEnabled: (on) => { VexOverrides.setEnabled(on).catch(e => VexBench.fail(e)); },
    settingsRows: (box) => VexOverrides.settingsRows(box),
  });
  VexOverrides.registerCommands();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexOverrides };
