// === Map-reduce long-document engine (T2-025) ===============================
//
// A small local model has a small window. A long page or thread used to be cut
// at the front and summarised as if that were all of it. This service reads the
// whole text in pieces instead and says how much it really read:
//
//   chunk      split the text at paragraph / sentence ends into pieces of about
//              chunkChars, a little overlap between neighbours
//   map        each piece is summarised on its own, a few at a time
//   reduce     the partial summaries are merged; if they are still too long they
//              are merged in groups first, then once more into the answer
//
// Bounded: at most maxChunks pieces and maxCalls model calls per run, whatever
// the size of the text. A text that does not fit is NOT silently cut: the result
// says "covered 62 percent" and carries nextOffset so the caller can go on from
// there. A run can be cancelled with an AbortSignal; the error then carries what
// was done so far (err.partial).
//
// Local only: the default model call is AIRouter.callOn('local', ...). A caller
// that passes its own `call` is responsible for what that call does; this file
// has no cloud path of its own.
//
// Pure functions (chunk, plan, run with a given `call`) have no DOM so they are
// tested directly (tests/renderer/longdocEngine.test.js).

const VexLongDoc = {
  FEATURE: 'longdoc-engine',
  KEY_ENABLED: 'vex.longdoc.enabled',
  LIMITS: {
    chunkChars: 6000,     // size of one piece
    overlap: 200,         // characters shared with the previous piece
    maxChunks: 24,        // pieces read per run
    concurrency: 2,       // pieces summarised at the same time
    partialChars: 1400,   // longest partial summary kept
    mergeBudget: 9000,    // longest text handed to one merge call
    mergeGroup: 6,        // partial summaries merged per group
    maxCalls: 48,         // model calls per run, merges included
    maxDepth: 4,          // levels of group merging
  },

  // ---- the switch (Minimal Vex) -----------------------------------------------
  enabled() { try { return localStorage.getItem(this.KEY_ENABLED) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.KEY_ENABLED, on ? 'on' : 'off'); }
    catch (err) { throw new Error('The setting could not be saved: ' + err.message, { cause: err }); }
  },

  _limits(o) {
    const L = { ...this.LIMITS };
    for (const k of Object.keys(L)) {
      if (o && o[k] != null) {
        const v = Number(o[k]);
        if (!Number.isFinite(v) || v < 1) throw new Error('The limit "' + k + '" has to be a number of 1 or more');
        L[k] = Math.floor(v);
      }
    }
    if (L.overlap >= L.chunkChars) throw new Error('The overlap has to be smaller than a piece');
    return L;
  },

  // ---- chunking (pure) -----------------------------------------------------------
  // -> [{ i, start, end, text }] in order; start/end are offsets into `text`.
  chunk(text, opts) {
    const L = this._limits(opts);
    const s = String(text == null ? '' : text);
    const out = [];
    let pos = 0;
    while (pos < s.length) {
      let end = Math.min(s.length, pos + L.chunkChars);
      if (end < s.length) {
        // Cut at the last paragraph end, else sentence end, else space in the final 25% of the piece.
        const floor = pos + Math.floor(L.chunkChars * 0.75);
        const window = s.slice(floor, end);
        let cut = window.lastIndexOf('\n\n');
        if (cut < 0) cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '), window.lastIndexOf('\n'));
        if (cut < 0) cut = window.lastIndexOf(' ');
        if (cut >= 0) end = floor + cut + 1;
      }
      out.push({ i: out.length, start: pos, end, text: s.slice(pos, end) });
      if (end >= s.length) break;
      // The next piece starts a little before this one ended, never before this one started.
      pos = Math.max(pos + 1, end - L.overlap);
      if (pos < out[out.length - 1].start + 1) pos = end;
    }
    return out;
  },

  // What a run would do, before it does it. startAt: offset to begin from.
  plan(text, opts = {}) {
    const L = this._limits(opts);
    const s = String(text == null ? '' : text);
    const startAt = Math.max(0, Math.min(s.length, Math.floor(Number(opts.startAt) || 0)));
    const all = this.chunk(s.slice(startAt), L).map(c => ({ ...c, start: c.start + startAt, end: c.end + startAt }));
    const chunks = all.slice(0, L.maxChunks);
    const coveredTo = chunks.length ? chunks[chunks.length - 1].end : startAt;
    const total = s.length || 1;
    return {
      total: s.length, startAt, chunks, available: all.length,
      capped: all.length > chunks.length,
      coveredTo,
      coverage: s.length ? Math.round((coveredTo / total) * 100) : 100,
      nextOffset: coveredTo < s.length ? coveredTo : null,
      // map calls + a rough count of merge calls
      estimatedCalls: chunks.length + (chunks.length > 1 ? Math.ceil(chunks.length / L.mergeGroup) + 1 : 0),
    };
  },

  // ---- prompts (pure) --------------------------------------------------------------
  mapPrompt(chunk, n, instruction, L) {
    return 'This is part ' + (chunk.i + 1) + ' of ' + n + ' of a longer text. ' +
      'Summarise only this part in at most ' + Math.round(L.partialChars / 6) + ' words. Keep names, numbers, dates, decisions and open questions. Do not add anything that is not in the text. ' +
      (instruction ? 'What the reader wants from it: ' + instruction + '\n' : '') +
      'Reply as JSON: {"reply": "the summary"}.\n\nText:\n' + chunk.text;
  },
  mergePrompt(parts, instruction, final, L) {
    const body = parts.map((p, i) => '[' + (i + 1) + '] ' + p).join('\n\n');
    return (final
      ? 'These are summaries of consecutive parts of one text. Write ONE answer from them, in order, without repeating yourself and without adding anything that is not in them. '
      : 'These are summaries of consecutive parts of one text. Merge them into one shorter summary of at most ' + Math.round(L.partialChars / 6) + ' words, in order, keeping names, numbers, dates and decisions. ') +
      (instruction && final ? 'What the reader wants: ' + instruction + '\n' : '') +
      'Reply as JSON: {"reply": "the text"}.\n\nSummaries:\n' + body;
  },

  // The answer text out of whatever a local call returned.
  textOf(result) {
    if (result == null) throw new Error('The local model returned nothing.');
    if (typeof result === 'object') return String(result.reply || result.summary || result.text || result.result || '').trim();
    const raw = String(result).trim();
    if (raw.startsWith('{')) {
      try { const o = JSON.parse(raw); if (o && typeof o.reply === 'string') return o.reply.trim(); }
      catch { /* vex-allow-empty-catch: not JSON after all, the text itself is the answer */ }
    }
    return raw;
  },

  // The model call used when the caller gives none: the local model only.
  defaultCall() {
    return async (prompt, { signal } = {}) => {
      if (typeof AIRouter === 'undefined' || typeof AIRouter.callOn !== 'function') throw new Error('The local AI is not available here.');
      let res;
      try { res = await AIRouter.callOn('local', 'chat', { message: prompt, conversationHistory: [], signal }); }
      catch (err) {
        if (signal && signal.aborted) throw err;
        throw new Error('Your local model could not answer: ' + String((err && err.message) || err).replace(/\.$/, '') + '. Nothing was sent to the cloud.', { cause: err });
      }
      return res && res.result;
    };
  },

  _cancelled(partial) {
    const err = new Error('Stopped. ' + partial.coverage + ' percent had been read.');
    err.code = 'cancelled';
    err.partial = partial;
    return err;
  },

  /**
   * Reads the text in pieces and returns
   *   { summary, coverage, coveredChars, total, chunksDone, chunksTotal, capped, nextOffset, calls, partials }
   * opts: instruction, call(prompt,{signal}) -> text|result, signal, onProgress(p),
   *       startAt, plus any of LIMITS. A text that fits one piece takes one call.
   */
  async run(text, opts = {}) {
    if (!this.enabled() && !opts.force) throw new Error('The long-document engine is switched off (Settings › Long documents).');
    if (typeof GameMode !== 'undefined' && GameMode.gaming && !opts.allowDuringGame) throw new Error('A game is running, so the local model is left alone. Try again when you are done playing.');
    const L = this._limits(opts);
    const call = opts.call || this.defaultCall();
    const signal = opts.signal || null;
    const plan = this.plan(text, { ...opts, ...L });
    if (!plan.total) throw new Error('There is no text to read.');
    if (!plan.chunks.length) throw new Error('There is nothing left to read after that point.');
    const n = plan.chunks.length;
    const progress = (phase, done, totalSteps, extra) => {
      if (typeof opts.onProgress === 'function') opts.onProgress({ phase, done, total: totalSteps, coverage: plan.coverage, ...(extra || {}) });
    };
    let calls = 0;
    const ask = async (prompt) => {
      if (signal && signal.aborted) throw this._cancelled({ coverage: 0, partials: [] });
      if (calls >= L.maxCalls) throw new Error('This would take more than ' + L.maxCalls + ' model calls, so it was stopped. Use a smaller part of the text.');
      calls++;
      const out = this.textOf(await call(prompt, { signal }));
      if (!out) throw new Error('The local model returned an empty answer. Try again.');
      return out;
    };
    const clip = (s) => (s.length > L.partialChars ? s.slice(0, L.partialChars).replace(/\s+\S*$/, '') + '…' : s);

    // One piece is its own answer.
    if (n === 1) {
      progress('map', 0, 1);
      const only = plan.chunks[0];
      const summary = await ask(this.mapPrompt(only, 1, opts.instruction, { ...L, partialChars: L.mergeBudget }));
      progress('map', 1, 1);
      return this._result(plan, summary, 1, calls, [summary]);
    }

    // map: a few at a time, in order of the pieces
    const partials = new Array(n);
    let done = 0;
    let next = 0;
    let failure = null;
    progress('map', 0, n);
    const worker = async () => {
      while (!failure) {
        if (signal && signal.aborted) return;
        const i = next++;
        if (i >= n) return;
        try {
          partials[i] = clip(await ask(this.mapPrompt(plan.chunks[i], n, opts.instruction, L)));
          done++;
          progress('map', done, n);
        } catch (err) { failure = failure || err; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(L.concurrency, n) }, worker));
    const finished = partials.filter(p => p != null);
    if (signal && signal.aborted) {
      // Stopped by the person: what was read so far is kept for the caller.
      const lastGood = (() => { let k = 0; while (k < n && partials[k] != null) k++; return k; })();
      const cov = lastGood ? Math.round((plan.chunks[lastGood - 1].end / (plan.total || 1)) * 100) : 0;
      throw this._cancelled({ coverage: cov, partials: finished });
    }
    if (failure) { failure.partial = { coverage: 0, partials: finished }; throw failure; }

    // reduce: groups first while the summaries do not fit one merge call
    let level = partials.slice();
    let depth = 0;
    while (level.join('\n\n').length > L.mergeBudget && level.length > 1 && depth < L.maxDepth) {
      const groups = [];
      for (let i = 0; i < level.length; i += L.mergeGroup) groups.push(level.slice(i, i + L.mergeGroup));
      progress('merge', 0, groups.length + 1, { level: depth + 1 });
      const merged = [];
      for (const g of groups) {
        merged.push(g.length === 1 ? g[0] : clip(await ask(this.mergePrompt(g, opts.instruction, false, L))));
        progress('merge', merged.length, groups.length + 1, { level: depth + 1 });
      }
      level = merged;
      depth++;
    }
    if (level.join('\n\n').length > L.mergeBudget) {
      throw new Error('The summaries are still too long to merge after ' + depth + ' rounds. Use a smaller part of the text.');
    }
    progress('merge', 0, 1, { final: true });
    const summary = await ask(this.mergePrompt(level, opts.instruction, true, L));
    progress('merge', 1, 1, { final: true });
    return this._result(plan, summary, n, calls, partials);
  },

  _result(plan, summary, chunksDone, calls, partials) {
    return {
      summary, coverage: plan.coverage, coveredChars: plan.coveredTo - plan.startAt, coveredTo: plan.coveredTo, total: plan.total,
      chunksDone, chunksTotal: plan.available, capped: plan.capped, nextOffset: plan.nextOffset, calls, partials,
    };
  },

  // "Covered 62 percent" in words; says what is left when it is not everything.
  coverageLine(r) {
    if (!r) return '';
    if (r.coverage >= 100) return 'Read all of it (' + r.chunksDone + (r.chunksDone === 1 ? ' part' : ' parts') + ').';
    return 'Covered ' + r.coverage + ' percent of the text (' + r.chunksDone + ' of ' + r.chunksTotal + ' parts). The rest was not read.';
  },
};

if (typeof window !== 'undefined') window.VexLongDoc = VexLongDoc;
if (typeof window !== 'undefined' && typeof VexSettingsGroups !== 'undefined') {
  VexSettingsGroups.register({
    id: 'longdoc-engine',
    title: 'Long documents',
    keywords: 'long document engine read in pieces summarize thread digest local model coverage',
    build: (el) => {
      el.appendChild(VexSettingsGroups.note('Reads a text too long for the local model in pieces and says how much of it was covered. Thread digest and the other long-text tools use it; nothing runs until you ask one of them.'));
      el.appendChild(VexSettingsGroup.toggle('Read long texts in pieces', VexLongDoc.enabled(), (on) => {
        try { VexLongDoc.setEnabled(on); if (typeof VexUsage !== 'undefined') VexUsage.touch('longdoc-engine'); }
        catch (err) { window.showToast?.(err.message, 'error'); }
      }, 'off stops Thread digest too'));
    },
  });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexLongDoc };
