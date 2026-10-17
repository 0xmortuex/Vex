// === Local services and the webhook inspector: the window's side ==============
//
// Both are OFF until switched on in Settings, and both do their real work in the
// main process (src/main/local-services.js, src/main/webhook-inspector.js).
// docs/local-services-threat-model.md says what the launcher can and cannot do.
//
//   LocalServices     T3-033  start and stop the dev servers you listed (a folder
//                     you picked and one of a few fixed commands). Vex starts
//                     nothing by itself; it can only stop what it started.
//                     Adding one and the first Start of a session are confirmed
//                     in a box main shows, with the exact program and arguments.
//   WebhookInspector  T3-058  a receiver on 127.0.0.1 only, on a port you type, for
//                     the minutes you choose. It lists what arrives, never
//                     forwards it, and stops itself.

const LocalToolsBridge = {
  v() {
    const v = typeof window !== 'undefined' ? window.vex : null;
    if (!v || typeof v.localsvcStatus !== 'function' || typeof v.webhookStatus !== 'function') throw new Error('Local tools are not available in this build');
    return v;
  },
  // Every main-process answer is { ok: true, ... } or { ok: false, error }: an error is thrown, never ignored.
  async call(fn, ...args) {
    const r = await this.v()[fn](...args);
    if (!r || r.ok !== true) throw new Error((r && r.error) || 'The request failed');
    return r;
  },
};

function localToolsFail(what, err) {
  console.error('[LocalTools] ' + what + ':', err);
  window.showToast?.(what + ': ' + ((err && err.message) || err), 'error');
}

