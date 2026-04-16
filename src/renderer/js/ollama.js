// === Vex Phase 14: Ollama API wrapper ===
// Talks to a local Ollama server at http://localhost:11434.

const Ollama = (() => {
  const DEFAULT_URL = 'http://localhost:11434';
  let baseUrl = DEFAULT_URL;

  function setBaseUrl(url) {
    baseUrl = String(url || DEFAULT_URL).replace(/\/$/, '');
  }

  function getBaseUrl() { return baseUrl; }

  async function ping() {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 2000);
      const r = await fetch(`${baseUrl}/api/tags`, { method: 'GET', signal: ctl.signal });
      clearTimeout(t);
      return r.ok;
    } catch { return false; }
  }

  async function listModels() {
    try {
      const r = await fetch(`${baseUrl}/api/tags`);
      if (!r.ok) return [];
      const data = await r.json();
      return (data.models || []).map(m => ({
        name: m.name,
        size: m.size,
        modifiedAt: m.modified_at,
        sizeFormatted: formatBytes(m.size)
      }));
    } catch { return []; }
  }

  async function generate(model, prompt, options = {}) {
    const { systemPrompt, temperature = 0.5, maxTokens = 2000, format = null } = options;
    const body = {
      model, prompt, stream: false,
      options: { temperature, num_predict: maxTokens }
    };
    if (systemPrompt) body.system = systemPrompt;
    if (format === 'json') body.format = 'json';

    const r = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(`Ollama returned ${r.status}`);
    const data = await r.json();
    return data.response || '';
  }

  async function chat(model, messages, options = {}) {
    const { temperature = 0.5, maxTokens = 2000, format = null } = options;
    const body = {
      model, messages, stream: false,
      options: { temperature, num_predict: maxTokens }
    };
    if (format === 'json') body.format = 'json';
    const r = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(`Ollama chat returned ${r.status}`);
    const data = await r.json();
    return data.message?.content || '';
  }

  async function pullModel(modelName, onProgress) {
    const r = await fetch(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName, stream: true })
    });
    if (!r.ok) throw new Error(`Failed to pull model: ${r.status}`);
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (onProgress) onProgress(event);
          if (event.error) throw new Error(event.error);
        } catch (err) {
          if (err.message && !/JSON/i.test(err.message)) throw err;
        }
      }
    }
  }

  function formatBytes(bytes) {
    if (!bytes) return '—';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  return { setBaseUrl, getBaseUrl, ping, listModels, generate, chat, pullModel };
})();

window.Ollama = Ollama;
