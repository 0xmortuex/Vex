// === Vex — Anthropic API key settings ===
//
// Wires the "Anthropic API key" block in Settings → AI Backend. The key is
// written straight to the main process, which encrypts it with safeStorage;
// nothing here ever holds it beyond the keystroke, and there is no read-back
// channel — status() reports only whether a key exists.

const ClaudeSettings = {
  _wired: false,

  async refresh() {
    const badge = document.getElementById('claude-key-status');
    const input = document.getElementById('claude-key-input');
    if (!badge) return;

    if (!window.vex?.claude) {
      badge.textContent = 'Unavailable';
      badge.className = 'status-badge';
      return;
    }

    try {
      const s = await window.vex.claude.status();
      if (s.configured) {
        badge.textContent = 'Connected — ' + s.model;
        badge.className = 'status-badge ok';
        if (input) input.placeholder = 'Key saved — enter a new one to replace it';
      } else {
        badge.textContent = 'Not set';
        badge.className = 'status-badge';
        if (input) input.placeholder = 'sk-ant-...';
      }
      if (!s.encryptionAvailable) {
        this._msg('Your OS keychain is unavailable, so Vex will not store a key (it refuses to write one in plaintext).', true);
      }
    } catch {
      badge.textContent = 'Error';
      badge.className = 'status-badge';
    }
  },

  _msg(text, isError) {
    const el = document.getElementById('claude-key-msg');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = isError ? 'var(--danger)' : 'var(--success, #22c55e)';
  },

  wire() {
    if (this._wired) { this.refresh(); return; }

    const save = document.getElementById('claude-key-save');
    const clear = document.getElementById('claude-key-clear');
    const input = document.getElementById('claude-key-input');
    if (!save || !clear || !input) return; // settings markup not mounted yet

    save.addEventListener('click', async () => {
      const key = input.value.trim();
      if (!key) { this._msg('Enter a key first.', true); return; }
      const res = await window.vex.claude.configure(key);
      if (res.ok) {
        input.value = '';
        this._msg('Saved. The agent and AI panel will use Claude directly.');
        window.showToast?.('Anthropic API key saved');
      } else {
        this._msg(res.error || 'Could not save the key.', true);
      }
      this.refresh();
    });

    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });

    clear.addEventListener('click', async () => {
      const yes = await vexConfirm({
        title: 'Remove the Anthropic API key?',
        message: 'Vex will go back to using your Cloudflare AI Worker (or local models) for AI features.',
        okLabel: 'Remove',
        danger: true,
      });
      if (!yes) return;
      await window.vex.claude.clear();
      this._msg('Key removed.');
      window.showToast?.('Anthropic API key removed');
      this.refresh();
    });

    this._wired = true;
    this.refresh();
  },
};
