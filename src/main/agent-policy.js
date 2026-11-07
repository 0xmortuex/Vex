// === Agent policy: one rulebook for every program that drives Vex ===============
//
// Two kinds of caller act on the person's Vex: the in-app agent (js/agent-executor.js) and, when the
// person switches it on, an outside MCP client (main/mcp-server.js). Both ask THIS module before a
// tool runs, so there is one place that says what is allowed. It is pure (no files, no clock, no
// Electron): the caller passes the policy, the call and today's count, and gets an answer.
//
// What the policy holds:
//   tools     per caller, per tool: allow, ask (the person is asked first) or deny
//   denyHosts addresses no caller may touch (one list, for every tool and every caller)
//   budget    calls per day per caller (0 = no limit)
//
// Defaults are the most restrictive that still leave each caller usable:
//   - an unknown MCP tool is denied; the four MCP tools have a fixed list;
//   - open_url can never be "allow": at best the person is asked every time (normalize() lifts it to ask);
//   - the MCP caller has a daily budget; the in-app agent keeps the behaviour it had before this
//     module existed (it already confirms risky steps itself) until the person tightens a rule.
//
// Anything malformed (a hand-edited file, a message from a window) is replaced by the default, never
// by something looser.

const CALLERS = ['mcp', 'agent'];
const DECISIONS = ['allow', 'ask', 'deny'];

// The four things an outside client can do, and what each does with no rule saved.
// Nothing types, clicks, reads cookies, the vault, the clipboard, downloads or files.
const MCP_TOOL_DEFAULTS = Object.freeze({ list_tabs: 'allow', read_page_text: 'allow', open_url: 'ask', search_history: 'allow' });
// A tool that can never be allowed without asking, whatever the saved file says.
const ALWAYS_ASK = Object.freeze(['open_url']);

const DEFAULT_BUDGET = Object.freeze({ mcp: 200, agent: 0 });
const MAX_BUDGET = 100000;
const MAX_DENY_HOSTS = 200;
const MAX_AGENT_RULES = 100;
const TOOL_RE = /^[a-z][a-z0-9_]{0,39}$/;
const HOST_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

// A host name from what the person typed: a bare host, "*.host", or a whole address. null when it is none.
function parseHost(input) {
  let s = String(input == null ? '' : input).trim().toLowerCase();
  if (!s || s.length > 2000) return null;
  if (s.includes('://')) {
    try { s = new URL(s).hostname; } catch { return null; }
  }
  s = s.replace(/^\*\./, '').replace(/^\.+/, '').replace(/\.+$/, '');
  if (s.startsWith('www.') && s.length > 4) s = s.slice(4);
  return HOST_RE.test(s) ? s : null;
}

// The host of an address for the audit log and the deny list. '' when it has none.
function hostOfUrl(url) {
  try { return new URL(String(url)).hostname.toLowerCase().replace(/\.+$/, ''); } catch { return ''; }
}

// example.com in the list covers example.com and every sub-domain, never a look-alike (badexample.com).
function hostMatches(list, host) {
  const h = String(host || '').toLowerCase().replace(/\.+$/, '');
  if (!h) return false;
  const bare = h.startsWith('www.') ? h.slice(4) : h;
  return (Array.isArray(list) ? list : []).some((entry) => typeof entry === 'string' && entry && (bare === entry || bare.endsWith('.' + entry)));
}

function defaultPolicy() {
  return { v: 1, tools: { mcp: { ...MCP_TOOL_DEFAULTS }, agent: {} }, denyHosts: [], budget: { ...DEFAULT_BUDGET } };
}

// Whatever was read or received, as a policy that is safe to use.
function normalizePolicy(raw) {
  const out = defaultPolicy();
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const tools = src.tools && typeof src.tools === 'object' ? src.tools : {};
  const mcp = tools.mcp && typeof tools.mcp === 'object' ? tools.mcp : {};
  for (const name of Object.keys(MCP_TOOL_DEFAULTS)) {
    if (DECISIONS.includes(mcp[name])) out.tools.mcp[name] = mcp[name];
    if (ALWAYS_ASK.includes(name) && out.tools.mcp[name] === 'allow') out.tools.mcp[name] = 'ask';
  }
  const agent = tools.agent && typeof tools.agent === 'object' ? tools.agent : {};
  let n = 0;
  for (const name of Object.keys(agent)) {
    if (n >= MAX_AGENT_RULES) break;
    if (TOOL_RE.test(name) && DECISIONS.includes(agent[name])) { out.tools.agent[name] = agent[name]; n++; }
  }
  const seen = new Set();
  for (const h of Array.isArray(src.denyHosts) ? src.denyHosts : []) {
    const host = parseHost(h);
    if (host && !seen.has(host) && seen.size < MAX_DENY_HOSTS) seen.add(host);
  }
  out.denyHosts = [...seen].sort();
  const budget = src.budget && typeof src.budget === 'object' ? src.budget : {};
  for (const caller of CALLERS) {
    const b = budget[caller];
    if (Number.isInteger(b) && b >= 0 && b <= MAX_BUDGET) out.budget[caller] = b;
  }
  return out;
}

// The answer for one call. `used` is how many calls this caller has already made today.
// { decision: 'allow' | 'ask' | 'deny', reason }, reason being a short code:
//   unknown-caller, unknown-tool, host-denied, tool-denied, budget, tool-ask, tool-allow
function decide(policyInput, { caller, tool, host = '', used = 0 } = {}) {
  const policy = normalizePolicy(policyInput);
  if (!CALLERS.includes(caller)) return { decision: 'deny', reason: 'unknown-caller' };
  if (typeof tool !== 'string' || !TOOL_RE.test(tool)) return { decision: 'deny', reason: 'unknown-tool' };
  if (caller === 'mcp' && !Object.prototype.hasOwnProperty.call(MCP_TOOL_DEFAULTS, tool)) return { decision: 'deny', reason: 'unknown-tool' };
  if (hostMatches(policy.denyHosts, host)) return { decision: 'deny', reason: 'host-denied' };
  const rule = policy.tools[caller][tool] || (caller === 'mcp' ? 'deny' : 'allow');
  if (rule === 'deny') return { decision: 'deny', reason: 'tool-denied' };
  const limit = policy.budget[caller];
  if (limit > 0 && !(Number.isInteger(used) && used >= 0 && used < limit)) return { decision: 'deny', reason: 'budget' };
  return rule === 'ask' ? { decision: 'ask', reason: 'tool-ask' } : { decision: 'allow', reason: 'tool-allow' };
}

// A day's number from a time, for the daily budget. `offsetMinutes` is what Date#getTimezoneOffset gives
// (passed in so a test does not depend on the machine's zone).
function dayKey(ms, offsetMinutes = new Date(ms).getTimezoneOffset()) {
  return Math.floor((ms - offsetMinutes * 60000) / 86400000);
}

// Counts calls per caller for the current day; the counts restart at midnight (and when Vex restarts).
function createBudget({ now = () => Date.now(), offsetMinutes } = {}) {
  let day = null;
  let counts = { mcp: 0, agent: 0 };
  const roll = () => {
    const d = dayKey(now(), offsetMinutes === undefined ? undefined : offsetMinutes);
    if (d !== day) { day = d; counts = { mcp: 0, agent: 0 }; }
  };
  return {
    used(caller) { roll(); return CALLERS.includes(caller) ? counts[caller] : 0; },
    take(caller) { roll(); if (CALLERS.includes(caller)) counts[caller]++; },
  };
}

module.exports = { CALLERS, DECISIONS, MCP_TOOL_DEFAULTS, ALWAYS_ASK, DEFAULT_BUDGET, MAX_BUDGET, MAX_DENY_HOSTS, TOOL_RE,
  parseHost, hostOfUrl, hostMatches, defaultPolicy, normalizePolicy, decide, dayKey, createBudget };
