// === Page automations: the step model and the safety rules (pure) ============
//
// Record what you do on a site once, replay it later. This file is the part
// with no DOM, no Electron and no storage, so the main process (the runner),
// the interface (the recorder bar, the step list) and the tests all apply the
// SAME rules:
//
//   * what a step is, and how a recording is checked before it is kept;
//   * which fields are secret (password, one-time code, card, anything the
//     password manager filled): their value is NEVER recorded, the step
//     becomes "ask me";
//   * which steps are consequential (submit, buy, pay, send, post, delete,
//     transfer, confirm, in English and Turkish): they always ask, and the
//     payment / delete / transfer / send class cannot be switched to "run";
//   * the limits (steps, duration, runs per hour), and the export that strips
//     every typed value.
//
// The functions autoFold, autoClassify and autoIsSensitive are standalone (no
// outer references) because their source is also placed in the page being
// automated (automations-guest.js): the page and Vex apply literally the same
// rule. Public API: AutoModel (window.AutoModel, or require()).
(function (root) {
  'use strict';

  // ---- the secret-field test: one rule with the agent's, plus autofill -----
  // agent-safety.js is loaded before this file in the interface and required
  // from main; it has no DOM and exports the same function both ways.
  const globalScope = typeof globalThis !== 'undefined' ? globalThis : {};
  const safetyMod = (globalScope.AgentSafety && globalScope.agentIsSensitiveField) ? globalScope : require('./agent-safety.js');
  const baseSensitive = globalScope.agentIsSensitiveField || safetyMod.agentIsSensitiveField;
  const baseSecretValue = globalScope.agentLooksLikeSecretValue || safetyMod.agentLooksLikeSecretValue;
  if (typeof baseSensitive !== 'function' || typeof baseSecretValue !== 'function') throw new Error('Page automations need agent-safety.js to be loaded first');
  // The name autoIsSensitive calls, in this scope and (by toString) in the page.
  const agentIsSensitiveField = baseSensitive;

  // Lower case, accents off, Turkish dotted/dotless i folded together, and
  // everything that is not a letter or digit turned into a single space.
  function autoFold(s) {
    var t = String(s == null ? '' : s).replace(/İ/g, 'i').replace(/I/g, 'i').replace(/ı/g, 'i').toLowerCase();
    t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return t.replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // d = what the page reports about a control (see automations-guest.js).
  // True for a field whose value must never be written down.
  function autoIsSensitive(d) {
    d = d || {};
    if (agentIsSensitiveField(d)) return true;
    // The same rule on the name ATTRIBUTE (the accessible name is in d.name).
    if (d.attrName && agentIsSensitiveField({ type: d.type, name: d.attrName })) return true;
    // Filled by a password manager or the browser: never typed by the person.
    if (d.autofilled === true || d.pmAttr === true) return true;
    var hint = [d.name, d.attrName, d.id, d.label, d.placeholder, d.ariaLabel, d.text].map(function (x) { return String(x || ''); }).join(' ');
    var f = autoFold(hint);
    // credit card / kredi karti, cvv, iban, parola, sifre, tc kimlik, dogrulama kodu, tek kullanimlik
    if (/\b(credit card|debit card|card holder|cardholder|kredi karti|banka karti|kart numarasi|kart no|cvv|cvc|cvv2|iban|parola|sifre|sifreniz|pin kodu|dogrulama kodu|onay kodu|guvenlik kodu|tek kullanimlik|tc kimlik|kimlik no|passcode|passphrase|recovery code|backup code|secret answer)\b/.test(f)) return true;
    return false;
  }

  // What a click or a form submit would do. d = { text, ariaLabel, title, value,
  // type, role, tag, href, inForm, formMethod, formAction, crossOrigin }.
  // -> { level: 'none' | 'soft' | 'locked', kind, why }
  //   locked  pay / delete / transfer / send / post / confirm: always asks,
  //           and cannot be switched to "run"
  //   soft    a form submit or a change that saves: asks by default, the
  //           person may set the step to "run"
  function autoClassify(d) {
    d = d || {};
    var T = autoClassify.T;
    if (!T) {
      var w = function (list) { return new RegExp('(^| )(' + list.join('|') + ')( |$)'); };
      T = autoClassify.T = {
        // Cookie banners are not a consequence.
        cookie: /(^| )(cookies?|cerez(ler|leri)?|gizlilik tercih)( |$)/,
        login: /(^| )(sign in|log in|login|giris( yap)?|oturum ac)( |$)/,
        pay: w(['pay', 'pay now', 'payment', 'pay with [a-z ]+', 'checkout', 'check out', 'buy', 'buy now', 'purchase', 'place (your )?order', 'order now', 'complete (my )?(order|purchase)', 'donate', 'subscribe', 'start (my )?(free )?trial', 'upgrade', 'add funds', 'top up', 'withdraw', 'place (a )?bid', 'book now', 'reserve', 'rent',
          'satin al', 'satin alin', 'satin almak', 'hemen al', 'siparis( ver| verin| ver| i tamamla)?', 'siparisi (tamamla|onayla)', 'ode', 'odeyin', 'ode(me|meyi|mek|nir)', 'odeme( yap| yapin)?', 'odemeyi (tamamla|onayla)', 'sepeti onayla', 'bagis( yap)?', 'abone ol', 'yukselt', 'rezervasyon( yap)?', 'kirala', 'teklif ver', 'para yatir', 'para cek']),
        del: w(['delete', 'remove', 'erase', 'discard', 'destroy', 'deactivate', 'close (my )?account', 'cancel (my )?(subscription|order|booking|membership|plan)', 'unsubscribe', 'terminate', 'revoke', 'wipe', 'clear all', 'empty (the )?trash', 'permanently', 'reset (my )?(account|data)',
          'sil', 'silin', 'silme', 'silmek', 'sil(inecek)?', 'kaldir', 'kaldirin', 'cikar', 'iptal et', 'iptal edin', 'hesabi (kapat|sil)', 'abonelikten cik', 'uyeligi (iptal|sil)', 'yok et', 'feshet', 'kalici']),
        transfer: w(['transfer', 'wire', 'send (money|funds|payment)', 'havale', 'eft', 'aktar', 'aktarim', 'para gonder', 'para transferi']),
        send: w(['send', 'submit', 'post', 'publish', 'share', 'reply', 'tweet', 'comment', 'send message', 'gonder', 'gonderin', 'gonderi', 'yayinla', 'yayimla', 'paylas', 'yanitla', 'yorum( yap)?', 'ilet', 'ilet(in)?', 'mesaj gonder']),
        confirm: w(['confirm', 'approve', 'accept', 'agree', 'i agree', 'authorize', 'authorise', 'sign', 'e ?sign', 'apply', 'yes', 'ok', 'onayla', 'onaylayin', 'onayliyorum', 'kabul et', 'kabul ediyorum', 'yetkilendir', 'imzala', 'basvur', 'basvuru( yap)?', 'tamamla', 'bitir', 'evet']),
        soft: w(['save', 'save changes', 'update', 'add', 'create', 'apply changes', 'kaydet', 'degisiklikleri kaydet', 'guncelle', 'ekle', 'olustur']),
        benign: w(['search', 'find', 'filter', 'go', 'show', 'view', 'look up', 'sign in', 'log in', 'login', 'next', 'continue', 'back', 'previous', 'ara', 'bul', 'filtrele', 'goster', 'giris', 'giris yap', 'oturum ac', 'ileri', 'devam', 'devam et', 'geri']),
        urlDel: /(^|[\/_.-])(delete|remove|destroy|deactivate|unsubscribe|cancel)([\/_.?=&-]|$)/i,
        urlPay: /(^|[\/_.-])(checkout|payment|pay|purchase|order|buy|transfer|donate|subscribe)([\/_.?=&-]|$)/i,
      };
    }
    var raw = [d.text, d.ariaLabel, d.title, d.tag === 'input' ? d.value : ''].map(function (x) { return String(x || ''); });
    // Check each label on its own as well as together: "Sil" inside a long
    // aria-label still counts, and two short labels do not blur into one.
    var labels = raw.map(autoFold).filter(Boolean);
    var any = function (re) { return labels.some(function (l) { return re.test(l); }); };
    var type = String(d.type || '').toLowerCase();
    var method = String(d.formMethod || '').toLowerCase();
    var isSubmit = type === 'submit' || type === 'image' ||
      (d.inForm === true && (d.tag === 'button' || d.role === 'button') && (type === '' || type === 'submit'));
    var cookie = any(T.cookie);

    if (!cookie) {
      if (any(T.transfer)) return { level: 'locked', kind: 'transfer', why: 'It looks like a money transfer' };
      if (any(T.pay)) return { level: 'locked', kind: 'pay', why: 'It looks like a purchase or a payment' };
      if (any(T.del)) return { level: 'locked', kind: 'delete', why: 'It looks like it deletes or cancels something' };
      if (any(T.send)) return { level: 'locked', kind: 'send', why: 'It looks like it sends or posts something' };
      if (!any(T.login) && any(T.confirm)) return { level: 'locked', kind: 'confirm', why: 'It looks like a confirmation' };
    }
    var href = String(d.href || '');
    if (href) {
      if (T.urlPay.test(href) && !cookie) return { level: 'locked', kind: 'pay', why: 'The link goes to a payment or order address' };
      if (T.urlDel.test(href) && !cookie) return { level: 'locked', kind: 'delete', why: 'The link goes to a delete or cancel address' };
    }
    var action = String(d.formAction || '');
    if (isSubmit || d.enter === true) {
      if (action && T.urlPay.test(action)) return { level: 'locked', kind: 'pay', why: 'The form is sent to a payment or order address' };
      if (action && T.urlDel.test(action)) return { level: 'locked', kind: 'delete', why: 'The form is sent to a delete or cancel address' };
      if (d.crossOrigin === true && method === 'post') return { level: 'locked', kind: 'post', why: 'The form posts to a different site' };
      if (method === 'post') return { level: 'soft', kind: 'submit', why: 'It sends a form (a POST request)' };
      if (!any(T.benign)) return { level: 'soft', kind: 'submit', why: 'It is a form button' };
      return { level: 'none', kind: null, why: '' };
    }
    if (any(T.soft) && !cookie) return { level: 'soft', kind: 'change', why: 'It saves or changes something' };
    return { level: 'none', kind: null, why: '' };
  }

  // ---- the model ------------------------------------------------------------
  const STEP_TYPES = ['open', 'click', 'type', 'select', 'check', 'enter', 'read', 'wait', 'pause', 'summarise'];
  const ACTING = ['click', 'type', 'select', 'check', 'enter'];
  const CONFIRM = ['ask', 'run'];
  const LIMITS = Object.freeze({
    maxSteps: 60,            // steps in one recording
    maxOpens: 12,            // addresses one run may load (there are no loops, so this is also the page-load budget)
    maxRunMs: 5 * 60 * 1000, // default length of one run, waiting for the person excluded
    maxRunMsCap: 15 * 60 * 1000,
    maxRunsPerHour: 6,       // per recording
    maxRunsPerHourAll: 20,
    maxValueChars: 500,
    maxNameChars: 80,
    maxReadChars: 4000,
    maxWaitMs: 30000,
    approvalTimeoutMs: 15 * 60 * 1000, // a run left waiting this long ends as "needs approval"; nothing is done
    maxRuns: 60,             // run logs kept
    maxShots: 10,            // failure screenshots kept
    maxBytes: 600 * 1024,    // one recording, as JSON
  });
  const PARTITION_RE = /^persist:(?:main|container-(?!tor-)[A-Za-z0-9_-]{1,64})$/;
  const SECRETY_PARAM = /pass|pwd|token|secret|key|otp|sig|auth|session|sid|code|jwt|bearer|credential/i;
  const DOWNLOAD_EXT = /\.(exe|msi|msix|dmg|pkg|deb|rpm|apk|ipa|iso|zip|rar|7z|tar|gz|tgz|bz2|xz|bat|cmd|ps1|vbs|jar|scr|appimage|crx|xpi)(\?|#|$)/i;

  let counter = 0;
  const newId = (p) => p + Date.now().toString(36) + (++counter).toString(36) + Math.random().toString(36).slice(2, 6);
  const clip = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, n);

  function isSensitive(d) { return autoIsSensitive(d); }
  function looksLikeSecretValue(v) { return baseSecretValue(v); }

  // An address for an "open" step. Userinfo is refused; query parameters with
  // a secret-looking name are left out and the step says so.
  function cleanUrl(input) {
    let u;
    try { u = new URL(String(input)); } catch (e) { throw new Error('"' + clip(input, 80) + '" is not a web address'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http and https addresses can be opened');
    if (u.username || u.password) throw new Error('An address with a login inside it is not recorded');
    let trimmed = false;
    for (const k of [...u.searchParams.keys()]) if (SECRETY_PARAM.test(k)) { u.searchParams.delete(k); trimmed = true; }
    if (u.hash && /(access_token|id_token|token|code)=/i.test(u.hash)) { u.hash = ''; trimmed = true; }
    return { url: u.href, trimmed };
  }

  // Why an address may not be opened by a run ('' = it may). allowLocal is for
  // the test site of the real-window checks only.
  function urlRefusal(url, { allowLocal = false, isPrivateHost } = {}) {
    let u;
    try { u = new URL(String(url)); } catch (e) { return 'That is not a web address'; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Only http and https pages are opened';
    if (u.username || u.password) return 'Addresses with a login inside are not opened';
    if (DOWNLOAD_EXT.test(u.pathname)) return 'That address is a file download; a run never downloads or installs files';
    if (!allowLocal) {
      const priv = typeof isPrivateHost === 'function' ? isPrivateHost : (typeof VexPrivateAddress !== 'undefined' ? VexPrivateAddress.isPrivateHost : require('./private-address.js').isPrivateHost);
      if (priv(u.hostname)) return 'Pages on this computer or the home network are not opened by an automation';
    }
    return '';
  }

  // How a step reads in the list.
  function describeStep(s) {
    const name = (s.target && (s.target.name || s.target.text || s.target.label)) || '';
    const q = name ? ' "' + clip(name, 40) + '"' : '';
    switch (s.type) {
      case 'open': return 'Open ' + clip(s.url, 80);
      case 'click': return 'Click' + (q || ' a control');
      case 'type': return s.ask ? 'Type in' + (q || ' a field') + ' (asked at run time)' : 'Type in' + (q || ' a field');
      case 'select': return 'Choose in' + (q || ' a list');
      case 'check': return (s.checked === false ? 'Untick' : 'Tick') + (q || ' a box');
      case 'enter': return 'Press Enter in' + (q || ' a field');
      case 'read': return 'Read' + (q || ' the page');
      case 'wait': return s.waitFor ? 'Wait for "' + clip(s.waitFor, 40) + '"' : 'Wait ' + Math.round((s.ms || 0) / 100) / 10 + ' s';
      case 'pause': return 'Pause until you continue';
      case 'summarise': return 'Ask the AI to summarise what was read';
      default: return String(s.type);
    }
  }

  // The target a step finds its control with. Anything the page told us is
  // kept short; a secret field's own value is never part of it.
  function cleanTarget(t) {
    if (t == null) return null;
    if (typeof t !== 'object' || Array.isArray(t)) throw new Error('A step target must be an object');
    const out = {};
    for (const k of ['role', 'name', 'text', 'label', 'near', 'tag', 'type', 'css', 'placeholder', 'ariaLabel', 'id', 'autocomplete', 'title', 'attrName']) {
      if (t[k] != null && t[k] !== '') out[k] = clip(t[k], k === 'css' ? 300 : 140);
    }
    for (const k of ['autofilled', 'pmAttr', 'inForm', 'crossOrigin']) if (t[k] === true) out[k] = true;
    if (t.formMethod) out.formMethod = clip(t.formMethod, 8).toLowerCase();
    if (t.formAction) out.formAction = clip(t.formAction, 300);
    if (t.href) out.href = clip(t.href, 300);
    return out;
  }

  const classifyTarget = (t) => autoClassify({
    text: t && (t.name || t.text), ariaLabel: t && t.ariaLabel, title: t && t.title, value: t && t.value, type: t && t.type, role: t && t.role, tag: t && t.tag,
    href: t && t.href, inForm: t && t.inForm, formMethod: t && t.formMethod, formAction: t && t.formAction, crossOrigin: t && t.crossOrigin,
  });

  // One step, checked and made safe. Never trusts what it was given: secret
  // fields lose their value, the consequence is worked out again, and a
  // locked step is forced to ask.
  function cleanStep(raw, index) {
    const where = 'Step ' + (index + 1);
    if (!raw || typeof raw !== 'object') throw new Error(where + ' is not a step');
    if (!STEP_TYPES.includes(raw.type)) throw new Error(where + ' has an unknown type "' + clip(raw.type, 20) + '"');
    const s = { id: typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(raw.id) ? raw.id : newId('s'), type: raw.type, label: clip(raw.label, 120) };
    if (raw.type === 'open') {
      const c = cleanUrl(raw.url);
      s.url = c.url;
      if (c.trimmed || raw.urlTrimmed === true) s.urlTrimmed = true;
    }
    if (ACTING.includes(raw.type) || raw.type === 'read') {
      s.target = cleanTarget(raw.target);
      if (raw.type !== 'read' && (!s.target || !(s.target.name || s.target.text || s.target.label || s.target.css || s.target.id))) throw new Error(where + ' does not say which control it is for');
    }
    if (raw.type === 'type' || raw.type === 'select') {
      const sensitive = isSensitive(s.target || {}) || raw.ask === true || raw.secret != null;
      const value = raw.value == null ? '' : String(raw.value);
      if (sensitive || (raw.type === 'type' && looksLikeSecretValue(value))) {
        s.ask = true;                     // filled in by the person at run time; nothing is stored
        s.secret = typeof raw.secret === 'string' && /^[a-z-]{1,20}$/.test(raw.secret) ? raw.secret : (isSensitive(s.target || {}) ? 'secret' : 'value');
      } else {
        if (value.length > LIMITS.maxValueChars) throw new Error(where + ': the text to type is longer than ' + LIMITS.maxValueChars + ' characters');
        s.value = clip(value, LIMITS.maxValueChars);
      }
    }
    if (raw.type === 'check') s.checked = raw.checked !== false;
    if (raw.type === 'read') { s.as = clip(raw.as || s.label || 'value', 40); }
    if (raw.type === 'wait') {
      s.ms = Math.max(0, Math.min(LIMITS.maxWaitMs, Math.round(Number(raw.ms) || 0)));
      if (raw.waitFor) s.waitFor = clip(raw.waitFor, 100);
      if (!s.waitFor && !s.ms) s.ms = 1000;
    }
    if (raw.type === 'summarise') s.prompt = clip(raw.prompt, 300);
    // Consequence: from the recorded target, never from the stored flag.
    let level = 'none', kind = null, why = '';
    if (ACTING.includes(raw.type)) {
      const c = classifyTarget(s.target || {});
      level = c.level; kind = c.kind; why = c.why;
      if (raw.type === 'enter' && level === 'none') {
        const t = s.target || {};
        const e = autoClassify({ inForm: t.inForm, formMethod: t.formMethod, formAction: t.formAction, crossOrigin: t.crossOrigin, enter: true, text: '' });
        level = e.level; kind = e.kind; why = e.why;
      }
    }
    if (raw.type === 'pause') { s.confirm = 'ask'; }
    else if (level === 'locked') { s.consequence = { level, kind, why }; s.confirm = 'ask'; s.locked = true; }
    else if (level === 'soft') { s.consequence = { level, kind, why }; s.confirm = raw.confirm === 'run' ? 'run' : 'ask'; }
    else if (ACTING.includes(raw.type)) { s.confirm = raw.confirm === 'ask' ? 'ask' : 'run'; }
    if (s.ask) s.confirm = 'ask';
    if (!s.label) s.label = describeStep(s);
    return s;
  }

  const SCHEDULE_KINDS = ['none', 'daily', 'weekdays', 'weekly'];
  function cleanSchedule(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const kind = SCHEDULE_KINDS.includes(s.kind) ? s.kind : 'none';
    const out = { kind, time: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s.time || '')) ? s.time : '09:00', missed: s.missed === 'skip' ? 'skip' : 'run' };
    if (kind === 'weekly') out.day = Number.isInteger(s.day) && s.day >= 0 && s.day <= 6 ? s.day : 1;
    return out;
  }

  // A whole recording, checked. Throws a sentence that names the problem.
  function normalizeRecording(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('That is not a recording');
    if (JSON.stringify(raw).length > LIMITS.maxBytes) throw new Error('That recording is too large (the limit is ' + Math.round(LIMITS.maxBytes / 1024) + ' KB)');
    const name = clip(raw.name, LIMITS.maxNameChars).trim();
    if (!name) throw new Error('Give the recording a name');
    const steps = Array.isArray(raw.steps) ? raw.steps : null;
    if (!steps || !steps.length) throw new Error('A recording needs at least one step');
    if (steps.length > LIMITS.maxSteps) throw new Error('A recording has at most ' + LIMITS.maxSteps + ' steps');
    const clean = steps.map(cleanStep);
    if (clean.filter(s => s.type === 'open').length > LIMITS.maxOpens) throw new Error('A recording opens at most ' + LIMITS.maxOpens + ' addresses');
    if (new Set(clean.map(s => s.id)).size !== clean.length) throw new Error('Two steps share an id');
    if (clean[0].type !== 'open') throw new Error('A recording starts by opening an address');
    const summariseAt = clean.findIndex(s => s.type === 'summarise');
    if (summariseAt !== -1 && summariseAt !== clean.length - 1) throw new Error('The AI summary can only be the last step');
    const partition = PARTITION_RE.test(String(raw.partition || 'persist:main')) ? String(raw.partition || 'persist:main') : null;
    if (!partition) throw new Error('A recording runs in your main session or in one of your containers; a private, Tor or routed session cannot be used');
    const startUrl = clean[0].url;
    const rec = {
      format: 'vex-automation', version: 1,
      id: typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(raw.id) ? raw.id : newId('a'),
      name, startUrl, partition, steps: clean,
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
      updatedAt: Date.now(),
      enabled: raw.enabled !== false,
      mode: raw.mode === 'visible' ? 'visible' : 'hidden',
      schedule: cleanSchedule(raw.schedule),
      maxRunMs: Math.max(30000, Math.min(LIMITS.maxRunMsCap, Math.round(Number(raw.maxRunMs) || LIMITS.maxRunMs))),
      toInbox: raw.toInbox !== false,
      toNote: raw.toNote === true,
      lastRunAt: Number.isFinite(raw.lastRunAt) ? raw.lastRunAt : null,
      lastStatus: typeof raw.lastStatus === 'string' ? clip(raw.lastStatus, 20) : null,
      nextAt: Number.isFinite(raw.nextAt) ? raw.nextAt : null,
      imported: raw.imported === true,
    };
    return rec;
  }

  // A recording to hand to someone else: every typed value removed (the step
  // asks at run time), nothing of this computer or session in it.
  function exportRecording(rec) {
    const r = normalizeRecording(rec);
    return {
      format: 'vex-automation', version: 1, name: r.name, mode: r.mode,
      steps: r.steps.map(s => {
        const o = { ...s };
        if (o.type === 'type' || o.type === 'select') { delete o.value; o.ask = true; o.secret = o.secret || 'value'; o.confirm = 'ask'; }
        delete o.id;
        return o;
      }),
    };
  }

  // The other direction. An imported recording is somebody else's: it arrives
  // switched off, in the main session, unscheduled, with every acting step
  // asking, and with values only if the file had them (an export never does).
  function importRecording(text) {
    let raw;
    try { raw = JSON.parse(String(text)); } catch (e) { throw new Error('That file is not a Vex automation (it is not valid JSON)'); }
    if (!raw || raw.format !== 'vex-automation') throw new Error('That file is not a Vex automation');
    if (raw.version !== 1) throw new Error('That automation was made by a newer Vex (format ' + clip(raw.version, 10) + ')');
    const steps = (Array.isArray(raw.steps) ? raw.steps : []).map(s => {
      const o = { ...s };
      delete o.id;
      if (ACTING.includes(o.type) || o.type === 'read') o.confirm = 'ask';
      return o;
    });
    const rec = normalizeRecording({ name: raw.name, steps, mode: raw.mode, partition: 'persist:main', enabled: false, imported: true, schedule: { kind: 'none' } });
    rec.id = newId('a');
    return rec;
  }

  // ---- turning what the recorder saw into steps --------------------------------
  // events from automations-guest.js: { t: 'click'|'type'|'select'|'check'|'enter'|'read'|'ask', target, value, checked }
  // Typing bursts in one field become one step; a field the person did not
  // type into (a password manager's fill) becomes an "ask" step.
  function stepsFromEvents(events, existing) {
    const steps = existing ? existing.slice() : [];
    for (const ev of Array.isArray(events) ? events : []) {
      if (!ev || typeof ev !== 'object') continue;
      const target = cleanTarget(ev.target);
      const label = (t) => (target && (target.name || target.text || target.label)) || '';
      let step = null;
      if (ev.t === 'open') {
        let c;
        try { c = cleanUrl(ev.url); } catch (e) { continue; }
        step = { type: 'open', url: c.url, urlTrimmed: c.trimmed, label: 'Open ' + new URL(c.url).hostname };
      } else if (ev.t === 'click') {
        step = { type: 'click', target, label: 'Click "' + clip(label(), 40) + '"' };
      } else if (ev.t === 'type' || ev.t === 'ask') {
        const secret = ev.t === 'ask' || isSensitive(target || {});
        step = { type: 'type', target, ask: secret || undefined, secret: secret ? 'secret' : undefined, value: secret ? undefined : ev.value, label: 'Type in "' + clip(label(), 40) + '"' };
        const prev = steps[steps.length - 1];
        if (prev && prev.type === 'type' && prev.target && target && prev.target.css === target.css && prev.target.name === target.name) {
          try { steps[steps.length - 1] = cleanStep({ ...step, id: prev.id }, steps.length - 1); } catch (e) { steps.pop(); }   // vex-allow-empty-catch: an unsafe retype removes the earlier step as well
          continue;
        }
      } else if (ev.t === 'select') {
        step = { type: 'select', target, value: ev.value, label: 'Choose in "' + clip(label(), 40) + '"' };
      } else if (ev.t === 'check') {
        step = { type: 'check', target, checked: ev.checked !== false, label: (ev.checked === false ? 'Untick' : 'Tick') + ' "' + clip(label(), 40) + '"' };
      } else if (ev.t === 'enter') {
        step = { type: 'enter', target, label: 'Press Enter in "' + clip(label(), 40) + '"' };
      } else if (ev.t === 'read') {
        if (isSensitive(target || {})) continue;   // a secret field is never read
        step = { type: 'read', target, as: clip(ev.as || label() || 'value', 40), label: 'Read "' + clip(label() || 'the page', 40) + '"' };
      }
      if (!step) continue;
      try { steps.push(cleanStep(step, steps.length)); } catch (e) { /* a step that cannot be made safe is left out; the bar shows the count */ continue; }   // vex-allow-empty-catch: the recorder shows how many events were not turned into steps
    }
    return steps;
  }

  // ---- limits: runs per hour ----------------------------------------------------
  // times: epoch ms of earlier run starts. -> '' when one more may start, else why not.
  function rateRefusal({ now, recTimes, allTimes, perRec = LIMITS.maxRunsPerHour, all = LIMITS.maxRunsPerHourAll }) {
    const since = now - 3600 * 1000;
    if ((recTimes || []).filter(t => t > since).length >= perRec) return 'This automation already ran ' + perRec + ' times in the last hour';
    if ((allTimes || []).filter(t => t > since).length >= all) return 'Automations already ran ' + all + ' times in the last hour';
    return '';
  }

  // How the target looks once the sensitive pieces are out, for logs and prompts.
  const redact = (text) => String(text == null ? '' : text)
    .replace(/\b\d(?:[ -]?\d){12,18}\b/g, (m) => (baseSecretValue(m) ? '[card number removed]' : m))
    .replace(/\b(code|otp|pin|passcode|password|kod|sifre|parola)\b([^\d\n]{0,24})\d{4,8}\b/gi, '$1$2[removed]');

  const api = {
    autoFold, autoClassify, autoIsSensitive, agentIsSensitiveField: baseSensitive,
    STEP_TYPES, ACTING, CONFIRM, LIMITS, PARTITION_RE, SCHEDULE_KINDS,
    isSensitive, looksLikeSecretValue, classifyTarget, cleanUrl, urlRefusal, describeStep, cleanTarget, cleanStep, cleanSchedule,
    normalizeRecording, exportRecording, importRecording, stepsFromEvents, rateRefusal, redact, newId,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AutoModel = api;
})(typeof window !== 'undefined' ? window : null);
