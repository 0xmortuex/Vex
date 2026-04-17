// === Vex Phase 14: AI Router ===
// Decides whether a given AI feature goes to the Cloudflare worker (Claude)
// or to a local Ollama model. Preferences are persisted in localStorage
// (mirrored to disk by the Phase 11 persistent-storage shim).

const AIRouter = (() => {
  const CLOUD_WORKER_URL = 'https://vex-ai.mortuexhavoc.workers.dev';

  const DEFAULT_ROUTING = {
    chat: 'auto',
    summarize: 'auto',
    translate: 'cloud',
    explain: 'auto',
    historyIndex: 'local',
    historySearch: 'cloud',
    agent: 'cloud',
    multiTab: 'cloud'
  };

  let routingPrefs = { ...DEFAULT_ROUTING };
  let preferLocal = false;
  let forceCloud = false;
  let localModel = 'llama3.2:3b';
  let ollamaAvailable = null;
  let checkTimer = null;

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
    if (checkTimer) clearInterval(checkTimer);
    checkTimer = setInterval(refreshOllamaStatus, 30000);
  }

  async function refreshOllamaStatus() {
    ollamaAvailable = await Ollama.ping();
    console.log('[AIRouter] Ollama ping result:', ollamaAvailable);
    return ollamaAvailable;
  }

  function isOllamaAvailable() { return ollamaAvailable === true; }
  function isOnline() {
    try { return navigator.onLine; } catch { return true; }
  }

  function resolveBackend(feature) {
    let decision;
    if (forceCloud) decision = 'cloud';
    else {
      const pref = routingPrefs[feature] || 'auto';
      if (pref === 'cloud') decision = 'cloud';
      else if (pref === 'local') decision = 'local';
      else {
        // auto:
        if (preferLocal && isOllamaAvailable()) decision = 'local';
        else if (!isOnline() && isOllamaAvailable()) decision = 'local';
        else if (isOnline()) decision = 'cloud';
        else if (isOllamaAvailable()) decision = 'local';
        else decision = 'cloud';
      }
    }
    console.log(`[AIRouter] resolveBackend(${feature}):`, {
      decision, forceCloud, preferLocal,
      featurePref: routingPrefs[feature],
      ollamaAvailable, online: isOnline()
    });
    return decision;
  }

  async function callAI(feature, request) {
    const primary = resolveBackend(feature);
    const fallback = primary === 'cloud' ? 'local' : 'cloud';
    console.log(`[AIRouter] callAI(${feature}) → using backend: ${primary}`);
    try {
      const out = await callBackend(primary, feature, request);
      console.log(`[AIRouter] ${primary} succeeded for ${feature}`);
      return out;
    } catch (err) {
      console.warn(`[AIRouter] ${primary} failed for ${feature}:`, err.message);

      // Respect explicit user intent: if user picked "Prefer local" or feature=local,
      // don't silently fall back to cloud — that's the whole point of the mode.
      const featurePref = routingPrefs[feature] || 'auto';
      const userWantsLocal = preferLocal || featurePref === 'local';
      if (primary === 'local' && userWantsLocal) {
        throw new Error(`Local AI failed: ${err.message}. (Not falling back to cloud because you selected local mode.)`);
      }

      // Availability gates for fallback
      if (fallback === 'local' && !isOllamaAvailable()) throw err;
      if (fallback === 'cloud' && !isOnline()) throw err;
      if (feature === 'agent' && fallback === 'local') throw err;

      console.warn(`[AIRouter] falling back to ${fallback} for ${feature}`);
      try {
        return await callBackend(fallback, feature, request);
      } catch (err2) {
        throw new Error(`Both ${primary} and ${fallback} AI failed: ${err.message}`);
      }
    }
  }

  async function callBackend(backend, feature, request) {
    if (backend === 'local') return await callLocal(feature, request);
    return await callCloud(feature, request);
  }

  // ---------- LOCAL (Ollama) ----------
  async function callLocal(feature, request) {
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

    // Multi-turn chat: pass history when available
    if (feature === 'chat' && Array.isArray(request.conversationHistory) && request.conversationHistory.length) {
      const msgs = [{ role: 'system', content: systemPrompt }];
      for (const m of request.conversationHistory.slice(-10)) {
        if (m && m.role && m.content) msgs.push({ role: m.role, content: m.content });
      }
      msgs.push({ role: 'user', content: userMessage });
      const text = await Ollama.chat(localModel, msgs, { temperature, maxTokens: 2000, format: 'json' });
      return { result: text, backend: 'local', model: localModel };
    }

    const text = await Ollama.generate(localModel, userMessage, {
      systemPrompt,
      temperature,
      maxTokens: 2000,
      format: expectsJson ? 'json' : null
    });
    return { result: text, backend: 'local', model: localModel };
  }

  // ---------- CLOUD (Cloudflare worker) ----------
  async function callCloud(feature, request) {
    const actionMap = {
      chat: 'chat',
      summarize: 'summarize',
      translate: 'translate',
      explain: 'explain',
      historyIndex: 'summarize-for-history',
      historySearch: 'search-history',
      agent: 'agent',
      multiTab: 'multi-tab-chat'
    };
    const action = actionMap[feature] || 'chat';
    const body = { action, ...request };
    // Phase 15: forward persona fields to the worker at top level so it can
    // override system prompt + temperature for chat/summarize/explain.
    if (request.persona) {
      body.personaSystemPrompt = request.persona.systemPrompt;
      body.personaTemperature = request.persona.temperature;
      delete body.persona;
    }

    const r = await fetch(CLOUD_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: `Cloud returned ${r.status}` }));
      throw new Error(err.error || `Cloud returned ${r.status}`);
    }
    const data = await r.json();
    return { result: data.result, backend: 'cloud', model: 'claude-sonnet-4' };
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
Only include relevance > 0.5. Max 10 matches.`
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
    console.log('[AIRouter] setPreferLocal:', preferLocal, 'forceCloud:', forceCloud);
  }
  function setForceCloud(v) {
    forceCloud = !!v;
    if (forceCloud) preferLocal = false;
    _save('vex.forceCloudAI', forceCloud);
    _save('vex.preferLocalAI', preferLocal);
    console.log('[AIRouter] setForceCloud:', forceCloud, 'preferLocal:', preferLocal);
  }
  function setModel(name) {
    localModel = name;
    _save('vex.localAIModel', name);
  }

  return {
    init, refreshOllamaStatus, isOllamaAvailable, isOnline,
    callAI, resolveBackend,
    getRoutingPrefs, setRoutingPrefs,
    getOllamaStatus, setPreferLocal, setForceCloud,
    setModel, getModel,
    CLOUD_WORKER_URL
  };
})();

window.AIRouter = AIRouter;
