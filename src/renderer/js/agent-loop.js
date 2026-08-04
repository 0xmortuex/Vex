// === Vex Agent Loop — orchestrates AI tool-calling ===
//
// Drives the agent's iterate-think-act cycle: pulls page state from
// DOMExtractor + PageContext, asks AIRouter for the next tool call, executes
// it via AgentExecutor, renders steps into the AI panel. Includes loop /
// stall detection so the agent stops re-spamming identical actions.
// Public API: AgentLoop (singleton — start, stop, isRunning, startHeadless),
// parseAgentResponse (free function, exported for tests),
// ToolCallHistory (class, exported for tests).
// Depends on AIRouter, AgentExecutor, DOMExtractor, PageContext,
// WebviewManager, AIPanel.

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
  { name: 'press_key', description: 'Press a key in the focused element — use Enter to submit a form or search box after typing', parameters: { key: 'Enter|Tab|Escape|Backspace|Delete|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown' } },
  { name: 'scroll', description: 'Scroll the page', parameters: { direction: 'up|down|top|bottom', amount: 'number (optional)' } },
  { name: 'extract_elements', description: 'Get all interactive elements with selectors', parameters: {} },
  { name: 'accessibility_tree', description: 'Get the page accessibility tree — shows structure, roles, labels and states (disabled, checked, expanded) that a selector list cannot convey. Prefer this when the page layout is unclear.', parameters: {} },
  { name: 'extract_text', description: 'Get page text content', parameters: { selector: 'string (optional)' } },
  { name: 'screenshot', description: 'Capture current page', parameters: {} },
  { name: 'list_tabs', description: 'List all open tabs', parameters: {} },
  { name: 'switch_tab', description: 'Switch to a tab', parameters: { tabId: 'string' } },
  { name: 'wait', description: 'Wait for element or time', parameters: { selector: 'string', ms: 'number' } },
  { name: 'search_in_page', description: 'Find text on page', parameters: { query: 'string' } },
  { name: 'finish', description: 'Task complete — give final answer', parameters: { summary: 'string' } },
  { name: 'ask_user', description: 'Ask user for clarification', parameters: { question: 'string' } }
];

const SAFE_TOOLS = ['extract_elements', 'accessibility_tree', 'extract_text', 'screenshot', 'list_tabs', 'scroll', 'wait', 'search_in_page'];

// System prompt for the direct-Anthropic path. The Cloudflare Worker builds
// its own prompt server-side, so this is only used when the user has supplied
// their own API key and Vex talks to the Messages API directly.
const AGENT_SYSTEM = [
  'You are Vex\'s browser agent. You control a real browser tab on the user\'s machine to accomplish their goal.',
  '',
  'How you see the page: each turn you get the current URL and title, a list of interactive elements with CSS selectors, and an accessibility outline showing structure, labels and states. Call screenshot when you need to see the page visually — layout, images, or anything the text does not capture.',
  '',
  'How you act: your clicks and keystrokes are real browser input events, so pages respond exactly as they would to the user. After typing into a search box or form field, press Enter with press_key — typing alone does not submit.',
  '',
  'Use the selectors given to you rather than guessing. If an element is not there, look again with extract_elements or accessibility_tree instead of retrying the same selector.',
  '',
  'Call finish as soon as the goal is met, with a summary answering what the user actually asked. Call ask_user only when you genuinely cannot proceed without an answer.',
  '',
  'Set intent to "risky" on any action that sends a message, makes a purchase, deletes something, or is otherwise hard to undo — the user is asked to confirm those.',
].join('\n');

