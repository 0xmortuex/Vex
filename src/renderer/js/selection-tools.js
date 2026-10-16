// === Selection to my own MCP tools =============================================
//
// You run MCP servers of your own (a spec lookup, a notes search). This lets you
// pin up to five of their tools, and then right-click selected words on a page >
// "<tool>: selection" to send those words to that tool and read the answer in a
// window.
//
// Words from a web page are never sent on their own: every send first shows a
// confirm with the EXACT request (server address, tool, arguments). Servers are the
// ones you added in Settings > MCP Servers (js/mcp-client.js speaks HTTP only; a
// server started from a command line is not supported here). A private, Tor or
// routed tab's selection is never offered.
const VexSelectionTools = {
  KEY: 'vex.selectionTools',            // [{ id, serverId, tool, arg, label }]
  ENABLED_KEY: 'vex.selectionTools.enabled',
  MAX_PINNED: 5,
  MAX_SELECTION: 4000,

  enabled() { return VexBench.flag(this.ENABLED_KEY); },
  setEnabled(on) { VexBench.setFlag(this.ENABLED_KEY, on); },

  // The pinned list; throws when it cannot be read so a change never writes over it.
  _strict() {
    const raw = localStorage.getItem(this.KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) throw new Error('Your pinned tools are not readable, so they were not changed');
    return list;
  },
  list() {
    try { return this._strict(); }
    catch (err) { console.error('[SelectionTools] the pinned tools could not be read:', err.message); return []; }
  },
  _save(list) { localStorage.setItem(this.KEY, JSON.stringify(list)); },

  pin({ serverId, tool, arg, label }) {
    const list = this._strict();
    if (list.length >= this.MAX_PINNED) throw new Error('Five tools are pinned already; remove one first');
    if (!serverId || !tool || !arg) throw new Error('Choose a server, a tool and the argument that receives the selection');
    const entry = { id: 'st' + Date.now().toString(36), serverId, tool, arg, label: String(label || tool).slice(0, 40) };
    list.push(entry);
    this._save(list);
    return entry;
  },
  unpin(id) { this._save(this._strict().filter(p => p.id !== id)); },

  // Pure: the request that would be sent.
  payload(pin, selection) {
    const text = String(selection).slice(0, this.MAX_SELECTION);
    return { method: 'tools/call', params: { name: pin.tool, arguments: { [pin.arg]: text } } };
  },

  serverOf(pin) {
    const server = (typeof McpClient !== 'undefined' ? McpClient.list() : []).find(s => s.id === pin.serverId);
    if (!server) throw new Error('The server for ' + pin.label + ' is not in Settings > MCP Servers any more');
    return server;
  },

  async send(pin, selection, webview) {
    if (typeof McpClient === 'undefined') throw new Error('The MCP client is not available');
    if (!VexBench.canRead(webview)) throw new Error('Text from a private, Tor or routed tab is never sent anywhere');
    const server = this.serverOf(pin);
    const body = this.payload(pin, selection);
    const shown = JSON.stringify({ server: server.url, ...body }, null, 2);
    const ok = await vexConfirm({
      title: 'Send this selection to ' + pin.label + '?',
      message: 'This exact request goes to ' + server.name + ' (' + server.url + '). The words come from a web page; nothing is sent until you confirm.',
      html: '<pre style="white-space:pre-wrap;word-break:break-word;max-height:240px;overflow:auto;font-size:12px">' + VexBench.esc(shown) + '</pre>',
      okLabel: 'Send', wide: true,
    });
    if (!ok) return null;
    if (!McpClient.session(server.id) || !McpClient.session(server.id).tools) await McpClient.connect(server);
    const r = await McpClient.callTool(server, body.params.name, body.params.arguments);
    const parts = (r && r.content) || [];
    const text = parts.map(p => p.type === 'text' ? p.text : JSON.stringify(p, null, 2)).join('\n\n') || JSON.stringify(r, null, 2);
    this.showResult(pin, text, !!(r && r.isError));
    return text;
  },

  showResult(pin, text, isError) {
    const dlg = VexSettingsGroups.dialog({ id: 'vex-selection-tool-result', title: pin.label, sub: isError ? 'The tool reported an error' : 'Answer from your tool' });
    const pre = document.createElement('pre');
    pre.style.cssText = 'white-space:pre-wrap;word-break:break-word;max-height:60vh;overflow:auto;font-size:12.5px';
    pre.textContent = text;
    dlg.body.append(pre, VexSettingsGroups.button('Copy', () => VexBench.copy(text).catch(e => VexBench.fail(e))));
  },

  textItems(selection, webview) {
    if (!VexBench.canRead(webview)) return [];
    return this.list().map(pin => ({ label: pin.label + ': selection', action: VexBench.safe(() => this.send(pin, selection, webview)) }));
  },

  // Settings ---------------------------------------------------------------------
  async pinDialog() {
    if (typeof McpClient === 'undefined') throw new Error('The MCP client is not available');
    const servers = McpClient.list();
    if (!servers.length) throw new Error('Add an MCP server first (Settings > MCP Servers)');
    const dlg = VexSettingsGroups.dialog({ id: 'vex-selection-tool-pin', title: 'Pin an MCP tool', sub: 'The selected words are put into the argument you choose' });
    const el = (tag, css) => { const e = document.createElement(tag); if (css) e.style.cssText = css; return e; };
    const serverSel = el('select'); servers.forEach((s, i) => { const o = el('option'); o.value = String(i); o.textContent = s.name + ' (' + s.url + ')'; serverSel.appendChild(o); });
    const toolSel = el('select'); const argSel = el('select');
    const label = el('input'); label.type = 'text'; label.placeholder = 'Name in the menu';
    const note = VexSettingsGroup.note('Loading the tools of this server...');
    let tools = [];
    const loadTools = async () => {
      note.textContent = 'Loading the tools of this server...';
      toolSel.textContent = ''; argSel.textContent = '';
      const s = servers[Number(serverSel.value)];
      try {
        const sess = (McpClient.session(s.id) && McpClient.session(s.id).tools) ? McpClient.session(s.id) : await McpClient.connect(s);
        tools = sess.tools || [];
        tools.forEach((t, i) => { const o = el('option'); o.value = String(i); o.textContent = t.name; toolSel.appendChild(o); });
        note.textContent = tools.length ? tools.length + ' tools' : 'This server offers no tools';
        fillArgs();
      } catch (err) { note.textContent = 'Could not load the tools: ' + ((err && err.message) || err); }
    };
    const fillArgs = () => {
      argSel.textContent = '';
      const t = tools[Number(toolSel.value)];
      const props = (t && t.inputSchema && t.inputSchema.properties) || {};
      Object.keys(props).filter(k => !props[k].type || props[k].type === 'string').forEach(k => { const o = el('option'); o.value = k; o.textContent = k; argSel.appendChild(o); });
      if (t && !label.value) label.value = t.name;
    };
    serverSel.addEventListener('change', loadTools);
    toolSel.addEventListener('change', () => { label.value = ''; fillArgs(); });
    dlg.body.append(VexSettingsGroup.field('Server', serverSel), VexSettingsGroup.field('Tool', toolSel), VexSettingsGroup.field('Argument', argSel), VexSettingsGroup.field('Menu name', label), note,
      VexSettingsGroups.button('Pin', () => {
        const s = servers[Number(serverSel.value)], t = tools[Number(toolSel.value)];
        try { this.pin({ serverId: s.id, tool: t && t.name, arg: argSel.value, label: label.value }); VexBench.toast('Tool pinned'); dlg.close(); VexSettingsGroups.inject(); }
        catch (err) { VexBench.fail(err); }
      }, { primary: true }));
    await loadTools();
  },
  settingsRows(box) {
    box.appendChild(VexSettingsGroup.note('Pin up to five tools of your own MCP servers (HTTP). Select words on a page, right-click > "<tool>: selection", and confirm the exact request before anything is sent.'));
    for (const p of this.list()) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;align-items:center;margin:4px 0';
      const t = document.createElement('span'); t.style.flex = '1'; t.textContent = p.label + '  (' + p.tool + ' <- ' + p.arg + ')';
      row.append(t, VexSettingsGroup.button('Unpin', () => { try { this.unpin(p.id); VexSettingsGroups.inject(); } catch (err) { VexBench.fail(err); } }, 'danger'));
      box.appendChild(row);
    }
    box.appendChild(VexSettingsGroup.button('Pin a tool...', () => this.pinDialog().catch(e => VexBench.fail(e))));
  },
};

if (typeof window !== 'undefined') {
  window.VexSelectionTools = VexSelectionTools;
  VexBench.register({
    id: 'selection-tools', title: 'Selection to my own MCP tools', hint: 'asks before every send',
    enabled: () => VexSelectionTools.enabled(), setEnabled: (on) => VexSelectionTools.setEnabled(on),
    settingsRows: (box) => VexSelectionTools.settingsRows(box), textItems: (sel, wv) => VexSelectionTools.textItems(sel, wv),
  });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSelectionTools };
