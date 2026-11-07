// === Agent policy and audit: the service and its window-side channels ===========
//
// Holds the saved policy (agent-policy.json in the profile), the daily call counts and the audit log,
// and offers one question to everything that drives Vex: check(caller, { tool, host }). The in-app agent
// asks through the agentpolicy:check channel; the MCP server (main/mcp-server-ipc.js) calls check() in
// process. The channels are for Vex's own window only (UI_ONLY_CHANNELS in main/ipc-policy.js); the
// caller name on a channel call is fixed here ("in-app agent"), so a window cannot log as an MCP client.
//
// Nothing here starts anything or reaches the network.

const path = require('path');
const policyLib = require('./agent-policy');
const { createAgentAudit } = require('./agent-audit');

const RESULT_FOR_REASON = { 'host-denied': 'denied-host', budget: 'denied-budget' };

function createAgentControl({ fs, dir, now = () => Date.now(), atomicWriteSync, log = (m) => console.error(m), offsetMinutes }) {
  const policyFile = path.join(dir, 'agent-policy.json');
  const audit = createAgentAudit({ fs, file: path.join(dir, 'agent-audit.jsonl'), now, log });
  const budget = policyLib.createBudget({ now, offsetMinutes });
  let policy = null;

  // A file that cannot be read or parsed gives the default (most restrictive) policy, and says so; the
  // broken file is left as it is until the person saves a policy again.
  function load() {
    let text;
    try { text = fs.readFileSync(policyFile, 'utf8'); }
    catch (e) {
      if (e.code !== 'ENOENT') log('[AgentPolicy] the policy file could not be read, the default policy is used: ' + e.message);
      return policyLib.defaultPolicy();
    }
    try { return policyLib.normalizePolicy(JSON.parse(text)); }
    catch (e) { log('[AgentPolicy] the policy file is damaged, the default policy is used: ' + e.message); return policyLib.defaultPolicy(); }
  }
  function get() { if (!policy) policy = load(); return policy; }
  function set(raw) {
    const next = policyLib.normalizePolicy(raw);
    atomicWriteSync(policyFile, JSON.stringify(next), { fsImpl: fs });
    policy = next;
    return next;
  }

  // One question, one count. A denied call is not counted against the day's budget.
  function check(caller, { tool, host = '', url = '' } = {}) {
    const h = host || policyLib.hostOfUrl(url);
    const answer = policyLib.decide(get(), { caller, tool, host: h, used: budget.used(caller) });
    if (answer.decision !== 'deny') budget.take(caller);
    return { ...answer, host: h };
  }

  const resultFor = (reason) => RESULT_FOR_REASON[reason] || 'denied-policy';
  return { get, set, check, audit, budget, resultFor };
}

// The channels. `isPrivate(event)` says whether a message comes from a private window; those are never
// written to the audit log (a private window's sites stay out of anything kept on disk).
function registerAgentControlIpc({ ipcMain, control, isPrivate = () => false, chooseExportFile, writeFile }) {
  const reply = (fn) => { try { return { ok: true, ...fn() }; } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; } };
  const view = () => ({ policy: control.get(), mcpDefaults: policyLib.MCP_TOOL_DEFAULTS, used: { mcp: control.budget.used('mcp'), agent: control.budget.used('agent') } });

  ipcMain.handle('agentpolicy:get', () => reply(view));
  ipcMain.handle('agentpolicy:set', (_e, raw) => reply(() => { control.set(raw); return view(); }));
  ipcMain.handle('agentpolicy:check', (event, req) => reply(() => {
    const answer = control.check('agent', { tool: req && req.tool, url: req && req.url });
    if (answer.decision === 'deny' && !isPrivate(event)) {
      control.audit.record({ caller: 'in-app agent', tool: req.tool, host: answer.host, decision: 'deny', result: control.resultFor(answer.reason) });
    }
    return { decision: answer.decision, reason: answer.reason };
  }));
  ipcMain.handle('agentaudit:record', (event, req) => reply(() => {
    if (isPrivate(event)) throw new Error('Nothing is logged from a private window');
    control.audit.record({ caller: 'in-app agent', tool: req.tool, url: req.url, decision: req.decision, result: req.result });
    return {};
  }));
  ipcMain.handle('agentaudit:list', (_e, limit) => reply(() => control.audit.list(limit)));
  ipcMain.handle('agentaudit:clear', () => reply(() => { control.audit.clear(); return {}; }));
  ipcMain.handle('agentaudit:export', async () => {
    try {
      const file = await chooseExportFile();
      if (!file) return { ok: true, canceled: true };
      await writeFile(file, control.audit.exportText());
      return { ok: true, canceled: false, file };
    } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });
}

module.exports = { createAgentControl, registerAgentControlIpc };
