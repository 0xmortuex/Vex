// === The AI provider registry: a provider is data plus a small adapter ==========
//
// "Bring your own key" (Settings > AI > Connect an AI). Each provider is one row
// below (id, name, base address, how it is authenticated, where its keys are
// issued) and one of three wire "kinds" that know how to build a request and read
// the answer:
//
//   anthropic     Claude: POST /v1/messages (x-api-key, anthropic-version), GET /v1/models
//   openai-chat   OpenAI, OpenRouter and any OpenAI-compatible server (Groq, Together,
//                 Mistral, LM Studio, vLLM ...): POST /chat/completions, GET /models
//   gemini        Google Gemini: POST models/<id>:streamGenerateContent?alt=sse, GET models
//
// Everything here is PURE (no network, no files, no Electron): src/main/ai-byok.js
// does the fetching with the key, and tests/main/aiProviders.test.js checks every
// request shape, stream parser, error mapping and the model sorting.
//
// What the request carries is the router's own contract (js/ai-router.js): a list
// of { role: 'system'|'user'|'assistant', content } messages. The agent's tool
// calling stays what it is for Ollama and the Worker: the model is asked for ONE
// JSON object naming the tool (the agent prompt), so it works the same with every
// provider and needs no provider-specific tool-use API.
//
// Sampling parameters (temperature, top_p) are never sent: Claude 5 models answer
// 400 to a non-default value and reasoning models of other providers do too.
const ANTHROPIC_VERSION = '2023-06-01';

