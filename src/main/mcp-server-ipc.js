// === Vex as an MCP server: what the four tools do, and the switch ================
//
// Joins the front door (main/mcp-server.js) to Vex: the agent policy and audit log
// (main/agent-policy.js, agent-audit.js), the window's tabs and history (through js/mcp-server-ui.js,
// reached with executeJavaScript on the main window), and the person.
//
// The four tools, and what they will never do:
//   list_tabs       id, title and SITE NAME of the open tabs. Not private, Tor or routed tabs (the window
//                   leaves them out), not sign-in / payment / mail / health pages, not blocked sites.
//   read_page_text  one tab's visible text, cut to a size. Refused for the same tabs, for a page with a
//                   password or card field, and for any blocked site; the address is checked again after
//                   the read, in case the page moved.
//   open_url        asks the person, in a box MAIN shows (a window script cannot press it), every single
//                   time: "<client> wants to open <site>" with Allow once / Block (Block is the default).
//                   Opens a background tab. Addresses on this computer or the home network are refused.
//   search_history  titles and addresses (no query, no fragment); not sensitive pages, not blocked sites.
// There is no tool that types, clicks, reads cookies, the vault, the clipboard, downloads or files.
//
// Every call is written to the audit log (host and result code only). If the log cannot be written the
// call is not run. The token is made here, kept sealed by the OS (SecretStore) and shown to the person
// ONCE, when it is made; "Make a new token" replaces it. Switching it on and making a new token are
// confirmed in a box main shows. Off by default; stopped when switched off and when Vex quits.
//
// Everything outside (files, secrets, http, the window, the dialogs) is injected, so it runs under
// test without a socket, a window or a disk.

const crypto = require('crypto');
const path = require('path');
const { VexPageSensitivity } = require('../renderer/js/page-sensitivity');
const { hostOfUrl } = require('./agent-policy');
const { mcpCaller } = require('./agent-audit');
const { createMcpServer } = require('./mcp-server');

const BRIDGE_METHODS = ['listTabs', 'tabInfo', 'readText', 'searchHistory'];
const BRIDGE_FAIL = {
  private: ['denied-private', 'That tab is private or routed, so it is not shared.'],
  sensitive: ['denied-sensitive', 'That page is a sign-in, payment or similar page, so it is not shared.'],
  asleep: ['unavailable', 'That tab is asleep. Ask the person to open it first.'],
  changed: ['error', 'The page changed while it was being read. Try again.'],
  'no-tab': ['error', 'There is no such tab. list_tabs gives the ids.'],
  unavailable: ['unavailable', 'Vex cannot reach its window right now.'],
};

const newToken = () => crypto.randomBytes(32).toString('base64url');
const clip = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
// An address without its query, fragment or credentials: where a page lives, not what it was asked.
function bareUrl(url) {
  try { const u = new URL(String(url)); return clip(u.origin + u.pathname, 300); } catch { return ''; }
}
const sensitive = (url) => VexPageSensitivity.reason(url) !== null;
const ok = (obj) => ({ isError: false, text: JSON.stringify(obj) });
const fail = (text) => ({ isError: true, text });

