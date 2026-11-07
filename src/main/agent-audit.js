// === The agent audit log: what was asked of Vex, never what was in it ===========
//
// One JSON line per tool call made by the in-app agent or by an outside MCP client, appended to
// agent-audit.jsonl in the profile folder. It exists so the person can see, after the fact, who asked
// Vex for what and what Vex answered.
//
// What a line holds (and nothing else; the fields are built here from fixed sets, so page text, a
// query, a token or an address path cannot get in by accident):
//   t         time (ISO, from the injected clock)
//   caller    "in-app agent" or "mcp:<client name>" (letters, digits and . _ - only, 40 characters at most)
//   tool      the tool's name (lower case words with underscores)
//   host      the site's host name only (no path, no query), or "" when the call names none
//   decision  allow | ask-allowed | ask-blocked | deny
//   result    one code from RESULTS (ok, error, denied-policy ...), never free text
//
// The file is appended to (fs.appendFileSync: one short line per call), never rewritten. When it grows
// past `maxBytes` it is renamed to agent-audit.jsonl.1 (replacing the previous .1), so the log keeps
// between one and two files' worth of the newest calls and never grows without limit.
//
// Everything outside (fs, clock) is injected so it runs under test without a disk.

const path = require('path');
const { hostOfUrl, TOOL_RE } = require('./agent-policy');

const DECISIONS = ['allow', 'ask-allowed', 'ask-blocked', 'deny'];
const RESULTS = ['ok', 'error', 'denied-policy', 'denied-host', 'denied-budget', 'denied-private', 'denied-sensitive', 'denied-user', 'busy', 'too-large', 'unavailable', 'invalid'];
const CALLER_RE = /^(?:in-app agent|mcp:[A-Za-z0-9][A-Za-z0-9 ._-]{0,39})$/;
const DEFAULT_MAX_BYTES = 512 * 1024;
const MAX_LIST = 1000;

// A client's own name as it may appear in the log: letters, digits, space . _ - ; at most 40; never empty.
function cleanClientName(name) {
  const s = String(name == null ? '' : name).replace(/[^A-Za-z0-9 ._-]/g, '').trim().slice(0, 40).trim();
  return /^[A-Za-z0-9]/.test(s) ? s : 'unnamed client';
}
const mcpCaller = (name) => 'mcp:' + cleanClientName(name);

// The line for a call. Throws on anything that is not in the fixed sets, so a mistake in a caller is
// found at once and a stray string is never written down as if it were a code.
function buildEntry({ caller, tool, host, url, decision, result }, at) {
  if (typeof caller !== 'string' || !CALLER_RE.test(caller)) throw new Error('Audit: the caller is not a known kind');
  if (typeof tool !== 'string' || !TOOL_RE.test(tool)) throw new Error('Audit: the tool name is not valid');
  if (!DECISIONS.includes(decision)) throw new Error('Audit: unknown decision ' + String(decision).slice(0, 30));
  if (!RESULTS.includes(result)) throw new Error('Audit: unknown result code ' + String(result).slice(0, 30));
  const h = host ? String(host).toLowerCase().replace(/\.+$/, '') : (url ? hostOfUrl(url) : '');
  return { t: new Date(at).toISOString(), caller, tool, host: /^[a-z0-9.-]{0,253}$/.test(h) ? h : '', decision, result };
}

function createAgentAudit({ fs, file, now = () => Date.now(), maxBytes = DEFAULT_MAX_BYTES, log = () => {} }) {
  if (!fs || !file) throw new Error('createAgentAudit needs fs and file');
  const older = file + '.1';

  function ensureFolder() { fs.mkdirSync(path.dirname(file), { recursive: true }); }

  // Throws when the log cannot be written. The MCP server calls this before it does anything, so a
  // call is never carried out that could not be written down.
  function assertWritable() { ensureFolder(); fs.appendFileSync(file, ''); }

  function rotateIfFull() {
    let size = 0;
    try { size = fs.statSync(file).size; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (size < maxBytes) return false;
    fs.rmSync(older, { force: true });
    fs.renameSync(file, older);
    return true;
  }

  function record(input) {
    const entry = buildEntry(input, now());
    ensureFolder();
    rotateIfFull();
    fs.appendFileSync(file, JSON.stringify(entry) + '\n');
    return entry;
  }

  function readLines(f) {
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    return text.split('\n').filter(Boolean);
  }

  // The newest `limit` entries, oldest first, from both files. A line that does not parse (a cut write
  // after a crash) is counted in `unreadable`, not hidden.
  function list(limit = 200) {
    const n = Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_LIST) : 200;
    const lines = [...readLines(older), ...readLines(file)];
    const entries = [];
    let unreadable = 0;
    for (const line of lines.slice(-n)) {
      try {
        const o = JSON.parse(line);
        if (o && typeof o === 'object' && typeof o.t === 'string') entries.push({ t: o.t, caller: String(o.caller), tool: String(o.tool), host: String(o.host || ''), decision: String(o.decision), result: String(o.result) });
        else unreadable++;
      } catch { unreadable++; }
    }
    return { entries, unreadable, total: lines.length };
  }

  // The log as one text, both files, oldest first, for the Export button.
  function exportText() { return [...readLines(older), ...readLines(file)].join('\n') + '\n'; }

  function clear() {
    fs.rmSync(file, { force: true });
    fs.rmSync(older, { force: true });
    log('[AgentAudit] cleared');
    return true;
  }

  return { record, list, exportText, clear, assertWritable, file };
}

module.exports = { createAgentAudit, buildEntry, cleanClientName, mcpCaller, DECISIONS, RESULTS, CALLER_RE, DEFAULT_MAX_BYTES };
