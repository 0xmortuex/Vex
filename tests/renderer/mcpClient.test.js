// @vitest-environment jsdom
//
// Unit coverage for McpClient — the parts that don't need a live MCP server:
// server storage/validation and the JSON-vs-SSE response parser. The networked
// connect()/callTool() paths go through window.vex.apiRequest at runtime.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { McpClient } = require('../../src/renderer/js/mcp-client.js');

beforeEach(() => {
  localStorage.clear();
  McpClient.load();
  globalThis.window.showToast = vi.fn();
  // reset internal server list via the public API
  McpClient.list().slice().forEach(s => McpClient.removeServer(s.id));
});

describe('McpClient server storage', () => {
  it('adds valid http(s) servers and persists them', () => {
    const s = McpClient.addServer('Test', 'https://mcp.example.com/mcp', 'tok');
    expect(s).toBeTruthy();
    expect(McpClient.list()).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem('vex.mcpServers'))[0].url).toBe('https://mcp.example.com/mcp');
  });

  it('rejects non-http URLs', () => {
    expect(McpClient.addServer('Bad', 'ftp://nope')).toBeNull();
    expect(McpClient.list()).toHaveLength(0);
  });

  it('removes servers by id', () => {
    const s = McpClient.addServer('X', 'https://x.com/mcp');
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
