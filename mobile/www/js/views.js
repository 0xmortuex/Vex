// === Vex Mobile — reader and assistant ===
//
// The two full-screen views that render page content rather than chrome. Both
// take text that came out of a web page or a worker, and both put it on screen
// as text nodes only — no innerHTML path touches either. A page that could
// inject markup into the reader would be reading its own script back into the
// chrome's privileged context, which is the one thing this layer must not do.

const VexViews = (() => {
  const { $, el, icon, clear } = VexDom;

  const READER_SIZES = [15, 17, 19, 21, 24, 27];
  const SAFE_IMAGE = /^(https:|data:image\/)/i;

  // ── Reader ───────────────────────────────────────────────────────────────
  function readerSize() {
    const stored = Number(VexStore.get('vex.readerSize', 19));
    return READER_SIZES.includes(stored) ? stored : 19;
  }

  function applyReaderSize(size) {
    document.documentElement.style.setProperty('--reader-size', size + 'px');
  }

  // Typeface, measure, leading and tint. Four data attributes on #reader, which
  // the stylesheet turns into four custom properties — so changing one is one
  // attribute write rather than a re-render of the article.
  // This table is the only place these four exist: app.js primes them from it at
  // boot, applyReaderLook() reads them, and the sheet below is built from it. A
  // fifth row needs nothing else, which is why check-www cannot see a get() here
  // and does not need to.
  const READER_LOOK = [
    ['vex.readerFont', 'font', 'theme', 'Typeface', [
      ['theme', 'The theme’s reading face'], ['serif', 'Serif'], ['sans', 'Sans'], ['mono', 'Monospace']
    ]],
    ['vex.readerWidth', 'width', 'normal', 'Measure', [
      ['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide']
    ]],
    ['vex.readerLeading', 'leading', 'normal', 'Line spacing', [
      ['tight', 'Tight'], ['normal', 'Normal'], ['loose', 'Loose']
    ]],
    ['vex.readerTint', 'tint', 'theme', 'Paper', [
      ['theme', 'Follow the theme'], ['paper', 'Paper'], ['ink', 'Black, for a dark room']
    ]]
  ];

  function lookValue(key, fallback) {
    return String(VexStore.get(key, fallback) || fallback);
  }

  function applyReaderLook() {
    const reader = $('reader');
    for (const [key, attribute, fallback] of READER_LOOK) {
      const value = lookValue(key, fallback);
      // 'theme' and 'normal' are the absence of an override, so they are written
      // as no attribute at all and the stylesheet needs no rule for them.
      if (value === fallback) delete reader.dataset[attribute];
      else reader.dataset[attribute] = value;
    }
  }

  function renderArticle(article) {
    const body = clear($('reader-body'));
    body.appendChild(el('h1', null, article.title || 'Untitled'));

    const bits = [];
    if (article.byline) bits.push(article.byline);
    if (article.published) {
      const date = new Date(article.published);
      if (!isNaN(date)) bits.push(date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }));
    }
    bits.push(VexReader.estimateMinutes(article) + ' min read');
    body.appendChild(el('p', 'reader-meta', bits.join(' · ')));

    for (const block of article.blocks) {
      if (block.type === 'img') {
        if (!SAFE_IMAGE.test(String(block.src || ''))) continue;
        body.appendChild(el('img', { src: block.src, alt: block.alt || '', loading: 'lazy' }));
        continue;
      }
      const tag = ['h1', 'h2', 'h3', 'h4', 'p', 'li', 'blockquote', 'pre', 'figcaption'].includes(block.type)
        ? (block.type === 'h1' ? 'h2' : block.type)     // the article's own h1 is the title
        : 'p';
      body.appendChild(el(tag, null, block.text));
    }
    body.scrollTop = 0;
  }

  // ── Assistant ────────────────────────────────────────────────────────────
  let mode = 'ask';                 // 'ask' talks; 'agent' does things
  const agentSteps = [];

  function renderAgent() {
    if (!$('vex-chat-log')) return;          // the panel was closed mid-run
    const log = clear($('vex-chat-log'));
    if (!agentSteps.length) {
      const empty = el('div', 'list-empty');
      empty.appendChild(document.createTextNode(
        'Say what you want done — "close every YouTube tab", "find the cheapest one and open it". '
        + 'It works one step at a time, you watch each one, and anything it marks risky stops and asks.'));
      log.appendChild(empty);
    }
    for (const step of agentSteps) {
      if (step.kind === 'goal') {
        log.appendChild(el('div', 'bubble user', step.text));
      } else if (step.kind === 'step') {
        const node = el('div', 'bubble assistant');
        if (step.thought) node.appendChild(el('span', 'agent-thought', step.thought));
        node.appendChild(el('span', 'agent-call', step.tool
          + (step.parameters && Object.keys(step.parameters).length
            ? ' ' + JSON.stringify(step.parameters).slice(0, 120) : '')));
        log.appendChild(node);
      } else if (step.kind === 'result') {
        log.appendChild(el('div', 'agent-result', step.text));
      } else if (step.kind === 'note') {
        log.appendChild(el('div', 'agent-result', step.text));
      } else if (step.kind === 'done') {
        log.appendChild(el('div', 'bubble assistant', step.text));
      } else if (step.kind === 'error') {
        log.appendChild(el('div', 'bubble error', step.text));
      }
    }
    log.scrollTop = log.scrollHeight;
  }

  async function pursue(goal) {
    const input = $('vex-chat-input');
    if (input) input.value = '';
    agentSteps.push({ kind: 'goal', text: goal });
    renderAgent();
    try {
      await VexAgent.pursue(goal, step => { agentSteps.push(step); renderAgent(); });
    } catch (error) {
      agentSteps.push({ kind: 'error', text: error.message });
      renderAgent();
    }
  }

  // What the on-device model has said so far, while it is still saying it. A
  // phone takes tens of seconds over a long answer, and an empty screen for
  // twenty of them reads as a hang rather than as thinking.
  let streaming = '';

  function renderChat() {
    // Closed (or switched to another panel) while an answer was still coming:
    // there is nothing to draw into, and every token would throw.
    if (!$('vex-chat-log')) return;
    const log = clear($('vex-chat-log'));
    if (!VexAI.state.messages.length && !streaming) {
      const empty = el('div', 'list-empty');
      const onDevice = typeof VexLocalAI !== 'undefined' && VexLocalAI.mode() !== 'off';
      empty.appendChild(document.createTextNode(onDevice
        ? 'Ask about the page you are on, or anything else. With on-device AI on, the question and the '
          + 'page text stay on this phone — nothing is sent anywhere.'
        : 'Ask about the page you are on, or anything else. The question, and the page text with it, '
          + 'go to the worker you configured — nothing else sees them.'));
      log.appendChild(empty);
    }
    for (const message of VexAI.state.messages) {
      const bubble = el('div', 'bubble ' + message.role, message.text);
      // Say where an answer came from, once it is one of two places.
      if (message.role === 'assistant' && message.onDevice) bubble.appendChild(el('span', 'bubble-tag', 'on this phone'));
      log.appendChild(bubble);
    }
    if (streaming) {
      const bubble = el('div', 'bubble assistant', streaming);
      bubble.appendChild(el('span', 'bubble-tag', 'on this phone'));
      log.appendChild(bubble);
    } else if (VexAI.state.busy) {
      log.appendChild(el('div', 'bubble assistant thinking', 'Thinking…'));
    }

    const last = VexAI.state.messages[VexAI.state.messages.length - 1];
    const suggest = clear($('vex-chat-suggest'));
    if (!suggest) return;
    const followUps = last && last.role === 'assistant' ? (last.followUps || []) : [];
    for (const followUp of followUps) {
      suggest.appendChild(el('button', { class: 'chip', onclick: () => ask(followUp) }, followUp));
    }
    log.scrollTop = log.scrollHeight;
  }

  // Put a polished selection back where it came from, if that is possible at all:
  // only an editable field can be written to, and a page's article text cannot.
  const REPLACE = text => '(function(replacement){'
    + 'var node = document.activeElement;'
    + 'var editable = node && (node.isContentEditable || /^(input|textarea)$/i.test(node.tagName));'
    + 'if (!editable) return "not-editable";'
    + 'try { return document.execCommand("insertText", false, replacement) ? "ok" : "failed"; }'
    + 'catch (error) { return "failed"; }'
    + '})(' + JSON.stringify(text) + ')';

  async function offerResult(tab, result) {
    let where = 'not-editable';
    if (tab) {
      try {
        const answer = await VexBridge.evaluate(tab.id, REPLACE(result));
        where = String((answer && answer.result) || '').replace(/"/g, '');
      } catch { where = 'not-editable'; }
    }
    if (where === 'ok') {
      VexUI.toast('Replaced', 2500);
      return;
    }
    // Not a field, so there is nowhere to put it: show it, and let it be copied.
    const keep = await VexUI.offer(result, 'Copy', 'Polished');
    if (keep) await VexUI.copy(result);
  }

  async function ask(text, options) {
    // Asked while the last answer is still coming: say so and keep what was
    // typed, rather than emptying the box over a question that never ran.
    if (VexAI.state.busy) { VexUI.toast('Still thinking about the last one'); return; }
    const input = $('vex-chat-input');
    if (input) input.value = '';
    // A question about a selection shows the selection, not just the prompt.
    if (options && options.selectedText) {
      VexAI.state.messages.push({
        role: 'user',
        text: '“' + String(options.selectedText).slice(0, 300) + '”\n\n' + text,
        at: Date.now()
      });
    }
    renderChat();
    streaming = '';
    try {
      await VexAI.ask(text, Object.assign({
        skipUserMessage: !!(options && options.selectedText),
        // Only the on-device path calls this; the worker answers in one piece.
        // Repainting the whole log per token would fight the scroll, so the
        // partial answer gets its own bubble and the rest is left alone.
        onToken: chunk => {
          streaming += chunk;
          const log = $('vex-chat-log');
          const partial = log && log.querySelector('.bubble.assistant:last-child');
          if (partial && partial.dataset.streaming === '1') {
            partial.firstChild.textContent = streaming;
          } else {
            renderChat();
            const fresh = log && log.querySelector('.bubble.assistant:last-child');
            if (fresh) fresh.dataset.streaming = '1';
          }
          if (log) log.scrollTop = log.scrollHeight;
        }
      }, options));
    } catch {
      // The failure is already the last message in the log.
    }
    streaming = '';
    renderChat();
  }

  function chatLayout() {
    const body = clear($('panel-body'));
    const wrap = el('div', 'chat');

    // Two things the assistant can be asked for, and they behave differently
    // enough to be a choice rather than a guess: answer me, or do it.
    const modes = el('div', 'panel-chips');
    for (const [id, label] of [['ask', 'Ask'], ['agent', 'Do it']]) {
      modes.appendChild(el('button', {
        class: 'chip' + (mode === id ? ' on' : ''),
        onclick: () => {
          if (VexAgent.running()) { VexUI.toast('It is working — stop it first'); return; }
          mode = id;
          chatLayout();
          if (mode === 'agent') renderAgent(); else renderChat();
        }
      }, label));
    }
    if (mode === 'agent' && VexAgent.running()) {
      modes.appendChild(el('button', { class: 'chip', onclick: () => VexAgent.stop() }, 'Stop'));
    }
    // The on-device model can be told to stop mid-answer; the worker cannot.
    if (mode === 'ask' && VexAI.state.busy && typeof VexLocalAI !== 'undefined' && VexLocalAI.state.busy) {
      modes.appendChild(el('button', {
        class: 'chip', onclick: async () => { await VexLocalAI.stop(); VexUI.toast('Stopped'); }
      }, 'Stop'));
    }
    wrap.appendChild(modes);
    wrap.appendChild(el('div', { class: 'chat-log', id: 'vex-chat-log' }));

    const context = VexAI.state.context;
    if (context) wrap.appendChild(el('div', 'chat-context', 'About: ' + (context.title || context.url)));

    wrap.appendChild(el('div', { class: 'chat-suggest', id: 'vex-chat-suggest' }));

    const compose = el('div', 'chat-compose');
    const input = el('textarea', {
      id: 'vex-chat-input', rows: 1,
      placeholder: mode === 'agent' ? 'What shall it do?' : 'Ask about this page…',
      enterkeyhint: 'send', autocapitalize: 'sentences'
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(120, input.scrollHeight) + 'px';
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        const value = input.value.trim();
        if (value) (mode === 'agent' ? pursue : ask)(value);
      }
    });
    compose.appendChild(input);
    const send = el('button', { class: 'chat-send', 'aria-label': 'Send' });
    send.appendChild(icon('send'));
    send.onclick = () => { const value = input.value.trim(); if (value) (mode === 'agent' ? pursue : ask)(value); };
    compose.appendChild(send);
    wrap.appendChild(compose);
    body.appendChild(wrap);
  }

  return {
    // app.js primes these at boot; the table is the only place they are named.
    READER_LOOK,

    // ── Reader ─────────────────────────────────────────────────────────────
    async openReader() {
      const tab = VexTabStore.active();
      if (!tab || !tab.url || tab.url === 'about:blank') { VexUI.toast('Open a page first'); return; }
      VexUI.toast('Reading…', 900);
      let article = null;
      try { article = await VexReader.extract(tab.id); } catch { article = null; }
      if (!article || !article.ok) { VexUI.toast('No article found on this page'); return; }

      applyReaderSize(readerSize());
      applyReaderLook();
      renderArticle(article);
      $('reader-meta').textContent = VexSearch.prettyHost(tab.url);
      $('reader').hidden = false;
      $('reader-progress').style.width = '0';
      VexUI.cover(true);
      this._article = article;
      this._articleUrl = tab.url;
    },

    closeReader() {
      if ($('reader').hidden) return;
      $('reader').hidden = true;
      VexUI.cover(false);
    },

    /**
     * Typeface, measure, line spacing and paper. Four rows showing what each is
     * set to; tapping one replaces the sheet with that group's choices, and
     * choosing comes back here — because nobody changes exactly one of these.
     */
    readerLook() {
      applyReaderLook();        // the sheet and the article must agree
      const rows = READER_LOOK.map(([key, , fallback, label, options]) => {
        const current = lookValue(key, fallback);
        return { id: key, label, note: (options.find(pair => pair[0] === current) || [, current])[1] };
      });
      VexSheets.choose('How it reads', rows, key => {
        const spec = READER_LOOK.find(entry => entry[0] === key);
        if (!spec) return true;
        const current = lookValue(key, spec[2]);
        VexSheets.choose(spec[3], spec[4].map(([id, name]) => ({ id, label: name, selected: id === current })),
          async value => {
            await VexStore.set(key, value);
            applyReaderLook();
            this.readerLook();
            return true;
          });
        return true;          // the picker replaced this sheet; do not close it
      });
      return true;
    },

    /** Read the article that is already open, without extracting it again. */
    async speakArticle() {
      if (VexSpeak.state.loaded) { await VexSpeak.toggle(); return; }
      const article = this._article;
      if (!article) { VexUI.toast('Nothing to read'); return; }
      await VexSpeak.readLines(VexSpeak.linesFor(article), {
        title: article.title || '', url: this._articleUrl || ''
      });
    },

    /** How far down the article you are, as a hairline under the tools. */
    onReaderScroll() {
      const body = $('reader-body');
      const room = body.scrollHeight - body.clientHeight;
      const through = room > 0 ? Math.min(1, body.scrollTop / room) : 0;
      $('reader-progress').style.width = Math.round(through * 100) + '%';
    },

    readerOpen() { return !$('reader').hidden; },

    async stepReaderSize(direction) {
      const index = READER_SIZES.indexOf(readerSize());
      const next = READER_SIZES[Math.min(READER_SIZES.length - 1, Math.max(0, index + direction))];
      await VexStore.set('vex.readerSize', next);
      applyReaderSize(next);
    },

    // ── Assistant ──────────────────────────────────────────────────────────
    async openAI(wanted, prefill) {
      if (wanted === 'agent' || wanted === 'ask') mode = wanted;
      else if (typeof wanted === 'string') prefill = wanted;
      $('panel-title').textContent = mode === 'agent' ? 'Let it do things' : 'Assistant';
      $('panel-search').hidden = true;
      const action = $('panel-action');
      action.hidden = false;
      action.textContent = 'Clear';
      action.onclick = () => {
        if (mode === 'agent') { agentSteps.length = 0; renderAgent(); }
        else { VexAI.clear(); renderChat(); }
      };
      chatLayout();
      if (mode === 'agent') renderAgent(); else renderChat();
      // Through the shell, which is the only thing that knows whether the panel
      // is already open: opening the assistant from inside another panel — the
      // library's "ask Vex what you don't know" does exactly that — covered the
      // page twice and uncovered it once, leaving every later page invisible.
      VexPanels.openAIShell();

      // A phone running its own model needs no worker to chat: only the agent
      // (which the model is not trusted with) does. The error used to greet
      // everyone without a worker, on-device AI or not.
      const local = mode !== 'agent' && VexAI.staysHere('chat');
      if (!local && !(await VexAI.configured())) {
        if (mode === 'agent') {
          agentSteps.push({ kind: 'error', text: 'No assistant configured yet. Settings → Assistant takes a '
            + 'worker URL and an access token.' });
          renderAgent();
          return;
        }
        VexAI.state.messages.push({
          role: 'error',
          text: 'No assistant configured yet. Settings → Assistant takes a worker URL and an access '
            + 'token — the same Cloudflare Worker the desktop app uses (see SELF_HOSTING.md).',
          at: Date.now()
        });
        renderChat();
        return;
      }
      if (prefill) ask(prefill);
    },

    askAI: ask,
    pursue,
    offerResult,
    renderChat,
    renderAgent,
    mode() { return mode; },

    async summarisePage() {
      await this.openAI();
      // On-device can answer this without a worker, so the worker is only
      // required when nothing local will take it.
      if (!VexAI.staysHere('summarize') && !(await VexAI.configured())) {
        VexUI.toast('Set up the assistant, or turn on on-device AI');
        return;
      }
      renderChat();
      try { await VexAI.summarize(); } catch {}
      renderChat();
    },

    /**
     * Polish a selection — Gemini Nano's three jobs, on the text you picked.
     *
     * It happens on the phone, so it is offered beside Copy rather than behind
     * the assistant, and the result can go straight back into the field it came
     * from when that field is editable. Where there is no Nano, the worker is
     * asked to do the same thing, and where there is neither, it says so.
     */
    async polish(tab, text) {
      const selection = String(text || '').trim();
      if (!selection) return;
      const nano = typeof VexLocalAI !== 'undefined' && VexLocalAI.state.nano === 'available';
      const choices = [
        { id: 'proofread', label: 'Fix spelling and grammar', note: nano ? 'On the phone' : 'Through your worker' },
        { id: 'shorten', label: 'Shorter' },
        { id: 'rephrase', label: 'Say it differently' },
        { id: 'professional', label: 'More formal' },
        { id: 'friendly', label: 'Warmer' }
      ];
      VexSheets.choose(selection.length > 60 ? selection.slice(0, 57) + '…' : selection, choices,
        async choice => {
          VexSheets.close();
          VexUI.toast(nano ? 'On it, on the phone…' : 'Asking your worker…', 2000);
          let result = '';
          try {
            if (nano) {
              result = choice === 'proofread'
                ? await VexLocalAI.nanoProofread(selection)
                : await VexLocalAI.nanoRewrite(selection, choice);
            } else if (tab && tab.incognito) {
              VexUI.toast('A private selection is not sent to your worker', 4000);
              return;
            } else if (await VexAI.configured()) {
              const how = choice === 'proofread' ? 'Correct the spelling and grammar'
                : choice === 'shorten' ? 'Say this more briefly'
                : choice === 'professional' ? 'Rewrite this more formally'
                : choice === 'friendly' ? 'Rewrite this more warmly'
                : 'Rewrite this differently';
              result = await VexAI.ask(how + ', and give only the result:\n\n' + selection,
                { action: 'chat', context: null, skipUserMessage: true });
            } else {
              VexUI.toast('This needs Gemini Nano or your own worker', 4000);
              return;
            }
          } catch (error) {
            VexUI.toast(error.message || 'It could not do that', 4000);
            return;
          }
          if (!result) { VexUI.toast('Nothing came back'); return; }
          await offerResult(tab, result);
        });
    },

    anyOpen() { return this.readerOpen() || !$('panel').hidden; }
  };
})();

if (typeof window !== 'undefined') window.VexViews = VexViews;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexViews };
