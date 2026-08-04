// === Vex Agent Indicator ===
//
// While the agent is driving, its clicks and keystrokes are real browser
// input — indistinguishable from the user's. That's the point, but it also
// means that without a visible signal you can't tell whether the page is
// reacting to you or to the agent. Claude for Chrome injects a visual
// indicator into the page for the same reason.
//
// Vex draws it in the chrome rather than injecting into the guest: injecting
// into the page would let a hostile site read, restyle, or hide the very
// element that tells you an agent is running. Drawn here it's outside the
// page's reach.
//
// Public API: AgentIndicator (show, hide, setStep).

const AgentIndicator = {
  _el: null,
  _stepEl: null,

  _build() {
    if (this._el) return this._el;
    const el = document.createElement('div');
    el.id = 'vex-agent-indicator';
    el.innerHTML = `
      <div class="vex-agent-frame" aria-hidden="true"></div>
      <div class="vex-agent-badge" role="status" aria-live="polite">
        <span class="vex-agent-dot"></span>
        <span class="vex-agent-who">Agent</span>
        <span class="vex-agent-text">is controlling this tab</span>
        <button class="vex-agent-stop" type="button" title="Stop the agent">Stop</button>
      </div>
    `;
    document.body.appendChild(el);

    el.querySelector('.vex-agent-stop').addEventListener('click', () => {
      try { AgentLoop.stop(); } catch {}
      this.hide();
    });

    this._el = el;
    this._stepEl = el.querySelector('.vex-agent-text');
    return el;
  },

  show(who) {
    const el = this._build();
    el.querySelector('.vex-agent-who').textContent = who || 'Agent';
    if (this._stepEl) this._stepEl.textContent = 'is controlling this tab';
    el.classList.add('visible');
  },

  // Short status line inside the badge, e.g. "clicking Sign in".
  setStep(text) {
    if (this._stepEl && text) this._stepEl.textContent = text;
  },

  hide() {
    if (this._el) this._el.classList.remove('visible');
  },
};
