// @vitest-environment jsdom
//
// Unit coverage for McpClient — the parts that don't need a live MCP server:
// server storage/validation and the JSON-vs-SSE response parser. The networked
// connect()/callTool() paths go through window.vex.apiRequest at runtime.

import { describe, it, expect, beforeEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');  // installs window.vexId, as index.html does
const { McpClient } = require('../../src/renderer/js/mcp-client.js');

beforeEach(() => {
  localStorage.clear();
  McpClient.load();
  globalThis.window.showToast = vi.fn();
  // reset internal server list via the public API
  McpClient.list().slice().forEach(s => McpClient.removeServer(s.id));
});

describe('McpClient server storage', () => {
  it('adds valid http(s) servers and persists them, the token in main only', async () => {
    globalThis.window.vex = { mcpAuthSet: vi.fn(async () => ({ ok: true, has: true })) };
    const s = await McpClient.addServer('Test', 'https://mcp.example.com/mcp', 'tok');
    expect(s).toBeTruthy();
    expect(McpClient.list()).toHaveLength(1);
    const saved = JSON.parse(localStorage.getItem('vex.mcpServers'))[0];
    expect(saved.url).toBe('https://mcp.example.com/mcp');
    // The token went to main (encrypted there) and never into localStorage.
    expect(window.vex.mcpAuthSet).toHaveBeenCalledWith(s.id, 'tok');
    expect(saved.hasAuth).toBe(true);
    expect(localStorage.getItem('vex.mcpServers')).not.toContain('tok');
  });

  it('does not add a server whose token main could not keep', async () => {
    globalThis.window.vex = { mcpAuthSet: vi.fn(async () => { throw new Error('This operation is unavailable in a private window'); }) };
    expect(await McpClient.addServer('Test', 'https://mcp.example.com/mcp', 'tok')).toBeNull();
    expect(McpClient.list()).toHaveLength(0);
  });

  it('moves a token saved the old way into main and drops it here', async () => {
    globalThis.window.vex = { mcpAuthSet: vi.fn(async () => ({ ok: true, has: true })) };
    localStorage.setItem('vex.mcpServers', JSON.stringify([{ id: 'mcp_old', name: 'Old', url: 'https://old.example/mcp', auth: 'secret-token' }]));
    McpClient.load();
    await new Promise(r => setTimeout(r, 0));
    expect(window.vex.mcpAuthSet).toHaveBeenCalledWith('mcp_old', 'secret-token');
    expect(localStorage.getItem('vex.mcpServers')).not.toContain('secret-token');
    expect(McpClient.list()[0].hasAuth).toBe(true);
  });

  it('names the server in the request so main adds its token', async () => {
    globalThis.window.vex = { mcpAuthSet: vi.fn(async () => ({ ok: true })), apiRequest: vi.fn(async () => ({ ok: true, status: 200, headers: {}, body: '{"jsonrpc":"2.0","id":1,"result":{}}' })) };
    const s = await McpClient.addServer('Test', 'https://mcp.example.com/mcp', 'tok');
    await McpClient.connect(s).catch(() => {});
    const req = window.vex.apiRequest.mock.calls[0][0];
    expect(req.mcpServer).toBe(s.id);
    expect(JSON.stringify(req.headers)).not.toContain('tok');
  });

  it('rejects non-http URLs', async () => {
    expect(await McpClient.addServer('Bad', 'ftp://nope')).toBeNull();
    expect(McpClient.list()).toHaveLength(0);
  });

  it('removes servers by id', async () => {
    const s = await McpClient.addServer('X', 'https://x.com/mcp');
    McpClient.removeServer(s.id);
    expect(McpClient.list()).toHaveLength(0);
  });
});

describe('McpClient._parseBody', () => {
  it('parses a plain JSON-RPC body', () => {
    const r = McpClient._parseBody('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}');
    expect(r.result.ok).toBe(true);
  });

  it('parses a JSON-RPC object out of an SSE stream', () => {
    const sse = 'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"tools":[]}}\n\n';
    const r = McpClient._parseBody(sse);
    expect(r.id).toBe(2);
    expect(Array.isArray(r.result.tools)).toBe(true);
  });

  it('returns null for unparseable bodies', () => {
    expect(McpClient._parseBody('not json at all')).toBeNull();
    expect(McpClient._parseBody('')).toBeNull();
  });
});

describe('McpClient agent integration', () => {
  // Drive a fake server through connect() so a session with tools exists, then
  // check the agent-facing tool defs + dispatch.
  async function connectFakeServer() {
    const s = await McpClient.addServer('Search', 'https://mcp.example.com/mcp', '');
    let call = 0;
    globalThis.window.vex = {
      apiRequest: vi.fn(async ({ body }) => {
        const method = JSON.parse(body).method;
        call++;
        if (method === 'initialize') return { ok: true, status: 200, headers: { 'mcp-session-id': 'sess-1' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'fake' } } }) };
        if (method === 'tools/list') return { ok: true, status: 200, headers: {}, body: JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'web_search', description: 'Search the web', inputSchema: { properties: { query: { type: 'string' } } } }] } }) };
        if (method === 'tools/call') return { ok: true, status: 200, headers: {}, body: JSON.stringify({ jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: 'result for ' + JSON.parse(body).params.arguments.query }] } }) };
        return { ok: true, status: 200, headers: {}, body: '{}' };
      }),
    };
    await McpClient.connect(s);
    return s;
  }

  it('exposes connected tools as namespaced agent tool defs', async () => {
    const s = await connectFakeServer();
    const defs = McpClient.agentToolDefs();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('mcp__' + s.id + '__web_search');
    expect(defs[0].parameters).toEqual({ query: 'string' });
    expect(defs[0].description).toContain('MCP');
  });

  it('agentCall routes a namespaced tool to the right server and flattens text', async () => {
    const s = await connectFakeServer();
    const out = await McpClient.agentCall('mcp__' + s.id + '__web_search', { query: 'cats' });
    expect(out).toBe('result for cats');
  });

  it('agentCall rejects non-MCP names and unknown servers', async () => {
    await expect(McpClient.agentCall('navigate', {})).rejects.toThrow();
    await expect(McpClient.agentCall('mcp__nope__x', {})).rejects.toThrow(/not connected/i);
  });

  it('agentToolDefs is empty when nothing is connected', () => {
    expect(McpClient.agentToolDefs()).toEqual([]);
  });
});
