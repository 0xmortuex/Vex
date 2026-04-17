// === Vex Phase 17: Ask Vex AI quick-prompt bar (Ctrl+J) ===
// A dedicated AI-only bar. Distinct from Ctrl+K (command bar) — this one
// pipes straight into the AI panel.

const AskAIBar = (() => {
  let bar = null;
  let input = null;
  let outsideClickHandler = null;

  function _el() {
    if (!bar) bar = document.getElementById('ask-ai-bar');
    if (!input) input = document.getElementById('ask-ai-input');
    return { bar, input };
  }

  function isOpen() {
    const { bar } = _el();
    return bar && !bar.hidden;
  }

  function open() {
    const { bar, input } = _el();
    if (!bar || !input) return;

    // Close the command bar overlay if it's open — they shouldn't co-exist
    const cmdOverlay = document.getElementById('command-overlay');
    if (cmdOverlay && cmdOverlay.style.display !== 'none') {
      if (typeof CommandBar !== 'undefined' && CommandBar.close) CommandBar.close();
      else cmdOverlay.style.display = 'none';
    }

    bar.hidden = false;
    input.value = '';
    setTimeout(() => input.focus(), 50);

    // Delay outside-click attach so the opening click doesn't immediately close us
    setTimeout(() => {
      outsideClickHandler = (e) => {
        if (!bar.contains(e.target)) close();
      };
      document.addEventListener('mousedown', outsideClickHandler);
    }, 0);
  }

  function close() {
    const { bar, input } = _el();
    if (!bar) return;
    bar.hidden = true;
    input?.blur();
    if (outsideClickHandler) {
      document.removeEventListener('mousedown', outsideClickHandler);
      outsideClickHandler = null;
    }
  }

  function toggle() { isOpen() ? close() : open(); }

  function submit() {
    const { input } = _el();
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    close();

    if (typeof AIPanel === 'undefined') {
      if (typeof window.showToast === 'function') window.showToast('AI panel not available', 'error');
      return;
    }
    AIPanel.open();

    // Feed the question into the AI panel's input and trigger its send path,
    // so whatever logic the panel runs (history-search intent, multi-tab,
    // persona routing) still kicks in.
    setTimeout(() => {
      const aiInput = document.getElementById('ai-input');
      if (!aiInput) return;
      aiInput.value = text;
      if (typeof AIPanel._sendChat === 'function') {
        AIPanel._sendChat();
      } else {
        aiInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      }
    }, 80);
  }

  function init() {
    const { bar, input } = _el();
    if (!input) return;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
  }

  return { init, open, close, toggle, isOpen };
})();

window.AskAIBar = AskAIBar;