const PROVIDERS = Object.freeze({
  anthropic: { id: 'anthropic', name: 'Anthropic (Claude)', short: 'Claude', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', keyUrl: 'https://console.anthropic.com/settings/keys', keyHint: 'sk-ant-...', keyMin: 20 },
  openai: { id: 'openai', name: 'OpenAI', short: 'OpenAI', kind: 'openai-chat', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-...', keyMin: 20 },
  gemini: { id: 'gemini', name: 'Google Gemini', short: 'Gemini', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', keyUrl: 'https://aistudio.google.com/apikey', keyHint: 'AIza...', keyMin: 20 },
  openrouter: { id: 'openrouter', name: 'OpenRouter', short: 'OpenRouter', kind: 'openai-chat', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys', keyHint: 'sk-or-...', keyMin: 20 },
  custom: { id: 'custom', name: 'Custom (OpenAI-compatible)', short: 'Custom', kind: 'openai-chat', baseUrl: '', keyUrl: '', keyHint: 'optional for a server on your own computer', keyMin: 0, needsBaseUrl: true },
});
const PROVIDER_IDS = Object.freeze(Object.keys(PROVIDERS));

function provider(id) {
  const p = PROVIDERS[id];
  if (!p) throw new Error('Unknown AI provider "' + String(id).slice(0, 40) + '"');
  return p;
}

// What the interface may know about a provider (no key, ever).
function describe(id) {
  const p = provider(id);
  return { id: p.id, name: p.name, short: p.short, keyUrl: p.keyUrl, keyHint: p.keyHint, needsBaseUrl: !!p.needsBaseUrl, defaultBaseUrl: p.baseUrl };
}

// The key's own shape: one printable token, no spaces. Custom servers may have none.
function checkKey(id, key) {
  const p = provider(id);
  const k = String(key == null ? '' : key).trim();
  if (!k && p.id === 'custom') return '';
  if (!k) throw new Error('Paste your ' + p.short + ' API key first');
  if (/\s/.test(k)) throw new Error('A key has no spaces or line breaks. Copy it again without anything around it.');
  if (!/^[\x21-\x7E]+$/.test(k)) throw new Error('That does not look like an API key (it holds characters a key never has).');
  if (k.length < p.keyMin) throw new Error('That is too short to be a ' + p.short + ' API key.');
  if (k.length > 400) throw new Error('That is too long to be an API key.');
  return k;
}

// A custom server's base address: https, or http only for this computer / a LAN-free loopback name.
function checkBaseUrl(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) throw new Error('Write the server address, for example https://api.groq.com/openai/v1');
  let u;
  try { u = new URL(raw); } catch { throw new Error('That is not a web address. Start it with https://'); }
  if (u.username || u.password) throw new Error('Leave the user name and password out of the address; paste the key in the key box.');
  if (u.search || u.hash) throw new Error('Leave everything after the ? and # out of the address.');
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new Error('Use https:// (http:// is only accepted for a server on this computer).');
  return u.origin + u.pathname.replace(/\/+$/, '');
}

// ---- model lists ---------------------------------------------------------------------------------

function listRequest(id, baseUrl, key) {
  const p = provider(id);
  const base = String(baseUrl || p.baseUrl).replace(/\/+$/, '');
  if (p.kind === 'anthropic') return { url: base + '/v1/models?limit=1000', headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION } };
  if (p.kind === 'gemini') return { url: base + '/models?pageSize=1000', headers: { 'x-goog-api-key': key } };
  return { url: base + '/models', headers: key ? { Authorization: 'Bearer ' + key } : {} };
}

const NOT_CHAT = /embed|whisper|tts|dall-e|moderation|transcribe|realtime|audio|imagen|image-gen|image-preview|veo|aqa|guard|rerank|davinci|babbage|text-search|-instruct$|computer-use|deep-research|codex-mini|search-preview/i;

// The numbers in an id, for "newer first" when the provider gives no date: gemini-2.5-pro > gemini-2.0-pro.
function versionOf(modelId) { return (String(modelId).match(/\d+(?:\.\d+)?/g) || []).map(Number); }
function compareVersions(a, b) {
  const x = versionOf(a), y = versionOf(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (y[i] || 0) - (x[i] || 0);
    if (d) return d;
  }
  return 0;
}
// Newest first: the provider's own date when both have one, else the version in the id, else the name.
function newestFirst(a, b) {
  if (a.created && b.created && a.created !== b.created) return b.created - a.created;
  return compareVersions(a.id, b.id) || a.id.localeCompare(b.id);
}

// The provider's own answer -> [{ id, name, created (ms, 0 when unknown) }], chat models only, newest first.
function parseModelList(id, json) {
  const p = provider(id);
  if (!json || typeof json !== 'object') throw new Error('The model list was not understood');
  let rows;
  if (p.kind === 'anthropic') {
    rows = (Array.isArray(json.data) ? json.data : []).map(m => ({ id: m && m.id, name: m && m.display_name, created: m && m.created_at ? Date.parse(m.created_at) || 0 : 0 }));
  } else if (p.kind === 'gemini') {
    rows = (Array.isArray(json.models) ? json.models : [])
      .filter(m => m && Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map(m => ({ id: String(m.name || '').replace(/^models\//, ''), name: m.displayName, created: 0 }))
      .filter(m => /^gemini/i.test(m.id));
  } else {
    rows = (Array.isArray(json.data) ? json.data : []).map(m => ({ id: m && m.id, name: m && (m.name || undefined), created: m && Number(m.created) ? Number(m.created) * 1000 : 0, out: m && m.architecture && m.architecture.output_modalities }));
    if (p.id === 'openai') rows = rows.filter(m => /^(gpt-|o\d|chatgpt-)/i.test(String(m.id)));
    if (p.id === 'openrouter') rows = rows.filter(m => !Array.isArray(m.out) || (m.out.length === 1 && m.out[0] === 'text') || (m.out.includes('text') && !m.out.includes('image')));
  }
  const seen = new Set();
  const out = [];
  for (const m of rows) {
    if (!m || typeof m.id !== 'string' || !m.id || seen.has(m.id) || NOT_CHAT.test(m.id)) continue;
    seen.add(m.id);
    out.push({ id: m.id, name: typeof m.name === 'string' && m.name ? m.name : m.id, created: m.created || 0 });
  }
  return out.sort(newestFirst);
}

// Shown ONLY when listing failed. Claude's are the ones the registry knows for certain; the other
// providers have no fallback on purpose (Vex does not invent model ids): type one in.
const FALLBACK_MODELS = Object.freeze({
  anthropic: [
    { id: 'claude-fable-5-1', name: 'Claude Fable 5.1' },
    { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
    { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
    { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' },
    { id: 'claude-fable-5', name: 'Claude Fable 5' },
    { id: 'claude-opus-5', name: 'Claude Opus 5' },
    { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' },
    { id: 'claude-opus-4-8', name: 'Claude Opus 4.8' },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
  ],
  openai: [], gemini: [], openrouter: [], custom: [],
});
const FALLBACK_NOTE = 'list unavailable, showing known models';

function fallbackModels(id) {
  provider(id);
  return (FALLBACK_MODELS[id] || []).map(m => ({ ...m, created: 0 }));
}

// "best" / "default" (balanced) / "fast" for a list (newest first). Simple rules, no invented ids:
// a model is only recommended when it is in the list.
function recommend(id, models) {
  const list = Array.isArray(models) ? models : [];
  const has = (mid) => list.some(m => m.id === mid);
  const firstOf = (re) => { const m = list.find(x => re.test(x.id)); return m ? m.id : null; };
  const exactOr = (ids, re) => ids.find(has) || (re ? firstOf(re) : null);
  const p = provider(id);
  if (p.id === 'anthropic') {
    // Opus 5.5 is the best answer at a fraction of Fable's price; Fable 5.1 when Opus 5.5 is not on the account.
    return {
      best: exactOr(['claude-opus-5-5', 'claude-fable-5-1'], /^claude-opus-/),
      default: exactOr(['claude-sonnet-5-5'], /^claude-sonnet-/),
      fast: exactOr(['claude-haiku-5-5'], /^claude-haiku-/),
    };
  }
  if (p.id === 'openai') {
    const flagship = firstOf(/^gpt-\d+(\.\d+)?$/);
    return { best: flagship || firstOf(/^gpt-/), default: flagship || firstOf(/^gpt-/), fast: firstOf(/^gpt-[\d.]+-(mini|nano)$/) || firstOf(/-(mini|nano)$/) };
  }
  if (p.id === 'gemini') {
    const pro = firstOf(/^gemini-[\d.]+-pro$/) || firstOf(/pro/);
    const flash = firstOf(/^gemini-[\d.]+-flash$/) || firstOf(/flash/);
    return { best: pro || flash, default: flash || pro, fast: firstOf(/^gemini-[\d.]+-flash-lite$/) || flash };
  }
  if (p.id === 'openrouter') {
    return { best: firstOf(/^anthropic\/claude-opus/), default: firstOf(/^anthropic\/claude-sonnet/), fast: firstOf(/^anthropic\/claude-haiku/) };
  }
  return { best: null, default: null, fast: null };
}

// ---- chat -----------------------------------------------------------------------------------------

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(c => (c && typeof c.text === 'string' ? c.text : '')).join('');
  return content == null ? '' : String(content);
}

// The router's messages -> the request for this provider (always streaming).
function chatRequest(id, { baseUrl, key, model, messages, maxTokens }) {
  const p = provider(id);
  if (!model) throw new Error('No model is chosen for ' + p.short);
  const base = String(baseUrl || p.baseUrl).replace(/\/+$/, '');
  const list = (Array.isArray(messages) ? messages : []).filter(m => m && m.role && textOf(m.content).trim());
  const max = Math.max(16, Math.min(Number(maxTokens) || 2000, 32000));
  if (p.kind === 'anthropic') {
    const system = list.filter(m => m.role === 'system').map(m => textOf(m.content)).join('\n\n');
    let turns = list.filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({ role: m.role, content: textOf(m.content) }));
    while (turns.length && turns[0].role !== 'user') turns.shift();
    if (!turns.length) throw new Error('There is nothing to ask');
    const body = { model, max_tokens: max, stream: true, messages: turns };
    if (system) body.system = system;
    return { url: base + '/v1/messages', headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json', accept: 'text/event-stream' }, body };
  }
  if (p.kind === 'gemini') {
    const system = list.filter(m => m.role === 'system').map(m => textOf(m.content)).join('\n\n');
    const contents = list.filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: textOf(m.content) }] }));
    while (contents.length && contents[0].role !== 'user') contents.shift();
    if (!contents.length) throw new Error('There is nothing to ask');
    const body = { contents, generationConfig: { maxOutputTokens: max } };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    return { url: base + '/models/' + encodeURIComponent(String(model).replace(/^models\//, '')) + ':streamGenerateContent?alt=sse', headers: { 'x-goog-api-key': key, 'content-type': 'application/json', accept: 'text/event-stream' }, body };
  }
  const body = { model, stream: true, messages: list.map(m => ({ role: m.role, content: textOf(m.content) })) };
  if (p.id === 'openai') body.max_completion_tokens = max; else body.max_tokens = max;
  if (p.id === 'openai' || p.id === 'openrouter') body.stream_options = { include_usage: true };
  const headers = { 'content-type': 'application/json', accept: 'text/event-stream' };
  if (key) headers.Authorization = 'Bearer ' + key;
  return { url: base + '/chat/completions', headers, body };
}

// ---- stream parsing ------------------------------------------------------------------------------
// Server-sent events: blocks of "event:"/"data:" lines separated by a blank line. push(text) takes
// whatever arrived and returns the events it completed: { type: 'delta', text } | { type: 'usage',
// input, output } | { type: 'error', message, errorType } | { type: 'stop', reason }.
function createStreamParser(id) {
  const kind = provider(id).kind;
  let buf = '';
  let data = [];
  const out = [];

  const handle = (raw) => {
    if (raw === '[DONE]') return;
    let j;
    try { j = JSON.parse(raw); } catch { out.push({ type: 'error', message: 'The provider sent something that is not JSON in its stream', errorType: 'bad-stream' }); return; }
    if (j && j.error) { out.push({ type: 'error', message: errorText(j), errorType: String((j.error && (j.error.type || j.error.status || j.error.code)) || '') }); return; }
    if (kind === 'anthropic') {
      if (j.type === 'content_block_delta' && j.delta && j.delta.type === 'text_delta' && j.delta.text) out.push({ type: 'delta', text: j.delta.text });
      else if (j.type === 'message_start' && j.message && j.message.usage) out.push({ type: 'usage', input: j.message.usage.input_tokens, output: j.message.usage.output_tokens });
      else if (j.type === 'message_delta') {
        if (j.usage) out.push({ type: 'usage', output: j.usage.output_tokens });
        if (j.delta && j.delta.stop_reason) out.push({ type: 'stop', reason: j.delta.stop_reason });
      }
    } else if (kind === 'gemini') {
      const c = Array.isArray(j.candidates) ? j.candidates[0] : null;
      if (c && c.content && Array.isArray(c.content.parts)) for (const part of c.content.parts) if (part && typeof part.text === 'string' && part.text && !part.thought) out.push({ type: 'delta', text: part.text });
      if (j.usageMetadata) out.push({ type: 'usage', input: j.usageMetadata.promptTokenCount, output: j.usageMetadata.candidatesTokenCount });
      if (c && c.finishReason) out.push({ type: 'stop', reason: c.finishReason });
    } else {
      const c = Array.isArray(j.choices) ? j.choices[0] : null;
      if (c && c.delta && typeof c.delta.content === 'string' && c.delta.content) out.push({ type: 'delta', text: c.delta.content });
      if (j.usage) out.push({ type: 'usage', input: j.usage.prompt_tokens, output: j.usage.completion_tokens });
      if (c && c.finish_reason) out.push({ type: 'stop', reason: c.finish_reason });
    }
  };
  const line = (l) => {
    if (l === '') { if (data.length) { const d = data.join('\n'); data = []; handle(d); } return; }
    if (l.startsWith('data:')) data.push(l.slice(5).replace(/^ /, ''));
  };
  return {
    push(text) {
      buf += text;
      let i;
      while ((i = buf.search(/\r?\n/)) >= 0) {
        const l = buf.slice(0, i);
        buf = buf.slice(i + (buf[i] === '\r' && buf[i + 1] === '\n' ? 2 : 1));
        line(l);
      }
      return out.splice(0);
    },
    end() { if (buf) { line(buf); buf = ''; } line(''); return out.splice(0); },
  };
}

// ---- errors ---------------------------------------------------------------------------------------

// The provider's own sentence out of its error body (each wraps it a little differently).
function errorText(json) {
  if (!json || typeof json !== 'object') return '';
  const e = json.error;
  if (typeof e === 'string') return e;
  if (e && typeof e.message === 'string') return e.message;
  if (typeof json.message === 'string') return json.message;
  return '';
}

// An HTTP failure -> { code, status, detail, retryAfter, fix }. `detail` is the provider's own words (the
// interface shows it as written, next to a sentence in the person's language for the code).
//   invalid-key  401/403: the key is wrong, revoked or not allowed for this
//   rate-limit   429: too many requests; retryAfter seconds when the provider says
//   quota        402, or 429 that says the credit/quota is used up
//   model        404 / 400 naming a model: the chosen model is not available to this key
//   overloaded   529 / 503 and other 5xx
//   bad-request  any other 4xx
function mapHttpError(status, bodyText, headers) {
  let detail;
  try { detail = errorText(JSON.parse(bodyText)); } catch { detail = ''; }   // not JSON: the plain text below
  if (!detail) detail = String(bodyText || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  detail = detail.slice(0, 400);
  const get = (n) => (headers && typeof headers.get === 'function' ? headers.get(n) : (headers && headers[n]) || null);
  let retryAfter = Number(get('retry-after'));
  if (!Number.isFinite(retryAfter) || retryAfter <= 0) retryAfter = 0;
  const quotaWords = /insufficient[_ ]quota|billing|credit balance|exceeded your current quota|out of credits|payment required|resource_exhausted.*(quota|billing)|spend limit/i;
  let code;
  if (status === 401 || status === 403) code = 'invalid-key';
  else if (status === 402 || (status === 429 && quotaWords.test(bodyText || ''))) code = 'quota';
  else if (status === 429) code = 'rate-limit';
  else if (status === 404 || (status === 400 && /model/i.test(detail) && /(not found|does not exist|not supported|unknown|invalid|unavailable|no access|access)/i.test(detail))) code = 'model';
  else if (status >= 500) code = 'overloaded';
  else code = 'bad-request';
  return { code, status, detail, retryAfter };
}

module.exports = {
  PROVIDERS, PROVIDER_IDS, ANTHROPIC_VERSION, FALLBACK_NOTE,
  provider, describe, checkKey, checkBaseUrl,
  listRequest, parseModelList, fallbackModels, recommend, newestFirst,
  chatRequest, createStreamParser, mapHttpError, errorText,
};
