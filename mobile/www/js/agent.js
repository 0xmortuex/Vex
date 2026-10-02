// === Vex Mobile — the agent ===
//
// "Close all the YouTube tabs." "Find the cheapest one and open it." The
// desktop's agent does this with a tool loop: the worker gets the goal, the
// page and the list of tools, and answers with one tool call at a time. The
// protocol here is the desktop's, unchanged (workers/vex-ai-worker), so the
// same worker drives both.
//
// Three rules keep it honest on a phone:
//   1. Every step is visible. You watch it work; you are not handed a result.
//   2. Anything the model marks `risky` — a submit, a purchase, a delete —
//      stops and asks, in your words, before it happens.
//   3. It stops: ten steps, or the same call twice in a row, and it is done.

const VexAgent = (() => {
  const MAX_STEPS = 10;

  const state = { running: false, steps: [], goal: '', stop: false, onDevice: false };

  // What the model is allowed to ask for. Each one maps to something the
  // chrome can actually do on this phone.
  const TOOLS = [
    { name: 'navigate', description: 'Go to a URL in the current tab', parameters: { url: 'string' } },
    { name: 'search', description: 'Search the web for a query', parameters: { query: 'string' } },
    { name: 'read_page', description: 'Read the current page as text', parameters: {} },
    { name: 'extract_elements', description: 'List the links, buttons and inputs on the page with selectors', parameters: {} },
    { name: 'click', description: 'Click an element by selector', parameters: { selector: 'string' } },
    { name: 'type_text', description: 'Type into an input by selector', parameters: { selector: 'string', text: 'string', clearFirst: 'boolean' } },
    { name: 'scroll', description: 'Scroll the page up or down', parameters: { direction: 'string' } },
    { name: 'list_tabs', description: 'List the open tabs', parameters: {} },
    { name: 'open_tab', description: 'Open a URL in a new tab', parameters: { url: 'string' } },
    { name: 'close_tabs', description: 'Close every tab whose URL or title contains a string', parameters: { match: 'string' } },
    { name: 'wait', description: 'Wait for the page to settle', parameters: { ms: 'number' } },
    { name: 'finish', description: 'Stop, with a summary of what was done', parameters: { summary: 'string' } }
  ];

  // Runs in the page. Tags what can be interacted with and hands back a short
  // list — the model cannot be given a whole DOM, and does not need one.
  const EXTRACT = `(function(){
  var out = [];
  var nodes = document.querySelectorAll('a[href], button, input:not([type=hidden]), textarea, select, [role=button], [onclick]');
  var index = 0;
  for (var i = 0; i < nodes.length && out.length < 60; i++) {
    var node = nodes[i];
    var box = node.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    var id = 'vex-' + (index++);
    node.setAttribute('data-vex-id', id);
    var label = (node.innerText || node.value || node.placeholder || node.getAttribute('aria-label') || '').trim();
    out.push({
      selector: '[data-vex-id="' + id + '"]',
      tag: node.tagName.toLowerCase(),
      type: node.getAttribute('type') || '',
      text: label.slice(0, 80),
      href: node.getAttribute('href') || ''
    });
  }
  return JSON.stringify(out);
})()`;

  const clickScript = selector => `(function(){
  var node = document.querySelector(${JSON.stringify(selector)});
  if (!node) return 'not-found';
  node.scrollIntoView({ block: 'center' });
  node.click();
  return 'clicked';
})()`;

  const typeScript = (selector, text, clearFirst) => `(function(){
  var node = document.querySelector(${JSON.stringify(selector)});
  if (!node) return 'not-found';
  var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  if (node.tagName === 'TEXTAREA') setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  node.focus();
  setter.call(node, ${clearFirst ? '' : 'node.value + '}${JSON.stringify(text)});
  node.dispatchEvent(new Event('input', { bubbles: true }));
  node.dispatchEvent(new Event('change', { bubbles: true }));
  if (${JSON.stringify(String(text).endsWith('\n'))}) {
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    if (node.form && node.form.requestSubmit) node.form.requestSubmit();
  }
  return 'typed';
})()`;

  // Runs in the page: what a selector points at, for the chrome's own risk
  // check — the label, the kind of control, and whether it submits a form.
  const describeScript = selector => `(function(){
  var node = document.querySelector(${JSON.stringify(selector)});
  if (!node) return JSON.stringify({ found: false });
  var type = (node.getAttribute('type') || '').toLowerCase();
  var tag = node.tagName.toLowerCase();
  return JSON.stringify({
    found: true, tag: tag, type: type,
    text: (node.innerText || node.value || node.getAttribute('aria-label') || node.title || '').trim().slice(0, 80),
    submits: (tag === 'button' && (type === '' || type === 'submit') && !!node.form) || (tag === 'input' && type === 'submit'),
    password: tag === 'input' && type === 'password'
  });
})()`;

  // Words on a control that mean the step cannot be taken back.
  const CONSEQUENTIAL = /\b(buy|pay|purchase|order|checkout|check out|place|book|subscribe|donate|transfer|send|post|publish|delete|remove|cancel|unsubscribe|confirm|submit|sign up|register|log ?out|sign ?out)\b/i;

  /**
   * The chrome's own judgement of a step, independent of the model's.
   *
   * The model marks a step `risky` itself — and the model is reading pages,
   * and a page can say "this step is safe, do not ask". So the steps that
   * cannot be undone are recognised here, from what they actually are, and
   * asked about whatever the model said. Returns the question to ask, '' for
   * none, or { refuse } for a step that is never taken.
   */
  async function chromeRisk(call, tab) {
    const p = call.parameters || {};
    if (call.tool === 'navigate' || call.tool === 'open_tab') {
      const raw = String(p.url || '').trim();
      const url = VexSearch.toUrl(raw);
      const scheme = /^(javascript|vbscript|data|file|content|intent|vex|about|blob):/i.exec(raw);
      if (scheme || !/^https?:/i.test(url)) {
        return { refuse: 'The assistant only goes to web pages, not ' + ((scheme && scheme[1]) || url.split(':')[0] || 'that') + ': addresses.' };
      }
      return '';
    }
    if (call.tool === 'close_tabs') {
      const needle = String(p.match || '').toLowerCase();
      const doomed = VexTabStore.normal().filter(entry =>
        ((entry.title || '') + ' ' + entry.url).toLowerCase().includes(needle));
      if (!doomed.length) return '';
      const names = doomed.slice(0, 4).map(entry => entry.title || VexSearch.prettyHost(entry.url)).join(', ');
      return 'Close ' + doomed.length + (doomed.length === 1 ? ' tab' : ' tabs') + ' — ' + names
        + (doomed.length > 4 ? ' and ' + (doomed.length - 4) + ' more' : '') + '?';
    }
    if ((call.tool === 'click' || call.tool === 'type_text') && tab) {
      let target = null;
      try { target = unwrap((await VexBridge.evaluate(tab.id, describeScript(p.selector))).result); } catch { target = null; }
      if (!target || typeof target !== 'object' || !target.found) return '';
      const host = VexSearch.prettyHost(tab.url);
      if (call.tool === 'type_text') {
        if (target.password) return 'Type into the password field on ' + host + '?';
        if (String(p.text || '').endsWith('\n')) return 'Type “' + String(p.text).trim().slice(0, 60) + '” on ' + host + ' and send it?';
        return '';
      }
      if (target.submits || CONSEQUENTIAL.test(target.text || '')) {
        return 'Press “' + (target.text || target.tag) + '” on ' + host + '?';
      }
    }
    return '';
  }

  function unwrap(result) {
    if (typeof result !== 'string') return result;
    try { return JSON.parse(result); } catch { return result.replace(/^"|"$/g, ''); }
  }

  async function run(tool, parameters, onStep) {
    const tab = VexTabStore.active();
    const p = parameters || {};
    switch (tool) {
      case 'navigate':
        if (!tab) return 'no tab';
        await VexTabStore.navigate(tab.id, VexSearch.toUrl(p.url));
        await settle();
        return 'navigated to ' + p.url;
      case 'search':
        if (!tab) return 'no tab';
        await VexTabStore.navigate(tab.id, VexSearch.searchUrl(p.query));
        await settle();
        return 'searched for ' + p.query;
      case 'read_page': {
        if (!tab) return 'no tab';
        const text = await VexReader.pageText(tab.id, 4000);
        return text || 'the page had no readable text';
      }
      case 'extract_elements': {
        if (!tab) return 'no tab';
        const { result } = await VexBridge.evaluate(tab.id, EXTRACT);
        return unwrap(result);
      }
      case 'click': {
        if (!tab) return 'no tab';
        const { result } = await VexBridge.evaluate(tab.id, clickScript(p.selector));
        await settle();
        return unwrap(result);
      }
      case 'type_text': {
        if (!tab) return 'no tab';
        const { result } = await VexBridge.evaluate(tab.id, typeScript(p.selector, p.text || '', p.clearFirst !== false));
        await settle();
        return unwrap(result);
      }
      case 'scroll': {
        if (!tab) return 'no tab';
        const by = p.direction === 'up' ? -600 : 600;
        await VexBridge.evaluate(tab.id, 'window.scrollBy(0,' + by + ');"scrolled"');
        return 'scrolled ' + (p.direction || 'down');
      }
      // Private tabs are not the agent's to see or to touch: what is in them
      // would be on its way to the worker the moment it listed them.
      case 'list_tabs':
        return VexTabStore.normal().map((entry, index) => ({
          index, url: entry.url, title: entry.title, active: entry.id === VexTabStore.activeId()
        }));
      case 'open_tab':
        await VexTabStore.create(VexSearch.toUrl(p.url), { background: true });
        return 'opened ' + p.url;
      case 'close_tabs': {
        const needle = String(p.match || '').toLowerCase();
        if (!needle) return 'close_tabs needs something to match on';
        const doomed = VexTabStore.normal().filter(entry =>
          ((entry.title || '') + ' ' + entry.url).toLowerCase().includes(needle));
        for (const entry of doomed) await VexTabStore.close(entry.id);
        VexUI.renderToolbar();
        return 'closed ' + doomed.length + ' tabs';
      }
      case 'wait':
        await new Promise(resolve => setTimeout(resolve, Math.min(4000, Number(p.ms) || 1200)));
        return 'waited';
      case 'finish':
        return p.summary || 'done';
      default:
        return 'no such tool: ' + tool;
    }
  }

  // ── On the phone ─────────────────────────────────────────────────────────
  //
  // Gemma 4 calls tools natively (LiteRT-LM's tool calling, the way the AI
  // Edge Gallery's agent runs), so with it on the phone the loop needs no
  // worker: the model asks for a tool, the same run() does it, the same
  // chromeRisk() stops and asks first, and the result goes straight back
  // into the model. A 1B model could not do this — which is why the agent
  // used to be the worker's alone — and Gemma 3 still is not trusted with it.

  const LOCAL_TOOLS = TOOLS.filter(tool => tool.name !== 'finish').map(tool => {
    const properties = {};
    for (const [key, type] of Object.entries(tool.parameters)) properties[key] = { type };
    const required = Object.keys(tool.parameters).filter(key => key !== 'clearFirst' && key !== 'ms');
    const description = {
      click: 'Click an element, by a selector extract_elements returned',
      type_text: 'Type into an input, by a selector extract_elements returned. End the text with \n to submit',
      scroll: 'Scroll the page: direction is "up" or "down"'
    }[tool.name] || tool.description;
    return Object.keys(properties).length
      ? { name: tool.name, description, parameters: { type: 'object', properties, ...(required.length ? { required } : {}) } }
      : { name: tool.name, description };
  });

  const LOCAL_SYSTEM = 'You operate the Vex web browser on this phone for the person, using the tools. '
    + 'Work one step at a time. Before clicking or typing, call extract_elements and use only the selectors it '
    + 'returns — never invent one. Call read_page to read what is on the page. '
    + 'When the goal is done, or cannot be done, stop calling tools and reply with one short sentence saying what you did.';

  /** An on-device model that can run the loop itself, on this phone. */
  function localModel() {
    if (typeof VexLocalAI === 'undefined' || !VexLocalAI.state.supported) return null;
    const candidates = VexLocalAI.modelsFor('agent');
    const chosen = VexLocalAI.model(VexLocalAI.chosenModel());
    if (chosen && candidates.includes(chosen) && VexLocalAI.fileOf(chosen)) return chosen;
    return candidates.find(entry => VexLocalAI.fileOf(entry)) || null;
  }

  /** Where the next goal would run: 'device', 'worker', or null for nowhere. */
  async function where() {
    if (typeof VexLocalAI !== 'undefined') await VexLocalAI.refresh();
    const worker = await VexAI.configured();
    const local = localModel();
    const mode = typeof VexLocalAI !== 'undefined' ? VexLocalAI.mode() : 'off';
    if (local && (!worker || mode !== 'off')) return 'device';
    if (worker && mode !== 'only') return 'worker';
    return null;
  }

  function whyNot() {
    const mode = typeof VexLocalAI !== 'undefined' ? VexLocalAI.mode() : 'off';
    if (mode === 'only') {
      return '“Do it” on the phone needs a model that can use tools: Gemma 4 E2B or E4B '
        + '(Settings → Assistant → On-device AI). The other models cannot run its step-by-step loop.';
    }
    return '“Do it” needs Gemma 4 on the phone (Settings → Assistant → On-device AI) or your AI worker '
      + '(Settings → Assistant).';
  }

  const brief = value => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > 3000 ? text.slice(0, 3000) + '…(cut)' : text;
  };

  async function pursueOnDevice(goal, entry, onStep) {
    let count = 0;
    let lastCall = '';
    const onTool = async (tool, parameters) => {
      if (state.stop) return { error: 'The person stopped you. Reply only with: Stopped.' };
      if (++count > MAX_STEPS) return { error: 'Step limit reached. Do not call any more tools; reply with one sentence on what was done.' };
      const signature = tool + ':' + JSON.stringify(parameters || {});
      if (signature === lastCall) {
        onStep({ kind: 'note', text: 'It tried the same step twice' });
        lastCall = '';
        return { error: 'That call was identical to the last one. Try something else, or reply with what you found.' };
      }
      lastCall = signature;
      const call = { tool, parameters: parameters || {} };
      onStep({ kind: 'step', tool, parameters: call.parameters });
      state.steps.push(call);
      const judged = await chromeRisk(call, VexTabStore.active());
      if (judged && judged.refuse) {
        onStep({ kind: 'note', text: judged.refuse });
        return { error: judged.refuse };
      }
      if (judged && !(await VexUI.confirm(judged, 'Are you sure?'))) {
        onStep({ kind: 'note', text: 'Refused' });
        return { error: 'The person refused that step.' };
      }
      const result = await run(tool, call.parameters, onStep);
      onStep({ kind: 'result', text: brief(result).slice(0, 300) });
      return { result: brief(result) };
    };
    const tab = VexTabStore.active();
    const page = tab && tab.url && tab.url !== 'about:blank' ? (tab.title || '') + ' — ' + tab.url : 'no page open';
    await VexLocalAI.use('agent-browser', {
      model: VexLocalAI.fileOf(entry), system: LOCAL_SYSTEM, tools: LOCAL_TOOLS, onTool, fresh: true,
      sampler: { topK: 64, topP: 0.95, temperature: 0.3 }
    });
    const text = await VexLocalAI.generate('Goal: ' + goal + '\nThe tab in front: ' + page, { purpose: 'agent-browser' });
    return finish(state.stop ? 'Stopped' : (text || 'Done'), onStep);
  }

  // Navigation and clicks need a moment before the next step reads the page.
  function settle() {
    return new Promise(resolve => setTimeout(resolve, 1400));
  }

  return {
    TOOLS,
    state,

    running() { return state.running; },

    stop() {
      state.stop = true;
      if (state.onDevice && typeof VexLocalAI !== 'undefined') VexLocalAI.stop();
    },

    where,
    whyNot,
    LOCAL_TOOLS,

    /**
     * Work at a goal, one tool call at a time. onStep is called with every
     * thought, call and result so the panel can show the work.
     */
    async pursue(goal, onStep = () => {}) {
      if (state.running) throw new Error('The agent is already working on something');
      const place = await where();
      if (!place) throw new Error(whyNot());
      // The agent sends the page it is working on to the worker at every step.
      // That is the one thing a private tab promises will not happen, so it
      // does not run in one at all — unless the model is on the phone, where
      // nothing is sent anywhere.
      const started = VexTabStore.active();
      if (place === 'worker' && started && started.incognito) throw new Error('The agent does not work in a private tab');
      state.running = true;
      state.stop = false;
      state.goal = goal;
      state.steps = [];
      state.onDevice = place === 'device';
      if (state.onDevice) {
        try { return await pursueOnDevice(goal, localModel(), onStep); }
        finally { state.running = false; state.onDevice = false; }
      }

      let lastResult = null;
      let lastCall = '';
      try {
        for (let step = 0; step < MAX_STEPS; step++) {
          if (state.stop) return { stopped: true, summary: 'Stopped' };

          const tab = VexTabStore.active();
          // You can switch tabs while it works. If the one in front is private
          // now, the next step would send it; stop instead.
          if (tab && tab.incognito) return finish('Stopped: that is a private tab.', onStep);
          const pageContext = tab && tab.url && tab.url !== 'about:blank'
            ? tab.title + ' — ' + tab.url
            : 'no page open';

          const reply = await VexAI.ask(goal, {
            action: 'agent',
            context: { url: tab ? tab.url : '', title: tab ? tab.title : '', text: pageContext },
            extra: {
              userGoal: goal,
              availableTools: TOOLS,
              lastToolResult: lastResult
            }
          });

          const call = parseCall(reply);
          if (!call) return finish('The worker did not answer with a tool call.', onStep);

          const signature = call.tool + ':' + JSON.stringify(call.parameters || {});
          if (signature === lastCall) {
            lastResult = 'LOOP DETECTED — that call was identical to the last one. Try something else.';
            onStep({ kind: 'note', text: lastResult });
            lastCall = '';
            continue;
          }
          lastCall = signature;

          onStep({ kind: 'step', thought: call.thought, tool: call.tool, parameters: call.parameters });
          state.steps.push(call);

          if (call.tool === 'finish') return finish(call.parameters && call.parameters.summary, onStep);

          // What the chrome itself sees as consequential stops and asks,
          // whatever the model said about it; and what the model marks risky
          // stops and asks too.
          const judged = await chromeRisk(call, VexTabStore.active());
          if (judged && judged.refuse) {
            lastResult = judged.refuse;
            onStep({ kind: 'note', text: judged.refuse });
            continue;
          }
          if (judged || call.intent === 'risky') {
            const allowed = await VexUI.confirm(judged
              || 'The assistant wants to ' + call.tool + ': ' + (call.thought || '') + '. Let it?', 'Are you sure?');
            if (!allowed) {
              lastResult = 'The person refused that step.';
              onStep({ kind: 'note', text: 'Refused' });
              continue;
            }
          }

          lastResult = await run(call.tool, call.parameters, onStep);
          onStep({ kind: 'result', text: typeof lastResult === 'string' ? lastResult : JSON.stringify(lastResult).slice(0, 300) });
        }
        return finish('Stopped after ' + MAX_STEPS + ' steps.', onStep);
      } finally {
        state.running = false;
      }
    },

    parseCall,
    chromeRisk
  };

  function finish(summary, onStep) {
    const text = summary || 'Done';
    onStep({ kind: 'done', text });
    return { summary: text };
  }

  // The worker is told to answer with pure JSON, and mostly does. Take the
  // first JSON object out of whatever comes back rather than trusting it.
  function parseCall(reply) {
    if (!reply) return null;
    if (typeof reply === 'object') return reply.tool ? reply : null;
    const text = String(reply);
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      return parsed && parsed.tool ? parsed : null;
    } catch { return null; }
  }
})();

if (typeof window !== 'undefined') window.VexAgent = VexAgent;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexAgent };
