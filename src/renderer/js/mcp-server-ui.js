// === Vex as an MCP server: the window's side ====================================
//
// Two things live here, and neither does anything until main asks or the person presses a button:
//
//   VexMcpBridge     what main (src/main/mcp-server-ipc.js) calls to see this window's tabs and history for an
//                    outside AI tool. It only ever returns what the person's tabs policy lets any feature
//                    share (VexTabPolicy.canShareTab / canReadWebview: never a private, Tor or routed tab, never
//                    any tab of a private window) and it reads no field of a page that has a password or card
//                    field. Main judges every answer again before it leaves.
//   McpServerUI      the Settings section: the switch (OFF by default, confirmed in a box main shows), the access
//                    token (shown once, when it is made), a new-token button and the config snippets.
//
// Loaded late (js/lazy-boot.js).

const VexMcpBridge = {
  MAX_TEXT: 20000,

  _tabsOf() { return typeof TabManager !== 'undefined' && Array.isArray(TabManager.tabs) ? TabManager.tabs : null; },
  // No policy object means nothing is shared.
  _shareable(tab) {
    const pol = typeof window !== 'undefined' ? window.VexTabPolicy : null;
    return !!pol && !pol.isPrivateWindow && typeof pol.canShareTab === 'function' && pol.canShareTab(tab);
  },
  _find(tabId) {
    const tabs = this._tabsOf();
    if (!tabs) return { code: 'unavailable' };
    const id = tabId == null ? TabManager.activeTabId : tabId;
    const tab = tabs.find(t => t.id === id);
    if (!tab) return { code: 'no-tab' };
    if (!this._shareable(tab)) return { code: 'private' };
    return { tab };
  },

  async listTabs() {
    const tabs = this._tabsOf();
    if (!tabs) return { ok: false, code: 'unavailable' };
    return { ok: true, tabs: tabs.filter(t => this._shareable(t)).map(t => ({ id: t.id, title: String(t.title || '').slice(0, 200), url: String(t.url || '').slice(0, 2048) })) };
  },

  async tabInfo(arg) {
    const found = this._find(arg && arg.tabId);
    if (!found.tab) return { ok: false, code: found.code };
    const t = found.tab;
    return { ok: true, tab: { id: t.id, title: String(t.title || '').slice(0, 200), url: String(t.url || '').slice(0, 2048) } };
  },

  async readText(arg) {
    const found = this._find(arg && arg.tabId);
    if (!found.tab) return { ok: false, code: found.code };
    const tab = found.tab;
    // The page main looked at is the page that is read; if it moved on, main is told.
    if (tab.url !== arg.expectedUrl) return { ok: false, code: 'changed' };
    if (tab.sleeping || tab._lazy) return { ok: false, code: 'asleep' };
    const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(tab.id) : null;
    if (!wv) return { ok: false, code: 'asleep' };
    const pol = window.VexTabPolicy;
    if (typeof pol.canReadWebview === 'function' && !pol.canReadWebview(wv)) return { ok: false, code: 'private' };
    const max = Math.max(200, Math.min(Number(arg.maxChars) || 8000, this.MAX_TEXT));
    const script = `(() => { try {
      if (document.querySelector('input[type="password"], input[autocomplete^="cc-"], input[autocomplete="one-time-code"]')) return JSON.stringify({ sensitive: true });
      const el = document.querySelector('article, main, [role="main"]') || document.body;
      return JSON.stringify({ title: document.title, url: location.href, text: String(el.innerText || el.textContent || '').slice(0, ${max + 1}) });
    } catch (e) { return JSON.stringify({ error: String(e && e.message) }); } })()`;
    const raw = await window.vexGuestEval(wv, script);
    let out;
    try { out = JSON.parse(raw); } catch (err) { window.VexProblems?.note('MCP server', 'A page read returned something unreadable', err); return { ok: false, code: 'unavailable' }; }
    if (out.sensitive) return { ok: false, code: 'sensitive' };
    if (out.error || typeof out.text !== 'string') return { ok: false, code: 'unavailable' };
    return { ok: true, title: out.title, url: out.url, text: out.text };
  },

  async searchHistory(arg) {
    if (typeof AgentTools === 'undefined' || typeof AgentTools.searchHistory !== 'function') return { ok: false, code: 'unavailable' };
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) return { ok: false, code: 'private' };
    const hits = AgentTools.searchHistory(arg.query, Math.min(Number(arg.limit) * 3 || 30, 75));
    return { ok: true, items: hits.map(h => ({ title: String(h.title || '').slice(0, 200), url: String(h.url || '').slice(0, 2048) })) };
  },
};

