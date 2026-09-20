// === The same question, asked of two models ================================
//
// "Is the local model good enough for this?" is not a question anyone can
// answer in the abstract — it depends on the question. So ask both at once and
// read the two answers side by side: the cloud model and the one running on
// this machine, same question, same page, no switching back and forth and
// re-typing.
//
// Each column is whatever that backend says, including its failure: a local
// model that is not running says so in its own column rather than taking the
// comparison down with it.
const TwoModels = {
  SIDES: [
    { backend: 'cloud', name: 'Cloud' },
    { backend: 'local', name: 'On this machine' },
  ],

  // Both at once — the point is the wait being one wait, not two.
  async ask(question, context) {
    const q = String(question || '').trim();
    if (!q) throw new Error('Write the question first');
    const request = {
      message: q,
      pageContext: context || null,
      conversationHistory: [],
      persona: null,
    };
    const answers = await Promise.all(this.SIDES.map(async (side) => {
      const started = Date.now();
      try {
        const out = await AIRouter.callOn(side.backend, 'chat', { ...request });
        const text = this.reply(out && out.result != null ? String(out.result) : '');
        if (!text.trim()) throw new Error('That backend answered with nothing');
        return { ...side, ok: true, text, model: (out && out.model) || '', ms: Date.now() - started };
      } catch (err) {
        return { ...side, ok: false, error: err.message, ms: Date.now() - started };
      }
    }));
    if (!answers.some(a => a.ok)) throw new Error('Neither model answered: ' + answers.map(a => a.name + ' — ' + a.error).join('; '));
    return answers;
  },

  // A chat answer arrives as the panel's own JSON envelope
  // ({"reply": …, "citations": …}). The reply is what a person reads, so that
  // is what the two columns hold — and what "keep this one" puts in the chat.
  reply(raw) {
    const text = String(raw == null ? '' : raw);
    if (typeof AIPanel === 'undefined' || !AIPanel._parseResponse) return text;
    try {
      const parsed = AIPanel._parseResponse(text);
      return String((parsed && parsed.reply) || text);
    } catch { return text; }
  },

  // The page the question is about, when the AI panel would have sent it.
  _context() {
    try {
      const tab = TabManager.getActiveTab();
      if (!tab || !/^https?:/i.test(tab.url || '')) return null;
      return { url: tab.url, title: tab.title || '' };
    } catch { return null; }
  },

  _column(a, md) {
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const head = `<div style="display:flex;align-items:baseline;gap:6px;margin-bottom:5px">
        <b style="font-size:11.5px;color:var(--text)">${esc(a.name)}</b>
        <span style="font-size:10px;color:var(--text-muted)">${esc(a.model || '')}${a.ok ? ' · ' + (a.ms / 1000).toFixed(1) + ' s' : ''}</span>
      </div>`;
    const body = a.ok
      ? `<div style="font-size:12.5px;color:var(--text)">${md(a.text)}</div>`
      : `<div style="font-size:11.5px;color:var(--text-muted)">${esc(a.error)}</div>`;
    const keep = a.ok ? `<button data-keep="${esc(a.backend)}" type="button"
        style="margin-top:8px;font-size:11px;color:var(--text-muted);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 8px;cursor:pointer">Keep this answer</button>` : '';
    // In a narrow panel the two columns become two rows rather than two
    // columns of four words each.
    return `<div style="flex:1 1 220px;min-width:200px;border:1px solid var(--border);border-radius:9px;padding:9px">${head}${body}${keep}</div>`;
  },

  // Renders into the AI panel's message list, so it sits in the conversation
  // where it was asked.
  render(question, answers) {
    const container = document.getElementById('ai-messages');
    if (!container) return null;
    const md = (s) => (typeof AIPanel !== 'undefined' ? AIPanel._md(s) : window.escapeHtml(s));
    const el = document.createElement('div');
    el.className = 'ai-msg assistant vex-two-models';
    el.innerHTML = `
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Both models, same question</div>
      <div style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap">${answers.map(a => this._column(a, md)).join('')}</div>`;
    el.querySelectorAll('[data-keep]').forEach(btn => {
      btn.addEventListener('click', () => {
        const kept = answers.find(a => a.backend === btn.dataset.keep);
        if (kept) this.keep(question, kept);
      });
    });
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
    return el;
  },

  // Keeping one puts the pair into the conversation as an ordinary exchange,
  // so anything asked next follows on from the answer you chose.
  keep(question, answer) {
    if (typeof AIPanel === 'undefined') return false;
    const conv = AIPanel._getConv(AIPanel._getTabId());
    conv.push({ role: 'user', content: question });
    conv.push({ role: 'assistant', content: answer.text });
    AIPanel._persistConversations();
    AIPanel._renderMessages();
    window.showToast?.('Kept the ' + answer.name.toLowerCase() + ' answer — the chat carries on from it');
    return true;
  },

  async run(question) {
    if (typeof AIPanel !== 'undefined') AIPanel.open();
    const q = String(question || '').trim();
    if (!q) throw new Error('Write the question first');
    const container = document.getElementById('ai-messages');
    const waiting = document.createElement('div');
    waiting.className = 'ai-msg assistant';
    waiting.textContent = 'Asking both models…';
    container?.appendChild(waiting);
    try {
      const answers = await this.ask(q, this._context());
      waiting.remove();
      this.render(q, answers);
      return answers;
    } catch (err) {
      waiting.remove();
      throw err;
    }
  },
};

if (typeof window !== 'undefined') window.TwoModels = TwoModels;
if (typeof module !== 'undefined' && module.exports) module.exports = { TwoModels };
