// === Vex Agent Loop — orchestrates AI tool-calling ===

const AGENT_TOOLS = [
  { name: 'navigate', description: 'Navigate current tab to a URL', parameters: { url: 'string' } },
  { name: 'new_tab', description: 'Open a new tab', parameters: { url: 'string' } },
  { name: 'close_tab', description: 'Close a tab', parameters: { tabId: 'string' } },
  { name: 'go_back', description: 'Go back in history', parameters: {} },
  { name: 'go_forward', description: 'Go forward in history', parameters: {} },
  { name: 'reload', description: 'Reload current tab', parameters: {} },
  { name: 'click', description: 'Click an element by selector', parameters: { selector: 'string' } },
  { name: 'type_text', description: 'Type into an input field', parameters: { selector: 'string', text: 'string', clearFirst: 'boolean' } },
  { name: 'select_option', description: 'Select dropdown option', parameters: { selector: 'string', value: 'string' } },
  { name: 'scroll', description: 'Scroll the page', parameters: { direction: 'up|down|top|bottom', amount: 'number' } },
  { name: 'extract_elements', description: 'Get all interactive elements with selectors', parameters: {} },
  { name: 'extract_text', description: 'Get page text content', parameters: { selector: 'string (optional)' } },
  { name: 'screenshot', description: 'Capture current page', parameters: {} },
  { name: 'list_tabs', description: 'List all open tabs', parameters: {} },
  { name: 'switch_tab', description: 'Switch to a tab', parameters: { tabId: 'string' } },
  { name: 'wait', description: 'Wait for element or time', parameters: { selector: 'string', ms: 'number' } },
  { name: 'search_in_page', description: 'Find text on page', parameters: { query: 'string' } },
  { name: 'finish', description: 'Task complete — give final answer', parameters: { summary: 'string' } },
  { name: 'ask_user', description: 'Ask user for clarification', parameters: { question: 'string' } }
];

const SAFE_TOOLS = ['extract_elements', 'extract_text', 'screenshot', 'list_tabs', 'scroll', 'wait', 'search_in_page'];