// === Phase 18: Tool-call loop detection ===
// Stops the agent from calling the same (tool, args) pair more than MAX_IDENTICAL
// times in the last WINDOW calls. When tripped, we feed guidance back as the
// "tool result" so the model picks a different strategy instead of re-spawning.
class ToolCallHistory {
  constructor() {
    this.recentCalls = [];
    this.MAX_IDENTICAL = 2;
    this.WINDOW = 5;
  }
  _sig(tool, args) { return `${tool}::${JSON.stringify(args || {})}`; }
  add(tool, args, result) {
    this.recentCalls.push({
      signature: this._sig(tool, args),
      toolName: tool, args,
      result, at: Date.now()
    });
    if (this.recentCalls.length > 20) this.recentCalls.shift();
  }
  isStuckInLoop(tool, args) {
    const sig = this._sig(tool, args);
    const window = this.recentCalls.slice(-this.WINDOW);
    const identical = window.filter(c => c.signature === sig).length;
    return identical >= this.MAX_IDENTICAL;
  }
  loopGuidance(tool, args) {
    const sig = this._sig(tool, args);
    const matching = this.recentCalls.filter(c => c.signature === sig);
    const lastResult = matching.length ? matching[matching.length - 1].result : null;
    const resultPreview = typeof lastResult === 'string' ? lastResult :
      JSON.stringify(lastResult || {}).substring(0, 300);
    return {
      ok: false,
      loopPrevented: true,
      error: `LOOP DETECTED: You already called ${tool} with these exact arguments ${matching.length} time(s). The result won't change. Previous result: ${resultPreview}. DO NOT repeat this exact call. Change your approach: try a different tool, different arguments, or move to the next step using what you already know.`
    };
  }
  mostRepeated() {
    const counts = {};
    for (const c of this.recentCalls) counts[c.signature] = (counts[c.signature] || 0) + 1;
    let max = 0, best = null;
    for (const [sig, n] of Object.entries(counts)) if (n > max) { max = n; best = sig; }
    return best ? `${best} (${max}x)` : 'nothing repeated';
  }
  summarizeFailure(goal) {
    const calls = this.recentCalls;
    const uniqueTools = [...new Set(calls.map(c => c.toolName))];
    const urls = [...new Set(calls.filter(c => c.toolName === 'navigate').map(c => c.args?.url).filter(Boolean))];
    return `Couldn't complete: "${goal}"\n\nWhat I tried:\n• ${calls.length} tool calls using: ${uniqueTools.join(', ')}\n• Navigated to: ${urls.slice(0, 5).join(', ') || '(none)'}\n• Most repeated: ${this.mostRepeated()}\n\nSuggestion: break the task into smaller steps or be more specific.`;
  }
  reset() { this.recentCalls = []; }
}

const toolCallHistory = new ToolCallHistory();

// Parse agent response — handles fences, multiple field name variations.
// Hoisted to a free function so unit tests can require() it under Node.
function parseAgentResponse(raw) {
  if (!raw) return null;
  let str = String(raw).trim();
  if (!str) return null;

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

  if (!parsed || typeof parsed !== 'object') return null;

  // Normalize field names — AI might use any of these
  const tool = parsed.tool || parsed.toolName || parsed.tool_name || parsed.action || parsed.function_name || parsed.name;
  const parameters = parsed.parameters || parsed.params || parsed.arguments || parsed.args || {};
  const thought = parsed.thought || parsed.reasoning || parsed.reason || '';
  const intent = parsed.intent || 'action';

  if (!tool) return null;

  return { tool, parameters, thought, intent };
}