// ---------------------------------------------------------------------------------
// T3-033
const LocalServices = {
  KEY: 'vex.localServices',
  FEATURE: 'local-services',

  _pref() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || '{}') || {}; }
    catch (err) {
      console.error('[LocalServices] the switch is not readable and stays off:', err.message);
      if (typeof VexProblems !== 'undefined') VexProblems.note('Local services', 'The switch was not readable and stays off', err);
      return {};
    }
  },
  // Off by default, and on a profile that never switched it on.
  enabled() { return this._pref().enabled === true; },
  setEnabled(on) {
    localStorage.setItem(this.KEY, JSON.stringify({ ...this._pref(), enabled: !!on }));
    // Off also takes back the permission main holds, so nothing can be started from a window that has it off.
    if (!on && typeof window !== 'undefined' && window.vex && typeof window.vex.localsvcArm === 'function') {
      window.vex.localsvcArm(false).then(r => { if (!r || r.ok !== true) throw new Error((r && r.error) || 'main did not answer'); })
        .catch(err => localToolsFail('Local services could not be disarmed', err));
    }
  },

  status() { return LocalToolsBridge.call('localsvcStatus'); },

  // The words the add form takes for each template field.
  FIELD_HELP: { script: 'Script name, e.g. dev', file: 'Script in the folder, e.g. manage.py', args: 'Words after it, e.g. runserver 8000' },

  async open() {
    if (!this.enabled()) throw new Error('Local services are switched off (Settings > More developer tools)');
    const S = VexSettingsGroups;
    const { body } = S.dialog({ id: 'vex-local-services', title: 'Local services', sub: 'Dev servers you start yourself. Vex never starts one by itself, and only stops what it started.' });
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const act = (text, fn, opts) => S.button(text, async () => { try { await fn(); } catch (err) { localToolsFail(text, err); } }, opts);
    const grant = { token: '', folder: '' };
    let logsFor = '', logText = '';
    const draw = async () => {
      let st;
      try { st = await this.status(); } catch (err) { body.textContent = ''; body.appendChild(S.note('Could not read the list: ' + err.message)); return; }
      body.textContent = '';
      if (!st.supported) { body.appendChild(S.note('Local services can be started on Windows only.')); return; }
      if (!st.armed) {
        body.append(S.note('Not allowed yet. Allowing it asks you in a box Vex shows itself. After that you add a service by choosing a folder and typing one of a few fixed commands once; Vex shows you the exact program and arguments before it saves anything.'),
          act('Allow local services', async () => { await LocalToolsBridge.call('localsvcArm', true); await draw(); }, { primary: true }));
        return;
      }
      const list = el('div', 'vexsr-list');
      for (const s of st.services) {
        const t = el('span', 'vexsr-host'); t.style.wordBreak = 'normal';
        const state = s.state === 'running' ? 'running' + (s.pid ? ' (process ' + s.pid + ')' : '') : 'stopped' + (s.exit ? (s.exit.error ? ': ' + s.exit.error : ' (last exit ' + s.exit.code + ')') : '');
        const badge = s.port ? (s.state === 'running' ? (s.listening ? ', port ' + s.port + ' answers' : ', port ' + s.port + ' not answering yet') : '') : '';
        t.append(el('div', '', s.name + ': ' + state + badge), Object.assign(el('div', 'vexsr-mode', s.command + '  in  ' + s.folder), { style: 'white-space:normal' }));
        const bar = el('div'); bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
        if (s.state === 'running') {
          bar.append(act('Stop', async () => { await LocalToolsBridge.call('localsvcStop', s.id); window.showToast?.(s.name + ' stopped'); await draw(); }, { label: 'Stop ' + s.name }),
            act('Logs', async () => { const r = await LocalToolsBridge.call('localsvcLogs', s.id); logsFor = s.name; logText = r.lines.join('\n') || '(no output yet)'; await draw(); }, { label: 'Show the output of ' + s.name }));
          if (s.port) bar.append(act('Open', () => { if (typeof TabManager === 'undefined') throw new Error('Tabs are not available'); TabManager.createTab('http://localhost:' + s.port + '/', true); }, { label: 'Open ' + s.name + ' in a tab' }));
        } else {
          bar.append(act('Start', async () => { const r = await LocalToolsBridge.call('localsvcStart', s.id); if (!r.canceled) window.showToast?.(s.name + ' started'); await draw(); }, { primary: true, label: 'Start ' + s.name }),
            act('Remove', async () => {
              if (!(await vexConfirm({ title: 'Remove this service?', message: '"' + s.name + '" is removed from the list. Nothing on disk is changed.', okLabel: 'Remove', danger: true }))) return;
              await LocalToolsBridge.call('localsvcRemove', s.id); await draw();
            }, { danger: true, label: 'Remove ' + s.name }));
        }
        const row = el('div', 'vexsr-rule'); row.append(t, bar);
        list.appendChild(row);
      }
      if (!list.children.length) list.appendChild(S.note('No services yet. Add one below.'));
      body.append(list, act('Refresh', draw));
      if (logsFor) { const pre = el('pre'); pre.style.cssText = 'white-space:pre-wrap;max-height:240px;overflow:auto;margin:8px 0'; pre.textContent = logsFor + ':\n' + logText; body.appendChild(pre); }

      // ---- add ----
      body.appendChild(S.note('Add a service'));
      const name = el('input', 'set-input'); name.type = 'text'; name.placeholder = 'Name, e.g. Vex site'; name.setAttribute('aria-label', 'Service name');
      const tpl = el('select', 'set-input'); tpl.setAttribute('aria-label', 'Command');
      for (const t of st.templates) tpl.appendChild(Object.assign(el('option', '', t.label), { value: t.id }));
      const fields = el('div');
      const inputs = {};
      const drawFields = () => {
        fields.textContent = '';
        const t = st.templates.find(x => x.id === tpl.value);
        for (const f of t.fields) {
          const i = el('input', 'set-input'); i.type = 'text'; i.spellcheck = false; i.placeholder = this.FIELD_HELP[f]; i.setAttribute('aria-label', this.FIELD_HELP[f]);
          inputs[f] = i; fields.appendChild(i);
        }
      };
      tpl.addEventListener('change', drawFields);
      drawFields();
      const port = el('input', 'set-input'); port.type = 'number'; port.min = '1024'; port.max = '65535'; port.placeholder = 'Port it listens on (optional)'; port.setAttribute('aria-label', 'Port it listens on');
      const folder = el('span', 'vexsr-mode', grant.folder || 'No folder chosen');
      const row = (...k) => { const r = el('div', 'vexsr-rule'); r.append(...k); return r; };
      body.append(row(name, tpl), fields, row(port),
        row(act('Choose folder', async () => { const r = await LocalToolsBridge.call('localsvcPickFolder'); if (r.canceled) return; grant.token = r.token; grant.folder = r.folder; folder.textContent = r.folder; }), folder),
        row(act('Add', async () => {
          if (!grant.token) throw new Error('Choose the folder first');
          const params = {};
          for (const [k, i] of Object.entries(inputs)) params[k] = i.value;
          const r = await LocalToolsBridge.call('localsvcAdd', { name: name.value, token: grant.token, template: tpl.value, params, ...(port.value ? { port: Number(port.value) } : {}) });
          grant.token = ''; grant.folder = '';
          if (!r.canceled) window.showToast?.('Added ' + name.value);
          await draw();
        }, { primary: true })));
    };
    await draw();
  },

  group(el) {
    const S = VexSettingsGroups;
    el.appendChild(S.note('Local services: start and stop the dev servers you list (pnpm, npm, wrangler, python, node, uv), in a folder you choose. OFF until you switch it on here; Vex asks in its own box before it can start anything, and never starts one by itself. See docs/local-services-threat-model.md.'));
    el.appendChild(this._box('Local services (off by default)', this));
    el.appendChild(S.button('Open local services', () => this.open().catch(err => localToolsFail('Local services', err))));
  },
  _box(label, mod) {
    const l = document.createElement('label');
    l.className = 'vex-platform-note';
    const box = document.createElement('input');
    box.type = 'checkbox'; box.checked = mod.enabled();
    box.addEventListener('change', () => { try { mod.setEnabled(box.checked); } catch (err) { localToolsFail(label, err); } });
    l.append(box, document.createTextNode(' ' + label));
    return l;
  },
};

