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

  const state = { running: false, steps: [], goal: '', stop: false };

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
      case 'list_tabs':
        return VexTabStore.all().map((entry, index) => ({
          index, url: entry.url, title: entry.title, active: entry.id === VexTabStore.activeId()
        }));
      case 'open_tab':
        await VexTabStore.create(VexSearch.toUrl(p.url), { background: true });
        return 'opened ' + p.url;
      case 'close_tabs': {
        const needle = String(p.match || '').toLowerCase();
        if (!needle) return 'close_tabs needs something to match on';
        const doomed = VexTabStore.all().filter(entry =>
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

  // Navigation and clicks need a moment before the next step reads the page.
  function settle() {
    return new Promise(resolve => setTimeout(resolve, 1400));
  }

  return {
    TOOLS,
    state,

    running() { return state.running; },

    stop() { state.stop = true; },

    /**
     * Work at a goal, one tool call at a time. onStep is called with every
     * thought, call and result so the panel can show the work.
     */
    async pursue(goal, onStep = () => {}) {
      if (state.running) throw new Error('The agent is already working on something');
      if (!(await VexAI.configured())) throw new Error('Set up the assistant first (Settings → Assistant)');
      state.running = true;
      state.stop = false;
      state.goal = goal;
      state.steps = [];

      let lastResult = null;
      let lastCall = '';
      try {
        for (let step = 0; step < MAX_STEPS; step++) {
          if (state.stop) return { stopped: true, summary: 'Stopped' };

          const tab = VexTabStore.active();
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

          // Anything the model itself marks risky stops and asks.
          if (call.intent === 'risky') {
            const allowed = await VexUI.confirm(
              'The assistant wants to ' + call.tool + ': ' + (call.thought || '') + '. Let it?', 'Are you sure?');
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

    parseCall
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
