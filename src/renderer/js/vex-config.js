// === Vex runtime configuration: self-hosted backends ===
//
// The AI assistant and Sync features talk to Cloudflare Workers that each user
// deploys themselves — see SELF_HOSTING.md. Their URLs live in localStorage so
// they can be set in Settings without rebuilding the app.
//
// Empty string = "not configured":
//   - AI: auto routing prefers local Ollama; an explicit cloud request shows a
//     clear "add your AI Worker URL" error (see ai-router.js).
//   - Sync: stays off entirely until a URL is set (see sync-engine.js).
//
// Nothing here ships pointing at anyone else's backend, so a fresh install
// never spends someone else's API credits or stores data on their server.

const VexConfig = {
  async fetchAI(url, options) {
    if (!window.vex?.cloudRequest) return fetch(url, options);
    await window.PersistentStorage?._flush?.();
    const result = await window.vex.cloudRequest(JSON.parse(options.body));
    return new Response(result.body, { status: result.status, headers: { 'Content-Type': 'application/json' } });
  },
  aiWorkerUrl() {
    try { return (localStorage.getItem('vex.aiWorkerUrl') || '').trim(); } catch { return ''; }
  },
  // A pasted URL ending in "/" made every call go to "//auth/..." and the
  // worker answered "Not found" (found 2026-09-29). The Settings field writes
  // localStorage directly, so the getter strips it as well as the setter.
  syncWorkerUrl() {
    try { return (localStorage.getItem('vex.syncWorkerUrl') || '').trim().replace(/\/+$/, ''); } catch { return ''; }
  },
  setAiWorkerUrl(url) {
    try { localStorage.setItem('vex.aiWorkerUrl', String(url || '').trim()); } catch {}
  },
  setSyncWorkerUrl(url) {
    try { localStorage.setItem('vex.syncWorkerUrl', String(url || '').trim().replace(/\/+$/, '')); } catch {}
  },

  // The AI worker's address in the Sync field said only "Authentication
  // required" (found 2026-10-09, on the owner's phone). Which worker is at an
  // address is told by what each already answers, with no token, to a GET of
  // /sync/pull (workers/): the AI worker takes only POST and answers 405
  // {"error":"Method not allowed"}; the sync worker wants a session and
  // answers 401 {"error":"Unauthorized"}. Only the address the user entered
  // is asked. → 'ai' | 'sync' | 'unknown'; throws when it cannot be reached.
  WRONG_WORKER: {
    sync: 'This is your Vex AI worker’s address, not your Sync worker’s. Your Sync worker’s address usually has “sync” in it.',
    ai: 'This is your Vex Sync worker’s address, not your AI worker’s. Your AI worker’s address usually has “ai” in it.',
  },
  async workerKind(url) {
    const base = String(url || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^/]/i.test(base)) return 'unknown';
    const r = await (window.VexNet?.fetch || fetch)(base + '/sync/pull', { method: 'GET', credentials: 'omit', timeoutMs: 8000, maxBytes: 64 * 1024 });
    let error = '';
    try { const body = await r.json(); error = body && typeof body.error === 'string' ? body.error : ''; } catch { error = ''; }
    if (r.status === 405 && error === 'Method not allowed') return 'ai';
    if (r.status === 401 && error === 'Unauthorized') return 'sync';
    return 'unknown';
  },

  // Settings › Cloud: when a URL is entered (the field's change, not every
  // key), ask it which worker it is and say so under the field if it is the
  // other one. `expected` is 'sync' or 'ai'.
  watchWorkerField(input, expected, out) {
    if (!input || !out) return;
    const other = expected === 'sync' ? 'ai' : 'sync';
    let asked = 0;
    const show = (text) => { out.textContent = text; out.hidden = !text; };
    input.addEventListener('input', () => { asked++; show(''); });
    input.addEventListener('change', async () => {
      const mine = ++asked;
      const url = input.value.trim();
      show('');
      if (!url) return;
      let kind;
      try { kind = await this.workerKind(url); }
      catch (err) { console.error('[Cloud] Could not ask ' + url + ' which worker it is:', (err && err.message) || err); return; }
      if (mine === asked && kind === other) show(this.WRONG_WORKER[expected]);
    });
  },
};

if (typeof window !== 'undefined') window.VexConfig = VexConfig;
// Renderer loads this via <script>; the guard keeps it importable in tests.
if (typeof module !== 'undefined' && module.exports) module.exports = { VexConfig };
