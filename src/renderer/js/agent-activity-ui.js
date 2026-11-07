// === AI agent activity: the policy and the activity log (Settings) ==============
//
// The window's side of main/agent-policy.js and main/agent-audit.js. One section in Settings:
//   - the rulebook for the built-in agent and for an outside MCP client: each tool allowed, asked
//     about every time, or blocked; a list of sites no agent may touch; a daily limit of steps;
//   - the activity log: who asked for what, with Export and Clear.
// Everything is decided and kept in main; this only shows it and sends the person's changes.
// Nothing here makes a request or starts anything. Loaded late (js/lazy-boot.js).

const AgentActivityUI = {
  ID: 'agent-activity',

  // The four things an outside client can ask for, in words.
  MCP_TOOLS: [
    ['list_tabs', 'List open tabs (titles and sites only)'],
    ['read_page_text', 'Read the text of a page'],
    ['open_url', 'Open an address in a new tab'],
    ['search_history', 'Search history (titles and addresses)'],
  ],
  // A few of the in-app agent's tools worth a rule of their own. Any tool it has can be named in the saved file.
  AGENT_TOOLS: ['navigate', 'new_tab', 'click', 'type_text', 'download_file', 'sign_in', 'change_setting', 'create_schedule', 'read_url', 'read_tab', 'save_note', 'vex_command'],
  CHOICES: [['allow', 'Allow'], ['ask', 'Ask each time'], ['deny', 'Block']],

  bridge() {
    const v = typeof window !== 'undefined' ? window.vex : null;
    if (!v || typeof v.agentPolicyGet !== 'function') throw new Error('The agent policy is not available in this build');
    return v;
  },
  async call(fn, ...args) {
    const r = await this.bridge()[fn](...args);
    if (!r || r.ok !== true) throw new Error((r && r.error) || 'The request failed');
    return r;
  },
  fail(what, err) {
    console.error('[AgentActivity] ' + what + ':', err);
    window.showToast?.(what + ': ' + ((err && err.message) || err), 'error');
  },

  open() {
    if (typeof SettingsUI === 'undefined' || typeof SettingsUI.openSection !== 'function') throw new Error('Settings is not available in this window');
    SettingsUI.openSection('setting-agent-activity');
  },

  render(body) {
    const S = VexSettingsGroups;
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const act = (text, fn, opts) => S.button(text, async () => { try { await fn(); } catch (err) { this.fail(text, err); } }, opts);
    const host = el('div');
    body.append(
      S.note('This is the rulebook for every program that drives Vex: the built-in AI agent and, if you switch it on, an outside AI tool over MCP. Each tool can be allowed, asked about each time, or blocked, and sites on the blocked list are off limits to all of them.'),
      host);
    const draw = async () => {
      let view;
      try { view = await this.call('agentPolicyGet'); }
      catch (err) { host.textContent = ''; host.appendChild(S.note('Could not read the agent policy: ' + err.message)); return; }
      const policy = view.policy;
      const save = async (mutate) => { mutate(policy); await this.call('agentPolicySet', policy); await draw(); };
      host.textContent = '';

      const choice = (value, onPick, label) => {
        const sel = el('select', 'set-input'); sel.setAttribute('aria-label', label);
        for (const [v, text] of this.CHOICES) sel.appendChild(Object.assign(el('option', '', text), { value: v, selected: v === value }));
        sel.addEventListener('change', () => { Promise.resolve(onPick(sel.value)).catch(err => this.fail(label, err)); });
        return sel;
      };
      const row = (...k) => { const r = el('div', 'vexsr-rule'); r.append(...k); return r; };

      host.appendChild(S.note('Outside AI tools (MCP). Opening an address always needs your answer, so it can be set to Ask or Block, never to Allow.'));
      for (const [tool, text] of this.MCP_TOOLS) {
        const current = policy.tools.mcp[tool] || view.mcpDefaults[tool];
        const sel = choice(current, (v) => save(p => { p.tools.mcp[tool] = v; }), text);
        if (tool === 'open_url') for (const o of [...sel.options]) if (o.value === 'allow') o.remove();
        host.appendChild(row(el('span', 'vexsr-host', text), sel));
      }

      host.appendChild(S.note('The built-in agent. A tool with no rule here keeps working as before; a rule makes it ask first or stops it.'));
      for (const tool of this.AGENT_TOOLS) {
        host.appendChild(row(el('span', 'vexsr-host', tool), choice(policy.tools.agent[tool] || 'allow', (v) => save(p => { if (v === 'allow') delete p.tools.agent[tool]; else p.tools.agent[tool] = v; }), tool)));
      }

      host.appendChild(S.note('Blocked sites. No agent or outside tool may read or open these, nor their sub-domains.'));
      const list = el('div', 'vexsr-list');
      for (const h of policy.denyHosts) {
        list.appendChild(row(el('span', 'vexsr-host', h), act('Remove', () => save(p => { p.denyHosts = p.denyHosts.filter(x => x !== h); }), { label: 'Remove ' + h + ' from the blocked sites' })));
      }
      if (!policy.denyHosts.length) list.appendChild(S.note('No blocked sites yet.'));
      const hostBox = el('input', 'set-input'); hostBox.type = 'text'; hostBox.spellcheck = false; hostBox.placeholder = 'example.com'; hostBox.setAttribute('aria-label', 'A site to block');
      host.append(list, row(hostBox, act('Block this site', () => {
        const value = hostBox.value.trim();
        if (!value) throw new Error('Type a site first');
        return save(p => { p.denyHosts = [...p.denyHosts, value]; });
      })));

      host.appendChild(S.note('Daily limit of steps (0 means no limit). Steps used today are counted since Vex started.'));
      const budgetRow = (caller, text) => {
        const box = el('input', 'set-input'); box.type = 'number'; box.min = '0'; box.max = '100000'; box.value = String(policy.budget[caller]); box.setAttribute('aria-label', text);
        box.addEventListener('change', () => {
          const n = Number(box.value);
          if (!Number.isInteger(n) || n < 0 || n > 100000) { this.fail(text, new Error('A whole number from 0 to 100000')); return; }
          save(p => { p.budget[caller] = n; }).catch(err => this.fail(text, err));
        });
        return row(el('span', 'vexsr-host', text + ' (' + view.used[caller] + ')'), box);
      };
      host.append(budgetRow('mcp', 'Outside tools per day'), budgetRow('agent', 'Built-in agent per day'));
    };
    draw();

    body.appendChild(S.note('Activity log. Each line is the time, who asked, the tool, the site, what Vex decided and a result code. It never keeps page text, search words, addresses beyond the site name, or secrets, it records nothing from private windows, and it stays on this computer. It lists only what went through these tools; it cannot show anything else that touched your browser.'));
    const logBox = el('pre'); logBox.style.cssText = 'white-space:pre-wrap;max-height:260px;overflow:auto;margin:8px 0;font-size:12px';
    const drawLog = async () => {
      const r = await this.call('agentAuditList', 100);
      const lines = r.entries.map(e => e.t.replace('T', ' ').slice(0, 19) + '  ' + e.caller + '  ' + e.tool + '  ' + (e.host || '-') + '  ' + e.decision + '  ' + e.result);
      if (r.unreadable) lines.push('Unreadable lines: ' + r.unreadable);
      logBox.textContent = lines.length ? lines.join('\n') : 'Nothing has been logged yet.';
    };
    drawLog().catch(err => { logBox.textContent = 'Could not read the log: ' + err.message; });
    const bar = el('div'); bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    bar.append(
      act('Refresh log', () => drawLog()),
      act('Export log', async () => { const r = await this.call('agentAuditExport'); if (!r.canceled) window.showToast?.('Log exported'); }),
      act('Clear log', async () => {
        if (!(await vexConfirm({ title: 'Clear the activity log?', message: 'Every line is deleted from this computer. This cannot be undone.', okLabel: 'Clear', danger: true }))) return;
        await this.call('agentAuditClear'); await drawLog(); window.showToast?.('Log cleared');
      }, { danger: true }));
    body.append(logBox, bar);
  },
};

if (typeof window !== 'undefined') {
  window.AgentActivityUI = AgentActivityUI;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'agent-activity', title: 'AI agent activity', keywords: 'agent policy audit log mcp allow block ask budget history who asked', before: 'about', render: (body) => AgentActivityUI.render(body) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'agent-activity', label: 'AI agent activity and rules', hint: 'See what the AI agent and outside tools did, and set what they may do', icon: 'shield', action: () => { try { AgentActivityUI.open(); } catch (err) { AgentActivityUI.fail('AI agent activity', err); } } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { AgentActivityUI };