// ---------------------------------------------------------------------------------
// T3-058
const WebhookInspector = {
  KEY: 'vex.webhookInspector',
  FEATURE: 'webhook-inspector',
  JOB: 'Webhook inspector view',
  FORBIDDEN_REPLAY: new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'keep-alive', 'proxy-authorization', 'proxy-connection']),

  _pref() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || '{}') || {}; }
    catch (err) {
      console.error('[Webhook] the switch is not readable and stays off:', err.message);
      if (typeof VexProblems !== 'undefined') VexProblems.note('Webhook inspector', 'The switch was not readable and stays off', err);
      return {};
    }
  },
  enabled() { return this._pref().enabled === true; },
  setEnabled(on) {
    localStorage.setItem(this.KEY, JSON.stringify({ ...this._pref(), enabled: !!on }));
    // Off stops a listener that is running.
    if (!on && typeof window !== 'undefined' && window.vex && typeof window.vex.webhookStop === 'function') {
      window.vex.webhookStop().then(r => { if (!r || r.ok !== true) throw new Error((r && r.error) || 'main did not answer'); })
        .catch(err => localToolsFail('The webhook inspector could not be stopped', err));
    }
  },

  // What "replay in the playground" hands over: the method, body and the headers the playground may set.
  // The address is a placeholder on purpose: nothing is sent until you choose where and press Send.
  replayPrefill(rec) {
    return {
      url: 'https://replace-me.invalid/',
      method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(rec.method) ? rec.method : 'POST',
      body: rec.binary || rec.tooLarge ? '' : rec.body,
      headers: rec.headers.filter(([n]) => !this.FORBIDDEN_REPLAY.has(String(n).toLowerCase()) && /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/.test(n)).map(([name, value]) => ({ name, value })),
    };
  },

  async open() {
    if (!this.enabled()) throw new Error('The webhook inspector is switched off (Settings > More developer tools)');
    const S = VexSettingsGroups;
    const { body, close } = S.dialog({ id: 'vex-webhook', title: 'Webhook inspector', sub: 'A receiver on 127.0.0.1 only. It shows what arrives, never forwards it, and stops by itself.' });
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const act = (text, fn, opts) => S.button(text, async () => { try { await fn(); } catch (err) { localToolsFail(text, err); } }, opts);
    let picked = null, job = null, shownCount = 0;
    const stopJob = () => { if (job) { job.stop(); job = null; } };
    const watchClose = new MutationObserver(() => { if (!body.isConnected) { stopJob(); watchClose.disconnect(); } });
    watchClose.observe(document.body, { childList: true });

    const draw = async () => {
      const st = (await LocalToolsBridge.call('webhookList', 0)).status;
      body.textContent = '';
      if (!st.running) {
        stopJob();
        const port = el('input', 'set-input'); port.type = 'number'; port.min = '1024'; port.max = '65535'; port.value = '8788'; port.setAttribute('aria-label', 'Port');
        const mins = el('select', 'set-input'); mins.setAttribute('aria-label', 'Stop after');
        for (const m of [5, 10, 30, 60]) mins.appendChild(Object.assign(el('option', '', m + ' minutes'), { value: String(m) }));
        mins.value = '10';
        body.append(S.note('Not listening. Choose a port and for how long. Requests are kept in memory only (1 MB each, the latest 100) and are gone when it stops.'),
          el('div', 'vexsr-rule'), act('Start', async () => {
            const p = Number(port.value), m = Number(mins.value);
            if (!(await vexConfirm({ title: 'Start the webhook inspector?', message: 'Vex will listen on 127.0.0.1 port ' + p + ' (this computer only) for ' + m + ' minutes and list what it receives. It forwards nothing.', okLabel: 'Start' }))) return;
            await LocalToolsBridge.call('webhookStart', { port: p, minutes: m });
            picked = null;
            await draw();
          }, { primary: true }));
        body.children[1].append(port, mins);
        return;
      }
      // Looks every two seconds; the window is redrawn only when something arrived or it stopped.
      if (!job) {
        job = VexJobs.every(this.JOB, 2000, async () => {
          try {
            const r = await LocalToolsBridge.call('webhookList', 0);
            if (!r.status.running || r.requests.length !== shownCount) await draw();
          } catch (err) { stopJob(); localToolsFail('Webhook inspector', err); }
        }, { when: 'ui', feature: this.FEATURE });
      }
      const left = Math.max(0, Math.round((st.stopsAt - Date.now()) / 60000));
      body.appendChild(S.note('Listening on http://127.0.0.1:' + st.port + '/ for about ' + left + ' more minute' + VexPlural.s(left) + '. ' + st.count + ' request' + VexPlural.s(st.count) + ' received.'));
      body.appendChild((() => {
        const bar = el('div'); bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:6px 0';
        bar.append(act('Stop', async () => { await LocalToolsBridge.call('webhookStop'); stopJob(); await draw(); }, { danger: true }),
          act('Clear', async () => { await LocalToolsBridge.call('webhookClear'); picked = null; await draw(); }),
          act('Copy address', () => navigator.clipboard.writeText('http://127.0.0.1:' + st.port + '/').then(() => window.showToast?.('Address copied'))));
        return bar;
      })());
      const reqs = (await LocalToolsBridge.call('webhookList', 0)).requests.slice().reverse();
      shownCount = reqs.length;
      const list = el('div', 'vexsr-list');
      for (const r of reqs.slice(0, 50)) {
        const t = el('span', 'vexsr-host', r.method + ' ' + r.path); t.style.wordBreak = 'break-all';
        const when = el('span', 'vexsr-mode', new Date(r.at).toLocaleTimeString() + ', ' + r.size + ' B' + (r.tooLarge ? ' (too large, not kept)' : '') + (r.binary ? ' (not text)' : ''));
        const row = el('div', 'vexsr-rule'); row.append(t, when, act('View', async () => { picked = (await LocalToolsBridge.call('webhookGet', r.id)).request; await draw(); }, { label: 'View request ' + r.id }));
        list.appendChild(row);
      }
      if (!list.children.length) list.appendChild(S.note('Nothing has arrived yet. Send one with curl or your webhook sender.'));
      body.appendChild(list);
      if (picked) {
        const d = el('div');
        const head = el('pre'); head.style.cssText = 'white-space:pre-wrap;word-break:break-all;margin:8px 0';
        head.textContent = picked.method + ' ' + picked.path + '\nfrom ' + picked.from + '\n\n' + picked.headers.map(([n, v]) => n + ': ' + v).join('\n');
        const data = el('pre'); data.style.cssText = 'white-space:pre-wrap;word-break:break-all;max-height:260px;overflow:auto;margin:8px 0';
        data.textContent = picked.tooLarge ? '(larger than 1 MB, not kept)' : (picked.binary ? '(the body is not text)' : (picked.body || '(empty body)'));
        const bar = el('div'); bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
        bar.append(act('Copy body', () => navigator.clipboard.writeText(picked.body).then(() => window.showToast?.('Body copied'))),
          act('Replay in the API playground', () => {
            if (typeof ApiPlayground === 'undefined') throw new Error('The API playground is not loaded');
            const pre = this.replayPrefill(picked);
            close(); stopJob();
            ApiPlayground.open(pre);
            window.showToast?.('Choose where to send it in the playground. Nothing has been sent.');
          }));
        d.append(head, data, bar);
        body.appendChild(d);
      }
    };
    await draw();
  },

  group(el) {
    const S = VexSettingsGroups;
    el.appendChild(S.note('Webhook inspector: a receiver on 127.0.0.1 (this computer only) on a port you choose, for the minutes you choose, showing what arrives. Never forwards, never reachable from outside, OFF until you switch it on here.'));
    el.appendChild(LocalServices._box('Webhook inspector (off by default)', this));
    el.appendChild(S.button('Open webhook inspector', () => this.open().catch(err => localToolsFail('Webhook inspector', err))));
  },
};

const LocalToolsUI = {
  group(el) {
    LocalServices.group(el);
    WebhookInspector.group(el);
  },
};

if (typeof window !== 'undefined') {
  Object.assign(window, { LocalToolsBridge, LocalServices, WebhookInspector, LocalToolsUI });
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    const run = (what, fn) => () => { fn().catch(err => localToolsFail(what, err)); };
    VexExtras.registerCommand({ id: 'local-services', label: 'Local services', hint: 'Start and stop the dev servers you listed', icon: 'terminal', action: run('Local services', () => LocalServices.open()) });
    VexExtras.registerCommand({ id: 'webhook-inspector', label: 'Webhook inspector', hint: 'A loopback receiver that shows what a webhook sender posts', icon: 'plug', action: run('Webhook inspector', () => WebhookInspector.open()) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { LocalToolsBridge, LocalServices, WebhookInspector, LocalToolsUI };
