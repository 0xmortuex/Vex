// === Page automations: the code that runs INSIDE the page ====================
//
// autoKit() is written as an ordinary function so it can be linted and tested
// in a DOM, and is placed in the page as text (kitSource()). It finds a
// control the way a person would describe it, and is deliberately unwilling
// to guess:
//
//   1. role + accessible name (a "Download report" button)
//   2. the control's own text
//   3. the label next to a field
//   4. the CSS selector recorded, but only if the name still agrees
//   5. a close spelling of the name (0.8 and a clear winner), never for a
//      consequential step
//
// More than one match is "ambiguous", no match is "not found", a hidden or
// disabled match is reported as such. The caller STOPS on any of those: it
// never clicks "something else".
//
// The recorder half records what a person does. A value in a secret field is
// never read; a field the person did not type into (a password manager's
// fill) is recorded as "ask me", not as text.
//
// Public API: AutoGuest.kitSource(), AutoGuest.call(method, args).
/* global autoFold, autoClassify, autoIsSensitive -- placed in the page next to autoKit by kitSource() */
(function (root) {
  'use strict';
  const M =(typeof AutoModel !== 'undefined') ? AutoModel : require('./automations-model.js');

  function autoKit() {
    var doc = document;
    var kit = { version: 1 };
    var LAYOUT = (function () { try { var r = doc.documentElement.getBoundingClientRect(); return r.width > 0 || r.height > 0; } catch (e) { return false; } })();
    var INTERACTIVE = 'a,button,input,select,textarea,summary,label,[role],[tabindex],[onclick],[contenteditable=""],[contenteditable="true"]';
    var SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|HEAD|META|LINK|TITLE)$/;

    function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
    function textOf(el) { return norm(LAYOUT && el.innerText != null ? el.innerText : el.textContent); }
    function visible(el) {
      try {
        var cs = window.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        if (!LAYOUT) return !el.hidden;
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      } catch (e) { return false; }
    }
    function labelOf(el) {
      var t = '';
      try { if (el.labels && el.labels.length) t = textOf(el.labels[0]); } catch (e) { t = ''; }
      if (!t && el.id) { var l = doc.querySelector('label[for="' + String(el.id).replace(/"/g, '') + '"]'); if (l) t = textOf(l); }
      if (!t) { var p = el.closest && el.closest('label'); if (p) { var c = p.cloneNode(true); var ctl = c.querySelectorAll('input,select,textarea'); for (var i = 0; i < ctl.length; i++) ctl[i].remove(); t = norm(c.textContent); } }
      return norm(t);
    }
    function roleOf(el) {
      var r = el.getAttribute('role'); if (r) return r.split(/\s+/)[0].toLowerCase();
      var tag = el.tagName, ty = (el.getAttribute('type') || '').toLowerCase();
      if (tag === 'A') return el.hasAttribute('href') ? 'link' : 'generic';
      if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button';
      if (tag === 'SELECT') return 'combobox';
      if (tag === 'TEXTAREA') return 'textbox';
      if (/^H[1-6]$/.test(tag)) return 'heading';
      if (tag === 'IMG') return 'img';
      if (tag === 'LABEL') return 'label';
      if (tag === 'INPUT') {
        if (/^(button|submit|reset|image)$/.test(ty)) return 'button';
        if (ty === 'checkbox') return 'checkbox';
        if (ty === 'radio') return 'radio';
        if (ty === 'range') return 'slider';
        if (ty === 'search') return 'searchbox';
        return 'textbox';
      }
      return 'generic';
    }
    // The accessible name. For a text field it is NEVER the typed value.
    function nameOf(el) {
      var a = el.getAttribute('aria-label'); if (a && norm(a)) return norm(a).slice(0, 120);
      var lb = el.getAttribute('aria-labelledby');
      if (lb) { var t = lb.split(/\s+/).map(function (id) { var n = doc.getElementById(id); return n ? textOf(n) : ''; }).join(' '); if (norm(t)) return norm(t).slice(0, 120); }
      var tag = el.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
        var ty = (el.getAttribute('type') || '').toLowerCase();
        if (/^(button|submit|reset)$/.test(ty)) return norm(el.getAttribute('value') || (ty === 'submit' ? 'Submit' : '')).slice(0, 120);
        if (ty === 'image') return norm(el.getAttribute('alt')).slice(0, 120);
        var lab = labelOf(el); if (lab) return lab.slice(0, 120);
        return norm(el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('name') || '').slice(0, 120);
      }
      if (tag === 'IMG') return norm(el.getAttribute('alt')).slice(0, 120);
      var t2 = textOf(el); if (t2) return t2.slice(0, 120);
      return norm(el.getAttribute('title')).slice(0, 120);
    }
    function esc(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/([^\w-])/g, '\\$1'); }
    function cssOf(el) {
      if (el.id && doc.querySelectorAll('#' + esc(el.id)).length === 1) return '#' + esc(el.id);
      var tid = el.getAttribute('data-testid') || el.getAttribute('data-test');
      if (tid) return '[' + (el.getAttribute('data-testid') ? 'data-testid' : 'data-test') + '="' + String(tid).replace(/"/g, '') + '"]';
      var nm = el.getAttribute('name');
      if (nm) { var q = el.tagName.toLowerCase() + '[name="' + String(nm).replace(/"/g, '') + '"]'; if (doc.querySelectorAll(q).length === 1) return q; }
      var parts = [], cur = el;
      while (cur && cur.nodeType === 1 && cur !== doc.body && parts.length < 5) {
        var tag = cur.tagName.toLowerCase(), idx = 1, sib = cur;
        while ((sib = sib.previousElementSibling)) if (sib.tagName === cur.tagName) idx++;
        parts.unshift(tag + ':nth-of-type(' + idx + ')');
        if (cur.id && doc.querySelectorAll('#' + esc(cur.id)).length === 1) { parts[0] = '#' + esc(cur.id); break; }
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    }
    // The nearest heading or label text above a control: tells two "Delete"
    // buttons in different cards apart.
    function nearOf(el) {
      var cur = el, hops = 0;
      while (cur && cur !== doc.body && hops < 6) {
        var prev = cur.previousElementSibling;
        while (prev) {
          var h = /^H[1-6]$/.test(prev.tagName) ? prev : (prev.querySelector && prev.querySelector('h1,h2,h3,h4,h5,h6,legend'));
          if (h) return textOf(h).slice(0, 60);
          prev = prev.previousElementSibling;
        }
        cur = cur.parentElement; hops++;
        if (cur) { var own = cur.querySelector(':scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > legend'); if (own && own !== el) return textOf(own).slice(0, 60); }
      }
      return '';
    }
    var PM_ATTRS = ['data-lpignore', 'data-1p-ignore', 'data-bwautofill', 'data-dashlane-rid', 'data-kwimpalaid', 'data-com-onepassword-filled', 'data-lastpass-icon-root', 'data-np-autofill-field-type'];
    function autofilled(el) {
      try { if (el.matches(':-webkit-autofill') || el.matches(':autofill')) return true; } catch (e) { /* vex-allow-empty-catch: the pseudo-class is unknown in this engine, so it is not autofilled */ }
      return false;
    }
    function describe(el) {
      var tag = el.tagName.toLowerCase();
      var form = el.form || (el.closest && el.closest('form'));
      var d = {
        tag: tag, role: roleOf(el), name: nameOf(el), text: tag === 'input' || tag === 'select' || tag === 'textarea' ? '' : textOf(el).slice(0, 80),
        type: (el.getAttribute('type') || '').toLowerCase(), id: el.id || '', attrName: el.getAttribute('name') || '', autocomplete: el.getAttribute('autocomplete') || '',
        label: labelOf(el).slice(0, 80), placeholder: el.getAttribute('placeholder') || '', ariaLabel: el.getAttribute('aria-label') || '', title: el.getAttribute('title') || '',
        css: cssOf(el), near: nearOf(el), autofilled: autofilled(el), pmAttr: PM_ATTRS.some(function (a) { return el.hasAttribute(a); }),
        inForm: !!form,
      };
      if (form) {
        d.formMethod = (form.getAttribute('method') || 'get').toLowerCase();
        var act = form.getAttribute('action') || '';
        try { var u = new URL(act || location.href, location.href); d.formAction = u.href; d.crossOrigin = u.origin !== location.origin; } catch (e) { d.formAction = act; }
        var sens = form.querySelectorAll('input');
        d.formHasSensitive = false;
        for (var i = 0; i < sens.length; i++) if (sensOf(sens[i])) { d.formHasSensitive = true; break; }
      }
      if (el.getAttribute('href')) { try { d.href = new URL(el.getAttribute('href'), location.href).href; } catch (e) { d.href = el.getAttribute('href'); } }
      return d;
    }
    function sensOf(el) {
      var t = (el.getAttribute('type') || '').toLowerCase();
      if (t === 'hidden') return false;   // nobody types into a hidden field (a CSRF token is not a secret of the person's)
      return autoIsSensitive({ type: t, name: el.name || '', attrName: el.getAttribute('name') || '', id: el.id || '', autocomplete: el.getAttribute('autocomplete') || '', label: labelOf(el), placeholder: el.getAttribute('placeholder') || '', ariaLabel: el.getAttribute('aria-label') || '', autofilled: autofilled(el), pmAttr: PM_ATTRS.some(function (a) { return el.hasAttribute(a); }) });
    }
    kit.describe = describe;
    kit.isSensitiveEl = sensOf;

    function sim(a, b) {
      a = autoFold(a); b = autoFold(b);
      if (!a || !b) return 0;
      if (a === b) return 1;
      var m = a.length, n = b.length, prev = [], cur = [], i, j;
      for (j = 0; j <= n; j++) prev[j] = j;
      for (i = 1; i <= m; i++) {
        cur = [i];
        for (j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
        prev = cur;
      }
      return 1 - prev[n] / Math.max(m, n);
    }
    function deepest(list) { return list.filter(function (el) { return !list.some(function (o) { return o !== el && el.contains(o); }); }); }

    // Find the control a step means. Never guesses: see the header.
    kit.resolve = function (t, opts) {
      opts = opts || {};
      t = t || {};
      var pool = Array.prototype.slice.call(doc.querySelectorAll(opts.scope === 'any' ? 'body *' : INTERACTIVE)).filter(function (el) { return !SKIP.test(el.tagName); });
      var fname = autoFold(t.name), ftext = autoFold(t.text), flabel = autoFold(t.label), fnear = autoFold(t.near);
      var hiddenSeen = 0, tried = [];
      function pick(list, how, score) {
        var vis = list.filter(visible);
        if (!vis.length) { hiddenSeen += list.length; return null; }
        if (vis.length > 1 && fnear) { var n1 = vis.filter(function (el) { return autoFold(nearOf(el)) === fnear; }); if (n1.length) vis = n1; }
        if (vis.length > 1 && t.css) { var n2 = vis.filter(function (el) { try { return el.matches(t.css); } catch (e) { return false; } }); if (n2.length) vis = n2; }
        if (vis.length > 1) return { status: 'ambiguous', how: how, count: vis.length };
        return { status: 'found', how: how, score: score, el: vis[0] };
      }
      var out = null, r;
      if (t.role && fname) { r = pick(pool.filter(function (el) { return roleOf(el) === t.role && autoFold(nameOf(el)) === fname; }), 'role+name', 1); if (r) out = out || r; }
      if (!out && ftext) { r = pick(deepest(pool.filter(function (el) { return autoFold(textOf(el)) === ftext; })), 'text', 1); if (r) out = r; }
      if (!out && fname && !t.role) { r = pick(pool.filter(function (el) { return autoFold(nameOf(el)) === fname; }), 'name', 1); if (r) out = r; }
      if (!out && flabel) { r = pick(pool.filter(function (el) { return /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && autoFold(labelOf(el)) === flabel; }), 'label', 1); if (r) out = r; }
      if (!out && t.css) {
        var byCss = [];
        try { byCss = Array.prototype.slice.call(doc.querySelectorAll(t.css)); } catch (e) { byCss = []; }
        if (byCss.length === 1) {
          var el1 = byCss[0], nm = nameOf(el1);
          // The selector may only stand in for the name when the name still agrees.
          var ok = !fname || autoFold(nm) === fname || (!opts.exact && sim(nm, t.name) >= 0.6);
          if (ok && (!t.tag || el1.tagName.toLowerCase() === t.tag)) { r = pick([el1], 'css', autoFold(nm) === fname ? 1 : 0.7); if (r) out = r; }
        }
      }
      if (!out && !opts.exact && fname) {
        var scored = pool.filter(function (el) { return !t.role || roleOf(el) === t.role; }).map(function (el) { return { el: el, s: sim(nameOf(el), t.name) }; }).filter(function (x) { return x.s >= 0.8 && visible(x.el); }).sort(function (a, b) { return b.s - a.s; });
        if (scored.length === 1 || (scored.length > 1 && scored[0].s - scored[1].s >= 0.12)) out = { status: 'found', how: 'similar', score: Math.round(scored[0].s * 100) / 100, el: scored[0].el };
        else if (scored.length > 1) out = { status: 'ambiguous', how: 'similar', count: scored.length };
      }
      if (out) { out.count = out.count || 1; return out; }
      return { status: hiddenSeen ? 'hidden' : 'none', count: 0, how: null };
    };

    function livePlan(el) {
      var d = describe(el);
      var cls = autoClassify({ text: d.name || d.text, ariaLabel: d.ariaLabel, title: d.title, value: '', type: d.type, role: d.role, tag: d.tag, href: d.href, inForm: d.inForm, formMethod: d.formMethod, formAction: d.formAction, crossOrigin: d.crossOrigin });
      return { desc: d, cls: cls, sensitive: sensOf(el) };
    }
    function brief(res) {
      var o = { status: res.status, how: res.how, score: res.score, count: res.count };
      if (res.el) {
        var p = livePlan(res.el);
        o.desc = { tag: p.desc.tag, role: p.desc.role, name: p.desc.name.slice(0, 80), type: p.desc.type, inForm: p.desc.inForm, formMethod: p.desc.formMethod, formAction: p.desc.formAction, crossOrigin: p.desc.crossOrigin, href: p.desc.href, formHasSensitive: p.desc.formHasSensitive };
        o.consequence = p.cls;
        o.sensitive = p.sensitive;
        o.disabled = !!(res.el.disabled || res.el.getAttribute('aria-disabled') === 'true');
        o.download = !!res.el.hasAttribute('download');
      }
      return o;
    }
    // Look, do nothing.
    kit.probe = function (step) { return brief(kit.resolve(step.target, { exact: !!step.exact, scope: step.scope })); };

    function setValue(el, value) {
      var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      var d = Object.getOwnPropertyDescriptor(proto, 'value');
      if (d && d.set) d.set.call(el, value); else el.value = value;
    }
    function fire(el, type, init) { el.dispatchEvent(new Event(type, Object.assign({ bubbles: true, cancelable: true }, init || {}))); }

    // Do one step on the control it means. Re-checks everything the probe
    // checked: a page that changed between the probe and the action is a stop.
    kit.act = function (step, opts) {
      opts = opts || {};
      var res = kit.resolve(step.target, { exact: !!step.exact });
      if (res.status !== 'found') return Object.assign({ ok: false, reason: res.status === 'none' ? 'not-found' : res.status }, brief(res));
      var el = res.el, p = livePlan(el), info = brief(res);
      var order = { none: 0, soft: 1, locked: 2 };
      if (order[p.cls.level] > (opts.approvedLevel == null ? 0 : opts.approvedLevel)) return Object.assign({ ok: false, reason: 'not-approved' }, info);
      if (info.disabled) return Object.assign({ ok: false, reason: 'disabled' }, info);
      if (step.type !== 'click' && step.type !== 'check' && step.type !== 'enter' && p.sensitive) return Object.assign({ ok: false, reason: 'sensitive-field' }, info);
      try { el.scrollIntoView({ block: 'center' }); } catch (e) { /* vex-allow-empty-catch: scrolling is a courtesy; the action itself is checked next */ }
      if (step.type === 'click') { el.click(); return Object.assign({ ok: true }, info); }
      if (step.type === 'type') {
        el.focus(); setValue(el, ''); fire(el, 'input'); setValue(el, String(step.value == null ? '' : step.value)); fire(el, 'input'); fire(el, 'change');
        return Object.assign({ ok: true }, info);
      }
      if (step.type === 'select') {
        if (el.tagName !== 'SELECT') return Object.assign({ ok: false, reason: 'not-a-list' }, info);
        var want = autoFold(step.value), idx = -1, i;
        for (i = 0; i < el.options.length; i++) if (autoFold(el.options[i].text) === want || autoFold(el.options[i].value) === want) { idx = i; break; }
        if (idx < 0) return Object.assign({ ok: false, reason: 'option-not-found' }, info);
        el.selectedIndex = idx; fire(el, 'input'); fire(el, 'change');
        return Object.assign({ ok: true }, info);
      }
      if (step.type === 'check') {
        var wantChecked = step.checked !== false;
        if (el.checked !== wantChecked) el.click();
        return Object.assign({ ok: true }, info);
      }
      if (step.type === 'enter') {
        el.focus();
        ['keydown', 'keypress', 'keyup'].forEach(function (t) { el.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })); });
        var f = el.form;
        if (f && typeof f.requestSubmit === 'function') f.requestSubmit();
        return Object.assign({ ok: true }, info);
      }
      return Object.assign({ ok: false, reason: 'unknown-step' }, info);
    };

    // Read the text of a control (or the page). Never a secret field's value.
    kit.read = function (step, max) {
      var el;
      if (step.target && (step.target.name || step.target.text || step.target.label || step.target.css)) {
        var res = kit.resolve(step.target, { exact: false, scope: 'any' });
        if (res.status !== 'found') return Object.assign({ ok: false, reason: res.status === 'none' ? 'not-found' : res.status }, brief(res));
        el = res.el;
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && sensOf(el)) return { ok: false, reason: 'sensitive-field' };
      } else el = doc.body;
      var text = /^(INPUT|TEXTAREA)$/.test(el.tagName) ? String(el.value) : textOf(el);
      return { ok: true, text: text.slice(0, max || 4000), how: 'read' };
    };

    kit.captcha = function () {
      var sel = 'iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare.com"],iframe[src*="turnstile"],iframe[src*="captcha"],.g-recaptcha,.h-captcha,.cf-turnstile,#cf-challenge-running,#challenge-form,[data-sitekey],input[name="cf-turnstile-response"],input[name="g-recaptcha-response"]';
      var hit = null;
      try { hit = doc.querySelector(sel); } catch (e) { hit = null; }
      if (hit) return { found: true, kind: 'widget' };
      var body = autoFold(textOf(doc.body || doc.documentElement).slice(0, 6000));
      if (/(verify you are human|are you a robot|i m not a robot|unusual traffic|please complete the security check|checking if the site connection is secure|captcha|robot degilim|insan oldugunuzu|guvenlik kontrolunu)/.test(body)) return { found: true, kind: 'text' };
      return { found: false };
    };

    kit.waitFor = function (text, ms) {
      var want = autoFold(text), end = Date.now() + Math.max(100, ms || 5000);
      return new Promise(function (resolve) {
        (function poll() {
          if (autoFold(textOf(doc.body || doc.documentElement)).indexOf(want) !== -1) return resolve({ ok: true });
          if (Date.now() > end) return resolve({ ok: false, reason: 'wait-timeout' });
          setTimeout(poll, 150);
        })();
      });
    };

    // ---- the recorder ---------------------------------------------------------
    function isTextField(el) {
      var tag = el.tagName;
      if (tag === 'TEXTAREA') return true;
      if (tag !== 'INPUT') return !!el.isContentEditable;
      return !/^(button|submit|checkbox|radio|image|reset|file|color|range)$/i.test(el.type || 'text');
    }
    // With a nonce, every event is sent out at once as a console line the window listens for (a page that navigates
    // straight after a click would otherwise take the buffered events with it); without one they are buffered for recDrain.
    kit.recStart = function (nonce) {
      if (kit._rec && kit._rec.on) return 'already';
      var rec = kit._rec = { on: true, events: [], pick: false, hot: null };
      var push = function (e) {
        if (nonce) { console.log('__vexrec:' + nonce + ':' + JSON.stringify(e)); return; }
        if (rec.events.length < 300) rec.events.push(e);
      };
      var onInput = function (e) {
        if (e.isTrusted && typeof e.inputType === 'string' && /^(insertText|insertFromPaste|insertFromDrop|deleteContent|insertCompositionText|insertLineBreak|historyUndo|historyRedo)/.test(e.inputType) && e.target) e.target.__vexTyped = true;
      };
      var onKey = function (e) {
        if (!e.isTrusted || e.key !== 'Enter' || !e.target || !e.target.tagName || !isTextField(e.target) || e.target.tagName === 'TEXTAREA') return;
        if (sensOf(e.target)) return;   // Enter in a secret field is the person's own step
        push({ t: 'enter', target: describe(e.target) });
      };
      var onChange = function (e) {
        var el = e.target; if (!el || !el.tagName) return;
        if (el.tagName === 'SELECT') { var o = el.options[el.selectedIndex]; push({ t: 'select', target: describe(el), value: o ? o.text : '' }); return; }
        var ty = (el.getAttribute('type') || '').toLowerCase();
        if (ty === 'checkbox' || ty === 'radio') { if (e.isTrusted) push({ t: 'check', target: describe(el), checked: !!el.checked }); return; }
        if (!isTextField(el)) return;
        var d = describe(el);
        // A secret field, or a field the person did not type into, is never read.
        if (sensOf(el) || !e.isTrusted || !el.__vexTyped) { push({ t: 'ask', target: d, autofilled: !sensOf(el) }); return; }
        push({ t: 'type', target: d, value: el.isContentEditable ? el.textContent : el.value });
      };
      var onClick = function (e) {
        var t = e.target; if (!t || !t.closest) return;
        if (rec.pick) {
          e.preventDefault(); e.stopPropagation();
          rec.pick = false; if (rec.hot) { rec.hot.style.outline = rec.hotOutline || ''; rec.hot = null; }
          // A value changes between runs, so the step finds it by where it is (id or position), never by its text.
          var rd = describe(t); rd.name = ''; rd.text = '';
          push({ t: 'read', target: rd, as: (rd.id || rd.near || 'value').slice(0, 40) });
          return;
        }
        if (!e.isTrusted) return;
        var el = t.closest('a,button,[role=button],[role=tab],[role=menuitem],[role=link],input[type=button],input[type=submit],input[type=image],summary,label,[onclick]') || t;
        if (isTextField(el) || el.tagName === 'SELECT') return;
        var ty = (el.getAttribute('type') || '').toLowerCase();
        if (ty === 'checkbox' || ty === 'radio') return;   // the change event records it
        if (el.tagName === 'LABEL' && el.control) return;
        push({ t: 'click', target: describe(el) });
      };
      var onOver = function (e) {
        if (!rec.pick || !e.target || !e.target.style) return;
        if (rec.hot && rec.hot !== e.target) rec.hot.style.outline = rec.hotOutline || '';
        if (rec.hot !== e.target) { rec.hot = e.target; rec.hotOutline = e.target.style.outline; e.target.style.outline = '3px solid #e8a33d'; }
      };
      doc.addEventListener('input', onInput, true);
      doc.addEventListener('keydown', onKey, true);
      doc.addEventListener('change', onChange, true);
      doc.addEventListener('click', onClick, true);
      doc.addEventListener('mouseover', onOver, true);
      rec.off = function () {
        rec.on = false;
        doc.removeEventListener('input', onInput, true); doc.removeEventListener('keydown', onKey, true);
        doc.removeEventListener('change', onChange, true); doc.removeEventListener('click', onClick, true); doc.removeEventListener('mouseover', onOver, true);
        if (rec.hot) rec.hot.style.outline = rec.hotOutline || '';
      };
      return 'ok';
    };
    kit.recDrain = function () { var r = kit._rec; if (!r) return []; var e = r.events; r.events = []; return e; };
    kit.recPick = function (on) { if (kit._rec) { kit._rec.pick = !!on; if (!on && kit._rec.hot) { kit._rec.hot.style.outline = kit._rec.hotOutline || ''; kit._rec.hot = null; } } return !!kit._rec; };
    kit.recStop = function () { var e = kit.recDrain(); if (kit._rec && kit._rec.off) kit._rec.off(); kit._rec = null; return e; };
    return kit;
  }

  // The kit as text: the three shared rules, the secret-field test, and autoKit.
  function kitSource() {
    return '(function(){ if (window.__vexAutoKit && window.__vexAutoKit.version === 1) return window.__vexAutoKit; ' +
      M.agentIsSensitiveField.toString().replace(/^function\s*\w*/, 'function agentIsSensitiveField') + ';\n' +
      M.autoFold.toString() + ';\n' + M.autoClassify.toString() + ';\n' + M.autoIsSensitive.toString() + ';\n' +
      'var kit = (' + autoKit.toString() + ')(); window.__vexAutoKit = kit; return kit; })()';
  }
  // Source of an expression that installs the kit and calls kit[method](...args).
  // Results must be JSON.
  function call(method, args) {
    if (!/^[A-Za-z]{1,20}$/.test(method)) throw new Error('Not a kit method');
    return '(function(){ var kit = ' + kitSource() + '; return kit.' + method + '.apply(kit, ' + JSON.stringify(args || []) + '); })()';
  }

  const api = { autoKit, kitSource, call };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AutoGuest = api;
})(typeof window !== 'undefined' ? window : null);
