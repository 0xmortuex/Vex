// === Can this local model drive the agent? ==================================
//
// Settings › AI › "Test as agent". Whether a local model can work as an agent
// used to be found out the hard way: start a task and watch it fail. This asks
// the model four canned questions — the same request shape a real run sends,
// the same guide and tool list — and checks each reply is the right tool call.
//
// Nothing is executed and nothing leaves the machine: the page, the elements
// and the tool result in each case are made up here.
//
// Depends on AIRouter, Ollama, and agent-loop.js (AGENT_TOOLS, agentGuide,
// parseAgentResponse).

const AgentModelTest = {
  CASES: [
    {
      name: 'Researches with web_search instead of driving a search page',
      request: { userGoal: 'What is the tallest mountain in Europe, and how tall is it?', pageContext: null, lastToolResult: null },
      pass: (d) => d.tool === 'web_search' && !!String((d.parameters || {}).query || '').trim(),
    },
    {
      name: "Uses Vex's own timer, not a website",
      request: { userGoal: 'Start a 20 minute timer', pageContext: null, lastToolResult: null },
      pass: (d) => d.tool === 'start_timer' && /20/.test(String((d.parameters || {}).duration || '')),
    },
    {
      name: 'Clicks the right element on a page',
      request: {
        userGoal: 'Open the pricing page of this site',
        pageContext: {
          url: 'https://shop.example/', title: 'Example Shop',
          elements: [
            { selector: '[data-vex-id="vex-1"]', tag: 'a', text: 'Home' },
            { selector: '[data-vex-id="vex-2"]', tag: 'a', text: 'Pricing' },
            { selector: '[data-vex-id="vex-3"]', tag: 'a', text: 'Contact us' },
            { selector: '[data-vex-id="vex-4"]', tag: 'button', text: 'Sign in' },
          ],
          text: 'Example Shop. Everything you need, delivered. Home Pricing Contact us Sign in',
        },
        lastToolResult: null,
      },
      pass: (d) => (d.tool === 'click' && String((d.parameters || {}).selector || '').includes('vex-2'))
        || (d.tool === 'click_text' && /pricing/i.test(String((d.parameters || {}).text || '')))
        || (d.tool === 'navigate' && /pricing/i.test(String((d.parameters || {}).url || ''))),
    },
    {
      name: 'Finishes with the answer once it has read it',
      request: {
        userGoal: 'What is the capital of Australia?',
        pageContext: null,
        history: [{ role: 'assistant', content: JSON.stringify({ thought: 'Read the encyclopedia page.', tool: 'read_url', parameters: { url: 'https://encyclopedia.example/australia' }, intent: 'safe' }) }],
        lastToolResult: { ok: true, result: { title: 'Australia', url: 'https://encyclopedia.example/australia', text: 'Australia is a country in the Southern Hemisphere. Its capital city is Canberra, and its largest city is Sydney.' } },
      },
      pass: (d) => d.tool === 'finish' && /canberra/i.test(String((d.parameters || {}).summary || '')),
    },
  ],

  verdict(passed, total) {
    if (passed === total) return 'Good for agent work';
    if (passed === total - 1) return 'Usable — expect the odd retry';
    return 'Not reliable as an agent — pick a larger model';
  },

  // → { model, vision, contextLength, numCtx, cases: [{ name, ok, seconds, tool, promptTokens, error }], passed, verdict, warning }
  async run(model, onProgress) {
    if (!model) throw new Error('Pick a local model first');
    const info = await Ollama.show(model);
    const numCtx = AIRouter.agentNumCtx();
    const out = { model, vision: info.capabilities.includes('vision'), contextLength: info.contextLength, numCtx, cases: [], passed: 0, verdict: '', warning: '' };
    for (const c of this.CASES) {
      if (onProgress) onProgress(out.cases.length + 1, this.CASES.length, c.name);
      const row = { name: c.name, ok: false, seconds: 0, tool: '', promptTokens: 0, error: '' };
      const t0 = Date.now();
      try {
        const reply = await AIRouter.localAgent({
          userGoal: c.request.userGoal, pageContext: c.request.pageContext, lastToolResult: c.request.lastToolResult,
          availableTools: AGENT_TOOLS,
          conversationHistory: [{ role: 'user', content: agentGuide('auto') }, ...(c.request.history || [])],
          onMeta: (m) => { row.promptTokens = m.promptTokens; },
        }, model);
        const decision = parseAgentResponse(reply.result);
        if (!decision || !decision.tool) row.error = 'The reply was not a tool call';
        else { row.tool = decision.tool; row.ok = !!c.pass(decision); if (!row.ok) row.error = 'Chose ' + decision.tool + ' ' + JSON.stringify(decision.parameters || {}).slice(0, 120); }
      } catch (err) { row.error = (err && err.message) || 'The model call failed'; }
      row.seconds = Math.round((Date.now() - t0) / 100) / 10;
      out.cases.push(row);
    }
    out.passed = out.cases.filter(r => r.ok).length;
    out.verdict = this.verdict(out.passed, this.CASES.length);
    const biggest = Math.max(0, ...out.cases.map(r => r.promptTokens));
    // An EMPTY agent turn is already this big; pages and results come on top.
    if (biggest && biggest > numCtx * 0.6) out.warning = 'The instructions alone fill ' + Math.round(biggest / numCtx * 100) + '% of the ' + numCtx.toLocaleString() + '-token context. Raise "Agent context size" or long tasks will lose their instructions.';
    else if (out.contextLength && numCtx > out.contextLength) out.warning = 'This model was built for ' + out.contextLength.toLocaleString() + ' tokens of context; the agent asks for ' + numCtx.toLocaleString() + '.';
    return out;
  },

  // Models that only make embeddings cannot answer a turn at all.
  EMBED: /embed|bge-|minilm|nomic-embed/i,

  // The same test on every installed model, one at a time, each unloaded
  // afterwards so the graphics card is not left holding them all. Ranked by
  // turns passed, then by speed. Refused during a game: loading model after
  // model is exactly the load game mode exists to keep off the card.
  async runAll(onProgress) {
    if (typeof GameMode !== 'undefined' && GameMode.gaming) throw new Error('Not while a game is running — every model is loaded onto the graphics card in turn');
    const models = (await Ollama.listModels()).map(m => m.name).filter(n => !this.EMBED.test(n));
    if (!models.length) throw new Error('No chat models are installed');
    const rows = [];
    for (const [i, model] of models.entries()) {
      if (onProgress) onProgress(i + 1, models.length, model);
      const row = { model, passed: 0, total: this.CASES.length, seconds: 0, vision: false, verdict: '', error: '' };
      try {
        const r = await this.run(model);
        Object.assign(row, { passed: r.passed, seconds: Math.round(r.cases.reduce((n, c) => n + c.seconds, 0) * 10) / 10, vision: r.vision, verdict: r.verdict });
      } catch (err) { row.error = (err && err.message) || 'could not be tested'; }
      try { await Ollama.unload(model); }
      catch (err) { window.VexProblems?.note('Local AI', 'Could not unload ' + model + ' after its test', err); }
      rows.push(row);
    }
    return this.rank(rows);
  },

  rank(rows) {
    return [...rows].sort((a, b) => (!!a.error - !!b.error) || b.passed - a.passed || a.seconds - b.seconds);
  },
};

if (typeof window !== 'undefined') window.AgentModelTest = AgentModelTest;
if (typeof module !== 'undefined' && module.exports) module.exports = { AgentModelTest };
