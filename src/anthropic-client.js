// === Vex → Anthropic API (direct) ===
//
// Talks to api.anthropic.com with the user's own API key, using the official
// SDK. Lives in the main process for one reason: the key never enters the
// renderer. It's stored via safeStorage (Windows DPAPI / OS keychain), exactly
// like the password vault, and only ever leaves this file as an Authorization
// header on a request to Anthropic.
//
// This is the second AI backend alongside the existing Cloudflare Worker
// route. The worker is still there and still works — this path just removes
// the OpenRouter hop for users who'd rather bring their own Anthropic key.
//
// The renderer owns conversation state and the agent loop; this module runs
// exactly one turn per call and returns the model's content blocks. Streaming
// text is pushed to the renderer as it arrives so the panel can render live.

const { ipcMain, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const MODEL = 'claude-opus-5';

// Effort: Anthropic's guidance is to start at xhigh for agentic/coding work
// and sweep down. Browser automation is agentic, so the agent defaults to
// xhigh; plain chat in the panel doesn't need it and defaults to high.
const EFFORT = { agent: 'xhigh', chat: 'high' };

// Streaming is used unconditionally — at these max_tokens a non-streaming
// request risks an HTTP timeout, and the panel wants live text anyway.
const MAX_TOKENS = 64000;

// Opus 5's safety classifiers can decline a request outright (HTTP 200 with
// stop_reason 'refusal'). Server-side fallbacks re-run the declined request on
// Anthropic's recommended fallback model inside the same call, so a false
// positive on benign work doesn't just dead-end. If the account or SDK build
// doesn't recognise the beta, _send falls back to a plain request.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

let _keyPath = null;
let _client = null;
let _cachedKey = null;
const _inflight = new Map(); // requestId -> AbortController

function keyFile(app) {
  if (!_keyPath) _keyPath = path.join(app.getPath('userData'), 'anthropic-key.dat');
  return _keyPath;
}

function loadKey(app) {
  if (_cachedKey !== null) return _cachedKey;
  try {
    const p = keyFile(app);
    if (!fs.existsSync(p)) return (_cachedKey = '');
    _cachedKey = safeStorage.decryptString(fs.readFileSync(p));
  } catch (err) {
    console.error('[Claude] key read failed:', err.message);
    _cachedKey = '';
  }
  return _cachedKey;
}

function saveKey(app, key) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption unavailable — refusing to store the key in plaintext');
  }
  const p = keyFile(app);
  fs.writeFileSync(p, safeStorage.encryptString(String(key || '')), { mode: 0o600 });
  _cachedKey = String(key || '');
  _client = null; // rebuild on next use
}

function clearKey(app) {
  try { fs.unlinkSync(keyFile(app)); } catch {}
  _cachedKey = '';
  _client = null;
}

function getClient(app) {
  if (_client) return _client;
  const key = loadKey(app);
  if (!key) return null;
  const Anthropic = require('@anthropic-ai/sdk');
  const Ctor = Anthropic.default || Anthropic;
  _client = new Ctor({ apiKey: key });
  return _client;
}

// --- Tool schema conversion -------------------------------------------------
// Vex describes its agent tools loosely (`{ url: 'string' }`) because the old
// worker prompt just interpolated them into text. The Messages API wants real
// JSON Schema, and getting it right matters: with a proper schema the model
// emits structured tool_use blocks instead of JSON-in-prose that we then have
// to regex out of a fenced block.
//
// Pure + exported so the tests can pin the mapping.
function toAnthropicTools(vexTools) {
  if (!Array.isArray(vexTools)) return [];
  return vexTools.map(t => {
    const properties = {};
    const required = [];
    const params = (t && t.parameters) || {};

    for (const [name, spec] of Object.entries(params)) {
      const desc = String(spec || '');
      const optional = /\(optional\)/i.test(desc);
      let prop;

      if (/^boolean/i.test(desc)) prop = { type: 'boolean' };
      else if (/^number|^integer/i.test(desc)) prop = { type: 'number' };
      else if (desc.includes('|')) {
        // e.g. 'up|down|top|bottom' — an enum written as a pipe list.
        prop = { type: 'string', enum: desc.replace(/\s*\(optional\)\s*/i, '').split('|').map(s => s.trim()).filter(Boolean) };
      } else prop = { type: 'string' };

      prop.description = desc;
      properties[name] = prop;
      if (!optional) required.push(name);
    }

    // Vex gates hard-to-undo actions on a confirmation prompt in `auto` mode,
    // so every tool carries an optional risk flag the model sets per call.
    // Cheaper and more reliable than inferring risk from the tool name alone —
    // navigating to a URL is harmless, navigating to a "delete account"
    // confirmation link is not.
    properties.intent = {
      type: 'string',
      enum: ['action', 'risky'],
      description: 'Set to "risky" if this action sends a message, makes a purchase, deletes data, or is otherwise hard to undo. Otherwise "action".',
    };

    return {
      name: t.name,
      description: t.description || '',
      input_schema: { type: 'object', properties, required },
    };
  });
}

// --- Request ----------------------------------------------------------------

function buildSystem(systemText) {
  // One cached block: the system prompt and the tool list are byte-identical
  // across every turn of an agent run, and they render before the messages, so
  // a breakpoint here means each turn re-reads them at ~0.1x instead of paying
  // full price. Opus 5's minimum cacheable prefix is 512 tokens; the agent
  // system prompt plus ~19 tool schemas clears that comfortably.
  return [{ type: 'text', text: String(systemText || ''), cache_control: { type: 'ephemeral' } }];
}

async function _send(client, params, sender, requestId, useFallbacks) {
  const controller = new AbortController();
  _inflight.set(requestId, controller);

  const req = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive', display: 'summarized' },
    ...params,
  };
  if (useFallbacks) {
    req.betas = [FALLBACK_BETA];
    req.fallbacks = 'default';
  }

  const api = useFallbacks ? client.beta.messages : client.messages;
  const stream = api.stream(req, { signal: controller.signal });

  // Push deltas to the renderer as they arrive. Thinking summaries and answer
  // text are tagged separately so the panel can style them differently.
  stream.on('text', (delta) => {
    if (sender && !sender.isDestroyed()) sender.send('claude:delta', { requestId, type: 'text', text: delta });
  });
  stream.on('thinking', (delta) => {
    if (sender && !sender.isDestroyed()) sender.send('claude:delta', { requestId, type: 'thinking', text: delta });
  });

  try {
    return await stream.finalMessage();
  } finally {
    _inflight.delete(requestId);
  }
}

function shapeResponse(message) {
  // Always inspect stop_reason before touching content: on a refusal the
  // content array can be empty, and indexing content[0] would throw.
  const out = {
    ok: true,
    stopReason: message.stop_reason,
    model: message.model,
    // The raw blocks, echoed back verbatim as the assistant turn on the next
    // request. Thinking blocks in particular must be replayed unmodified on
    // the same model, so this is passed through rather than reconstructed.
    content: message.content || [],
    text: '',
    thinking: '',
    toolUses: [],
    usage: message.usage || null,
    refusal: null,
  };

  if (message.stop_reason === 'refusal') {
    out.ok = false;
    out.refusal = {
      category: (message.stop_details && message.stop_details.category) || null,
      explanation: (message.stop_details && message.stop_details.explanation) || '',
    };
    return out;
  }

  for (const block of message.content || []) {
    if (block.type === 'text') out.text += block.text;
    else if (block.type === 'thinking') out.thinking += block.thinking || '';
    else if (block.type === 'tool_use') out.toolUses.push({ id: block.id, name: block.name, input: block.input });
  }
  return out;
}

function register(app) {
  ipcMain.handle('claude:status', () => ({
    configured: !!loadKey(app),
    model: MODEL,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
  }));

  ipcMain.handle('claude:configure', (_e, apiKey) => {
    try {
      const key = String(apiKey || '').trim();
      if (!key) return { ok: false, error: 'Empty key' };
      if (!/^sk-ant-/.test(key)) return { ok: false, error: 'That does not look like an Anthropic API key (expected it to start with sk-ant-).' };
      saveKey(app, key);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('claude:clear', () => { clearKey(app); return { ok: true }; });

  ipcMain.handle('claude:cancel', (_e, requestId) => {
    const c = _inflight.get(requestId);
    if (c) { try { c.abort(); } catch {} _inflight.delete(requestId); }
    return { ok: true };
  });

  // One turn. The renderer passes the full message history (including any
  // tool_result blocks from the previous turn) and gets back the model's
  // content blocks — text, summarized thinking, and any tool calls to run.
  ipcMain.handle('claude:message', async (e, payload) => {
    const client = getClient(app);
    if (!client) return { ok: false, error: 'No Anthropic API key configured. Add one in Settings → AI Backend.' };

    const {
      requestId = String(Date.now()),
      system = '',
      messages = [],
      tools = [],
      mode = 'chat',
    } = payload || {};

    const params = {
      system: buildSystem(system),
      messages,
      output_config: { effort: EFFORT[mode] || EFFORT.chat },
    };
    if (Array.isArray(tools) && tools.length) {
      // The renderer sends Vex's loose tool descriptors; the schema mapping
      // lives here so there's one implementation of it and the tests can pin
      // it. Already-converted tools (with input_schema) pass through.
      params.tools = tools[0] && tools[0].input_schema ? tools : toAnthropicTools(tools);
      // Vex's agent loop executes exactly one action per iteration so it can
      // gate each on a permission prompt. Parallel tool calls would return
      // several tool_use blocks in one turn, and the API requires a matching
      // tool_result for every one of them — so ask for one at a time rather
      // than dropping results and 400ing on the next request.
      params.tool_choice = { type: 'auto', disable_parallel_tool_use: true };
    }

    const sender = e.sender;

    try {
      let message;
      try {
        message = await _send(client, params, sender, requestId, true);
      } catch (err) {
        // The fallbacks parameter is gated behind a beta that not every
        // account or SDK build has. If that's what failed, retry once without
        // it rather than losing the whole request; anything else rethrows.
        const msg = String(err && err.message || err);
        if (/fallback|beta/i.test(msg) && /400|invalid_request|unsupported|unrecognized/i.test(msg)) {
          console.warn('[Claude] server-side fallbacks unavailable, retrying without:', msg);
          message = await _send(client, params, sender, requestId, false);
        } else throw err;
      }
      return shapeResponse(message);
    } catch (err) {
      if (err && (err.name === 'AbortError' || /abort/i.test(String(err.message || '')))) {
        return { ok: false, aborted: true, error: 'Cancelled' };
      }
      return { ok: false, error: String(err && err.message || err) };
    }
  });
}

module.exports = { register, toAnthropicTools, shapeResponse, MODEL, MAX_TOKENS, EFFORT };