const AgentLoop = {
  _running: false,
  _mode: 'ask',
  _history: [],
  _maxIter: 15,

  // Parse agent response — handles fences, multiple field name variations
  _parseAgentResponse(raw) {
    if (!raw) return null;
    let str = raw.trim();
    console.log('[Agent] Raw AI response:', str.substring(0, 500));

    // Strip markdown fences
    str = str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

    let parsed = null;
    try {
      parsed = JSON.parse(str);
    } catch {
      // Try extracting JSON object from within text
      const m = str.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
    }

    if (!parsed || typeof parsed !== 'object') {
      console.error('[Agent] Could not parse JSON. Keys:', parsed ? Object.keys(parsed) : 'null');
      return null;
    }

    // Normalize field names — AI might use any of these
    const tool = parsed.tool || parsed.toolName || parsed.tool_name || parsed.action || parsed.function_name || parsed.name;
    const parameters = parsed.parameters || parsed.params || parsed.arguments || parsed.args || {};
    const thought = parsed.thought || parsed.reasoning || parsed.reason || '';
    const intent = parsed.intent || 'action';

    if (!tool) {
      console.error('[Agent] No tool field found. Keys:', Object.keys(parsed));
      return null;
    }

    console.log('[Agent] Parsed:', { tool, thought: thought.substring(0, 60), intent });
    return { tool, parameters, thought, intent };
  },

  async start(goal, mode) {
    if (this._running) { window.showToast?.('Agent already running'); return; }
    this._running = true;
    this._mode = mode || 'ask';
    this._history = [];
    document.getElementById('ai-send-agent')?.classList.add('running');

    this._renderStep('agent-start', 'Agent started: ' + goal, 'info');

    try {
      let iteration = 0;
      let lastResult = null;

      while (iteration < this._maxIter && this._running) {
        iteration++;

        // Get current page state
        const wv = WebviewManager.getActiveWebview();
        let pageContext = null;
        if (wv) {
          try {
            const dom = await DOMExtractor.extractInteractiveElements(wv);
            const text = await PageContext.extractPageContext(wv);
            pageContext = { url: dom.url, title: dom.title, elements: dom.elements, text: text?.text || '' };
          } catch {}
        }

        this._renderStep('thinking', 'Thinking... (step ' + iteration + ')', 'loading');

        // Ask AI for next action
        const res = await fetch(AI_WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'agent',
            userGoal: goal,
            pageContext,
            availableTools: AGENT_TOOLS,
            conversationHistory: this._history.slice(-20),
            lastToolResult: lastResult
          })
        });

        // Remove thinking indicator
        document.querySelector('.agent-step-thinking')?.remove();

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Request failed' }));
          this._renderStep('error', 'Error: ' + (err.error || 'Request failed'), 'error');
          break;
        }

        const data = await res.json();
        const decision = this._parseAgentResponse(data.result);

        if (!decision || !decision.tool) {
          console.error('[Agent] Full raw response:', data.result);
          this._renderError('AI did not return a valid tool call', data.result);
          break;
        }

        this._history.push({ role: 'assistant', content: JSON.stringify(decision) });

        // Handle finish
        if (decision.tool === 'finish') {
          this._renderStep('finish', decision.parameters?.summary || 'Task complete', 'success');
          break;
        }

        // Handle ask_user
        if (decision.tool === 'ask_user') {
          const answer = prompt(decision.parameters?.question || 'What should I do?');
          this._history.push({ role: 'user', content: answer || '' });
          lastResult = { userAnswer: answer || '' };
          this._renderStep('ask', 'Asked: ' + (decision.parameters?.question || ''), 'info');
          continue;
        }

        // Check permission
        const allowed = await this._checkPermission(decision);
        if (!allowed) {
          this._renderStep('denied', 'Action denied by user', 'error');
          break;
        }

        // Execute
        this._renderStep('action', `${decision.thought || ''}\n→ ${decision.tool}(${JSON.stringify(decision.parameters || {})})`, 'action');
        lastResult = await AgentExecutor.executeTool(decision.tool, decision.parameters || {});
        this._history.push({ role: 'user', content: JSON.stringify({ toolResult: lastResult }) });

        if (lastResult.ok) {
          this._renderStep('result', typeof lastResult.result === 'string' ? lastResult.result : 'Done', 'success');
        } else {
          this._renderStep('result', 'Failed: ' + (lastResult.error || 'Unknown error'), 'error');
        }

        // Brief pause between actions
        await new Promise(r => setTimeout(r, 300));
      }

      if (iteration >= this._maxIter) {
        this._renderStep('error', 'Max iterations reached', 'error');
      }
    } catch (err) {
      this._renderStep('error', 'Agent error: ' + err.message, 'error');
    }

    this._running = false;
    document.getElementById('ai-send-agent')?.classList.remove('running');
    document.getElementById('ai-stop-agent')?.classList.remove('visible');
    this._renderStep('end', 'Agent finished', 'info');
  },

  stop() {
    this._running = false;
    document.getElementById('ai-send-agent')?.classList.remove('running');
    document.getElementById('ai-stop-agent')?.classList.remove('visible');
  },
  isRunning() { return this._running; },

  async _checkPermission(decision) {
    const intent = decision.intent || 'action';
    const isSafe = SAFE_TOOLS.includes(decision.tool);

    if (this._mode === 'auto') {
      return intent !== 'risky' || confirm('Risky action: ' + decision.tool + '\n\n' + (decision.thought || '') + '\n\nProceed?');
    }
    if (this._mode === 'ask') {
      if (isSafe) return true;
      return this._confirmAction(decision);
    }
    return true; // plan mode — already approved
  },

  _confirmAction(decision) {
    return new Promise(resolve => {
      const container = document.getElementById('ai-messages');
      if (!container) { resolve(false); return; }

      const el = document.createElement('div');
      el.className = 'ai-msg assistant';
      el.innerHTML = `
        <div class="agent-card">
          <div class="agent-thought">${AIPanel._esc(decision.thought || '')}</div>
          <div class="agent-tool-call"><strong>${decision.tool}</strong> <code>${AIPanel._esc(JSON.stringify(decision.parameters || {}))}</code></div>
          <div class="agent-btns">
            <button class="agent-approve">Approve</button>
            <button class="agent-deny">Deny</button>
          </div>
        </div>
      `;
      container.appendChild(el);
      container.scrollTop = container.scrollHeight;

      el.querySelector('.agent-approve').addEventListener('click', () => {
        el.querySelector('.agent-btns').innerHTML = '<span style="color:var(--success,#22c55e);font-size:11px">Approved</span>';
        resolve(true);
      });
      el.querySelector('.agent-deny').addEventListener('click', () => {
        el.querySelector('.agent-btns').innerHTML = '<span style="color:var(--danger);font-size:11px">Denied</span>';
        resolve(false);
      });
    });
  },

  _renderError(error, rawResponse) {
    const container = document.getElementById('ai-messages');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'ai-msg assistant agent-step-error';
    el.innerHTML = `
      <div style="color:var(--danger);font-weight:600;margin-bottom:6px">Agent Error</div>
      <div style="font-size:12px">${AIPanel._esc(error)}</div>
      ${rawResponse ? `<details style="margin-top:8px"><summary style="cursor:pointer;font-size:11px;color:var(--text-muted)">Show raw AI response</summary><pre style="font-size:10px;white-space:pre-wrap;background:var(--bg);padding:8px;border-radius:4px;margin-top:6px;max-height:200px;overflow:auto">${AIPanel._esc(String(rawResponse))}</pre></details>` : ''}
    `;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  },

  _renderStep(type, text, style) {
    const container = document.getElementById('ai-messages');
    if (!container) return;

    if (type === 'thinking') {
      const el = document.createElement('div');
      el.className = 'ai-msg assistant loading agent-step-thinking';
      el.innerHTML = AIPanel._esc(text) + ' <span class="ai-spinner"></span>';
      container.appendChild(el);
      container.scrollTop = container.scrollHeight;
      return;
    }

    const el = document.createElement('div');
    el.className = 'ai-msg assistant agent-step-' + style;
    const prefix = style === 'success' ? '\u2713 ' : style === 'error' ? '\u2717 ' : style === 'action' ? '\u2192 ' : '';
    el.innerHTML = '<div class="agent-step">' + prefix + AIPanel._esc(text).replace(/\n/g, '<br>') + '</div>';
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  }
};
