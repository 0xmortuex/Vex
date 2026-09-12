// === Vex AI Compose + Command Chains ===

// ---- AI Compose: draft/rewrite text into the focused input of the page ----
// Ctrl+K → "AI Compose". Reads the focused input's current value (and any
// selected page text) as context, asks your AI worker, and writes the result
// straight back into the field.
const AICompose = {
  async open() {
    const wv = WebviewManager.getActiveWebview();
    if (!wv) { window.showToast?.('Open a page first'); return; }
    let ctx = { value: '', selection: '', hasInput: false };
    try {
      ctx = await wv.executeJavaScript(`(()=>{
        const a=document.activeElement;
        const ok=a&&(a.tagName==='TEXTAREA'||(a.tagName==='INPUT'&&/^(text|search|email|url)$/i.test(a.type||'text'))||a.isContentEditable);
        return { hasInput: !!ok, value: ok ? (a.isContentEditable ? a.innerText : a.value).substring(0,4000) : '',
                 selection: String(getSelection&&getSelection()||'').substring(0,2000) };
      })()`);
    } catch {}
    document.getElementById('vex-compose-modal')?.remove();
    const esc = (s) => window.escapeHtml(s);
    const m = document.createElement('div');
    m.id = 'vex-compose-modal';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;';
    m.innerHTML = `<div style="width:460px;max-width:92vw;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:22px;box-shadow:0 24px 60px rgba(0,0,0,0.5)">
      <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:4px">${VexIcons.svg('edit', { size: 15 })} AI Compose</div>
      <p style="font-size:11.5px;color:var(--text-muted);margin:0 0 12px">${ctx.hasInput ? 'Writes into the focused field on the page.' : 'No input focused — the result will be copied to your clipboard.'}${ctx.value ? ' Current text is used as context.' : ''}</p>
      <textarea id="cmp-instr" rows="3" placeholder="e.g. reply politely declining · make this friendlier · write a short intro about X" style="width:100%;box-sizing:border-box;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;outline:none;resize:vertical;font-family:'Outfit',sans-serif"></textarea>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
        <button id="cmp-cancel" style="padding:8px 16px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px">Cancel</button>
        <button id="cmp-go" style="padding:8px 18px;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px;font-weight:600">Write</button>
      </div></div>`;
    document.body.appendChild(m);
    const instr = m.querySelector('#cmp-instr');
    instr.focus();
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelector('#cmp-cancel').addEventListener('click', () => m.remove());
    const go = async () => {
      const want = instr.value.trim();
      if (!want) return;
      const btn = m.querySelector('#cmp-go');
      btn.textContent = 'Writing…'; btn.disabled = true;
      try {
        let prompt = `Write text for me. Instruction: ${want}.`;
        if (ctx.value) prompt += `\n\nThe field currently contains (rewrite/extend as instructed):\n"""${ctx.value}"""`;
        if (ctx.selection) prompt += `\n\nSelected page text for context:\n"""${ctx.selection}"""`;
        prompt += `\n\nReturn ONLY the final text — no preamble, no quotes, no JSON.`;
        const data = await AIRouter.callAI('chat', { message: prompt });
        let out = data.result || '';
        try { const o = JSON.parse(out); if (o && o.reply) out = o.reply; } catch {}
        out = String(out).trim();
        if (!out) throw new Error('Empty response');
        if (ctx.hasInput) {
          await wv.executeJavaScript(`(()=>{
            const a=document.activeElement; if(!a) return;
            if(a.isContentEditable){a.innerText=${JSON.stringify(out)};}
            else{a.value=${JSON.stringify(out)};}
            a.dispatchEvent(new Event('input',{bubbles:true}));
            a.dispatchEvent(new Event('change',{bubbles:true}));
          })()`);
          window.showToast?.('Written into the field');
        } else {
          await navigator.clipboard.writeText(out);
          window.showToast?.('Copied to clipboard');
        }
        m.remove();
      } catch (err) {
        btn.textContent = 'Write'; btn.disabled = false;
        window.showToast?.(err.message || 'Compose failed');
      }
    };
    m.querySelector('#cmp-go').addEventListener('click', go);
    instr.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) go(); });
  },
};