const McpServerUI = {
  ID: 'mcp-server',

  bridge() {
    const v = typeof window !== 'undefined' ? window.vex : null;
    if (!v || typeof v.evoMcpStatus !== 'function') throw new Error('The MCP server is not available in this build');
    return v;
  },
  async call(fn, ...args) {
    const r = await this.bridge()[fn](...args);
    if (!r || r.ok !== true) throw new Error((r && r.error) || 'The request failed');
    return r;
  },
  fail(what, err) {
    console.error('[McpServer] ' + what + ':', err);
    window.showToast?.(what + ': ' + ((err && err.message) || err), 'error');
  },
  open() {
    if (typeof SettingsUI === 'undefined' || typeof SettingsUI.openSection !== 'function') throw new Error('Settings is not available in this window');
    SettingsUI.openSection('setting-' + this.ID);
  },

  // The two ways to connect a client, with the real address and token. Shown once, next to the token.
  snippets(url, token) {
    const code = 'claude mcp add --transport http vex ' + url + ' --header "Authorization: Bearer ' + token + '"';
    const desktop = JSON.stringify({ mcpServers: { vex: { command: 'npx', args: ['-y', 'mcp-remote', url, '--allow-http', '--header', 'Authorization:${VEX_AUTH}'], env: { VEX_AUTH: 'Bearer ' + token } } } }, null, 2);
    return { code, desktop };
  },

  render(body) {
    const S = VexSettingsGroups;
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const act = (text, fn, opts) => S.button(text, async () => { try { await fn(); } catch (err) { this.fail(text, err); } }, opts);
    const host = el('div');
    body.append(
      S.note('Lets an AI tool that you run yourself (Claude Code, or Claude Desktop through mcp-remote) use your Vex: list your open tabs, read the text of a page that is not private or sensitive, search your history, and ask you to open a page. Off until you switch it on. It listens on this computer only, needs an access token, never types, clicks or reads passwords, cookies, the clipboard or files, and every call is written to the log under AI agent activity.'),
      host);
    let shown = null;      // { token, url }: the token made a moment ago, shown once
    const draw = async () => {
      let st;
      try { st = await this.call('evoMcpStatus'); }
      catch (err) { host.textContent = ''; host.appendChild(S.note('Could not read the MCP server state: ' + err.message)); return; }
      host.textContent = '';
      const label = el('label', 'vex-platform-note');
      const box = el('input'); box.type = 'checkbox'; box.checked = st.enabled && st.running;
      box.addEventListener('change', async () => {
        try {
          const r = await this.call('evoMcpSetEnabled', box.checked);
          if (r.token) shown = { token: r.token, url: r.url };
          if (r.canceled) box.checked = false;
        } catch (err) { box.checked = false; this.fail('MCP server', err); }
        await draw();
      });
      label.append(box, el('span', '', ' Let AI tools use Vex (MCP server)'.trim()));
      host.appendChild(label);
      host.appendChild(S.note(st.running ? 'Running at ' + st.url : (st.enabled ? 'It is switched on but did not start.' : 'Off.')));
      if (st.error) host.appendChild(S.note('Last problem: ' + st.error));

      if (shown) {
        const snip = this.snippets(shown.url || st.url || 'http://127.0.0.1:PORT/mcp', shown.token);
        host.appendChild(S.note('Your access token. It is shown only now and Vex keeps it sealed; copy it into your AI tool before you leave this page.'));
        const tokenBox = el('input', 'set-input'); tokenBox.type = 'text'; tokenBox.readOnly = true; tokenBox.value = shown.token; tokenBox.spellcheck = false; tokenBox.setAttribute('aria-label', 'Access token');
        const row = el('div', 'vexsr-rule');
        row.append(tokenBox, act('Copy token', async () => { await navigator.clipboard.writeText(shown.token); window.showToast?.('Token copied'); }));
        host.appendChild(row);
        host.appendChild(S.note('For Claude Code, run this once:'));
        const pre1 = el('pre', '', snip.code); pre1.style.cssText = 'white-space:pre-wrap;user-select:text;font-size:12px';
        host.appendChild(pre1);
        host.appendChild(S.note('For Claude Desktop, add this to the mcpServers part of claude_desktop_config.json (it needs Node.js installed) and restart Claude Desktop:'));
        const pre2 = el('pre', '', snip.desktop); pre2.style.cssText = 'white-space:pre-wrap;user-select:text;font-size:12px';
        host.appendChild(pre2);
      } else if (st.hasToken) {
        host.appendChild(S.note('The access token was shown when it was made and cannot be shown again. If you lost it, make a new one.'));
      }
      const bar = el('div'); bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
      if (st.hasToken) {
        bar.appendChild(act('Make a new token', async () => {
          const r = await this.call('evoMcpRotateToken');
          if (r.token) shown = { token: r.token, url: r.url };
          await draw();
        }));
      }
      bar.appendChild(act('Open AI agent activity', () => { if (typeof AgentActivityUI === 'undefined') throw new Error('AI agent activity is still loading'); AgentActivityUI.open(); }));
      host.appendChild(bar);
      host.appendChild(S.note('Sites you never want shared, and which tools are allowed, asked about or blocked, are set under AI agent activity. Opening a page always asks you first.'));
    };
    draw();
  },
};

if (typeof window !== 'undefined') {
  window.VexMcpBridge = VexMcpBridge;
  window.McpServerUI = McpServerUI;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: McpServerUI.ID, title: 'MCP server for AI tools', keywords: 'mcp server claude desktop claude code ai tool token localhost expose tabs', before: 'about', render: (body) => McpServerUI.render(body) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'mcp-server', label: 'MCP server for AI tools', hint: 'Let Claude Desktop or Claude Code use your Vex, with your approval and a log', icon: 'plug', action: () => { try { McpServerUI.open(); } catch (err) { McpServerUI.fail('MCP server', err); } } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexMcpBridge, McpServerUI };
