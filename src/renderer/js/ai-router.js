// === Vex Phase 14: AI Router ===
//
// Decides per-feature whether an AI request goes to the Cloudflare worker
// (Claude) or to a local Ollama model. Honours user prefs (forceCloud,
// preferLocal, per-feature override), online status, and Ollama availability.
// Falls back to the other backend on transient errors unless the user
// explicitly chose local.
// Public API: AIRouter (singleton — init, callAI, resolveBackend, set/get
// prefs, getOllamaStatus). Depends on Ollama, browser fetch.

const AIRouter = (() => {
  // The cloud backend is a Cloudflare Worker each user deploys themselves
  // (see SELF_HOSTING.md). Its URL is set in Settings (VexConfig). Empty means
  // "cloud not configured" — auto routing then prefers local Ollama, and an
  // explicit cloud request surfaces a clear setup error.
  function cloudWorkerUrl() {
    try { return (typeof window !== 'undefined' && window.VexConfig) ? window.VexConfig.aiWorkerUrl() : ''; }
    catch { return ''; }
  }

  const DEFAULT_ROUTING = {
    chat: 'auto',
    summarize: 'auto',
    translate: 'cloud',
    explain: 'auto',
    historyIndex: 'local',
    historySearch: 'cloud',
    agent: 'cloud',
    multiTab: 'cloud',
    groupTabs: 'auto'
  };

  let routingPrefs = { ...DEFAULT_ROUTING };
  let preferLocal = false;
  let forceCloud = false;
  let localModel = 'llama3.2:3b';
  let ollamaAvailable = null;
  let checkTimer = null;

  // Per-call routing logs are useful when debugging AI backends but otherwise
  // spam the console on every request. Silence them unless vex.aiDebug is set.
  function _dbg(...a) { try { if (localStorage.getItem('vex.aiDebug') === '1') console.log(...a); } catch {} }

  // ---------- Storage helpers (wrap localStorage; data is mirrored to disk) ----------
  function _load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch { return fallback; }
  }
  function _save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  async function init() {
    routingPrefs = { ...DEFAULT_ROUTING, ..._load('vex.aiRouting', {}) };
    preferLocal = _load('vex.preferLocalAI', false) === true;
    forceCloud = _load('vex.forceCloudAI', false) === true;
    localModel = _load('vex.localAIModel', 'llama3.2:3b');
    await refreshOllamaStatus();
    // Have the local model ready before the first request, not during it.
    if (!ollamaAvailable && dependsOnLocal()) ollamaUp().catch(err => console.warn('[AIRouter] could not start Ollama:', err.message));
    if (checkTimer) clearInterval(checkTimer);
    checkTimer = setInterval(refreshOllamaStatus, 30000);
  }

  async function refreshOllamaStatus() {
    // A throw here used to reject init() (leaving the 30s re-check timer unset)
    // and reject the Settings "Refresh" button with a raw error.
    try { ollamaAvailable = (await Ollama.ping()) === true; }
    catch { ollamaAvailable = false; }
    _dbg('[AIRouter] Ollama ping result:', ollamaAvailable);
    return ollamaAvailable;
  }

  function isOllamaAvailable() { return ollamaAvailable === true; }
  function isOnline() {
    try { return navigator.onLine; } catch { return true; }
  }

  // Live Ollama reachability check (also refreshes the cached flag). Used by the
  // auto path when cloud is unconfigured, so a stale `ollamaAvailable` flag can't
  // wrongly route to a missing cloud worker.
  async function pingOllama() {
    try {
      const up = (await Ollama.ping()) === true;
      ollamaAvailable = up;
      return up;
    } catch {
      ollamaAvailable = false;
      return false;
    }
  }

  // After a reboot Ollama is simply not running, and every local AI request
  // failed until the user opened it by hand. When the local backend is wanted
  // and does not answer, Vex starts it (main/ollama-launcher.js) — at most one
  // attempt a minute, only for the default address on this machine, and not at
  // all with Settings › AI › "Start Ollama when it is needed" off.
  let _ollamaStartAt = 0;
  function ollamaAutoStart() { return _load('vex.ollamaAutoStart', true) !== false; }
  function setOllamaAutoStart(on) { _save('vex.ollamaAutoStart', !!on); }
  async function ollamaUp() {
    if (await pingOllama()) return true;
    if (!ollamaAutoStart() || typeof window === 'undefined' || !window.vex || typeof window.vex.ollamaEnsure !== 'function') return false;
    if (!/^https?:\/\/(localhost|127\.0\.0\.1):11434$/.test(Ollama.getBaseUrl())) return false;
    if (Date.now() - _ollamaStartAt < 60000) return false;
    _ollamaStartAt = Date.now();
    const r = await window.vex.ollamaEnsure();
    if (r && r.error) { console.warn('[AIRouter] ' + r.error); if (typeof VexProblems !== 'undefined') VexProblems.note('Local AI', 'Ollama could not be started', r.error); }
    return pingOllama();
  }

  // Does this setup rely on the local model? (no AI Worker, "prefer local", or
  // a feature pinned to local) — then it is worth having Ollama up before the
  // first request rather than during it.
  function dependsOnLocal() {
    if (forceCloud) return false;
    return !cloudWorkerUrl() || preferLocal || Object.values(routingPrefs).includes('local');
  }

  // On-device (WebLLM/WebGPU) wins for chat-like features when the user has
  // turned it on AND a model is actually loaded. Small models can't do the
  // agent / structured-history features well, so those still route normally.
  // Only chat runs on-device — the small local models can't reliably produce the
  // strict JSON the structured features (summarize/translate/explain/groupTabs)
  // render from, so those stay on cloud/Ollama even when on-device is enabled.
  const ONDEVICE_FEATURES = ['chat'];
  const ONDEVICE_CHAT_PROMPT = `You are Vex AI, a friendly, concise browser assistant running locally on the user's device. Answer clearly and directly in plain text (no JSON, no preamble). Use any provided page content to inform your answer, and match the user's language.`;
  function onDeviceReady(feature) {
    try {
      return typeof WebLLM !== 'undefined' && WebLLM.preferred() && WebLLM.isLoaded() && ONDEVICE_FEATURES.includes(feature);
    } catch { return false; }
  }

  async function resolveBackend(feature) {
    let decision;
    if (onDeviceReady(feature)) {
      decision = 'ondevice';
    } else if (forceCloud) {
      decision = 'cloud';
    } else {
      const pref = routingPrefs[feature] || 'auto';
      if (pref === 'cloud') {
        // The agent prefers the cloud model. With no AI Worker configured it
        // used to be simply unavailable — "Cloud AI is not configured" — even
        // with a capable local model running. Now the local model drives it.
        decision = (feature === 'agent' && !cloudWorkerUrl() && await ollamaUp()) ? 'local' : 'cloud';
      } else if (pref === 'local') {
        // Local-only feature (e.g. history indexing runs on-device for privacy).
        // If Ollama isn't installed/running, skip quietly instead of failing on
        // every page — no console spam, no doomed fetch to a dead port.
        // A background feature never starts Ollama by itself; a request the
        // user just made does.
        decision = (isOllamaAvailable() || (!BACKGROUND_FEATURES.includes(feature) && await ollamaUp())) ? 'local' : 'skip';
      } else {
        // auto mode
        const hasCloud = isOnline() && !!cloudWorkerUrl();
        if (hasCloud) {
          // Cloud is viable; only choose local if the user prefers it AND
          // Ollama is already known to be up.
          decision = (preferLocal && (isOllamaAvailable() || await ollamaUp())) ? 'local' : 'cloud';
        } else {
          // Cloud is unconfigured (or offline). Don't trust a possibly-stale
          // availability flag — ping Ollama live. Use local if it answers; only
          // fall through to 'cloud' (which surfaces the "not configured" error)
          // when Ollama is ALSO unavailable.
          decision = (await ollamaUp()) ? 'local' : 'cloud';
        }
      }
    }
    _dbg(`[AIRouter] resolveBackend(${feature}):`, {
      decision, forceCloud, preferLocal,
      featurePref: routingPrefs[feature],
      ollamaAvailable, online: isOnline()
    });
    return decision;
  }

  // Features that run silently in the background: when they're set to local and
  // Ollama isn't there, doing nothing is the right answer. Every OTHER feature is
  // something the user just asked for, so it must fail loudly instead of
  // resolving to null (callers then did `result.result` on null and showed
  // "Cannot read properties of null" instead of a real explanation).
  const BACKGROUND_FEATURES = ['historyIndex'];

  async function callAI(feature, request) {
    // A game is running and the user asked Vex to hold background AI: work
    // nobody is waiting for does not load a model onto the game's graphics
    // card. A question the user asks still goes through.
    if (BACKGROUND_FEATURES.includes(feature) && typeof window !== 'undefined' && window.GameMode && typeof window.GameMode.holdingAi === 'function' && window.GameMode.holdingAi()) {
      _dbg(`[AIRouter] holding ${feature} — a game is running`);
      return null;
    }
    const primary = await resolveBackend(feature);
    if (primary === 'skip') {
      _dbg(`[AIRouter] skipping ${feature} — no local backend`);
      if (BACKGROUND_FEATURES.includes(feature)) return null;
      throw new Error(`Local AI is selected for "${feature}" but Ollama isn't running. Start Ollama, or switch this feature to Auto/Cloud in Settings → AI.`);
    }
    const fallback = primary === 'cloud' ? 'local' : 'cloud';
    _dbg(`[AIRouter] callAI(${feature}) → using backend: ${primary}`);
    try {
      const out = await callBackend(primary, feature, request);
      _dbg(`[AIRouter] ${primary} succeeded for ${feature}`);
      return out;
    } catch (err) {
      // Stopped by the user: that is not a failure to fall back from.
      if (request && request.signal && request.signal.aborted) throw err;
      console.warn(`[AIRouter] ${primary} failed for ${feature}:`, err.message);
      if (typeof VexProblems !== 'undefined') VexProblems.note('AI', `${primary} failed for "${feature}"`, err.message);

      // Respect explicit user intent: if user picked "Prefer local" or feature=local,
      // don't silently fall back to cloud — that's the whole point of the mode.
      const featurePref = routingPrefs[feature] || 'auto';
      const userWantsLocal = preferLocal || featurePref === 'local';
      if (primary === 'local' && userWantsLocal) {
        throw new Error(`Local AI failed: ${err.message}. (Not falling back to cloud because you selected local mode.)`);
      }
      // Same rule for on-device (WebGPU): the user switched it on to keep the
      // conversation on their machine. Quietly re-sending the same prompt — and
      // any page text with it — to the cloud worker would break that promise.
      if (primary === 'ondevice') {
        throw new Error(`On-device AI failed: ${err.message}. (Not falling back to the cloud because on-device AI is switched on — turn it off in Settings → AI to use the cloud.)`);
      }

      // Availability gates for fallback
      if (fallback === 'local' && !isOllamaAvailable()) throw err;
      if (fallback === 'cloud' && !isOnline()) throw err;
      if (feature === 'agent' && fallback === 'local') throw err;

      console.warn(`[AIRouter] falling back to ${fallback} for ${feature}`);
      try {
        return await callBackend(fallback, feature, request);
      } catch (err2) {
        throw new Error(`Both ${primary} (${err.message}) and ${fallback} (${err2.message}) AI failed`);
      }
    }
  }

  async function callBackend(backend, feature, request) {
    if (backend === 'ondevice') return await callOnDevice(feature, request);
    if (backend === 'local') return await callLocal(feature, request);
    return await callCloud(feature, request);
  }

  // ---------- ON-DEVICE (WebLLM / WebGPU) ----------
  // Mirrors the Ollama path (small models → tight JSON prompts) but runs the
  // model locally in the renderer. Any failure throws and callAI falls back to
  // cloud/local automatically.
  async function callOnDevice(feature, request) {
    if (typeof WebLLM === 'undefined' || !WebLLM.isLoaded()) throw new Error('On-device model not loaded');
    // chat-only (see ONDEVICE_FEATURES). Plain-text answer → _parseResponse wraps
    // it as { reply }. A persona prompt still wins if one is active.
    const systemPrompt = request.persona?.systemPrompt || ONDEVICE_CHAT_PROMPT;
    const temperature = request.persona?.temperature ?? 0.6;

    let userMessage = '';
    if (request.pageContext) {
      const pc = request.pageContext;
      userMessage += `Page title: ${pc.title || ''}\nURL: ${pc.url || ''}\n\nContent:\n${(pc.text || '').substring(0, 2000)}\n\n`;
    }
    if (request.selectedText) userMessage += `Selected text: "${request.selectedText}"\n\n`;
    if (request.message) userMessage += request.message;
    if (!userMessage) userMessage = 'Hello';

    const msgs = [{ role: 'system', content: systemPrompt }];
    if (Array.isArray(request.conversationHistory)) {
      // The AI-memory facts ride at the FRONT of the history as a system
      // message. A blind slice(-8) dropped it as soon as the chat got long, so
      // "remember that I…" quietly stopped applying on the on-device backend.
      const hist = request.conversationHistory.filter(m => m && m.role && m.content);
      const system = hist.filter(m => m.role === 'system');
      const turns = hist.filter(m => m.role !== 'system').slice(-8);
      for (const m of [...system, ...turns]) msgs.push({ role: m.role, content: m.content });
    }
    msgs.push({ role: 'user', content: userMessage });

    const text = await WebLLM.chat(msgs, { temperature, maxTokens: 800 });
    return { result: text, backend: 'ondevice', model: WebLLM.loadedModel() };
  }

  // ---------- LOCAL (Ollama) ----------
  // The agent on a local model. Same contract as the cloud worker's agent
  // action: system prompt + tool list, the conversation so far (the agent
  // guide rides at its head), then the goal, the page state and the last tool
  // result. Two things a local model needs that the cloud does not: a context
  // window big enough for all that (Ollama's default 4,096 tokens drops the
  // START of the prompt — the instructions), and a low temperature so the
  // tool call is the same JSON shape every time.
  // Whether a local model can see images (Ollama reports it), cached per model.
  const _vision = new Map();
  async function localVision(model) {
    if (_vision.has(model)) return _vision.get(model);
    const info = await Ollama.show(model);
    const can = Array.isArray(info && info.capabilities) && info.capabilities.includes('vision');
    _vision.set(model, can);
    return can;
  }

  // The agent's context window on a local model (Settings › AI). 16,384 fits a
  // long research run on a 16 GB machine; Ollama's default 4,096 does not.
  function agentNumCtx() {
    const n = Number(_load('vex.agentNumCtx', 16384));
    return [8192, 16384, 32768, 65536].includes(n) ? n : 16384;
  }

  async function callLocalAgent(request, modelOverride) {
    const model = modelOverride || localModel;
    const system = LOCAL_SYSTEM_PROMPTS.agent + '\n\nAvailable tools:\n' + JSON.stringify(request.availableTools || []);
    const msgs = [{ role: 'system', content: system }];
    for (const m of (Array.isArray(request.conversationHistory) ? request.conversationHistory : [])) {
      if (m && m.role && m.content) msgs.push({ role: m.role, content: String(m.content).slice(0, 3500) });
    }
    let um = "User's goal: " + (request.userGoal || request.message || '') + '\n\n';
    const pc = request.pageContext;
    if (pc) {
      um += 'Current page:\nURL: ' + (pc.url || '') + '\nTitle: ' + (pc.title || '') + '\n';
      if (pc.elements) um += '\nInteractive elements (first 40):\n' + JSON.stringify((pc.elements || []).slice(0, 40)) + '\n';
      if (pc.text) um += '\nPage text (truncated):\n' + String(pc.text).substring(0, 3000) + '\n';
    } else {
      um += 'Current page: none loaded. Tools that need no page still work (web_search, read_url, tabs, notes…).\n';
    }
    if (request.lastToolResult) um += '\nLast tool result:\n' + JSON.stringify(request.lastToolResult).slice(0, 9000) + '\n';
    // A screenshot the agent asked for. Ollama takes images as bare base64 on
    // the message; a model without vision is told so, instead of being shown
    // nothing and left to guess what the page looks like.
    const last = { role: 'user', content: '' };
    if (request.image) {
      if (await localVision(model)) {
        last.images = [String(request.image).replace(/^data:image\/[a-z]+;base64,/, '')];
        um += '\nA screenshot of the current page is attached to this message.\n';
      } else {
        um += '\nNote: you asked for a screenshot, but this local model (' + model + ') cannot see images. Use extract_text and extract_elements instead.\n';
      }
    }
    um += "\nWhat's your next action? Reply with ONE JSON object.";
    last.content = um;
    msgs.push(last);
    // Before a slow one, say why it will be slow: a model pushed out of video
    // memory by a game runs on the processor and takes minutes, which used to
    // be indistinguishable from the agent having hung (js/ai-health.js).
    await warnIfSlow(request);
    // request.signal is the agent's Stop: it cancels the generation in flight.
    // onToken streams the reply as it is written — without it a local model
    // shows "Thinking…" for a minute and a stuck run looks the same as a slow one.
    const text = await Ollama.chat(model, msgs, { temperature: 0.2, maxTokens: 3000, format: 'json', numCtx: agentNumCtx(), signal: request.signal, onMeta: request.onMeta, onToken: request.onToken, ...thinkOpts(request) });
    return { result: text, backend: 'local', model };
  }

  // A question about an image (right-click a picture). The chat prompt, the
  // page context and the picture, in one turn.
  async function callLocalVisionChat(request) {
    const model = localModel;
    if (!(await localVision(model))) throw new Error(model + " cannot see images. Settings › AI › the model manager lists which of your models can — llava, llama3.2-vision, qwen3.5 and gemma3 can.");
    const msgs = [{ role: 'system', content: LOCAL_SYSTEM_PROMPTS.chat }];
    for (const m of (Array.isArray(request.conversationHistory) ? request.conversationHistory : [])) {
      if (m && m.role && m.content) msgs.push({ role: m.role, content: String(m.content).slice(0, 3000) });
    }
    msgs.push({ role: 'user', content: String(request.message || 'What is in this image?'), images: [String(request.image).replace(/^data:image\/[a-z]+;base64,/, '')] });
    const text = await Ollama.chat(model, msgs, { temperature: 0.4, maxTokens: 1200, numCtx: agentNumCtx(), signal: request.signal, onToken: request.onToken, ...thinkOpts(request) });
    return { result: text, backend: 'local', model };
  }
  // Before a local request that will be slow, say why and what to do instead
  // (a smaller model that fits, or the cloud) — request.onSlow(why, advice).
  async function warnIfSlow(request) {
    if (typeof AIHealth === 'undefined' || typeof request.onSlow !== 'function') return;
    try { const advice = await AIHealth.slowAdvice(); if (advice) request.onSlow(advice.why, advice); } catch { /* a diagnosis is never worth failing the request for */ }
  }

  async function callLocal(feature, request) {
    if (feature === 'agent') return callLocalAgent(request);
    // A question about an image (right-click → "Ask Vex about this image").
    // Ollama takes images as bare base64 on the message, same as the agent's
    // screenshot; a model without vision is told rather than left guessing.
    if (request.image && feature === 'chat') return callLocalVisionChat(request);
    // Phase 15: persona overrides the default system prompt + temperature.
    // Structured features (summarize/translate/etc.) keep their built-in
    // JSON-schema prompts — persona only overrides chat.
    const isStructured = ['summarize', 'translate', 'explain', 'historyIndex', 'historySearch'].includes(feature);
    const systemPrompt = (!isStructured && request.persona?.systemPrompt)
      ? request.persona.systemPrompt
      : (LOCAL_SYSTEM_PROMPTS[feature] || LOCAL_SYSTEM_PROMPTS.chat);
    const temperature = request.persona?.temperature ?? 0.5;

    let userMessage = '';
    if (request.pageContext) {
      const pc = request.pageContext;
      userMessage += `Page title: ${pc.title || ''}\nURL: ${pc.url || ''}\n\nContent:\n${(pc.text || '').substring(0, 4000)}\n\n`;
    }
    if (request.selectedText) {
      userMessage += `Selected text: "${request.selectedText}"\n\n`;
    }
    if (request.message) userMessage += `User: ${request.message}`;
    if (!userMessage) userMessage = JSON.stringify(request);

    // All local features expect JSON because LOCAL_SYSTEM_PROMPTS.chat also
    // asks for {"reply": "..."} — without format:'json' small models ramble.
    const expectsJson = true;

    await warnIfSlow(request);

    // Multi-turn chat: pass history when available
    if (feature === 'chat' && Array.isArray(request.conversationHistory) && request.conversationHistory.length) {
      const msgs = [{ role: 'system', content: systemPrompt }];
      // Same rule as the on-device path: never let the trim drop the AI-memory
      // system message that sits at the front of the history.
      const hist = request.conversationHistory.filter(m => m && m.role && m.content);
      const system = hist.filter(m => m.role === 'system');
      const turns = hist.filter(m => m.role !== 'system').slice(-10);
      for (const m of [...system, ...turns]) msgs.push({ role: m.role, content: m.content });
      msgs.push({ role: 'user', content: userMessage });
      const text = await Ollama.chat(localModel, msgs, { temperature, maxTokens: 2000, format: 'json', onToken: request.onToken, ...thinkOpts(request) });
      return { result: text, backend: 'local', model: localModel };
    }

    const text = await Ollama.generate(localModel, userMessage, {
      systemPrompt,
      temperature,
      maxTokens: 2000,
      format: expectsJson ? 'json' : null,
      // Only the local backend streams; the cloud worker answers in one piece.
      onToken: request.onToken,
      ...thinkOpts(request),
    });
    return { result: text, backend: 'local', model: localModel };
  }

  // ---------- CLOUD (Cloudflare worker) ----------
  const CLOUD_TIMEOUT_MS = 60000;

  async function callCloud(feature, request) {
    const actionMap = {
      chat: 'chat',
      summarize: 'summarize',
      translate: 'translate',
      explain: 'explain',
      historyIndex: 'summarize-for-history',
      historySearch: 'search-history',
      agent: 'agent',
      multiTab: 'multi-tab-chat',
      groupTabs: 'group-tabs'
    };
    const action = actionMap[feature] || 'chat';
    // The Stop signal and the local-only meta callback do not belong in a JSON body.
    const { signal: outerSignal, onMeta: _onMeta, ...sendable } = request;
    const body = { action, ...sendable };
    // Phase 15: forward persona fields to the worker at top level so it can
    // override system prompt + temperature for chat/summarize/explain.
    if (request.persona) {
      body.personaSystemPrompt = request.persona.systemPrompt;
      body.personaTemperature = request.persona.temperature;
      delete body.persona;
    }

    const url = cloudWorkerUrl();
    if (!url) {
      throw new Error('Cloud AI is not configured. Add your AI Worker URL in Settings → AI (see SELF_HOSTING.md), or switch to local Ollama.');
    }
    // The normal path (VexConfig.fetchAI → main's cloud:request) is already
    // bounded at 25s in main. The bare-fetch fallback had no bound at all, so a
    // worker that accepts the connection and never answers left the panel
    // spinning forever. Always carry an abort deadline.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new Error('Cloud AI request timed out')), CLOUD_TIMEOUT_MS);
    // The agent's Stop cancels this request — and is reported as a stop, not
    // as the worker having timed out.
    const onOuterAbort = () => ctl.abort(new Error('Stopped'));
    if (outerSignal) {
      if (outerSignal.aborted) onOuterAbort();
      else outerSignal.addEventListener('abort', onOuterAbort, { once: true });
    }
    let r;
    try {
      r = await (window.VexConfig?.fetchAI || fetch)(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctl.signal
      });
    } catch (err) {
      if (outerSignal && outerSignal.aborted) throw new Error('Stopped');
      if (ctl.signal.aborted) throw new Error(`Cloud AI did not answer within ${Math.round(CLOUD_TIMEOUT_MS / 1000)}s. Check your AI Worker URL in Settings → AI.`);
      throw new Error(_cleanIpcError(err));
    } finally {
      clearTimeout(timer);
      if (outerSignal) outerSignal.removeEventListener('abort', onOuterAbort);
    }
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: `Cloud returned ${r.status}` }));
      throw new Error(err.error || `Cloud returned ${r.status}`);
    }
    const data = await r.json();
    return { result: data.result, backend: 'cloud', model: 'claude-sonnet-4' };
  }

  // Errors thrown by main over ipcRenderer.invoke arrive wrapped as
  //   Error invoking remote method 'cloud:request': Error: <the real message>
  // Showing that verbatim in the chat ("Error: Error invoking remote method…")
  // buries the one sentence the user needs. Unwrap to the innermost message.
  function _cleanIpcError(err) {
    const raw = (err && typeof err.message === 'string') ? err.message : String(err == null ? '' : err);
    const m = raw.match(/Error invoking remote method '[^']*':\s*(?:[A-Za-z]*Error:\s*)?([\s\S]+)$/);
    return (m ? m[1] : raw).trim() || 'Cloud request failed';
  }

  // ---------- Local prompts (smaller models need tighter guidance) ----------
  const LOCAL_SYSTEM_PROMPTS = {
    chat: `You are Vex AI, a helpful browser assistant. Answer the user's question concisely based on any provided page content. Match the user's language. Respond with JSON: {"reply": "your response", "citations": [], "suggestedFollowUps": []}. Return ONLY JSON.`,

    summarize: `You are a web page summarizer. Given a page's content, return ONLY this JSON (no markdown fences):
{"title": "Short descriptive title", "summary": "2-3 sentence summary", "keyPoints": ["point 1", "point 2", "point 3", "point 4", "point 5"], "readingTime": "X min read", "topics": ["topic1", "topic2"]}`,

    translate: `You are a translator. Translate the text to the target language. Return ONLY this JSON:
{"sourceLanguage": "detected", "targetLanguage": "target", "translation": "full translated text", "notes": ""}`,

    explain: `You are a learning assistant. Explain the selected text clearly. Return ONLY this JSON:
{"explanation": "clear explanation", "keyTerms": [{"term": "word", "definition": "meaning"}], "context": "", "relatedConcepts": []}`,

    historyIndex: `You summarize web pages for a browser history index. Return ONLY this JSON:
{"summary": "Brief 2-4 sentence description under 300 chars", "tags": ["tag1","tag2","tag3","tag4","tag5"], "contentType": "article|video|social-post|shopping|forum-thread|documentation|news|tool|game|other"}`,

    historySearch: `You search browser history. Given a user query and entries, return ONLY this JSON:
{"matches": [{"id": "entry_id", "relevanceScore": 0.9, "whyRelevant": "reason"}], "interpretation": "what you searched for"}
Only include relevance > 0.5. Max 10 matches.`,

    agent: `You are Vex AI, an autonomous browser agent. You accomplish the user's goal by calling tools, one at a time.

Reply with ONLY one JSON object — no markdown, no text around it:
{"thought":"one short sentence","tool":"tool_name","parameters":{},"intent":"safe|action|risky"}

How it works: you get the goal, the current page (if any), the tools, and the result of your last tool call. You reply with ONE tool call. The system runs it and shows you the result. Repeat until the goal is met, then call "finish" with the answer in parameters.summary.

intent: "safe" for reading and searching, "action" for clicking, typing, navigating or changing something in Vex, "risky" for anything that buys, pays, sends, posts, deletes or submits personal data.

Use exactly the tool names and parameter names listed under "Available tools". Never invent a tool. Never repeat a call that just failed — read the error and change something.`,

    groupTabs: `You cluster browser tabs into groups. Given tabs (id, title, url, summary), return ONLY this JSON:
{"groups": [{"name": "Short name", "color": "indigo|cyan|green|amber|red|violet|rose|teal", "tabIds": ["id1", "id2"], "pattern": "what makes a tab fit", "confidence": 0.9}], "ungrouped": ["id"], "reasoning": "one sentence"}
2-6 groups, 2+ tabs per group, confidence > 0.6.`
  };

  // ---------- User-facing API ----------
  function getRoutingPrefs() { return { ...routingPrefs }; }
  function getModel() { return localModel; }
  function getOllamaStatus() {
    return {
      available: ollamaAvailable,
      online: isOnline(),
      preferLocal, forceCloud,
      model: localModel
    };
  }

  function setRoutingPrefs(prefs) {
    routingPrefs = { ...routingPrefs, ...prefs };
    _save('vex.aiRouting', routingPrefs);
  }
  function setPreferLocal(v) {
    preferLocal = !!v;
    if (preferLocal) forceCloud = false;
    _save('vex.preferLocalAI', preferLocal);
    _save('vex.forceCloudAI', forceCloud);
    _dbg('[AIRouter] setPreferLocal:', preferLocal, 'forceCloud:', forceCloud);
  }
  function setForceCloud(v) {
    forceCloud = !!v;
    if (forceCloud) preferLocal = false;
    _save('vex.forceCloudAI', forceCloud);
    _save('vex.preferLocalAI', preferLocal);
    _dbg('[AIRouter] setForceCloud:', forceCloud, 'preferLocal:', preferLocal);
  }
  function setModel(name) {
    localModel = name;
    _save('vex.localAIModel', name);
  }

  // Show thinking: let a reasoning model think, and stream its thoughts to
  // whoever is watching (the chat's subtitle line, the agent's step row).
  // Off by default, and deliberately: measured on this machine's qwen3.5 a
  // reply takes ~3 s without thinking and 16–39 s with it. Off, nothing
  // changes — no thinking is requested and none is shown.
  const THINK_KEY = 'vex.ai.showThinking';
  function showThinking() { try { return localStorage.getItem(THINK_KEY) === 'on'; } catch { return false; } }
  function setShowThinking(on) {
    try { localStorage.setItem(THINK_KEY, on ? 'on' : 'off'); } catch {}
    try { document.dispatchEvent(new CustomEvent('vex:show-thinking', { detail: { on: !!on } })); } catch {}
    return !!on;
  }
  // What a call asks Ollama for: thinking only when the switch is on AND
  // someone is listening for the thoughts.
  function thinkOpts(request) {
    const on = showThinking() && typeof request.onThinking === 'function';
    return on ? { think: true, onThinking: request.onThinking } : {};
  }

  return {
    init, refreshOllamaStatus, isOllamaAvailable, isOnline,
    callAI, resolveBackend,
    getRoutingPrefs, setRoutingPrefs,
    getOllamaStatus, setPreferLocal, setForceCloud,
    setModel, getModel, showThinking, setShowThinking, localVision, agentNumCtx, ollamaUp, ollamaAutoStart, setOllamaAutoStart,
    // Settings › AI "Test as agent": the local agent, on a named model.
    localAgent: (request, model) => callLocalAgent(request, model),
    cloudWorkerUrl,
    _cleanIpcError
  };
})();

if (typeof window !== 'undefined') window.AIRouter = AIRouter;
// Test hook (renderer loads this as a plain <script>; the guard keeps runtime
// behavior unchanged).
if (typeof module !== 'undefined' && module.exports) module.exports = { AIRouter };