// ---- Command Chains: run several command-bar actions as one command ----
const CommandChains = {
  KEY: 'vex.chains',
  chains: [],
  init() {
    try { const a = JSON.parse(localStorage.getItem(this.KEY) || '[]'); this.chains = Array.isArray(a) ? a : []; } catch { this.chains = []; }
    this._register();
  },
  // Returns false when the write failed, so no caller announces a save that did
  // not happen. The command bar is refreshed either way so it matches memory.
  save() {
    let ok = true;
    try { localStorage.setItem(this.KEY, JSON.stringify(this.chains)); } catch { ok = false; }
    this._register();
    return ok;
  },
  // Runs every step even if one throws, but never pretends the chain worked:
  // a step whose command has gone away, or that failed, is named at the end.
  async run(chain) {
    const problems = [];
    for (const cid of chain.steps) {
      const cmd = CommandBar.commands.find(c => c.id === cid);
      if (!cmd) { problems.push(`${cid} (no longer exists)`); continue; }
      try { await cmd.action(); }
      catch (err) { problems.push(`${cmd.label || cid} (${err && err.message ? err.message : 'failed'})`); }
      await new Promise(r => setTimeout(r, 350));
    }
    if (problems.length) {
      window.showToast?.(`Chain "${chain.name}" finished with ${problems.length} problem${problems.length === 1 ? '' : 's'}: ${problems.join(', ')}`, 'error', 7000);
    }
    return { ok: !problems.length, problems };
  },
  _register() {
    if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return;
    CommandBar.commands = CommandBar.commands.filter(c => !String(c.id || '').startsWith('chain:'));
    this.chains.forEach(ch => CommandBar.commands.push({
      id: 'chain:' + ch.id, label: ch.name, hint: 'Chain — runs: ' + ch.steps.join(' → '), icon: 'link', action: () => this.run(ch),
    }));
  },
  renderPanel(container) {
    if (!container) return;
    const esc = (s) => window.escapeHtml(s);
    const baseCmds = CommandBar.commands.filter(c => !String(c.id).startsWith('chain:'));
    container.innerHTML = `<p class="setting-info muted" style="margin-bottom:10px">Chains run several command-bar actions in order as one command (e.g. Reading mode → Read aloud).</p>`;
    this.chains.forEach(ch => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--border)';
      row.innerHTML = `<div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:600;color:var(--text)">${VexIcons.svg('link', { size: 13 })} ${esc(ch.name)}</div><div style="font-size:11.5px;color:var(--text-muted)">${esc(ch.steps.join(' → '))}</div></div>
        <button data-del aria-label="Delete chain ${esc(ch.name)}" title="Delete this chain" style="padding:5px 10px;background:var(--bg);color:var(--danger);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif;display:inline-flex;align-items:center">${VexIcons.svg('trash', { size: 13 })}</button>`;
      // A chain is something the user assembled by hand and there is no undo,
      // so confirm first and then report what actually happened.
      row.querySelector('[data-del]').addEventListener('click', async () => {
        if (!await window.vexConfirm({
          title: 'Delete chain',
          message: `Delete the chain "${ch.name}"? This cannot be undone.`,
          okLabel: 'Delete', danger: true,
        })) return;
        const previous = this.chains;
        this.chains = this.chains.filter(x => x.id !== ch.id);
        const saved = this.save();
        if (!saved) { this.chains = previous; this.save(); }
        this.renderPanel(container);
        window.showToast?.(saved ? `Deleted "${ch.name}"` : 'Could not save the change — the chain was kept', saved ? undefined : 'error');
      });
      container.appendChild(row);
    });
    const add = document.createElement('div');
    add.style.cssText = 'margin-top:10px;display:flex;flex-direction:column;gap:8px';
    add.innerHTML = `
      <input id="chain-name" type="text" placeholder="Chain name (e.g. Read it to me)" style="padding:9px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;outline:none;font-family:'Outfit',sans-serif">
      <select id="chain-pick" multiple size="6" style="padding:6px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:12.5px;outline:none">${baseCmds.map(c => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('')}</select>
      <div style="font-size:11px;color:var(--text-muted)">Ctrl+click to pick steps in the order you want them to run.</div>
      <button id="chain-add" style="align-self:flex-start;padding:8px 16px;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px">+ Create chain</button>`;
    container.appendChild(add);
    const picked = [];
    add.querySelector('#chain-pick').addEventListener('change', (e) => {
      // Track click order: append newly-selected, drop deselected.
      const sel = Array.from(e.target.selectedOptions).map(o => o.value);
      sel.forEach(v => { if (!picked.includes(v)) picked.push(v); });
      for (let i = picked.length - 1; i >= 0; i--) if (!sel.includes(picked[i])) picked.splice(i, 1);
    });
    add.querySelector('#chain-add').addEventListener('click', () => {
      const name = add.querySelector('#chain-name').value.trim();
      if (!name || picked.length < 2) { window.showToast?.('Name it and pick at least 2 steps', 'warn'); return; }
      this.chains.push({ id: vexId('ch'), name, steps: picked.slice() });
      const saved = this.save();
      this.renderPanel(container);
      window.showToast?.(saved
        ? `Chain "${name}" created — run it from Ctrl+K`
        : 'Available for now, but the chain could not be saved — it resets when you restart Vex', saved ? undefined : 'error');
    });
  },
};

if (typeof window !== 'undefined') { window.AICompose = AICompose; window.CommandChains = CommandChains; }
if (typeof module !== 'undefined' && module.exports) module.exports = { AICompose, CommandChains };
