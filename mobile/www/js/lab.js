// === Vex Mobile — AI Lab ===
//
// Everything the Google AI Edge Gallery does with an on-device model, inside
// Vex, on the same models and the same engine (LiteRT-LM):
//
//   AI Chat         talk to a model, with your own sampling settings
//   Ask Image       ask about photos — Gemma 3n and Gemma 4 can see
//   Audio Scribe    transcribe or translate up to thirty seconds of sound
//   Prompt Lab      single-turn templates: free form, tone, summary, code
//   Agent Skills    a model that loads a skill and runs it (Gemma 4)
//   Tiny Garden     FunctionGemma 270M turns words into garden moves
//   Mobile Actions  FunctionGemma 270M turns words into phone actions
//   Scrapbook       MediaPipe's segmenter cuts things out of photos
//
// Nothing here leaves the phone except what you ask a skill to fetch (a
// Wikipedia summary) and the model downloads themselves.
//
// The tools are declared the way the Gallery declares them — the same names,
// descriptions and parameters, snake_cased as LiteRT-LM does — because the two
// FunctionGemma models were fine-tuned on exactly those declarations, and a
// renamed tool is one they have never seen.

const VexLab = (() => {
  const { $, el, icon, clear } = VexDom;

  const FEATURES = [
    { id: 'chat', panel: 'labChat', label: 'AI Chat', note: 'Chat with an on-device model', glyph: 'sparkle' },
    { id: 'image', panel: 'labImage', label: 'Ask Image', note: 'Ask questions about photos', glyph: 'image' },
    { id: 'audio', panel: 'labAudio', label: 'Audio Scribe', note: 'Transcribe and translate audio', glyph: 'mic' },
    { id: 'prompt', panel: 'labPrompt', label: 'Prompt Lab', note: 'Single-turn templates', glyph: 'text' },
    { id: 'agent', panel: 'labAgent', label: 'Agent Skills', note: 'Complete tasks with skills', glyph: 'layers' },
    { id: 'garden', panel: 'labGarden', label: 'Tiny Garden', note: 'Plant, water and harvest by talking', glyph: 'grid' },
    { id: 'actions', panel: 'labActions', label: 'Mobile Actions', note: 'Do things on the phone by asking', glyph: 'key' },
    { id: 'scrapbook', panel: 'labScrap', label: 'Scrapbook', note: 'Cut things out of photos into a page', glyph: 'palette' }
  ];

  const feature = id => FEATURES.find(entry => entry.id === id);

  // ── Which model each feature uses, and its settings ──────────────────────

  function installed(entry) { return !!VexLocalAI.fileOf(entry); }

  function modelFor(task) {
    const chosen = (VexStore.get('vex.labModels', {}) || {})[task];
    const candidates = VexLocalAI.modelsFor(task);
    const picked = candidates.find(entry => VexLocalAI.fileOf(entry) && (entry.id === chosen || VexLocalAI.fileOf(entry) === chosen));
    if (picked) return picked;
    // The assistant's model, when it can do this; otherwise the first one here.
    const assistant = VexLocalAI.model(VexLocalAI.chosenModel());
    if (assistant && candidates.includes(assistant) && installed(assistant)) return assistant;
    return candidates.find(installed) || null;
  }

  async function setModelFor(task, entry) {
    const all = Object.assign({}, VexStore.get('vex.labModels', {}) || {});
    all[task] = entry.id;
    await VexStore.set('vex.labModels', all);
  }

  function settingsFor(task, entry) {
    const saved = (VexStore.get('vex.labSettings', {}) || {})[task] || {};
    const base = (entry && entry.config) || { topK: 64, topP: 0.95, temperature: 1 };
    return {
      topK: Number(saved.topK) || base.topK,
      topP: saved.topP != null ? Number(saved.topP) : base.topP,
      temperature: saved.temperature != null ? Number(saved.temperature) : base.temperature
    };
  }

  async function saveSettings(task, values) {
    const all = Object.assign({}, VexStore.get('vex.labSettings', {}) || {});
    all[task] = values;
    await VexStore.set('vex.labSettings', all);
  }

  // ── Shared pieces ────────────────────────────────────────────────────────

  function shell(id, title) {
    return VexPanels.shell(feature(id) ? feature(id).panel : id, title || feature(id).label);
  }

  /** The line at the top of every feature: which model, and how to change it. */
  function modelBar(task, onChange, extra = []) {
    const bar = el('div', 'lab-bar');
    const entry = modelFor(task);
    const chip = el('button', { class: 'chip lab-model', onclick: () => chooseModel(task, onChange) });
    chip.appendChild(icon('sparkle'));
    chip.appendChild(document.createTextNode(entry ? entry.label : 'Choose a model'));
    bar.appendChild(chip);
    for (const item of extra) bar.appendChild(item);
    return bar;
  }

  function chooseModel(task, onChange) {
    const candidates = VexLocalAI.modelsFor(task);
    const current = modelFor(task);
    VexSheets.choose('Model for ' + (feature(task) ? feature(task).label : task), candidates.map(entry => ({
      id: entry.id,
      label: entry.label,
      note: (installed(entry) ? 'On this phone' : 'Not downloaded · ' + entry.size) + ' · ' + entry.note,
      selected: current === entry
    })), async id => {
      const entry = VexLocalAI.model(id);
      VexSheets.close();
      if (!installed(entry)) { getModel(entry, onChange); return; }
      await setModelFor(task, entry);
      if (onChange) onChange();
    });
  }

  /** Download a model, explaining the licence when there is one. */
  async function getModel(entry, after) {
    if (VexLocalAI.state.downloading) { VexUI.toast('Another model is downloading'); return; }
    if (entry.gated && !VexLocalAI.hfToken()) {
      // Three honest choices rather than a Yes/No whose "No" secretly meant
      // "I have a token" (found by walking through it).
      const choice = await new Promise(resolve => VexSheets.choose(entry.label + ' needs Google’s licence', [
        { id: 'page', label: 'Open its page to accept the licence', note: 'Once, on Hugging Face; then come back here' },
        { id: 'token', label: 'I have accepted it: paste my token', note: 'A read token from huggingface.co/settings/tokens. It stays on this phone' }
      ], id => { VexSheets.close(); resolve(id); }, 'Hugging Face asks for it before the download'));
      if (choice === 'page') { VexPanels.close(); VexUI.openUrl(entry.page, { newTab: true }); return; }
      if (choice !== 'token') return;
      const token = await VexUI.prompt('Hugging Face token', 'Paste a read token (hf_…)');
      if (!token) return;
      await VexLocalAI.setHfToken(token);
    }
    try {
      await VexLocalAI.downloadModel(entry);
      VexUI.toast('Downloading ' + entry.label + ' · ' + entry.size, 3000);
    } catch (error) {
      VexUI.toast(error.message || 'The download did not start', 4000);
    }
    if (after) after();
  }

  /** When nothing that can do this is on the phone: what to get. */
  let waiting = null;          // the feature showing this, so a finished download redraws it
  function needModel(body, task, onChange) {
    waiting = task;
    body.appendChild(el('div', 'field-note',
      'Nothing on this phone can do this yet. Any of these can — downloads resume if the connection drops.'));
    const downloading = VexLocalAI.state.downloading;
    for (const entry of VexLocalAI.modelsFor(task)) {
      const busy = downloading && downloading.name === entry.name;
      body.appendChild(VexSheets.row({
        icon: busy ? 'sync' : 'download',
        label: entry.label + (entry.gated ? ' · licence' : ''),
        note: busy
          ? progressText(downloading)
          : entry.size + ' · needs ' + (entry.ram || 4) + ' GB of memory · ' + entry.note,
        run: async () => { if (!busy) await getModel(entry, onChange); return true; }
      }));
    }
  }

  function progressText({ received, total }) {
    const mb = bytes => (bytes / 1048576).toFixed(0) + ' MB';
    return total > 0
      ? mb(received) + ' of ' + mb(total) + ' · ' + Math.floor(100 * received / total) + '%'
      : mb(received) + ' so far';
  }

  /** Temperature, top-K and top-P, as sliders, saved per feature. */
  function settingsSection(task, entry) {
    const values = settingsFor(task, entry);
    const box = el('details', 'lab-settings');
    box.appendChild(el('summary', null, 'Settings · temperature ' + values.temperature.toFixed(2)
      + ', top-K ' + values.topK + ', top-P ' + values.topP.toFixed(2)));
    const slider = (key, label, min, max, step) => {
      const rowNode = el('label', 'lab-slider');
      const value = el('span', 'lab-slider-value', String(values[key]));
      rowNode.appendChild(el('span', null, label));
      const input = el('input', { type: 'range', min, max, step, value: values[key] });
      input.oninput = () => { value.textContent = input.value; };
      input.onchange = async () => {
        values[key] = Number(input.value);
        await saveSettings(task, values);
        box.querySelector('summary').textContent = 'Settings · temperature ' + values.temperature.toFixed(2)
          + ', top-K ' + values.topK + ', top-P ' + values.topP.toFixed(2);
        restart.add(task);
      };
      rowNode.appendChild(input);
      rowNode.appendChild(value);
      box.appendChild(rowNode);
    };
    slider('temperature', 'Temperature', 0, 2, 0.05);
    slider('topK', 'Top-K', 1, 100, 1);
    slider('topP', 'Top-P', 0, 1, 0.01);
    const reset = el('button', { class: 'chip', onclick: async () => {
      await saveSettings(task, {});
      VexUI.toast('Back to the model’s own settings');
      VexLab.open(task);
    } }, 'Model defaults');
    box.appendChild(reset);
    return box;
  }

  // Sampling is part of a conversation, so new settings start a new one —
  // at the next message, not under the feet of an answer being written.
  const restart = new Set();

  // ── Home ─────────────────────────────────────────────────────────────────

  async function home() {
    const body = VexPanels.shell('aiLab', 'AI Lab');
    await VexLocalAI.refresh();
    body.appendChild(el('div', 'field-note',
      'Models that run on this phone, with nothing sent anywhere — the Google AI Edge Gallery’s features, '
      + 'inside Vex. Each one says which model it needs; tap it to get started.'));
    const grid = el('div', 'lab-tiles');
    for (const item of FEATURES) {
      const entry = modelFor(item.id);
      const tile = el('button', { class: 'lab-tile', onclick: () => VexLab.open(item.id) });
      const glyph = el('span', 'lab-glyph');
      glyph.appendChild(icon(item.glyph));
      tile.appendChild(glyph);
      tile.appendChild(el('span', 'lab-tile-title', item.label));
      tile.appendChild(el('span', 'lab-tile-note', item.note));
      tile.appendChild(el('span', 'lab-tile-model' + (entry ? '' : ' missing'),
        entry ? entry.label : 'Needs a model'));
      grid.appendChild(tile);
    }
    body.appendChild(grid);
    body.appendChild(VexSheets.row({
      icon: 'download', label: 'Models', note: 'Every model the Gallery offers: download, import, delete',
      run: async () => { VexPanels.localAI(); return true; }
    }));
  }

  // ── Chat, Ask Image and Agent Skills share one conversation view ─────────

  const chats = {
    chat: { messages: [], images: [] },
    image: { messages: [], images: [] },
    agent: { messages: [], images: [] }
  };
  let busy = false;

  const SYSTEMS = {
    chat: 'You are a helpful assistant running entirely on this phone. Answer clearly and concisely.',
    image: 'You are a helpful assistant that can see the pictures you are given. Answer about them clearly and concisely.'
  };

  function chatView(task, { intro, attach, tools, onTool, system, examples = [] }) {
    const state = chats[task];
    const body = shell(task);
    const entry = modelFor(task);
    const redraw = () => VexLab.open(task);
    const newChat = el('button', { class: 'chip', onclick: async () => {
      if (busy) { await VexLocalAI.stop(); busy = false; }
      state.messages.length = 0;
      state.images.length = 0;
      if (entry && VexLocalAI.purpose() === task) {
        await VexLocalAI.use(task, { model: VexLocalAI.fileOf(entry), fresh: true, vision: !!attach,
          system, sampler: settingsFor(task, entry), tools, onTool }).catch(() => {});
      }
      redraw();
    } }, 'New chat');
    body.appendChild(modelBar(task, redraw, [newChat]));
    if (!entry) { needModel(body, task, redraw); return; }
    if (task !== 'agent') body.appendChild(settingsSection(task, entry));

    const wrap = el('div', 'chat lab-chat');
    const log = el('div', { class: 'chat-log', id: 'lab-chat-log' });
    wrap.appendChild(log);

    const paint = streaming => {
      clear(log);
      if (!state.messages.length && !streaming) log.appendChild(el('div', 'list-empty', intro));
      for (const message of state.messages) log.appendChild(bubble(message));
      if (streaming != null) {
        const live = el('div', 'bubble assistant', streaming || '…');
        live.dataset.streaming = '1';
        log.appendChild(live);
      }
      log.scrollTop = log.scrollHeight;
    };
    paint(null);

    const suggest = el('div', 'chat-suggest');
    if (!state.messages.length) {
      for (const example of examples) {
        suggest.appendChild(el('button', { class: 'chip', onclick: () => send(example) }, example));
      }
    }
    wrap.appendChild(suggest);

    const thumbs = el('div', 'lab-thumbs');
    const paintThumbs = () => {
      clear(thumbs);
      state.images.forEach((image, index) => {
        const thumb = el('div', 'lab-thumb');
        thumb.appendChild(el('img', { src: 'data:image/jpeg;base64,' + image, alt: '' }));
        const remove = el('button', { 'aria-label': 'Remove', onclick: () => { state.images.splice(index, 1); paintThumbs(); } });
        remove.appendChild(icon('close'));
        thumb.appendChild(remove);
        thumbs.appendChild(thumb);
      });
      thumbs.hidden = !state.images.length;
    };
    paintThumbs();
    wrap.appendChild(thumbs);

    const compose = el('div', 'chat-compose');
    if (attach) {
      const add = el('button', { class: 'chat-send lab-attach', 'aria-label': 'Add a picture' });
      add.appendChild(icon('camera'));
      add.onclick = () => VexSheets.choose('Add a picture', [
        { id: 'camera', label: 'Take a photo' },
        { id: 'pick', label: 'Choose from the phone' }
      ], async choice => {
        VexSheets.close();
        if (state.images.length >= 4) { VexUI.toast('Four pictures at a time'); return; }
        try {
          const picked = await VexLocalAI.pickImage(choice === 'camera');
          if (picked) { state.images.push(picked.base64); paintThumbs(); }
        } catch (error) { VexUI.toast(error.message || 'That picture could not be read', 4000); }
      });
      compose.appendChild(add);
    }
    const input = el('textarea', {
      id: 'lab-chat-input', rows: 1, enterkeyhint: 'send', autocapitalize: 'sentences',
      placeholder: attach ? 'Ask about the picture…' : task === 'agent' ? 'What should it do?' : 'Message…'
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(120, input.scrollHeight) + 'px';
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(input.value); }
    });
    compose.appendChild(input);
    const sendButton = el('button', { class: 'chat-send', 'aria-label': 'Send' });
    sendButton.appendChild(icon('send'));
    sendButton.onclick = () => {
      if (busy) { VexLocalAI.stop(); return; }
      send(input.value);
    };
    compose.appendChild(sendButton);
    wrap.appendChild(compose);
    body.appendChild(wrap);

    async function send(raw) {
      const text = String(raw || '').trim();
      if (busy) { VexUI.toast('Still answering — tap ■ to stop'); return; }
      if (!text && !state.images.length) return;
      if (attach && !state.images.length && !state.messages.some(message => message.images)) {
        VexUI.toast('Add a picture first');
        return;
      }
      input.value = '';
      clear(suggest);
      const images = state.images.splice(0);
      paintThumbs();
      // Another feature had the model since this chat began: what the model
      // remembers is gone, and pretending otherwise would be a lie.
      const fresh = restart.delete(task);
      if (state.messages.length && (fresh || VexLocalAI.purpose() !== task)) {
        state.messages.push({ role: 'note', text: fresh
          ? 'New settings, new conversation: the model has forgotten the earlier messages.'
          : 'The model was used elsewhere, so it has forgotten the earlier messages.' });
      }
      state.messages.push({ role: 'user', text, images: images.length ? images : null });
      busy = true;
      sendButton.classList.add('stop');
      paint('');
      let streamed = '';
      try {
        await VexLocalAI.use(task, {
          model: VexLocalAI.fileOf(entry), vision: !!attach, system, fresh,
          sampler: settingsFor(task, entry), tools, onTool: onTool && (async (name, args) => {
            const result = await onTool(name, args, state);
            paint(streamed);
            return result;
          })
        });
        const answer = await VexLocalAI.generate(text || 'Describe this picture.', {
          purpose: task, images,
          onToken: chunk => {
            streamed += chunk;
            const live = log.querySelector('[data-streaming="1"]');
            if (live) { live.textContent = streamed; log.scrollTop = log.scrollHeight; }
          }
        });
        state.messages.push({ role: 'assistant', text: answer || '(no answer)' });
      } catch (error) {
        state.messages.push({ role: 'error', text: error.message || String(error) });
      }
      busy = false;
      sendButton.classList.remove('stop');
      if ($('lab-chat-log') === log) paint(null);
    }
  }

  function bubble(message) {
    const node = el('div', 'bubble ' + (message.role === 'note' ? 'thinking' : message.role === 'tool' ? 'assistant lab-tool' : message.role));
    if (message.images) {
      const row = el('div', 'lab-bubble-images');
      for (const image of message.images) row.appendChild(el('img', { src: 'data:image/jpeg;base64,' + image, alt: '' }));
      node.appendChild(row);
    }
    if (message.picture) node.appendChild(message.picture);
    if (message.spin) {
      const spin = el('div', 'lab-spin', message.spin);
      node.appendChild(spin);
    }
    if (message.text) node.appendChild(document.createTextNode(message.text));
    if (message.role === 'assistant' && message.text) {
      node.appendChild(el('button', { class: 'bubble-tag lab-copy', onclick: () => VexUI.copy(message.text) }, 'Copy'));
    }
    return node;
  }

  function aiChat() {
    chatView('chat', {
      intro: 'Ask anything. It runs on this phone: no account, no network, and it keeps working in aeroplane mode.',
      system: SYSTEMS.chat,
      examples: ['Explain how a rainbow forms', 'Write a haiku about the sea', 'Plan a three-day trip to Lisbon']
    });
  }

  function askImage() {
    chatView('image', {
      intro: 'Take a photo or choose one with the camera button, then ask about it — what is in it, what a sign says, '
        + 'what a plant might be. Up to four pictures at a time.',
      attach: true,
      system: SYSTEMS.image,
      examples: ['What is in this picture?', 'Read the text in this image', 'Describe this in one sentence']
    });
  }

  // ── Audio Scribe ─────────────────────────────────────────────────────────

  const LANGUAGES = ['English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Dutch', 'Arabic', 'Hindi',
    'Urdu', 'Bengali', 'Turkish', 'Russian', 'Polish', 'Ukrainian', 'Chinese', 'Japanese', 'Korean', 'Indonesian', 'Vietnamese'];
  let scribeOutput = '';

  async function audioScribe() {
    const body = shell('audio');
    const entry = modelFor('audio');
    const redraw = () => VexLab.open('audio');
    body.appendChild(modelBar('audio', redraw));
    if (!entry) { needModel(body, 'audio', redraw); return; }
    await VexLocalAI.refresh();
    const state = VexLocalAI.state;

    const card = el('div', 'lab-card');
    const seconds = ms => Math.round(ms / 100) / 10;
    const status = el('div', 'lab-clip', state.recording
      ? 'Recording…'
      : state.clipMillis ? 'A clip of ' + seconds(state.clipMillis) + ' s is ready' : 'No clip yet — up to 30 seconds');
    card.appendChild(status);
    const meter = el('div', 'lab-meter');
    const level = el('span');
    meter.appendChild(level);
    card.appendChild(meter);

    const buttons = el('div', 'lab-buttons');
    const record = el('button', { class: 'lab-big' + (state.recording ? ' on' : '') });
    record.appendChild(icon(state.recording ? 'pause' : 'mic'));
    record.appendChild(document.createTextNode(state.recording ? ' Stop' : ' Record'));
    record.onclick = async () => {
      if (VexLocalAI.state.recording) { await VexLocalAI.stopAudio(); return; }
      try {
        const done = VexLocalAI.recordAudio(data => {
          level.style.width = (Number(data.level) || 0) + '%';
          status.textContent = 'Recording… ' + (Number(data.seconds) || 0) + ' s of 30';
        });
        redrawSoon();
        await done;
      } catch (error) { VexUI.toast(error.message || 'The recording failed', 4000); }
      redraw();
    };
    buttons.appendChild(record);
    const file = el('button', { class: 'lab-big ghost', onclick: async () => {
      try {
        const millis = await VexLocalAI.importAudio();
        if (millis) VexUI.toast('Clip ready · ' + seconds(millis) + ' s');
      } catch (error) { VexUI.toast(error.message || 'That file could not be read', 4000); }
      redraw();
    } });
    file.appendChild(icon('download'));
    file.appendChild(document.createTextNode(' Audio file'));
    buttons.appendChild(file);
    if (state.clipMillis && !state.recording) {
      buttons.appendChild(el('button', { class: 'chip', onclick: async () => { await VexLocalAI.clearAudio(); redraw(); } }, 'Clear'));
    }
    card.appendChild(buttons);
    body.appendChild(card);

    function redrawSoon() {
      record.classList.add('on');
      clear(record);
      record.appendChild(icon('pause'));
      record.appendChild(document.createTextNode(' Stop'));
    }

    const output = el('div', 'lab-output', scribeOutput || 'The transcript appears here.');
    const run = async prompt => {
      if (!VexLocalAI.state.clipMillis) { VexUI.toast('Record or choose a clip first'); return; }
      if (busy) { VexUI.toast('Still working'); return; }
      busy = true;
      scribeOutput = '';
      output.textContent = 'Listening…';
      try {
        await VexLocalAI.use('audio', { model: VexLocalAI.fileOf(entry), audio: true, fresh: true,
          sampler: settingsFor('audio', entry) });
        scribeOutput = await VexLocalAI.generate(prompt, {
          purpose: 'audio', withClip: true,
          onToken: chunk => { scribeOutput += chunk; output.textContent = scribeOutput; }
        });
        output.textContent = scribeOutput || '(nothing came back)';
      } catch (error) {
        output.textContent = error.message || String(error);
      }
      busy = false;
    };

    const actions = el('div', 'lab-buttons');
    actions.appendChild(el('button', { class: 'chip on', onclick: () =>
      run('Transcribe the following speech segment in its original language. Give only the transcript.') }, 'Transcribe'));
    actions.appendChild(el('button', { class: 'chip', onclick: () => VexSheets.choose('Translate into',
      LANGUAGES.map(name => ({ id: name, label: name })), language => {
        VexSheets.close();
        run('Transcribe the following speech segment, then translate it into ' + language
          + '. Give only the ' + language + ' translation.');
      }) }, 'Translate…'));
    actions.appendChild(el('button', { class: 'chip', onclick: async () => {
      const prompt = await VexUI.prompt('Ask about the clip', 'What should the model do with it?', 'Summarise what is said');
      if (prompt) run(prompt);
    } }, 'Ask…'));
    body.appendChild(actions);
    body.appendChild(output);
    body.appendChild(el('button', { class: 'chip', onclick: () => scribeOutput && VexUI.copy(scribeOutput) }, 'Copy'));
    body.appendChild(settingsSection('audio', entry));
  }

  // ── Prompt Lab ───────────────────────────────────────────────────────────

  const TEMPLATES = [
    {
      id: 'free', label: 'Free form', option: null,
      build: input => input,
      examples: [
        'Suggest 3 topics for a podcast about "Friendships in your 20s".',
        'Outline the key sections needed in a basic logo design brief.',
        'List 3 pros and 3 cons to consider before buying a smart watch.',
        'Write a short, optimistic quote about the future of technology.',
        'Create a simple haiku about a cat sleeping in the sun.'
      ]
    },
    {
      id: 'tone', label: 'Rewrite tone',
      option: { label: 'Tone', values: ['Formal', 'Casual', 'Friendly', 'Polite', 'Enthusiastic', 'Concise'] },
      build: (input, tone) => 'Rewrite the following text using a ' + tone.toLowerCase() + ' tone: ' + input,
      examples: ['hey, can u send me the report by tmrw? thx']
    },
    {
      id: 'summary', label: 'Summarize text',
      option: { label: 'Style', values: ['Key bullet points (3-5)', 'Short paragraph (1-2 sentences)',
        'Concise summary (~50 words)', 'Headline / title', 'One-sentence summary'] },
      build: (input, style) => 'Please summarize the following in ' + style.toLowerCase() + ': ' + input,
      examples: []
    },
    {
      id: 'code', label: 'Code snippet',
      option: { label: 'Language', values: ['C++', 'Java', 'JavaScript', 'Kotlin', 'Python', 'Swift', 'TypeScript'] },
      build: (input, language) => 'Write a ' + language + ' code snippet to ' + input,
      examples: ['reverse a string', 'check whether a number is prime', 'read a file line by line']
    }
  ];
  const prompt = { template: 'free', options: {}, input: '', output: '' };

  function promptLab() {
    const body = shell('prompt');
    const entry = modelFor('prompt');
    const redraw = () => VexLab.open('prompt');
    body.appendChild(modelBar('prompt', redraw));
    if (!entry) { needModel(body, 'prompt', redraw); return; }

    const tabs = el('div', 'panel-chips');
    for (const template of TEMPLATES) {
      tabs.appendChild(el('button', {
        class: 'chip' + (prompt.template === template.id ? ' on' : ''),
        onclick: () => { prompt.template = template.id; redraw(); }
      }, template.label));
    }
    body.appendChild(tabs);
    const template = TEMPLATES.find(item => item.id === prompt.template);
    if (template.option) {
      const chosen = prompt.options[template.id] || template.option.values[0];
      const options = el('div', 'panel-chips');
      options.appendChild(el('span', 'lab-label', template.option.label));
      for (const value of template.option.values) {
        options.appendChild(el('button', {
          class: 'chip' + (chosen === value ? ' on' : ''),
          onclick: () => { prompt.options[template.id] = value; redraw(); }
        }, value));
      }
      body.appendChild(options);
    }
    if (prompt.template === 'summary' && !prompt.input) {
      body.appendChild(el('button', { class: 'chip', onclick: async () => {
        const tab = VexTabStore.active();
        if (!tab || !tab.url || tab.url === 'about:blank') { VexUI.toast('Open a page first'); return; }
        try { prompt.input = await VexReader.pageText(tab.id, 3000); } catch { prompt.input = ''; }
        redraw();
      } }, 'Use the page I am on'));
    }
    const input = el('textarea', { class: 'lab-input', rows: 5, placeholder: 'Type your prompt…' });
    input.value = prompt.input;
    input.oninput = () => { prompt.input = input.value; };
    body.appendChild(input);
    if (!prompt.input && template.examples.length) {
      const examples = el('div', 'chat-suggest lab-examples');
      for (const example of template.examples) {
        examples.appendChild(el('button', { class: 'chip', onclick: () => { prompt.input = example; redraw(); } }, example));
      }
      body.appendChild(examples);
    }
    const output = el('div', 'lab-output', prompt.output || 'The response appears here.');
    const runButton = el('button', { class: 'lab-big', onclick: async () => {
      if (busy) { await VexLocalAI.stop(); return; }
      const text = prompt.input.trim();
      if (!text) { VexUI.toast('Type a prompt first'); return; }
      const full = template.build(text, prompt.options[template.id] || (template.option ? template.option.values[0] : ''));
      busy = true;
      runButton.textContent = 'Stop';
      prompt.output = '';
      output.textContent = '…';
      try {
        await VexLocalAI.use('prompt', { model: VexLocalAI.fileOf(entry), fresh: true, sampler: settingsFor('prompt', entry) });
        prompt.output = await VexLocalAI.generate(full, {
          purpose: 'prompt',
          onToken: chunk => { prompt.output += chunk; output.textContent = prompt.output; }
        });
        output.textContent = prompt.output || '(nothing came back)';
      } catch (error) { output.textContent = error.message || String(error); }
      busy = false;
      runButton.textContent = 'Run';
    } }, 'Run');
    body.appendChild(runButton);
    body.appendChild(output);
    body.appendChild(el('button', { class: 'chip', onclick: () => prompt.output && VexUI.copy(prompt.output) }, 'Copy'));
    body.appendChild(settingsSection('prompt', entry));
  }

  // ── Agent Skills ─────────────────────────────────────────────────────────
  //
  // The Gallery's agent: the model reads a list of skills, loads the one that
  // fits (its instructions arrive as the result of load_skill), and follows
  // them — usually by calling run_skill with what the skill asks for. Vex's
  // skills run in the chrome rather than in a hidden web view, and a few of
  // them are a browser's: open a site, search, read the page you are on.

  const SKILLS = [
    {
      name: 'query-wikipedia', description: 'Query summary from Wikipedia for a given topic.',
      instructions: 'Call the `run_skill` tool with skill_name "query-wikipedia" and `data` set to a JSON string with:\n'
        + '- topic: Required. ONLY the primary entity, person or event (e.g. "Albert Einstein"), without question words.\n'
        + '- lang: Required. The 2-letter language code of the topic, e.g. "en".\n'
        + 'Then answer in 1-3 complete sentences, in the language of the user\'s question. If the answer is not in the '
        + 'extract, say so briefly and offer a related fact that is.',
      async run(data) {
        const lang = /^[a-z]{2,3}$/.test(data.lang || '') ? data.lang : 'en';
        const topic = String(data.topic || '').trim();
        if (!topic) return { error: 'No topic given' };
        const url = 'https://' + lang + '.wikipedia.org/w/api.php?action=query&format=json&formatversion=2'
          + '&generator=search&gsrlimit=1&prop=extracts&exintro=1&explaintext=1&exchars=1500&redirects=1'
          + '&gsrsearch=' + encodeURIComponent(topic);
        const response = await VexBridge.fetchText(url);
        if (!response.ok) return { error: 'Wikipedia did not answer (' + response.status + ')' };
        const pages = ((JSON.parse(response.body || '{}').query || {}).pages) || [];
        if (!pages.length) return { result: 'No article found for ' + topic };
        return { title: pages[0].title, extract: pages[0].extract };
      }
    },
    {
      name: 'calculate-hash', description: 'Calculate the hash of a given text.',
      instructions: 'Call `run_skill` with skill_name "calculate-hash" and `data` a JSON string with:\n'
        + '- text: Required. The text to hash.\n- algorithm: One of "SHA-1", "SHA-256", "SHA-384", "SHA-512". Default "SHA-256".\n'
        + 'Then reply with the algorithm and the hash.',
      async run(data) {
        const algorithm = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'].includes(data.algorithm) ? data.algorithm : 'SHA-256';
        const digest = await crypto.subtle.digest(algorithm, new TextEncoder().encode(String(data.text || '')));
        return { algorithm, hash: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') };
      }
    },
    {
      name: 'qr-code', description: 'Generates a QR code for the given url.',
      instructions: 'Call `run_skill` with skill_name "qr-code" and `data` a JSON string with:\n- url: Required. The URL or text to encode.\n'
        + 'Then say in one sentence that the QR code is shown.',
      async run(data, state) {
        const text = String(data.url || data.text || '');
        if (!text || typeof qrcode !== 'function') return { error: 'Nothing to encode' };
        const code = qrcode(0, 'M');
        code.addData(text);
        code.make();
        const count = code.getModuleCount();
        const scale = 6;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = (count + 8) * scale;
        const context = canvas.getContext('2d');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#000';
        for (let row = 0; row < count; row++) {
          for (let column = 0; column < count; column++) {
            if (code.isDark(row, column)) context.fillRect((column + 4) * scale, (row + 4) * scale, scale, scale);
          }
        }
        canvas.className = 'lab-qr';
        state.messages.push({ role: 'tool', text: text, picture: canvas });
        return { result: 'success', shown: true };
      }
    },
    {
      name: 'send-email', description: 'Send an email.',
      instructions: 'Call `run_skill` with skill_name "send-email" and `data` a JSON string with: to, subject, body. '
        + 'Your mail app opens with it filled in; say so in one sentence.',
      async run(data) { return VexLocalAI.deviceAction('send_email', { to: data.to, subject: data.subject, body: data.body }); }
    },
    {
      name: 'create-calendar-event', description: 'Create a calendar event.',
      instructions: 'Call `run_skill` with skill_name "create-calendar-event" and `data` a JSON string with:\n'
        + '- title: Required.\n- datetime: Required, as YYYY-MM-DDTHH:MM:SS. Today is ' + '__TODAY__' + '.\n'
        + 'The calendar opens with it filled in; say so in one sentence.',
      async run(data) { return VexLocalAI.deviceAction('create_calendar_event', { title: data.title, datetime: data.datetime }); }
    },
    {
      name: 'interactive-map', description: 'Show an interactive map view for the given location.',
      instructions: 'Call `run_skill` with skill_name "interactive-map" and `data` a JSON string with:\n- location: Required. A place, business or address.',
      async run(data) { return VexLocalAI.deviceAction('show_location_on_map', { location: data.location }); }
    },
    {
      name: 'schedule-notification', description: 'Schedule a notification for a specific date or time.',
      instructions: 'Call `run_skill` with skill_name "schedule-notification" and `data` a JSON string with:\n'
        + '- message: Required. What to be reminded of.\n- datetime: Required, as YYYY-MM-DDTHH:MM:SS. Now is __NOW__.',
      async run(data) {
        const at = Date.parse(String(data.datetime || ''));
        if (!at || at <= Date.now()) return { error: 'That time is not in the future' };
        const tab = VexTabStore.active();
        const entry = await VexRemind.add({
          url: (tab && tab.url && tab.url !== 'about:blank') ? tab.url : 'https://www.google.com/',
          title: String(data.message || 'Reminder'), note: String(data.message || ''), at
        });
        return entry ? { result: 'success', at: new Date(at).toString() } : { error: 'The reminder could not be set' };
      }
    },
    {
      name: 'mood-tracker',
      description: 'A simple mood tracker that stores your daily mood and comments. Use it to log a mood, or to see the mood history.',
      instructions: 'Call `run_skill` with skill_name "mood-tracker" and `data` a JSON string with:\n'
        + '- action: "log" or "history".\n- mood: for "log", one word such as happy, calm, tired, sad, anxious.\n'
        + '- comment: optional, for "log".\nThen confirm in one sentence, or summarise the history briefly.',
      async run(data) {
        const log = Array.isArray(VexStore.get('vex.moodLog', [])) ? VexStore.get('vex.moodLog', []) : [];
        if (data.action === 'history') return { entries: log.slice(-14) };
        const entry = { date: new Date().toISOString().slice(0, 10), mood: String(data.mood || ''), comment: String(data.comment || '') };
        await VexStore.set('vex.moodLog', [...log, entry].slice(-365));
        return { result: 'success', logged: entry };
      }
    },
    {
      name: 'text-spinner', description: 'Spin the given text on my head.',
      instructions: 'Call `run_skill` with skill_name "text-spinner" and `data` a JSON string with:\n- text: Required. The text to spin.',
      async run(data, state) {
        state.messages.push({ role: 'tool', spin: String(data.text || '✨') });
        return { result: 'success' };
      }
    },
    {
      name: 'kitchen-adventure',
      description: 'Act as a dungeon master for a text-based adventure in a world where everyone is a sentient kitchen appliance. Trigger when the user says "start kitchen adventure".',
      instructions: 'You are the dungeon master of a text adventure in a world of sentient kitchen appliances. No tool is needed. '
        + 'Describe the scene in 3-4 vivid sentences, give the player 2-3 numbered choices, and wait for their move. '
        + 'Keep every turn short, funny and consistent with earlier turns.'
    },
    {
      name: 'learn-something-new',
      description: 'A learning companion that teaches the user a new concept in a few minutes.',
      instructions: 'No tool is needed. Pick a surprising, concrete concept (or the one the user asked for). Explain it in at most '
        + '120 words: what it is, one everyday example, and one question to check understanding.'
    },
    {
      name: 'open-website', description: 'Open a website in a new Vex tab.',
      instructions: 'Call `run_skill` with skill_name "open-website" and `data` a JSON string with:\n- url: Required. The address to open.',
      async run(data) {
        const url = String(data.url || '').trim();
        if (!url) return { error: 'No address given' };
        VexUI.openUrl(/^https?:\/\//.test(url) ? url : 'https://' + url, { newTab: true });
        VexUI.toast('Opened in a new tab');
        return { result: 'success', opened: url };
      }
    },
    {
      name: 'search-web', description: 'Search the web with the user\'s search engine.',
      instructions: 'Call `run_skill` with skill_name "search-web" and `data` a JSON string with:\n- query: Required.',
      async run(data) {
        const query = String(data.query || '').trim();
        if (!query) return { error: 'No query' };
        VexUI.openUrl(VexSearch.searchUrl(query), { newTab: true });
        VexUI.toast('Searching in a new tab');
        return { result: 'success', searched: query };
      }
    },
    {
      name: 'read-this-page', description: 'Read the text of the page open in Vex, to answer questions about it.',
      instructions: 'Call `run_skill` with skill_name "read-this-page" and `data` "{}". Then answer from the text it returns, briefly.',
      async run() {
        const tab = VexTabStore.active();
        if (!tab || !tab.url || tab.url === 'about:blank') return { error: 'No page is open' };
        const text = await VexReader.pageText(tab.id, 3000);
        return { title: tab.title || '', url: tab.url, text };
      }
    }
  ];

  function skillsOn() {
    const off = VexStore.get('vex.labSkillsOff', []);
    return SKILLS.filter(skill => !(Array.isArray(off) && off.includes(skill.name)));
  }

  function agentSystem() {
    const list = skillsOn().map(skill => '- Skill name: "' + skill.name + '"\n- Description: ' + skill.description).join('\n\n');
    return 'You are an AI assistant that helps users by answering questions and completes tasks using skills. '
      + 'For EVERY new task or request or question, you MUST execute the following steps in exact order. You MUST NOT skip any steps.\n\n'
      + 'CRITICAL RULE: You MUST execute all steps silently. Do NOT generate or output any internal thoughts, reasoning, '
      + 'explanations, or intermediate text at ANY step.\n\n'
      + '1. First, find the most relevant skill from the following list:\n\n' + list + '\n\n'
      + '2. If a relevant skill exists, use the `load_skill` tool to read its instructions.\n\n'
      + '3. Follow the skill\'s instructions exactly to complete the task. Output ONLY the final result when successful. '
      + 'It should contain a one-sentence summary of the action taken, and the final result of the skill.\n\n'
      + '4. If no relevant skill is found, answer the user directly and briefly.';
  }

  const AGENT_TOOLS = [
    {
      name: 'load_skill', description: 'Loads a skill.',
      parameters: { type: 'object', properties: { skill_name: { type: 'string', description: 'The name of the skill to load.' } }, required: ['skill_name'] }
    },
    {
      name: 'run_skill', description: 'Runs a skill',
      parameters: {
        type: 'object',
        properties: {
          skill_name: { type: 'string', description: 'The name of skill' },
          data: { type: 'string', description: 'The data to pass to the skill, as a JSON string. Use "{}" if there is none.' }
        },
        required: ['skill_name', 'data']
      }
    }
  ];

  async function agentTool(name, args, state) {
    const skill = SKILLS.find(item => item.name === String(args.skill_name || '').trim());
    if (name === 'load_skill') {
      if (!skill) return { skill_name: args.skill_name, skill_instructions: 'Skill not found' };
      state.messages.push({ role: 'tool', text: 'Loaded the “' + skill.name + '” skill' });
      const now = new Date();
      const pad = number => String(number).padStart(2, '0');
      const stamp = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
        + 'T' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':00';
      return {
        skill_name: skill.name,
        skill_instructions: skill.instructions.replace('__TODAY__', stamp.slice(0, 10)).replace('__NOW__', stamp)
      };
    }
    if (name === 'run_skill') {
      if (!skill || !skill.run) return { error: 'No runnable skill called ' + args.skill_name };
      let data = args.data;
      if (typeof data === 'string') { try { data = JSON.parse(data || '{}'); } catch { data = { text: data }; } }
      state.messages.push({ role: 'tool', text: 'Running “' + skill.name + '”…' });
      try {
        const result = await skill.run(data || {}, state);
        state.messages.push({ role: 'tool', text: 'Ran “' + skill.name + '”' });
        return result;
      } catch (error) {
        state.messages.push({ role: 'tool', text: '“' + skill.name + '” failed: ' + (error.message || error) });
        return { error: error.message || String(error) };
      }
    }
    return { error: 'Unknown tool ' + name };
  }

  function agentSkills() {
    chatView('agent', {
      intro: 'Ask it to do something: “What is the Eiffel Tower?”, “Make a QR code for vex.app”, '
        + '“Remind me to call Mum at 6pm”, “Start kitchen adventure”. It picks a skill, loads it and runs it — all on the phone. '
        + 'Gemma 4 is the model the Gallery uses for this.',
      tools: AGENT_TOOLS,
      onTool: agentTool,
      system: agentSystem(),
      examples: ['Tell me about the Great Barrier Reef', 'Hash "hello world" with SHA-256', 'Start kitchen adventure']
    });
    const bar = $('panel-body').querySelector('.lab-bar');
    if (bar) bar.appendChild(el('button', { class: 'chip', onclick: chooseSkills }, 'Skills · ' + skillsOn().length));
  }

  function chooseSkills() {
    const off = new Set(VexStore.get('vex.labSkillsOff', []) || []);
    VexSheets.choose('Skills it may use', SKILLS.map(skill => ({
      id: skill.name, label: skill.name, note: skill.description, selected: !off.has(skill.name)
    })), async name => {
      if (off.has(name)) off.delete(name); else off.add(name);
      await VexStore.set('vex.labSkillsOff', [...off]);
      // The skill list is part of the system prompt: a new conversation.
      chats.agent.messages.length = 0;
      VexSheets.close();
      agentSkills();
    });
  }

  // ── Tiny Garden ──────────────────────────────────────────────────────────

  const GARDEN_SYSTEM = 'You are an assistant helping the user play a game about gardening.\n\n'
    + 'The environment is a 3x3 grid of garden plots. The plots are numbered 1 through 9.\n\n'
    + '**Garden Plot Layout**:\n\n'
    + '- Row 1: Plots 1, 2, 3 (top row)\n'
    + '- Row 2: Plots 4, 5, 6 (middle row)\n'
    + '- Row 3: Plots 7, 8, 9 (bottom row)\n\n'
    + 'Help the user plant seeds, water plots, and harvest flowers.\n\n'
    + 'There are 4 kinds of seeds you can plant:\n\n'
    + '1. sunflower\n2. daisy\n3. rose\n4. special (edge gallery, special, secret)\n\n'
    + 'Plot Array: For each action, identify all individual plot numbers (1-9) or implied plots (e.g., \'top row\' -> 1, 2, 3) '
    + 'and collect them into the `plots` list.\n\n'
    + 'Tips:\n\n'
    + '- ""top row"" has plots 1, 2, 3.\n'
    + '- ""middle row"" has plots 4, 5, 6.\n'
    + '- ""bottom row"" has plots 7, 8, 9.\n'
    + '- ""left column"" has plots 1, 4, 7.\n'
    + '- ""middle column"" has plots 2, 5, 8.\n'
    + '- ""right column"" has plots 3, 6, 9.\n';

  const GARDEN_TOOLS = [
    {
      name: 'water_plots', description: 'Water one or more garden plots.',
      parameters: { type: 'object', properties: { plots: { type: 'array', items: { type: 'integer' }, description: 'The IDs of the plots to water.' } }, required: ['plots'] }
    },
    {
      name: 'plant_seed', description: 'Plant a seed in one or more garden plots.',
      parameters: {
        type: 'object',
        properties: {
          seed: { type: 'string', description: 'The name of the seed to plant.' },
          plots: { type: 'array', items: { type: 'integer' }, description: 'The IDs of the plots to plant a seed in.' }
        },
        required: ['seed', 'plots']
      }
    },
    {
      name: 'harvest_plots', description: 'Harvest one or more garden plots.',
      parameters: { type: 'object', properties: { plots: { type: 'array', items: { type: 'integer' }, description: 'The IDs of the plots to harvest.' } }, required: ['plots'] }
    }
  ];

  const FLOWERS = { sunflower: '🌻', daisy: '🌼', rose: '🌹', secret: '🪷' };
  const garden = {
    plots: Array.from({ length: 9 }, () => ({ seed: '', water: 0 })),
    basket: {}, last: { seed: '', plots: '', action: '' }, log: []
  };

  const plotList = value => (Array.isArray(value) ? value : [value])
    .map(Number).filter(number => number >= 1 && number <= 9);

  function gardenTool(name, args) {
    const plots = plotList(args.plots);
    if (!plots.length) return { result: 'failure', reason: 'no plots between 1 and 9' };
    if (name === 'plant_seed') {
      const raw = String(args.seed || '').toLowerCase();
      const seed = raw === 'special' || raw === 'edge gallery' ? 'secret' : raw;
      if (!FLOWERS[seed]) return { result: 'failure', reason: 'unknown seed ' + args.seed };
      for (const plot of plots) garden.plots[plot - 1] = { seed, water: 0 };
      garden.last = { seed, plots: plots.join(', '), action: 'plantSeed' };
      garden.log.push('Planted ' + seed + ' in ' + plots.join(', '));
    } else if (name === 'water_plots') {
      for (const plot of plots) {
        const cell = garden.plots[plot - 1];
        if (cell.seed) cell.water = Math.min(2, cell.water + 1);
      }
      garden.last = { seed: '', plots: plots.join(', '), action: 'waterPlots' };
      garden.log.push('Watered ' + plots.join(', '));
    } else if (name === 'harvest_plots') {
      for (const plot of plots) {
        const cell = garden.plots[plot - 1];
        if (cell.seed && cell.water >= 2) {
          garden.basket[cell.seed] = (garden.basket[cell.seed] || 0) + 1;
          garden.plots[plot - 1] = { seed: '', water: 0 };
        }
      }
      garden.last = { seed: '', plots: plots.join(', '), action: 'harvestPlots' };
      garden.log.push('Harvested ' + plots.join(', '));
    } else {
      return { result: 'failure', reason: 'unknown action' };
    }
    paintGarden();
    return Object.assign({ result: 'success', plots }, args.seed ? { seed: args.seed } : {});
  }

  function gardenPrompt() {
    const parts = [GARDEN_SYSTEM];
    const { seed, plots, action } = garden.last;
    if (seed || plots || action) parts.push('Here is the info about user\'s last action:');
    if (seed) parts.push('- seed: ' + seed);
    if (plots) parts.push('- plots: ' + plots);
    if (action) parts.push('- action: ' + action);
    return parts.join('\n');
  }

  function paintGarden() {
    const grid = $('lab-garden');
    if (!grid) return;
    clear(grid);
    garden.plots.forEach((cell, index) => {
      const plot = el('div', 'lab-plot' + (cell.water ? ' wet' : ''));
      plot.appendChild(el('span', 'lab-plot-number', String(index + 1)));
      plot.appendChild(el('span', 'lab-plot-plant',
        !cell.seed ? '' : cell.water >= 2 ? FLOWERS[cell.seed] : cell.water === 1 ? '🌿' : '🌱'));
      grid.appendChild(plot);
    });
    const basket = $('lab-basket');
    if (basket) {
      const items = Object.entries(garden.basket).map(([seed, count]) => FLOWERS[seed] + ' ' + count);
      basket.textContent = items.length ? 'Basket: ' + items.join('  ') : 'Plant a seed, water it twice, then harvest.';
    }
    const log = $('lab-garden-log');
    if (log) log.textContent = garden.log.slice(-3).join(' · ');
  }

  function tinyGarden() {
    commandView('garden', {
      before: body => {
        body.appendChild(el('div', { class: 'lab-garden', id: 'lab-garden' }));
        body.appendChild(el('div', { class: 'field-note', id: 'lab-basket' }));
        body.appendChild(el('div', { class: 'field-note', id: 'lab-garden-log' }));
        paintGarden();
      },
      examples: ['Plant sunflowers in the top row', 'Water the top row', 'Water plots 1, 2 and 3 again',
        'Harvest the top row', 'Plant roses in the middle column', 'Plant a daisy in plot 5'],
      placeholder: 'Tell the garden what to do…',
      tools: GARDEN_TOOLS,
      system: gardenPrompt,
      onTool: gardenTool,
      after: body => body.appendChild(el('div', 'lab-buttons')).appendChild(el('button', { class: 'chip', onclick: () => {
        garden.plots = Array.from({ length: 9 }, () => ({ seed: '', water: 0 }));
        garden.basket = {};
        garden.last = { seed: '', plots: '', action: '' };
        garden.log = [];
        paintGarden();
      } }, 'Start over'))
    });
  }

  // ── Mobile Actions ───────────────────────────────────────────────────────

  const ACTION_TOOLS = [
    { name: 'turn_on_flashlight', description: 'Turns the flashlight on' },
    { name: 'turn_off_flashlight', description: 'Turns the flashlight off' },
    {
      name: 'create_contact', description: 'Creates a contact in the phone\'s contact list.',
      parameters: {
        type: 'object',
        properties: {
          first_name: { type: 'string', description: 'The first name of the contact.' },
          last_name: { type: 'string', description: 'The last name of the contact.' },
          phone_number: { type: 'string', description: 'The phone number of the contact.' },
          email: { type: 'string', description: 'The email address of the contact.' }
        },
        required: ['first_name', 'last_name', 'phone_number', 'email']
      }
    },
    {
      name: 'send_email', description: 'Sends an email.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'The email address of the recipient.' },
          subject: { type: 'string', description: 'The subject of the email.' },
          body: { type: 'string', description: 'The body of the email.' }
        },
        required: ['to', 'subject', 'body']
      }
    },
    {
      name: 'show_location_on_map', description: 'Shows a location on the map.',
      parameters: {
        type: 'object',
        properties: { location: { type: 'string', description: 'The location to search for. May be the name of a place, a business, or an address.' } },
        required: ['location']
      }
    },
    { name: 'open_wifi_settings', description: 'Opens the WiFi settings.' },
    {
      name: 'create_calendar_event', description: 'Creates a new calendar event.',
      parameters: {
        type: 'object',
        properties: {
          datetime: { type: 'string', description: 'The date and time of the event in the format YYYY-MM-DDTHH:MM:SS.' },
          title: { type: 'string', description: 'The title of the event.' }
        },
        required: ['datetime', 'title']
      }
    }
  ];

  const actionLog = [];

  function actionsPrompt() {
    const now = new Date();
    const pad = number => String(number).padStart(2, '0');
    const stamp = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
      + 'T' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
    const day = now.toLocaleDateString('en-US', { weekday: 'long' });
    return 'You are a model that can do function calling with the following functions\n'
      + 'Current date and time given in YYYY-MM-DDTHH:MM:SS format: ' + stamp + '\nDay of week is ' + day;
  }

  async function actionTool(name, args) {
    try {
      const result = await VexLocalAI.deviceAction(name, args);
      actionLog.push({ name, args, text: (result && result.text) || name });
      paintActions();
      return Object.assign({ result: 'success' }, args);
    } catch (error) {
      actionLog.push({ name, args, text: (error.message || String(error)), failed: true });
      paintActions();
      return { result: 'failure', reason: error.message || String(error) };
    }
  }

  function paintActions() {
    const list = $('lab-actions');
    if (!list) return;
    clear(list);
    if (!actionLog.length) list.appendChild(el('div', 'list-empty', 'What it does shows up here.'));
    for (const item of actionLog.slice(-8).reverse()) {
      const args = Object.entries(item.args || {}).map(([key, value]) => key.replace(/_/g, ' ') + ': ' + value).join(' · ');
      list.appendChild(VexSheets.row({
        icon: item.failed ? 'warning' : 'check', label: item.text, note: args || item.name.replace(/_/g, ' '),
        run: async () => true
      }));
    }
  }

  function mobileActions() {
    commandView('actions', {
      before: body => {
        body.appendChild(el('div', 'field-note',
          'Say or type what you want. The model picks an action and Vex does it: the torch switches at once; '
          + 'everything else opens the app that does it, filled in, for you to confirm.'));
        body.appendChild(el('div', { class: 'lab-actions', id: 'lab-actions' }));
        paintActions();
      },
      examples: ['Turn on the flashlight', 'Turn off the flashlight', 'Show the Eiffel Tower on the map',
        'Open the Wi-Fi settings', 'Email bob@example.com that I will be late, subject running late',
        'Add a dentist appointment tomorrow at 3pm', 'Create a contact for Jane Doe, 555 0100, jane@example.com'],
      placeholder: 'What should the phone do?',
      tools: ACTION_TOOLS,
      system: actionsPrompt,
      onTool: actionTool
    });
  }

  /**
   * A text box, a microphone and examples, for the two FunctionGemma models:
   * each command is a fresh conversation, as in the Gallery, since a 270M model
   * only has room for the one request.
   */
  function commandView(task, { before, examples, placeholder, tools, system, onTool, after }) {
    const body = shell(task);
    const entry = modelFor(task);
    const redraw = () => VexLab.open(task);
    body.appendChild(modelBar(task, redraw));
    if (!entry) { needModel(body, task, redraw); return; }
    before(body);
    const reply = el('div', 'field-note lab-reply');
    const compose = el('div', 'chat-compose lab-command');
    const input = el('textarea', { rows: 1, placeholder, enterkeyhint: 'send', autocapitalize: 'sentences' });
    const run = async text => {
      const command = String(text || '').trim();
      if (!command) return;
      if (busy) { VexUI.toast('Still working'); return; }
      busy = true;
      input.value = '';
      reply.textContent = '“' + command + '” …';
      try {
        await VexLocalAI.use(task, {
          model: VexLocalAI.fileOf(entry), fresh: true, system: system(), tools, onTool,
          sampler: settingsFor(task, entry)
        });
        const answer = await VexLocalAI.generate(command, { purpose: task });
        reply.textContent = '“' + command + '” — ' + (answer || 'done');
      } catch (error) {
        reply.textContent = error.message || String(error);
      }
      busy = false;
    };
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); run(input.value); }
    });
    const mic = el('button', { class: 'chat-send lab-attach', 'aria-label': 'Speak' });
    mic.appendChild(icon('mic'));
    mic.onclick = async () => {
      try {
        const heard = await VexBridge.voiceInput();
        if (heard) run(heard);
      } catch (error) { VexUI.toast(error.message || 'Voice input is not available', 3000); }
    };
    compose.appendChild(mic);
    compose.appendChild(input);
    const send = el('button', { class: 'chat-send', 'aria-label': 'Send', onclick: () => run(input.value) });
    send.appendChild(icon('send'));
    compose.appendChild(send);
    body.appendChild(compose);
    body.appendChild(reply);
    const chips = el('div', 'chat-suggest lab-examples');
    for (const example of examples) chips.appendChild(el('button', { class: 'chip', onclick: () => run(example) }, example));
    body.appendChild(chips);
    if (after) after(body);
  }

  // ── Scrapbook ────────────────────────────────────────────────────────────
  //
  // A page, a background colour, and cut-outs you place on it. A photo opens
  // in the cutter: tap or scribble over the thing you want (a second mode
  // scribbles out what you do not), and MediaPipe's segmenter hands back the
  // thing alone, transparent around it. Add it to the page, drag it where it
  // goes, make it bigger or smaller, turn it; save the page as a PNG.

  const PAGE_COLOURS = ['#fff8ec', '#ffffff', '#1f2430', '#fde2e4', '#e2f0cb', '#cde7f0', '#ffe8a3'];
  const scrap = { stickers: [], background: PAGE_COLOURS[0], selected: -1, cutting: null };

  function scrapbook() {
    const body = shell('scrapbook');
    const entry = modelFor('scrapbook');
    const redraw = () => VexLab.open('scrapbook');
    body.appendChild(modelBar('scrapbook', redraw));
    if (!entry) { needModel(body, 'scrapbook', redraw); return; }
    if (scrap.cutting) { cutter(body, entry); return; }

    const tools = el('div', 'panel-chips');
    tools.appendChild(el('button', { class: 'chip on', onclick: () => openPhoto(entry, false) }, 'Add a photo'));
    tools.appendChild(el('button', { class: 'chip', onclick: () => openPhoto(entry, true) }, 'Take one'));
    for (const colour of PAGE_COLOURS) {
      const swatch = el('button', { class: 'lab-swatch' + (scrap.background === colour ? ' on' : ''), 'aria-label': 'Page colour' });
      swatch.style.background = colour;
      swatch.onclick = () => { scrap.background = colour; paintPage(); redraw(); };
      tools.appendChild(swatch);
    }
    body.appendChild(tools);

    const page = el('div', { class: 'lab-page', id: 'lab-page' });
    body.appendChild(page);
    paintPage();

    const edit = el('div', 'panel-chips');
    const act = (label, fn) => edit.appendChild(el('button', { class: 'chip', onclick: () => {
      const sticker = scrap.stickers[scrap.selected];
      if (!sticker) { VexUI.toast('Tap a cut-out on the page first'); return; }
      fn(sticker);
      paintPage();
    } }, label));
    act('Bigger', sticker => { sticker.scale = Math.min(4, sticker.scale * 1.15); });
    act('Smaller', sticker => { sticker.scale = Math.max(0.15, sticker.scale / 1.15); });
    act('Turn', sticker => { sticker.rotate = (sticker.rotate + 15) % 360; });
    act('To front', sticker => {
      scrap.stickers.splice(scrap.selected, 1);
      scrap.stickers.push(sticker);
      scrap.selected = scrap.stickers.length - 1;
    });
    act('Remove', () => { scrap.stickers.splice(scrap.selected, 1); scrap.selected = -1; });
    body.appendChild(edit);
    body.appendChild(el('button', { class: 'lab-big', onclick: savePage }, 'Save the page'));
    if (!scrap.stickers.length) {
      body.appendChild(el('div', 'field-note', 'Add a photo, tap the thing you want, and it comes out on its own.'));
    }
  }

  async function openPhoto(entry, capture) {
    try {
      const picked = await VexBridge.localAI('scrapOpen', { model: VexLocalAI.fileOf(entry), capture });
      if (!picked || !picked.picked) return;
      scrap.cutting = { image: picked.base64, width: picked.width, height: picked.height, positive: [], negative: [], mode: 'add', cut: null };
      VexLab.open('scrapbook');
    } catch (error) { VexUI.toast(error.message || 'That photo could not be opened', 4000); }
  }

  function cutter(body, entry) {
    const cut = scrap.cutting;
    body.appendChild(el('div', 'field-note', 'Tap or scribble over what you want to cut out. Switch to “Take away” to scribble out what you do not.'));
    const modes = el('div', 'panel-chips');
    for (const [id, label] of [['add', 'Select'], ['remove', 'Take away']]) {
      modes.appendChild(el('button', { class: 'chip' + (cut.mode === id ? ' on' : ''), onclick: () => { cut.mode = id; VexLab.open('scrapbook'); } }, label));
    }
    modes.appendChild(el('button', { class: 'chip', onclick: () => { cut.positive = []; cut.negative = []; cut.cut = null; VexLab.open('scrapbook'); } }, 'Start again'));
    body.appendChild(modes);

    const stage = el('div', 'lab-cutter');
    const photo = el('img', { src: cut.image ? 'data:image/jpeg;base64,' + cut.image : '', alt: '', draggable: 'false' });
    stage.appendChild(photo);
    const overlay = el('canvas', 'lab-cut-overlay');
    stage.appendChild(overlay);
    body.appendChild(stage);
    const status = el('div', 'field-note', cut.cut ? 'Cut out. Add it to the page, or keep refining.' : '');
    body.appendChild(status);

    const paintOverlay = () => {
      const rect = stage.getBoundingClientRect();
      overlay.width = Math.max(1, Math.round(rect.width));
      overlay.height = Math.max(1, Math.round(rect.height));
      const context = overlay.getContext('2d');
      context.clearRect(0, 0, overlay.width, overlay.height);
      if (cut.cut) {
        context.fillStyle = 'rgba(0,0,0,0.45)';
        context.fillRect(0, 0, overlay.width, overlay.height);
        const image = new Image();
        image.onload = () => {
          const sx = overlay.width / cut.width;
          const sy = overlay.height / cut.height;
          context.drawImage(image, cut.cut.x * sx, cut.cut.y * sy, cut.cut.w * sx, cut.cut.h * sy);
          drawStrokes(context);
        };
        image.src = 'data:image/png;base64,' + cut.cut.png;
      } else {
        drawStrokes(context);
      }
    };
    const drawStrokes = context => {
      const draw = (strokes, colour) => {
        context.strokeStyle = colour;
        context.lineWidth = 6;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        for (const stroke of strokes) {
          context.beginPath();
          stroke.forEach(([x, y], index) => {
            const px = x * overlay.width;
            const py = y * overlay.height;
            if (index) context.lineTo(px, py); else context.moveTo(px, py);
          });
          if (stroke.length === 1) context.lineTo(stroke[0][0] * overlay.width + 0.1, stroke[0][1] * overlay.height);
          context.stroke();
        }
      };
      draw(cut.positive, 'rgba(80,200,120,0.9)');
      draw(cut.negative, 'rgba(230,80,80,0.9)');
    };
    photo.onload = paintOverlay;
    if (photo.complete) setTimeout(paintOverlay, 0);

    let current = null;
    const point = event => {
      const rect = stage.getBoundingClientRect();
      return [Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
        Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))];
    };
    overlay.onpointerdown = event => {
      overlay.setPointerCapture(event.pointerId);
      current = [point(event)];
      (cut.mode === 'add' ? cut.positive : cut.negative).push(current);
      paintOverlay();
    };
    overlay.onpointermove = event => {
      if (!current) return;
      const next = point(event);
      const last = current[current.length - 1];
      if (Math.hypot(next[0] - last[0], next[1] - last[1]) > 0.01) { current.push(next); paintOverlay(); }
    };
    overlay.onpointerup = async () => {
      if (!current) return;
      current = null;
      status.textContent = 'Cutting…';
      try {
        const result = await VexBridge.localAI('scrapCut', {
          model: VexLocalAI.fileOf(entry), positive: cut.positive, negative: cut.negative
        });
        cut.cut = result && result.found ? result : null;
        status.textContent = cut.cut ? 'Cut out. Add it to the page, or keep refining.' : 'Nothing found there — try another spot.';
      } catch (error) {
        status.textContent = error.message || 'The cut-out failed';
      }
      paintOverlay();
    };

    const done = el('div', 'panel-chips');
    done.appendChild(el('button', { class: 'chip on', onclick: () => {
      if (!cut.cut) { VexUI.toast('Tap something in the photo first'); return; }
      const ratio = cut.cut.w / Math.max(1, cut.cut.h);
      scrap.stickers.push({
        png: cut.cut.png, ratio, x: 0.5, y: 0.5, scale: Math.min(0.6, 0.45 * Math.max(1, ratio)), rotate: 0
      });
      scrap.selected = scrap.stickers.length - 1;
      // Keep the photo open for the next thing in it.
      cut.positive = [];
      cut.negative = [];
      cut.cut = null;
      VexUI.toast('Added to the page');
      VexLab.open('scrapbook');
    } }, 'Add to page'));
    done.appendChild(el('button', { class: 'chip', onclick: () => {
      scrap.cutting = null;
      VexBridge.localAI('scrapClose', {}).catch(() => {});
      VexLab.open('scrapbook');
    } }, 'Back to the page'));
    body.appendChild(done);
  }

  function paintPage() {
    const page = $('lab-page');
    if (!page) return;
    clear(page);
    page.style.background = scrap.background;
    scrap.stickers.forEach((sticker, index) => {
      const image = el('img', {
        class: 'lab-sticker' + (index === scrap.selected ? ' on' : ''),
        src: 'data:image/png;base64,' + sticker.png, alt: '', draggable: 'false'
      });
      image.style.left = (sticker.x * 100) + '%';
      image.style.top = (sticker.y * 100) + '%';
      image.style.width = (sticker.scale * 100) + '%';
      image.style.transform = 'translate(-50%, -50%) rotate(' + sticker.rotate + 'deg)';
      let start = null;
      image.onpointerdown = event => {
        event.preventDefault();
        image.setPointerCapture(event.pointerId);
        scrap.selected = index;
        start = { x: event.clientX, y: event.clientY, sx: sticker.x, sy: sticker.y };
        page.querySelectorAll('.lab-sticker').forEach(node => node.classList.toggle('on', node === image));
      };
      image.onpointermove = event => {
        if (!start) return;
        const rect = page.getBoundingClientRect();
        sticker.x = Math.min(1, Math.max(0, start.sx + (event.clientX - start.x) / rect.width));
        sticker.y = Math.min(1, Math.max(0, start.sy + (event.clientY - start.y) / rect.height));
        image.style.left = (sticker.x * 100) + '%';
        image.style.top = (sticker.y * 100) + '%';
      };
      image.onpointerup = () => { start = null; };
      page.appendChild(image);
    });
  }

  async function savePage() {
    if (!scrap.stickers.length) { VexUI.toast('Add a cut-out first'); return; }
    const width = 1200;
    const height = 1600;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = scrap.background;
    context.fillRect(0, 0, width, height);
    for (const sticker of scrap.stickers) {
      const image = await new Promise(resolve => {
        const node = new Image();
        node.onload = () => resolve(node);
        node.onerror = () => resolve(null);
        node.src = 'data:image/png;base64,' + sticker.png;
      });
      if (!image) continue;
      const w = sticker.scale * width;
      const h = w * image.height / Math.max(1, image.width);
      context.save();
      context.translate(sticker.x * width, sticker.y * height);
      context.rotate(sticker.rotate * Math.PI / 180);
      context.drawImage(image, -w / 2, -h / 2, w, h);
      context.restore();
    }
    const base64 = canvas.toDataURL('image/png').split(',')[1];
    try {
      await VexBridge.writeToDownloads('Vex scrapbook ' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.png', 'image/png', base64);
      VexUI.toast('Saved to Downloads');
    } catch (error) { VexUI.toast(error.message || 'It could not be saved', 4000); }
  }

  // ── Opening ──────────────────────────────────────────────────────────────

  const OPEN = {
    chat: aiChat, image: askImage, audio: audioScribe, prompt: promptLab,
    agent: agentSkills, garden: tinyGarden, actions: mobileActions, scrapbook
  };

  let followed = false;

  return {
    FEATURES, SKILLS, GARDEN_TOOLS, ACTION_TOOLS, AGENT_TOOLS, garden, chats,
    home,
    modelFor,
    gardenTool,

    /** Open one feature by id: chat, image, audio, prompt, agent, garden, actions, scrapbook. */
    async open(id) {
      if (!followed) {
        followed = true;
        // A download finishing while a feature waits for its model redraws it.
        // A feature showing "get a model" redraws as its download moves, and
        // once more when the model lands — then it is the feature itself. (It
        // used to redraw only while the model was still missing, so the one
        // redraw that mattered never happened: found by using Tiny Garden.)
        VexLocalAI.onChange(() => {
          const top = waiting && feature(waiting);
          if (top && VexPanels.top() === top.panel && !busy) {
            clearTimeout(this._redraw);
            this._redraw = setTimeout(() => { if (VexPanels.top() === top.panel) OPEN[top.id](); }, 400);
          }
        });
      }
      if (!OPEN[id]) return home();
      waiting = null;
      if (!Object.keys(VexLocalAI.state.models || {}).length) await VexLocalAI.refresh();
      return OPEN[id]();
    }
  };
})();

if (typeof window !== 'undefined') window.VexLab = VexLab;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexLab };
