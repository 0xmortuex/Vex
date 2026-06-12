// === Vex MCP Client (Model Context Protocol) ===
//
// Connect to HTTP (Streamable-HTTP) MCP servers, list their tools, and invoke
// them with a built-in explorer — like the API client, but speaking MCP's
// JSON-RPC. Servers are configured in Settings → MCP Servers. All traffic goes
// through main's CORS-free api:request (MCP servers don't send CORS headers),
// and the response may be plain JSON or a single SSE event — we handle both.
//
// Scope (v1): configure servers, initialize handshake, tools/list, tools/call
// from the explorer. Wiring MCP tools into the autonomous agent loop is a
// deliberate follow-up — this keeps the stable agent untouched.

const McpClient = (() => {
  const KEY = 'vex.mcpServers';
  const PROTOCOL_VERSION = '2025-06-18';
  let servers = [];
  const _sessions = Object.create(null); // serverId -> { sessionId, tools, info }

  function load() { try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); servers = Array.isArray(a) ? a : []; } catch { servers = []; } return servers; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(servers)); } catch {} }
  function list() { return servers; }
  function session(id) { return _sessions[id]; }

  function addServer(name, url, auth) {
    url = (url || '').trim(); name = (name || '').trim();
    if (!/^https?:\/\//i.test(url)) { window.showToast?.('Enter a valid http(s) MCP URL'); return null; }
    const s = { id: 'mcp' + Date.now().toString(36), name: name || url, url, auth: (auth || '').trim() };
    servers.push(s); save();
    return s;
  }
  function removeServer(id) { servers = servers.filter(s => s.id !== id); delete _sessions[id]; save(); }

  // Parse either a JSON body or an SSE stream ("event:"/"data:" lines) into the
  // first JSON-RPC object we can find.
  function _parseBody(body) {
    if (!body) return null;
    const t = body.trim();
    if (t[0] === '{' || t[0] === '[') { try { return JSON.parse(t); } catch {} }
    // SSE: collect data: lines, try each.
    for (const line of body.split(/\r?\n/)) {
      const m = /^data:\s*(.*)$/.exec(line);
      if (m && m[1]) { try { return JSON.parse(m[1]); } catch {} }
    }
    return null;
  }

  let _id = 0;
  async function _rpc(server, method, params, opts = {}) {
    if (!window.vex?.apiRequest) throw new Error('Bridge unavailable');
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
    if (server.auth) headers['Authorization'] = /^bearer\s/i.test(server.auth) ? server.auth : ('Bearer ' + server.auth);
    const sess = _sessions[server.id];
    if (sess?.sessionId) headers['Mcp-Session-Id'] = sess.sessionId;
    const payload = { jsonrpc: '2.0', method, params: params || {} };
    if (!opts.notification) payload.id = ++_id;
    const res = await window.vex.apiRequest({ url: server.url, method: 'POST', headers, body: JSON.stringify(payload) });
    if (!res || !res.ok) throw new Error((res && res.error) || 'Request failed');
    if (res.status >= 400) throw new Error('Server returned ' + res.status + (res.body ? ': ' + res.body.slice(0, 200) : ''));
    // Capture a session id handed back on initialize.
    const sid = res.headers && (res.headers['mcp-session-id'] || res.headers['Mcp-Session-Id']);
    if (sid) { (_sessions[server.id] || (_sessions[server.id] = {})).sessionId = sid; }
    if (opts.notification) return null;
    const parsed = _parseBody(res.body);
    if (!parsed) throw new Error('Unparseable response');
    if (parsed.error) throw new Error(parsed.error.message || 'RPC error');
    return parsed.result;
  }

  async function connect(server) {
    const init = await _rpc(server, 'initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'Vex', version: '1.0' },
    });
    // Best-effort "initialized" notification (some servers require it before tools/list).
    try { await _rpc(server, 'notifications/initialized', {}, { notification: true }); } catch {}
    const sess = (_sessions[server.id] || (_sessions[server.id] = {}));
    sess.info = init && init.serverInfo;
    const toolsRes = await _rpc(server, 'tools/list', {});
    sess.tools = (toolsRes && toolsRes.tools) || [];
    return sess;
  }

  async function callTool(server, name, args) {
    return await _rpc(server, 'tools/call', { name, arguments: args || {} });
  }

  function init() { load(); }

  // ---------------- Agent integration ----------------
  // Expose connected servers' tools to the autonomous agent as tool defs shaped
  // like the built-in AGENT_TOOLS ({name, description, parameters}). Names are
  // namespaced "mcp__<serverId>__<toolName>" so they can't collide with built-ins.
  function agentToolDefs() {
    const defs = [];
    servers.forEach(s => {
      const sess = _sessions[s.id];
      if (!sess || !Array.isArray(sess.tools)) return;
      sess.tools.forEach(t => {
        const params = {};
        const props = t.inputSchema && t.inputSchema.properties;
        if (props) Object.keys(props).forEach(k => { params[k] = (props[k] && props[k].type) || 'string'; });
        defs.push({ name: 'mcp__' + s.id + '__' + t.name, description: '[MCP · ' + s.name + '] ' + (t.description || t.name), parameters: params });
      });
    });
    return defs;
  }

  // Execute a namespaced MCP tool name chosen by the agent. Returns a string
  // (flattened tool output) or throws.
  async function agentCall(prefixedName, params) {
    if (typeof prefixedName !== 'string' || !prefixedName.startsWith('mcp__')) throw new Error('Not an MCP tool');
    const rest = prefixedName.slice(5);
    const idx = rest.indexOf('__');
    if (idx < 0) throw new Error('Malformed MCP tool name');
    const serverId = rest.slice(0, idx), toolName = rest.slice(idx + 2);
    const server = servers.find(s => s.id === serverId);
    if (!server) throw new Error('MCP server not connected');
    const r = await callTool(server, toolName, params || {});
    const parts = (r && r.content) || [];
    const text = parts.map(p => p && p.type === 'text' ? p.text : JSON.stringify(p)).join('\n');
    if (r && r.isError) throw new Error(text || 'MCP tool error');
    return text || r;
  }

  // ---------------- UI ----------------
  const esc = (s) => { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; };

  function renderSettings(container) {
    if (!container) return;
    container.innerHTML = `
      <p class="setting-info muted" style="margin-bottom:8px">Connect to <strong>HTTP MCP servers</strong> (Model Context Protocol) and browse/invoke their tools. Traffic is proxied through Vex (no CORS limits). Auth is optional (a bearer token).</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
        <input id="mcp-name" placeholder="Name" style="width:120px;padding:7px 9px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:12.5px;outline:none">
        <input id="mcp-url" placeholder="https://my-mcp-server/mcp" spellcheck="false" style="flex:1;min-width:180px;padding:7px 9px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:12px;outline:none">
        <input id="mcp-auth" placeholder="Token (optional)" spellcheck="false" style="width:140px;padding:7px 9px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:12.5px;outline:none">
        <button id="mcp-add" style="padding:7px 15px;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-weight:600">Add</button>
      </div>
      <div id="mcp-list"></div>`;
    const listEl = container.querySelector('#mcp-list');
    const renderList = () => {
      if (!servers.length) { listEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:4px 2px">No MCP servers yet.</div>'; return; }
      listEl.innerHTML = '';
      servers.forEach(s => {
        const sess = _sessions[s.id];
        const r = document.createElement('div');
        r.style.cssText = 'display:flex;align-items:center;gap:9px;padding:8px 9px;background:var(--bg);border:1px solid var(--border);border-radius:8px;margin-bottom:6px';
        r.innerHTML = `<div style="flex:1;min-width:0"><div style="font-size:12.5px;color:var(--text);font-weight:600">${esc(s.name)}</div><div style="font-size:11px;color:var(--text-muted);font-family:'JetBrains Mono',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.url)}</div>${sess && sess.tools ? `<div style="font-size:10.5px;color:#22c55e;margin-top:2px">● connected · ${sess.tools.length} tools</div>` : ''}</div>
          <button data-explore style="padding:6px 12px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px">${sess && sess.tools ? 'Tools' : 'Connect'}</button>
          <button data-x title="Remove" style="width:24px;height:24px;border:none;background:none;color:var(--text-muted);cursor:pointer;font-size:13px">✕</button>`;
        r.querySelector('[data-x]').addEventListener('click', () => { removeServer(s.id); renderList(); });
        r.querySelector('[data-explore]').addEventListener('click', async (e) => {
          const btn = e.target; btn.disabled = true; btn.textContent = '…';
          try { if (!_sessions[s.id]?.tools) await connect(s); openExplorer(s); }
          catch (err) { window.showToast?.('Connect failed: ' + (err.message || 'error')); }
          finally { btn.disabled = false; renderList(); }
        });
        listEl.appendChild(r);
      });
    };
    renderList();
    container.querySelector('#mcp-add').addEventListener('click', () => {
      const s = addServer(container.querySelector('#mcp-name').value, container.querySelector('#mcp-url').value, container.querySelector('#mcp-auth').value);
      if (s) { container.querySelector('#mcp-name').value = ''; container.querySelector('#mcp-url').value = ''; container.querySelector('#mcp-auth').value = ''; renderList(); window.showToast?.('MCP server added'); }
    });
  }

  function openExplorer(server) {
    const sess = _sessions[server.id] || {};
    const tools = sess.tools || [];
    document.getElementById('vex-mcp')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-mcp';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    const toolOpts = tools.map((t, i) => `<option value="${i}">${esc(t.name)}</option>`).join('');
    m.innerHTML = `<div style="width:680px;max-width:95vw;height:78vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5);overflow:hidden">
        <div style="display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid var(--border)">
          <strong style="font-size:15px;color:var(--text)">🔌 ${esc(server.name)}</strong>
          <span style="flex:1;font-size:11px;color:var(--text-muted)">${tools.length} tools${sess.info ? ' · ' + esc(sess.info.name || '') : ''}</span>
          <button id="mcp-close" style="padding:7px 12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer">✕</button>
        </div>
        <div style="padding:10px 16px;border-bottom:1px solid var(--border)">
          <div style="display:flex;gap:8px;align-items:center">
            <select id="mcp-tool" style="flex:1">${toolOpts || '<option>No tools</option>'}</select>
            <button id="mcp-run" style="padding:8px 18px;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-weight:600">Run</button>
          </div>
          <div id="mcp-tool-desc" style="font-size:11.5px;color:var(--text-muted);margin:7px 0 4px"></div>
          <textarea id="mcp-args" spellcheck="false" placeholder='Arguments (JSON), e.g. {"query":"hello"}' style="width:100%;box-sizing:border-box;height:70px;resize:vertical;padding:7px 9px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:12px;outline:none"></textarea>
        </div>
        <div id="mcp-result" style="flex:1;overflow:auto;padding:10px 16px;font-family:'JetBrains Mono',monospace;font-size:12px;white-space:pre-wrap;word-break:break-word;color:var(--text)"><span style="color:var(--text-muted)">Pick a tool, supply JSON arguments, and Run.</span></div>
      </div>`;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.querySelector('#mcp-close').addEventListener('click', close);
    m.addEventListener('click', (e) => { if (e.target === m) close(); });
    const toolSel = m.querySelector('#mcp-tool');
    const descEl = m.querySelector('#mcp-tool-desc');
    const argsEl = m.querySelector('#mcp-args');
    const showDesc = () => {
      const t = tools[parseInt(toolSel.value, 10)];
      if (!t) return;
      descEl.textContent = t.description || '';
      // Prefill a skeleton from the input schema's properties.
      try {
        const props = t.inputSchema && t.inputSchema.properties;
        if (props) { const skel = {}; Object.keys(props).forEach(k => { skel[k] = props[k].type === 'number' ? 0 : ''; }); argsEl.value = JSON.stringify(skel, null, 2); }
        else argsEl.value = '{}';
      } catch { argsEl.value = '{}'; }
    };
    toolSel.addEventListener('change', showDesc);
    if (tools.length) showDesc();
    m.querySelector('#mcp-run').addEventListener('click', async () => {
      const t = tools[parseInt(toolSel.value, 10)];
      if (!t) return;
      const out = m.querySelector('#mcp-result');
      let args = {};
      try { args = argsEl.value.trim() ? JSON.parse(argsEl.value) : {}; } catch { out.textContent = '✕ Arguments are not valid JSON'; return; }
      out.innerHTML = '<span style="color:var(--text-muted)">Running…</span>';
      try {
        const r = await callTool(server, t.name, args);
        const parts = (r && r.content) || [];
        const textOut = parts.map(p => p.type === 'text' ? p.text : (p.type === 'resource' ? JSON.stringify(p.resource, null, 2) : JSON.stringify(p, null, 2))).join('\n\n');
        out.textContent = textOut || JSON.stringify(r, null, 2);
        if (r && r.isError) out.style.color = '#fca5a5'; else out.style.color = 'var(--text)';
      } catch (err) { out.textContent = '✕ ' + (err.message || 'Tool call failed'); out.style.color = '#fca5a5'; }
    });
  }

  return { load, save, list, addServer, removeServer, connect, callTool, session, init, renderSettings, openExplorer, agentToolDefs, agentCall, _parseBody };
})();

if (typeof window !== 'undefined') window.McpClient = McpClient;
if (typeof module !== 'undefined' && module.exports) module.exports = { McpClient };
