// jsdom sets isTrusted to false on every event it dispatches, and the property cannot be forged, so a
// page-side handler that insists on a real click or key (`if (!e.isTrusted) return`) can never be
// reached by dispatchEvent. This records the listeners a script adds to window, then calls them with
// an event that reports isTrusted: true and the element it was aimed at. Listeners removed since are
// not called, and a listener that stops propagation ends the round, like the real thing.
//
//   const t = recordWindowListeners();     // before the script under test installs its listeners
//   ...install...
//   const e = t.fire('click', element, { button: 0 });   // -> the event (look at e.defaultPrevented)
//   t.restore();
export function recordWindowListeners() {
  const list = [];
  const add = window.addEventListener, remove = window.removeEventListener;
  const same = (a, b) => a.type === b.type && a.fn === b.fn && !!(a.capture) === !!(b.capture);
  const capOf = (o) => (typeof o === 'boolean' ? o : !!(o && o.capture));
  window.addEventListener = function (type, fn, opts) {
    list.push({ type, fn, capture: capOf(opts) });
    return add.call(this, type, fn, opts);
  };
  window.removeEventListener = function (type, fn, opts) {
    const at = list.findIndex(l => same(l, { type, fn, capture: capOf(opts) }));
    if (at >= 0) list.splice(at, 1);
    return remove.call(this, type, fn, opts);
  };
  const ctor = (type) => (/^(key)/.test(type) ? KeyboardEvent : /^wheel$/.test(type) ? WheelEvent : MouseEvent);
  return {
    list,
    fire(type, target, init = {}) {
      const e = new (ctor(type))(type, { bubbles: true, cancelable: true, ...init });
      let stopped = false;
      const proxy = new Proxy(e, {
        get(t, k) {
          if (k === 'isTrusted') return true;
          if (k === 'target' || k === 'srcElement') return target;
          if (k === 'stopPropagation' || k === 'stopImmediatePropagation') return () => { stopped = true; t.stopPropagation(); };
          const v = t[k];
          return typeof v === 'function' ? v.bind(t) : v;
        },
      });
      for (const l of list.filter(x => x.type === type && x.capture).slice()) {
        if (stopped) break;
        l.fn.call(window, proxy);
      }
      return e;
    },
    restore() { window.addEventListener = add; window.removeEventListener = remove; },
  };
}
