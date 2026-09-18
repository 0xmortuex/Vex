// === Why the AI is slow, or not answering ==================================
//
// "The AI stopped working" has a dozen causes and, until now, one symptom: a
// spinner for two minutes and then nothing. Measured here: a game and OBS had
// the graphics card at 7.7 GB of 8 GB, so the local model was pushed out to
// the processor and the same task that took 30 seconds ran past the limit —
// twice — with nothing on screen to say why.
//
// This asks every part in order and reports the first thing that is actually
// wrong, in a sentence. It runs on demand behind the "Why did that fail?"
// button on an AI error, and before a local request that is about to be slow.
//
// Public: AIHealth.check(), AIHealth.explain(err), AIHealth.slowReason().
// Depends on AIRouter, Ollama, window.vex.gpu.
const AIHealth = {
  // Everything worth knowing, gathered once. Nothing here throws.
  async check() {
    const out = { at: Date.now() };
    out.online = (() => { try { return navigator.onLine; } catch { return true; } })();
    out.worker = !!(typeof AIRouter !== 'undefined' && AIRouter.cloudWorkerUrl && AIRouter.cloudWorkerUrl());
    out.model = (typeof AIRouter !== 'undefined' && AIRouter.getModel) ? AIRouter.getModel() : '';
    out.ollama = false; out.installed = null; out.loaded = null; out.gpu = null;

    try { out.ollama = await Ollama.ping(); } catch { out.ollama = false; }
    if (out.ollama) {
      try { const models = await Ollama.listModels(); out.installed = models.map(m => m.name); }
      catch (err) { out.installedError = err.message; }
      try { out.loaded = await Ollama.running(); }
      catch (err) { out.loadedError = err.message; }
    }
    try { out.gpu = (window.vex && window.vex.gpu) ? await window.vex.gpu() : null; } catch { out.gpu = null; }
    return out;
  },

  // Is a local request about to be slow, and why? Returns a sentence or null.
  // The model in memory is what matters: one that has been pushed out of video
  // memory runs on the processor, which is ten to a hundred times slower.
  slowReasonFrom(state) {
    if (!state || !state.ollama) return null;
    const model = state.model;
    const live = Array.isArray(state.loaded) ? state.loaded.find(m => m.name === model || m.name === model + ':latest') : null;
    const gpu = state.gpu;
    if (live && live.onGpu === false) {
      return `${model} is running on the processor, not the graphics card${gpu ? ` (${gpu.name} is ${gpu.usedPercent}% full)` : ''} — expect answers to take minutes. Close what is using the card, or pick a smaller model.`;
    }
    if (!live && gpu && gpu.freeMB != null && gpu.freeMB < 2048) {
      return `Only ${(gpu.freeMB / 1024).toFixed(1)} GB of ${gpu.name} is free, so ${model} may not fit and would run on the processor instead — expect answers to take minutes.`;
    }
    if (!live && gpu && gpu.utilization >= 85) {
      return `${gpu.name} is ${gpu.utilization}% busy, so loading ${model} will be slow.`;
    }
    return null;
  },

  async slowReason() { return this.slowReasonFrom(await this.check()); },

  // What went wrong, in the order a person would check it. `err` is the error
  // the failed request threw, when there is one.
  // → { headline, lines: [] }
  explainFrom(state, err) {
    const message = String((err && err.message) || err || '');
    const lines = [];
    const local = typeof AIRouter !== 'undefined' && AIRouter.getOllamaStatus ? AIRouter.getOllamaStatus() : {};
    const wantsLocal = !state.worker || local.preferLocal;

    lines.push(state.worker ? 'Cloud AI: configured' : 'Cloud AI: no Worker URL set (Settings › AI)');
    lines.push(state.online ? 'Internet: connected' : 'Internet: offline');
    lines.push(state.ollama ? 'Ollama: running' : 'Ollama: not running');
    if (state.ollama) {
      const has = Array.isArray(state.installed) && state.installed.some(n => n === state.model || n === state.model + ':latest');
      lines.push(`Model "${state.model}": ${has ? 'installed' : 'NOT installed'}${Array.isArray(state.installed) ? ` (${state.installed.length} installed)` : ''}`);
      const live = Array.isArray(state.loaded) ? state.loaded.find(m => m.name === state.model || m.name === state.model + ':latest') : null;
      lines.push(live ? `Loaded: yes, ${live.onGpu ? 'on the graphics card' : 'on the PROCESSOR — this is the slow case'}` : 'Loaded: no (the first request loads it, which takes a while)');
    }
    if (state.gpu) lines.push(`${state.gpu.name}: ${(state.gpu.usedMB / 1024).toFixed(1)} of ${(state.gpu.totalMB / 1024).toFixed(1)} GB used, ${state.gpu.utilization}% busy`);

    // The first thing that is actually wrong.
    let headline;
    if (/stopped|aborted|cancelled/i.test(message)) headline = 'You stopped it — that is not a failure.';
    else if (!state.online && state.worker) headline = 'You are offline, and this request needed the cloud model.';
    else if (!state.worker && !state.ollama) headline = 'There is no AI backend: no Worker URL is set, and Ollama is not running. Settings › AI has both.';
    else if (wantsLocal && !state.ollama) headline = 'Ollama is not running, so the local model could not answer. Vex can start it for you — Settings › AI › "Start Ollama when it is needed".';
    else if (state.ollama && Array.isArray(state.installed) && !state.installed.length) headline = 'Ollama is running but has no models installed. Settings › AI › the model manager can pull one.';
    else if (state.ollama && Array.isArray(state.installed) && !state.installed.some(n => n === state.model || n === state.model + ':latest')) headline = `The chosen model "${state.model}" is not installed. Pick one that is, in Settings › AI.`;
    else if (/did not answer within|timeout/i.test(message)) headline = this.slowReasonFrom(state) || 'The model took longer than the two-minute limit. A smaller model, or a shorter task, will finish.';
    else if (/only produced reasoning|empty reply/i.test(message)) headline = 'The model spent its whole turn thinking and returned nothing. Try again, or pick another model.';
    else if (/not configured/i.test(message)) headline = 'Cloud AI is selected but has no Worker URL. Settings › AI.';
    else headline = this.slowReasonFrom(state) || (message ? 'The request failed: ' + message : 'Everything Vex can check looks fine.');

    return { headline, lines };
  },

  async explain(err) { return this.explainFrom(await this.check(), err); },
};

if (typeof window !== 'undefined') window.AIHealth = AIHealth;
if (typeof module !== 'undefined' && module.exports) module.exports = { AIHealth };
