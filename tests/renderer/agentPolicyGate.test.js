// @vitest-environment jsdom
//
// The in-app agent asks the agent policy (main/agent-policy.js) before every tool, and every step it takes
// is written to the activity log as a code, never as page text. Here the bridge is faked: what is pinned is
// the order (ask first, run second, log last) and that a failure to ask refuses the step.
import { describe, it, expect, vi, beforeEach } from 'vitest';
require('../../src/renderer/js/vex-utils.js');
globalThis.AgentTools = require('../../src/renderer/js/agent-tools.js').AgentTools;
const { AgentExecutor } = require('../../src/renderer/js/agent-executor.js');

let bridge;
beforeEach(() => {
  bridge = {
    agentPolicyCheck: vi.fn(async () => ({ ok: true, decision: 'allow', reason: 'tool-allow' })),
    agentAuditRecord: vi.fn(async () => ({ ok: true })),
  };
  window.vex = bridge;
  window.vexConfirm = vi.fn(async () => true);
  window.VexTabPolicy = { isPrivateWindow: false, canReadWebview: () => true, canShareTab: () => true };
  globalThis.WebviewManager = { getActiveWebview: () => ({ getURL: () => 'https://page.example/article?x=1' }) };
});

describe('the policy gate in front of every agent tool', () => {
  it('without the bridge (an older build) the tool simply runs as before', async () => {
    window.vex = {};
    const r = await AgentExecutor.executeTool('finish', { summary: 'done' }, {});
    expect(r).toEqual({ ok: true, result: { finished: true, summary: 'done' } });
  });

  it('allow: asks with the tool and the address, runs the tool, then logs an ok', async () => {
    const r = await AgentExecutor.executeTool('finish', { summary: 'done' }, {});
    expect(r.ok).toBe(true);
    expect(bridge.agentPolicyCheck).toHaveBeenCalledWith({ tool: 'finish', url: 'https://page.example/article?x=1' });
    expect(bridge.agentAuditRecord).toHaveBeenCalledTimes(1);
    expect(bridge.agentAuditRecord).toHaveBeenCalledWith({ tool: 'finish', url: 'https://page.example/article?x=1', decision: 'allow', result: 'ok' });
    expect(window.vexConfirm).not.toHaveBeenCalled();
  });

  it('uses the address the tool names when it names one', async () => {
    await AgentExecutor.executeTool('finish', { summary: 's', url: 'https://other.example/a' }, {});
    expect(bridge.agentPolicyCheck).toHaveBeenCalledWith({ tool: 'finish', url: 'https://other.example/a' });
  });

  it('deny: the tool does not run and the reason is given in plain words; main already logged it', async () => {
    bridge.agentPolicyCheck.mockResolvedValue({ ok: true, decision: 'deny', reason: 'host-denied' });
    const spy = vi.spyOn(AgentExecutor, '_executeToolChecked');
    const r = await AgentExecutor.executeTool('finish', { summary: 'done' }, {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/blocked list/);
    expect(spy).not.toHaveBeenCalled();
    expect(bridge.agentAuditRecord).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('ask, answered yes: runs once and logs ask-allowed', async () => {
    bridge.agentPolicyCheck.mockResolvedValue({ ok: true, decision: 'ask', reason: 'tool-ask' });
    const r = await AgentExecutor.executeTool('finish', { summary: 'done' }, {});
    expect(r.ok).toBe(true);
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    expect(bridge.agentAuditRecord).toHaveBeenCalledWith(expect.objectContaining({ decision: 'ask-allowed', result: 'ok' }));
  });

  it('ask, answered no: the tool does not run and ask-blocked is logged', async () => {
    bridge.agentPolicyCheck.mockResolvedValue({ ok: true, decision: 'ask', reason: 'tool-ask' });
    window.vexConfirm.mockResolvedValue(false);
    const spy = vi.spyOn(AgentExecutor, '_executeToolChecked');
    const r = await AgentExecutor.executeTool('finish', { summary: 'done' }, {});
    expect(r.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    expect(bridge.agentAuditRecord).toHaveBeenCalledWith(expect.objectContaining({ decision: 'ask-blocked', result: 'denied-user' }));
    spy.mockRestore();
  });

  it('ask with no way to ask (no confirm dialog) counts as no', async () => {
    bridge.agentPolicyCheck.mockResolvedValue({ ok: true, decision: 'ask', reason: 'tool-ask' });
    delete window.vexConfirm;
    const r = await AgentExecutor.executeTool('finish', { summary: 'done' }, {});
    expect(r.ok).toBe(false);
  });

  it('fails closed: when the policy cannot answer, the tool does not run', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const spy = vi.spyOn(AgentExecutor, '_executeToolChecked');
    bridge.agentPolicyCheck.mockRejectedValue(new Error('main is busy'));
    const r1 = await AgentExecutor.executeTool('finish', { summary: 'done' }, {});
    expect(r1.ok).toBe(false);
    expect(r1.error).toMatch(/could not be checked/);
    bridge.agentPolicyCheck.mockResolvedValue({ ok: false, error: 'nope' });
    const r2 = await AgentExecutor.executeTool('finish', { summary: 'done' }, {});
    expect(r2.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore(); err.mockRestore();
  });

  it('a private window is still checked but nothing is logged from it', async () => {
    window.VexTabPolicy.isPrivateWindow = true;
    const r = await AgentExecutor.executeTool('finish', { summary: 'done' }, {});
    expect(r.ok).toBe(true);
    expect(bridge.agentPolicyCheck).toHaveBeenCalledTimes(1);
    expect(bridge.agentAuditRecord).not.toHaveBeenCalled();
  });

  it('a log that cannot be written is reported, not swallowed, and does not undo the step', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const note = vi.fn();
    window.VexProblems = { note };
    bridge.agentAuditRecord.mockRejectedValue(new Error('disk full'));
    const r = await AgentExecutor.executeTool('finish', { summary: 'done' }, {});
    expect(r.ok).toBe(true);
    expect(note).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalled();
    delete window.VexProblems;
    err.mockRestore();
  });

  it('a tool that fails is logged as an error, and one that hit a private tab as denied-private', async () => {
    const spy = vi.spyOn(AgentExecutor, '_executeToolChecked');
    spy.mockResolvedValueOnce({ ok: false, error: 'It broke' });
    await AgentExecutor.executeTool('finish', {}, {});
    expect(bridge.agentAuditRecord).toHaveBeenLastCalledWith(expect.objectContaining({ result: 'error' }));
    spy.mockResolvedValueOnce({ ok: false, error: 'Private tabs are excluded from agent access' });
    await AgentExecutor.executeTool('finish', {}, {});
    expect(bridge.agentAuditRecord).toHaveBeenLastCalledWith(expect.objectContaining({ result: 'denied-private' }));
    spy.mockRestore();
  });
});