function createEvoMcp({ fs, dir, secretStore, atomicWriteSync, http, control, confirm, approve, callBridge, openTab, version = '0', now = () => Date.now(), log = (m) => console.error(m), randomToken = newToken }) {
  const configFile = path.join(dir, 'mcp-server.json');
  const tokenFile = path.join(dir, 'mcp-server-token.enc');
  let config = null;          // { enabled, port }
  let token = null;           // the token in force (null until read or made)
  let tokenLoaded = false;
  let lastError = '';

  // ---- saved switch ----------------------------------------------------------
  function loadConfig() {
    if (config) return config;
    config = { enabled: false, port: 0 };
    let text;
    try { text = fs.readFileSync(configFile, 'utf8'); } catch (e) {
      if (e.code !== 'ENOENT') log('[McpServer] the switch file could not be read, the server stays off: ' + e.message);
      return config;
    }
    try {
      const raw = JSON.parse(text);
      config = { enabled: raw && raw.enabled === true, port: Number.isInteger(raw && raw.port) && raw.port >= 1024 && raw.port <= 65535 ? raw.port : 0 };
    } catch (e) { log('[McpServer] the switch file is damaged, the server stays off: ' + e.message); }
    return config;
  }
  function saveConfig(next) {
    atomicWriteSync(configFile, JSON.stringify(next), { fsImpl: fs });
    config = next;
  }
  async function loadToken() {
    if (tokenLoaded) return token;
    const v = await secretStore.read(tokenFile);
    token = typeof v === 'string' && v.length >= 32 ? v : null;
    tokenLoaded = true;
    return token;
  }

  // ---- the four tools --------------------------------------------------------
  async function bridge(method, arg) {
    if (!BRIDGE_METHODS.includes(method)) throw new Error('Not a window method: ' + method);
    try { return await callBridge(method, arg); }
    catch (err) { log('[McpServer] the window did not answer ' + method + ': ' + (err && err.message)); return { ok: false, code: 'unavailable' }; }
  }

  async function handleTool(name, args, { client = '', isStale = () => false } = {}) {
    const caller = mcpCaller(client);
    const rec = (decision, result, host) => {
      try { control.audit.record({ caller, tool: name, host: host || '', decision, result }); }
      catch (err) { log('[McpServer] the audit line could not be written: ' + err.message); }
    };
    // No call without a log that can take it.
    try { control.audit.assertWritable(); }
    catch (err) { log('[McpServer] the activity log cannot be written, so a request was refused: ' + err.message); return fail('Vex cannot write its activity log, so it did not run this request.'); }

    const askedHost = name === 'open_url' ? hostOfUrl(args.url) : '';
    const verdict = control.check('mcp', { tool: name, host: askedHost });
    if (verdict.decision === 'deny') { rec('deny', control.resultFor(verdict.reason), askedHost); return fail('This is blocked by the Vex agent policy.'); }
    let decision = 'allow';

    // The person's say, in a box main shows. Anything but a clear "allow" is a no.
    async function gate(host, detail, always) {
      if (verdict.decision !== 'ask' && !always) return null;
      let answer = 'block';
      try { answer = await approve({ client: cleanLabel(client), tool: name, host, detail }); }
      catch (err) { log('[McpServer] the approval box failed, so the answer is no: ' + err.message); }
      if (isStale()) { rec('ask-blocked', 'unavailable', host); return fail('The request timed out before the person answered. Nothing was done.'); }
      if (answer === 'busy') { rec('ask-blocked', 'busy', host); return fail('Another request is waiting for the person\'s answer. Try again in a moment.'); }
      if (answer !== 'allow') { rec('ask-blocked', 'denied-user', host); return fail('The person did not allow this.'); }
      decision = 'ask-allowed';
      return null;
    }
    const failed = (code, host) => {
      const [result, message] = BRIDGE_FAIL[code] || BRIDGE_FAIL.unavailable;
      rec(decision, result, host);
      return fail(message);
    };

    switch (name) {
      case 'list_tabs': {
        const g = await gate('', 'Share the titles and site names of the open tabs');
        if (g) return g;
        const r = await bridge('listTabs', null);
        if (!r || r.ok !== true || !Array.isArray(r.tabs)) return failed(r && r.code, '');
        const tabs = [];
        for (const t of r.tabs.slice(0, 200)) {
          const host = hostOfUrl(t && t.url);
          if (!host || sensitive(t.url) || control.hostBlocked(host)) continue;
          tabs.push({ id: t.id, title: clip(t.title, 200), host });
        }
        rec(decision, 'ok', '');
        return ok({ tabs });
      }
      case 'read_page_text': {
        const info = await bridge('tabInfo', { tabId: args.tabId });
        if (!info || info.ok !== true || !info.tab) return failed(info && info.code, '');
        const url = String(info.tab.url || '');
        const host = hostOfUrl(url);
        if (!host || !/^https?:/i.test(url)) { rec(decision, 'denied-sensitive', host); return fail(BRIDGE_FAIL.sensitive[1]); }
        if (control.hostBlocked(host)) { rec('deny', 'denied-host', host); return fail('This is blocked by the Vex agent policy.'); }
        if (sensitive(url)) { rec('deny', 'denied-sensitive', host); return fail(BRIDGE_FAIL.sensitive[1]); }
        const g = await gate(host, 'Read the text of a page on ' + host);
        if (g) return g;
        const r = await bridge('readText', { tabId: info.tab.id, expectedUrl: url, maxChars: args.maxChars });
        if (!r || r.ok !== true || typeof r.text !== 'string') return failed(r && r.code, host);
        // Where the page ended up is judged again: it may have moved to a blocked or sensitive address.
        const finalHost = hostOfUrl(r.url);
        if (!finalHost || control.hostBlocked(finalHost)) { rec('deny', 'denied-host', finalHost || host); return fail('This is blocked by the Vex agent policy.'); }
        if (sensitive(r.url)) { rec('deny', 'denied-sensitive', finalHost); return fail(BRIDGE_FAIL.sensitive[1]); }
        rec(decision, 'ok', host);
        return ok({ title: clip(r.title, 200), url: bareUrl(r.url), truncated: r.text.length > args.maxChars, text: r.text.slice(0, args.maxChars) });
      }
      case 'open_url': {
        const g = await gate(askedHost, args.url, true);
        if (g) return g;
        try { openTab(args.url); }
        catch (err) { log('[McpServer] could not open a tab: ' + err.message); rec(decision, 'error', askedHost); return fail('Vex could not open the tab.'); }
        rec(decision, 'ok', askedHost);
        return ok({ opened: true, host: askedHost });
      }
      case 'search_history': {
        const g = await gate('', 'Search your history for: ' + clip(args.query, 100));
        if (g) return g;
        const r = await bridge('searchHistory', { query: args.query, limit: args.limit });
        if (!r || r.ok !== true || !Array.isArray(r.items)) return failed(r && r.code, '');
        const items = [];
        for (const h of r.items.slice(0, 100)) {
          const host = hostOfUrl(h && h.url);
          if (!host || sensitive(h.url) || control.hostBlocked(host)) continue;
          items.push({ title: clip(h.title, 200), url: bareUrl(h.url) });
          if (items.length >= args.limit) break;
        }
        rec(decision, 'ok', '');
        return ok({ items });
      }
      default:
        // The front door only lets the four names through; if one gets here anyway it is refused.
        rec('deny', 'invalid', '');
        return fail('Unknown tool.');
    }
  }

  function cleanLabel(client) { return mcpCaller(client).slice(4); }

  // A request the front door turned away before a tool ran (an unknown tool, bad arguments).
  function onRejected({ client, tool, result }) {
    try { control.audit.record({ caller: mcpCaller(client), tool, host: '', decision: 'deny', result }); }
    catch (err) { log('[McpServer] the audit line could not be written: ' + err.message); }
  }

  const server = createMcpServer({ http, getToken: () => token, handleTool, onRejected, version, now, log });

  // ---- the switch ------------------------------------------------------------
  async function status() {
    await loadToken();
    const s = server.status();
    return { enabled: loadConfig().enabled, running: s.running, port: s.port, url: s.running ? 'http://127.0.0.1:' + s.port + '/mcp' : null, hasToken: !!token, error: lastError };
  }

  async function setEnabled(on) {
    if (on !== true) {
      await server.stop();
      saveConfig({ enabled: false, port: loadConfig().port });
      lastError = '';
      return status();
    }
    await loadToken();
    if (server.status().running) return status();
    const yes = await confirm({
      title: 'Let AI tools use Vex?',
      message: 'Vex will start a small server that listens on this computer only (127.0.0.1). An AI tool that has the access token you are about to be shown can list your open tabs, read the text of a page that is not private or sensitive, search your history, and ask you to open a page. It can never type, click, or read passwords, cookies, the clipboard or your files, and every call is written to the activity log. You can turn it off at any time.',
      okLabel: 'Turn on',
    });
    if (!yes) return { ...(await status()), canceled: true };
    return start();
  }

  // Starts the server (token made first if there is none). Returns the token only when it was just made.
  async function start() {
    const had = token;
    const candidate = had || randomToken();
    token = candidate;
    try {
      control.audit.assertWritable();
      const port = await server.start({ preferredPort: loadConfig().port });
      if (!had) await secretStore.write(tokenFile, candidate);
      saveConfig({ enabled: true, port });
      lastError = '';
    } catch (err) {
      await server.stop().catch((e) => log('[McpServer] could not stop after a failed start: ' + e.message));
      token = had;
      lastError = (err && err.message) || String(err);
      throw err;
    }
    return { ...(await status()), ...(had ? {} : { token: candidate }) };
  }

  async function rotate() {
    await loadToken();
    const yes = await confirm({
      title: 'Make a new access token?',
      message: 'The old token stops working at once. You will be shown the new one once; put it in your AI tool\'s settings.',
      okLabel: 'Make new token',
    });
    if (!yes) return { ...(await status()), canceled: true };
    const fresh = randomToken();
    await secretStore.write(tokenFile, fresh);
    token = fresh;
    return { ...(await status()), token: fresh };
  }

  // At launch: only if the person left it on. A failure is reported and leaves it off.
  async function autostart() {
    if (!loadConfig().enabled) return false;
    try {
      await loadToken();
      if (!token) { lastError = 'The access token is missing, so the server was not started. Turn it on again.'; log('[McpServer] ' + lastError); return false; }
      control.audit.assertWritable();
      const port = await server.start({ preferredPort: config.port });
      saveConfig({ enabled: true, port });
      return true;
    } catch (err) {
      lastError = (err && err.message) || String(err);
      log('[McpServer] it was on but could not start: ' + lastError);
      return false;
    }
  }

  const shutdown = () => server.stop();
  return { status, setEnabled, rotate, autostart, shutdown, handleTool, server };
}

function registerEvoMcpIpc({ ipcMain, evo }) {
  const reply = async (fn) => { try { return { ok: true, ...(await fn()) }; } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; } };
  ipcMain.handle('evomcp:status', () => reply(() => evo.status()));
  ipcMain.handle('evomcp:set-enabled', (_e, on) => reply(() => evo.setEnabled(on === true)));
  ipcMain.handle('evomcp:rotate-token', () => reply(() => evo.rotate()));
}

module.exports = { createEvoMcp, registerEvoMcpIpc, bareUrl, BRIDGE_METHODS };
