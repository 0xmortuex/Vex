// Fixed-height windowing for long panels. Rows are created only near the viewport.
(function () {
  const mounted = new Map();
  let removals;
  function track(container, dispose) {
    if (typeof MutationObserver !== 'function') return;
    mounted.set(container, { dispose, connected: container.isConnected });
    if (!removals) {
      removals = new MutationObserver(() => {
        for (const [element, state] of mounted) {
          if (element.isConnected) state.connected = true;
          else if (state.connected) state.dispose();
        }
      });
      removals.observe(document.body, { childList: true, subtree: true });
    }
  }
  function mount(container, items, render, { height = 64, overscan = 6 } = {}) {
    container._virtualDispose?.();
    const canvas = document.createElement('div'); canvas.style.cssText = `height:${items.length * height}px;position:relative`;
    container.replaceChildren(canvas);
    let frame = 0, previous = '', disposed = false;
    function paint() {
      frame = 0;
      if (disposed) return;
      const start = Math.max(0, Math.floor(container.scrollTop / height) - overscan);
      const end = Math.min(items.length, Math.ceil((container.scrollTop + (container.clientHeight || 640)) / height) + overscan);
      const key = start + ':' + end;
      if (key === previous) return; previous = key;
      const focused = canvas.contains(document.activeElement) ? document.activeElement.closest('[data-virtual-index]')?.dataset.virtualIndex : null;
      const fragment = document.createDocumentFragment();
      for (let i = start; i < end; i++) {
        const row = render(items[i], i);
        row.style.position = 'absolute'; row.style.top = i * height + 'px'; row.style.height = height + 'px'; row.style.left = '0'; row.style.right = '0'; row.style.boxSizing = 'border-box';
        row.setAttribute('aria-posinset', String(i + 1)); row.setAttribute('aria-setsize', String(items.length));
        row.dataset.virtualIndex = String(i);
        if (row.tabIndex < 0) row.tabIndex = 0;
        fragment.appendChild(row);
      }
      canvas.replaceChildren(fragment);
      if (focused != null) {
        const replacement = canvas.querySelector(`[data-virtual-index="${focused}"]`);
        if (replacement) replacement.focus({ preventScroll: true });
        else { container.tabIndex = 0; container.focus({ preventScroll: true }); }
      }
    }
    const scroll = () => { if (!frame) frame = requestAnimationFrame(paint); };
    container.addEventListener('scroll', scroll, { passive: true });
    const keydown = event => {
      if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
      const current = Number(event.target.closest('[data-virtual-index]')?.dataset.virtualIndex || 0);
      const next = Math.max(0, Math.min(items.length - 1, event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : current + (event.key === 'ArrowDown' ? 1 : -1)));
      event.preventDefault(); container.scrollTop = next * height; cancelAnimationFrame(frame); paint();
      canvas.querySelector(`[data-virtual-index="${next}"]`)?.focus({ preventScroll: true });
    };
    container.addEventListener('keydown', keydown);
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(scroll) : null;
    resize?.observe(container);
    container._virtualDispose = () => {
      if (disposed) return; disposed = true;
      container.removeEventListener('scroll', scroll); container.removeEventListener('keydown', keydown); resize?.disconnect(); cancelAnimationFrame(frame); delete container._virtualDispose;
      mounted.delete(container);
      if (!mounted.size) { removals?.disconnect(); removals = null; }
    };
    track(container, container._virtualDispose);
    paint(); return container._virtualDispose;
  }
  window.VexVirtualList = { mount };
})();