const AgentLoop = {
  _running: false,
  _mode: 'ask',
  _history: [],
  _maxIter: 15,

  _parseAgentResponse(raw) {
    if (raw) console.log('[Agent] Raw AI response:', String(raw).trim().substring(0, 500));
    const result = parseAgentResponse(raw);
    if (result) console.log('[Agent] Parsed:', { tool: result.tool, thought: (result.thought || '').substring(0, 60), intent: result.intent });
    return result;
  },

  // === Direct Anthropic backend ===========================================
  // When the user has supplied their own API key, the agent talks to the
  // Messages API directly and gets real tool_use blocks back. That removes the
  // whole class of failure where the model wrote valid-looking JSON that
  // parseAgentResponse couldn't recover from a fenced code block.
  //
  // The Cloudflare Worker path is untouched and is still used when no key is
  // configured, so nothing regresses for existing users.
  _claudeMsgs: [],
  _claudeOn: false,

  async _claudeCheck() {
    try {
      if (!window.vex?.claude) return false;
      const s = await window.vex.claude.status();
      return !!(s && s.configured);
    } catch { return false; }
  },

  _claudeStart(goal) {
    this._claudeMsgs = [{ role: 'user', content: [{ type: 'text', text: 'Goal: ' + goal }] }];
  },

  // Build the user turn carrying this iteration's page state (and the previous
  // tool's result, as a tool_result block when there is one to answer).
  _claudeAppendState(pageContext, axText, lastToolUseId, lastResult) {
    const blocks = [];

    if (lastToolUseId) {
      const payload = typeof lastResult?.result === 'string'
        ? lastResult.result
        : JSON.stringify(lastResult?.result ?? lastResult ?? {}).slice(0, 12000);
      const content = [{ type: 'text', text: lastResult?.ok ? payload : ('Error: ' + (lastResult?.error || 'failed')) }];

      // Screenshots ride back inside the tool_result, which is what lets the
      // model actually look at the page instead of being told a screenshot
      // happened somewhere.
      if (lastResult?.image?.data) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: lastResult.image.mediaType || 'image/jpeg', data: lastResult.image.data },
        });
      }
      blocks.push({
        type: 'tool_result',
        tool_use_id: lastToolUseId,
        content,
        ...(lastResult?.ok ? {} : { is_error: true }),
      });
    }

    let state = '';
    if (pageContext) {
      state += `Current page: ${pageContext.title || '(untitled)'}\nURL: ${pageContext.url || '(unknown)'}\n`;
      if (Array.isArray(pageContext.elements) && pageContext.elements.length) {
        state += `\nInteractive elements:\n${JSON.stringify(pageContext.elements).slice(0, 12000)}\n`;
      }
      if (axText) state += `\nAccessibility outline:\n${axText.slice(0, 12000)}\n`;
    } else {
      state += 'No page is loaded in the active tab.\n';
    }
    blocks.push({ type: 'text', text: state });

    this._claudeMsgs.push({ role: 'user', content: blocks });
    this._claudeCompact();
  },

  // Keep the transcript from ballooning. Dropping whole messages is not an
  // option: every tool_result must keep the tool_use it answers, and deleting
  // the assistant turn that owns one makes the next request fail outright.
  // Assistant turns are also replayed verbatim because thinking blocks must
  // come back unmodified. So instead of removing anything, this shrinks the
  // bulky parts of older *user* turns in place — old screenshots and stale
  // page snapshots, which the model has no reason to re-read once it has
  // moved on. Structure and pairing survive untouched.
  _claudeCompact(keepRecent = 6, maxChars = 600) {
    const trimBlock = (b) => {
      if (!b || typeof b !== 'object') return b;
      if (b.type === 'image') return { type: 'text', text: '[screenshot from an earlier step — omitted]' };
      if (b.type === 'text' && typeof b.text === 'string' && b.text.length > maxChars) {
        return { type: 'text', text: b.text.slice(0, maxChars) + '\n… (earlier page state trimmed)' };
      }
      if (b.type === 'tool_result' && Array.isArray(b.content)) {
        return { ...b, content: b.content.map(trimBlock) };
      }
      return b;
    };

    const cutoff = this._claudeMsgs.length - keepRecent;
    for (let i = 1; i < cutoff; i++) {
      const m = this._claudeMsgs[i];
      if (!m || m.role !== 'user' || !Array.isArray(m.content)) continue;
      m.content = m.content.map(trimBlock);
    }
  },

  async _claudeTurn(tools) {
    const res = await window.vex.claude.message({
      requestId: 'agent-' + Date.now(),
      mode: 'agent',
      system: AGENT_SYSTEM,
      messages: this._claudeMsgs,
      tools,
    });

    if (!res.ok) {
      if (res.refusal) {
        throw new Error('Claude declined this request' + (res.refusal.category ? ` (${res.refusal.category})` : '') + '. ' + (res.refusal.explanation || ''));
      }
      throw new Error(res.error || 'Request failed');
    }

    // Echo the assistant turn back verbatim next time — thinking blocks must
    // be replayed unmodified or the API rejects the follow-up.
    this._claudeMsgs.push({ role: 'assistant', content: res.content });

    const tu = res.toolUses[0];
    if (!tu) {
      // No tool call means the model answered in prose — treat that as the
      // final answer rather than an error.
      return { tool: 'finish', parameters: { summary: res.text || 'Done' }, thought: '', intent: 'action', _noTool: true };
    }

    const params = { ...(tu.input || {}) };
    const intent = params.intent || 'action';
    delete params.intent;

    return { tool: tu.name, parameters: params, thought: res.text || res.thinking || '', intent, _toolUseId: tu.id };
  },

  async start(goal, mode) {
    if (this._running) { window.showToast?.('Agent already running'); return; }
    this._running = true;
    this._mode = mode || 'ask';
    this._history = [];
    toolCallHistory.reset();
    document.getElementById('ai-send-agent')?.classList.add('running');

    this._renderStep('agent-start', 'Agent started: ' + goal, 'info');

    // Pick the backend once per run so the transcript stays on one model.
    this._claudeOn = await this._claudeCheck();
    if (this._claudeOn) this._claudeStart(goal);

    // Attach the debugger so clicks and keystrokes are trusted events. If it
    // can't attach — DevTools open on this tab is the usual reason — say so
    // once and let the executor fall back to scripted interaction.
    AgentExecutor._cdpOk = true;
    const startWv = WebviewManager.getActiveWebview();
    if (startWv && typeof AgentCDP !== 'undefined' && AgentCDP.available()) {
      const att = await AgentCDP.attach(startWv);
      if (!att.ok) {
        AgentExecutor._cdpOk = false;
        this._renderStep('cdp', 'Using scripted input — ' + att.error + ' Some sites may not respond.', 'warn');
      }
    } else {
      AgentExecutor._cdpOk = false;
    }

    if (typeof AgentIndicator !== 'undefined') AgentIndicator.show(this._claudeOn ? 'Claude' : 'Vex AI');

    try {
      let iteration = 0;
      let lastResult = null;
      // Set when the model's decision came back as a real tool_use block, so
      // the next turn can answer it with a matching tool_result.
      let lastToolUseId = null;

      // Main converts these to JSON Schema. The list is identical every turn,
      // which is what lets the prompt cache hold across iterations.
      const allTools = [...AGENT_TOOLS, ...(typeof McpClient !== 'undefined' ? McpClient.agentToolDefs() : [])];
      const claudeTools = this._claudeOn ? allTools : [];
      // Phase 18: stall detection — stop if URL + tool combo stays the same
      // for STALL_THRESHOLD consecutive iterations.
      let stallCounter = 0;
      let lastProgressMarker = null;
      const STALL_THRESHOLD = 3;

      while (iteration < this._maxIter && this._running) {
        iteration++;

        // Get current page state
        const wv = WebviewManager.getActiveWebview();
        let pageContext = null;
        let axText = '';
        if (wv) {
          try {
            const dom = await DOMExtractor.extractInteractiveElements(wv);
            const text = await PageContext.extractPageContext(wv);
            pageContext = { url: dom.url, title: dom.title, elements: dom.elements, text: text?.text || '' };
          } catch {}
          // The accessibility outline is best-effort: it needs CDP, and a run
          // without it is still perfectly workable.
          if (AgentExecutor._cdpOk && typeof AXSnapshot !== 'undefined') {
            try {
              const snap = await AXSnapshot.capture(wv, { maxLines: 250 });
              if (snap.ok) axText = snap.text;
            } catch {}
          }
        }

        this._renderStep('thinking', 'Thinking... (step ' + iteration + ')', 'loading');

        let decision;
        try {
          if (this._claudeOn) {
            this._claudeAppendState(pageContext, axText, lastToolUseId, lastResult);
            decision = await this._claudeTurn(claudeTools);
          } else {
            // Cloudflare Worker path — unchanged.
            const data = await AIRouter.callAI('agent', {
              userGoal: goal,
              pageContext,
              availableTools: allTools,
              conversationHistory: this._history.slice(-20),
              lastToolResult: lastResult
            });
            document.querySelector('.agent-step-thinking')?.remove();
            decision = this._parseAgentResponse(data.result);
            if (!decision || !decision.tool) {
              console.error('[Agent] Full raw response:', data.result);
              this._renderError('AI did not return a valid tool call', data.result);
              break;
            }
          }
        } catch (err) {
          document.querySelector('.agent-step-thinking')?.remove();
          this._renderStep('error', 'Error: ' + (err.message || 'Request failed'), 'error');
          break;
        }

        document.querySelector('.agent-step-thinking')?.remove();
        lastToolUseId = decision._toolUseId || null;

        this._history.push({ role: 'assistant', content: JSON.stringify(decision) });

        // Handle finish
        if (decision.tool === 'finish') {
          this._renderStep('finish', decision.parameters?.summary || 'Task complete', 'success');
          break;
        }

        // Handle ask_user
        if (decision.tool === 'ask_user') {
          // Native prompt() is disabled in Electron's renderer (always
          // returned null, so the agent never actually got an answer).
          const answer = await vexPrompt({ title: 'The agent has a question', message: decision.parameters?.question || 'What should I do?', okLabel: 'Answer' });
          this._history.push({ role: 'user', content: answer || '' });
          lastResult = { ok: true, result: 'The user answered: ' + (answer || '(no answer)') };
          this._renderStep('ask', 'Asked: ' + (decision.parameters?.question || ''), 'info');
          continue;
        }

        // Check permission
        const allowed = await this._checkPermission(decision);
        if (!allowed) {
          this._renderStep('denied', 'Action denied by user', 'error');
          break;
        }

        // Phase 18: Loop prevention — intercept before executing
        if (toolCallHistory.isStuckInLoop(decision.tool, decision.parameters || {})) {
          lastResult = toolCallHistory.loopGuidance(decision.tool, decision.parameters || {});
          this._history.push({ role: 'user', content: JSON.stringify({ toolResult: lastResult }) });
          this._renderStep('loop-prevent', 'Loop detected — ' + decision.tool + ' called too many times with same args. Nudging agent to try a different approach.', 'warn');
          // Don't execute; let model re-plan on the next iteration.
          continue;
        }

        // Execute
        this._renderStep('action', `${decision.thought || ''}\n→ ${decision.tool}(${JSON.stringify(decision.parameters || {})})`, 'action');
        if (typeof AgentIndicator !== 'undefined') AgentIndicator.setStep('is running ' + decision.tool);
        lastResult = await AgentExecutor.executeTool(decision.tool, decision.parameters || {});
        toolCallHistory.add(decision.tool, decision.parameters || {}, lastResult);
        this._history.push({ role: 'user', content: JSON.stringify({ toolResult: lastResult }) });

        if (lastResult.ok) {
          this._renderStep('result', typeof lastResult.result === 'string' ? lastResult.result : 'Done', 'success');
        } else {
          this._renderStep('result', 'Failed: ' + (lastResult.error || 'Unknown error'), 'error');
        }

        // Phase 18: Stall detection — same URL + same tool for N iterations = done
        const currentUrl = pageContext?.url || '';
        const marker = `${currentUrl}::${decision.tool}`;
        if (marker === lastProgressMarker) {
          stallCounter++;
          if (stallCounter >= STALL_THRESHOLD) {
            this._renderStep('stall', 'Agent appears stuck on ' + decision.tool + ' at ' + (currentUrl || 'this page') + '. Stopping.', 'warn');
            this._renderStep('summary', toolCallHistory.summarizeFailure(goal), 'info');
            break;
          }
        } else {
          stallCounter = 0;
          lastProgressMarker = marker;
        }

        // Brief pause between actions
        await new Promise(r => setTimeout(r, 300));
      }

      if (iteration >= this._maxIter) {
        this._renderStep('error', 'Max iterations reached', 'error');
        this._renderStep('summary', toolCallHistory.summarizeFailure(goal), 'info');
      }
    } catch (err) {
      this._renderStep('error', 'Agent error: ' + err.message, 'error');
    }

    this._running = false;
    await this._teardown();
    document.getElementById('ai-send-agent')?.classList.remove('running');
    document.getElementById('ai-stop-agent')?.classList.remove('visible');
    this._renderStep('end', 'Agent finished', 'info');
  },

  // Release the debugger and drop the overlay. Detaching matters: while the
  // agent holds the debugger, DevTools can't open on that tab.
  async _teardown() {
    try { if (typeof AgentCDP !== 'undefined') await AgentCDP.detach(); } catch {}
    try { if (typeof AgentIndicator !== 'undefined') AgentIndicator.hide(); } catch {}
    this._claudeMsgs = [];
  },

  stop() {
    this._running = false;
    this._teardown();
    document.getElementById('ai-send-agent')?.classList.remove('running');
    document.getElementById('ai-stop-agent')?.classList.remove('visible');
  },
  isRunning() { return this._running; },

  async _checkPermission(decision) {
    const intent = decision.intent || 'action';
    const isSafe = SAFE_TOOLS.includes(decision.tool);

    if (this._mode === 'auto') {
      return intent !== 'risky' || vexConfirm({ title: 'Risky agent action', message: decision.tool + '\n\n' + (decision.thought || ''), okLabel: 'Proceed', danger: true });
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

  // Live token stream from the direct-Anthropic path. Registered once; the
  // handler is a no-op whenever no "thinking" bubble is on screen, so it costs
  // nothing on the worker path.
  _deltaWired: false,
  _wireDeltas() {
    if (this._deltaWired || !window.vex?.claude?.onDelta) return;
    this._deltaWired = true;
    window.vex.claude.onDelta((d) => {
      const live = document.querySelector('.agent-step-thinking .agent-live');
      if (!live || !d || !d.text) return;
      // Thinking summaries and answer text both land here; the summary is the
      // useful one to surface while the model is still deciding what to do.
      live.textContent = (live.textContent + d.text).slice(-600);
      const c = document.getElementById('ai-messages');
      if (c) c.scrollTop = c.scrollHeight;
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
      el.innerHTML = AIPanel._esc(text) + ' <span class="ai-spinner"></span>'
        + '<div class="agent-live" style="margin-top:6px;font-size:11px;color:var(--text-muted);white-space:pre-wrap"></div>';
      container.appendChild(el);
      container.scrollTop = container.scrollHeight;
      this._wireDeltas();
      return;
    }

    const el = document.createElement('div');
    el.className = 'ai-msg assistant agent-step-' + style;
    const prefix = style === 'success' ? '\u2713 ' : style === 'error' ? '\u2717 ' : style === 'action' ? '\u2192 ' : '';
    el.innerHTML = '<div class="agent-step">' + prefix + AIPanel._esc(text).replace(/\n/g, '<br>') + '</div>';
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  },

  // Headless agent — runs without UI, returns result. Used by Scheduler.
  // Uses the same backend selection as the interactive run, so a user who
  // configured only an Anthropic key still gets working scheduled tasks.
  async startHeadless(goal, mode, opts = {}) {
    const maxIter = opts.maxIterations || 15;
    const history = [];
    let lastResult = null;
    let lastToolUseId = null;

    const allTools = [...AGENT_TOOLS, ...(typeof McpClient !== 'undefined' ? McpClient.agentToolDefs() : [])];
    const useClaude = await this._claudeCheck();
    if (useClaude) this._claudeStart(goal);

    AgentExecutor._cdpOk = true;
    const startWv = WebviewManager.getActiveWebview();
    if (startWv && typeof AgentCDP !== 'undefined' && AgentCDP.available()) {
      const att = await AgentCDP.attach(startWv);
      if (!att.ok) AgentExecutor._cdpOk = false;
    } else {
      AgentExecutor._cdpOk = false;
    }

    try {
      for (let i = 0; i < maxIter; i++) {
        const wv = WebviewManager.getActiveWebview();
        let pageContext = null;
        let axText = '';
        if (wv) {
          try {
            const dom = await DOMExtractor.extractInteractiveElements(wv);
            const text = await PageContext.extractPageContext(wv);
            pageContext = { url: dom.url, title: dom.title, elements: dom.elements, text: text?.text || '' };
          } catch {}
          if (AgentExecutor._cdpOk && typeof AXSnapshot !== 'undefined') {
            try {
              const snap = await AXSnapshot.capture(wv, { maxLines: 250 });
              if (snap.ok) axText = snap.text;
            } catch {}
          }
        }

        let decision;
        if (useClaude) {
          this._claudeAppendState(pageContext, axText, lastToolUseId, lastResult);
          decision = await this._claudeTurn(allTools);
        } else {
          const data = await AIRouter.callAI('agent', {
            userGoal: goal, pageContext,
            availableTools: allTools, conversationHistory: history.slice(-20), lastToolResult: lastResult
          });
          decision = this._parseAgentResponse(data.result);
        }
        if (!decision?.tool) throw new Error('AI returned invalid response');
        lastToolUseId = decision._toolUseId || null;

        history.push({ role: 'assistant', content: JSON.stringify(decision) });

        if (decision.tool === 'finish') {
          return { summary: decision.parameters?.summary || 'Done', iterations: i + 1 };
        }
        if (decision.tool === 'ask_user') {
          throw new Error('Scheduled task needs user input: ' + (decision.parameters?.question || ''));
        }
        if (decision.intent === 'risky') {
          throw new Error('Risky action (' + decision.tool + ') aborted for safety');
        }

        lastResult = await AgentExecutor.executeTool(decision.tool, decision.parameters || {});
        history.push({ role: 'user', content: JSON.stringify({ toolResult: lastResult }) });
        await new Promise(r => setTimeout(r, 300));
      }

      return { summary: 'Task reached max iterations', iterations: maxIter };
    } finally {
      // Always release the debugger — a scheduled run that threw would
      // otherwise leave DevTools unusable on that tab until restart.
      await this._teardown();
    }
  }
};

// Renderer-safe export: when the file is loaded by Node (vitest) module is
// defined and we expose the pure helpers; the <script>-tag path leaves the
// existing globals untouched.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseAgentResponse, ToolCallHistory };
}
