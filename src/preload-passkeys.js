// === Passkeys in a page: the guest side =====================================
//
// Registered as its own guest preload (main.js GUEST_PRELOADS) next to
// preload-webview.js and site-tweaks.js, and for the same reason: webview
// preloads run sandboxed, where require() only resolves 'electron'.
//
// Two halves in one file:
//   1. vexPasskeyShim(bridge): self-contained, runs in the page's MAIN world
//      (contextBridge.executeInMainWorld, immune to page CSP). It replaces
//      navigator.credentials.create / get for `publicKey` requests with calls
//      to `bridge`, and returns real-looking PublicKeyCredential objects.
//      `password` / federated requests, and anything it declines, go to the
//      browser's own implementation untouched.
//   2. The preload proper (isolated world): owns the bridge, which only
//      carries base64url strings to the main process (src/main/passkeys.js).
//      The page is never trusted for who it is: main takes the origin from the
//      asking frame. Nothing secret ever comes back here, only finished
//      signatures.
//
// The file is also a CommonJS module for tests: it exports the shim.
'use strict';

function vexPasskeyShim(bridge, mode) {
  var CC = window.CredentialsContainer;
  var PKC = window.PublicKeyCredential;
  if (!CC || !PKC || !navigator.credentials) return;
  var credentials = navigator.credentials;
  var nativeGet = CC.prototype.get;
  var nativeCreate = CC.prototype.create;
  var $btoa = window.btoa.bind(window), $atob = window.atob.bind(window);
  var $Uint8Array = window.Uint8Array, $ArrayBuffer = window.ArrayBuffer;
  var $Promise = window.Promise;
  var $DOMException = window.DOMException;
  var refuse = mode === 'refused';

  function bytesOf(src, what) {
    if (src instanceof $ArrayBuffer) return new $Uint8Array(src);
    if (ArrayBuffer.isView(src)) return new $Uint8Array(src.buffer, src.byteOffset, src.byteLength);
    throw new TypeError("Failed to read the '" + what + "' property: The provided value is not of type '(ArrayBuffer or ArrayBufferView)'.");
  }
  function encode(src, what) {
    var u = bytesOf(src, what), s = '';
    for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return $btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decode(text) {
    var b = String(text).replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    var s = $atob(b), u = new $Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u.buffer;
  }
  function randomId() {
    var u = new $Uint8Array(16);
    window.crypto.getRandomValues(u);
    return encode(u, 'id');
  }
  function fail(name, message) {
    return name === 'TypeError' ? new TypeError(message) : new $DOMException(message, name);
  }
  function descriptors(list, what) {
    if (list === undefined || list === null) return [];
    if (!list || typeof list.length !== 'number') throw new TypeError("Failed to read the '" + what + "' property: The provided value cannot be converted to a sequence.");
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c || c.type !== 'public-key') continue;
      out.push({ id: encode(c.id, what + '.id'), transports: Array.isArray(c.transports) ? c.transports.map(String) : [] });
    }
    return out;
  }
  function pick(obj, keys) {
    var out = {};
    for (var i = 0; i < keys.length; i++) if (obj[keys[i]] !== undefined) out[keys[i]] = obj[keys[i]];
    return out;
  }
  function define(target, props) {
    Object.keys(props).forEach(function (k) {
      Object.defineProperty(target, k, { value: props[k], enumerable: false, configurable: true, writable: false });
    });
  }

  // A response / credential that passes `instanceof` and reads like the
  // native one. The native prototypes' accessors brand-check, so every
  // field is an own property of the object instead.
  function responseFor(kind, c) {
    var proto = kind === 'create' ? window.AuthenticatorAttestationResponse : window.AuthenticatorAssertionResponse;
    var r = Object.create(proto.prototype);
    var props = { clientDataJSON: decode(c.clientDataJSON) };
    if (kind === 'create') {
      props.attestationObject = decode(c.attestationObject);
      props.getAuthenticatorData = function getAuthenticatorData() { return decode(c.authenticatorData); };
      props.getPublicKey = function getPublicKey() { return decode(c.publicKey); };
      props.getPublicKeyAlgorithm = function getPublicKeyAlgorithm() { return c.publicKeyAlgorithm; };
      props.getTransports = function getTransports() { return (c.transports || []).slice(); };
    } else {
      props.authenticatorData = decode(c.authenticatorData);
      props.signature = decode(c.signature);
      props.userHandle = c.userHandle ? decode(c.userHandle) : null;
    }
    define(r, props);
    return r;
  }
  function credentialFor(kind, c) {
    var cred = Object.create(PKC.prototype);
    var json;
    if (kind === 'create') {
      json = { id: c.id, rawId: c.rawId, type: 'public-key', authenticatorAttachment: c.authenticatorAttachment,
        response: { clientDataJSON: c.clientDataJSON, attestationObject: c.attestationObject, transports: c.transports || [],
          publicKeyAlgorithm: c.publicKeyAlgorithm, publicKey: c.publicKey, authenticatorData: c.authenticatorData },
        clientExtensionResults: c.clientExtensionResults || {} };
    } else {
      json = { id: c.id, rawId: c.rawId, type: 'public-key', authenticatorAttachment: c.authenticatorAttachment,
        response: { clientDataJSON: c.clientDataJSON, authenticatorData: c.authenticatorData, signature: c.signature,
          userHandle: c.userHandle || undefined },
        clientExtensionResults: c.clientExtensionResults || {} };
    }
    var ext = c.clientExtensionResults || {};
    define(cred, {
      id: c.id, type: 'public-key', rawId: decode(c.rawId), response: responseFor(kind, c),
      authenticatorAttachment: c.authenticatorAttachment || 'platform',
      getClientExtensionResults: function getClientExtensionResults() { return JSON.parse(JSON.stringify(ext)); },
      toJSON: function toJSON() { return JSON.parse(JSON.stringify(json)); },
    });
    return cred;
  }

  function aborted(signal) {
    if (!signal || !signal.aborted) return null;
    return signal.reason !== undefined ? signal.reason : new $DOMException('The operation was aborted.', 'AbortError');
  }
  function run(kind, options, native, thisArg, args) {
    var pk = options.publicKey;
    var id = randomId();
    var mediation = options.mediation === 'conditional' ? 'conditional' : 'optional';
    var signal = options.signal;
    var early = aborted(signal);
    if (early) return $Promise.reject(early);
    var publicKey;
    if (kind === 'get') {
      publicKey = {
        challenge: encode(pk.challenge, 'challenge'), rpId: pk.rpId === undefined ? undefined : String(pk.rpId),
        timeout: pk.timeout, userVerification: pk.userVerification, hints: Array.isArray(pk.hints) ? pk.hints.map(String) : undefined,
        allowCredentials: descriptors(pk.allowCredentials, 'allowCredentials'),
      };
    } else {
      if (!pk.rp || !pk.user) throw new TypeError("Failed to execute 'create' on 'CredentialsContainer': The 'rp' and 'user' members are required.");
      publicKey = {
        challenge: encode(pk.challenge, 'challenge'), timeout: pk.timeout, hints: Array.isArray(pk.hints) ? pk.hints.map(String) : undefined,
        rp: { id: pk.rp.id === undefined ? undefined : String(pk.rp.id), name: String(pk.rp.name) },
        user: { id: encode(pk.user.id, 'user.id'), name: String(pk.user.name), displayName: pk.user.displayName === undefined ? '' : String(pk.user.displayName) },
        pubKeyCredParams: (pk.pubKeyCredParams || []).map(function (p) { return { type: p.type, alg: p.alg }; }),
        excludeCredentials: descriptors(pk.excludeCredentials, 'excludeCredentials'),
        authenticatorSelection: pk.authenticatorSelection ? pick(pk.authenticatorSelection, ['authenticatorAttachment', 'residentKey', 'requireResidentKey', 'userVerification']) : undefined,
        extensions: pk.extensions && pk.extensions.credProps === true ? { credProps: true } : undefined,
      };
    }
    var request = JSON.parse(JSON.stringify({ op: kind, id: id, mediation: mediation, publicKey: publicKey }));
    return new $Promise(function (resolve, reject) {
      var done = false;
      var onAbort = function () {
        if (done) return;
        done = true;
        try { bridge.cancel(id); } catch (e) { /* the page is going away */ }
        reject(aborted(signal));
      };
      if (signal && signal.addEventListener) signal.addEventListener('abort', onAbort, { once: true });
      var finish = function (fn, value) {
        if (done) return;
        done = true;
        if (signal && signal.removeEventListener) signal.removeEventListener('abort', onAbort);
        fn(value);
      };
      var asked;
      try { asked = bridge.request(request); } catch (err) { finish(reject, fail('NotAllowedError', 'The passkey request could not be sent')); return; }
      $Promise.resolve(asked).then(function (res) {
        if (!res) { finish(reject, fail('NotAllowedError', 'The operation either timed out or was not allowed.')); return; }
        if (res.fallback) {
          // A security key or phone: the browser's own flow, as if Vex were not here.
          if (done) return;
          done = true;
          if (signal && signal.removeEventListener) signal.removeEventListener('abort', onAbort);
          try { resolve(Reflect.apply(native, thisArg, args)); } catch (e) { reject(e); }
          return;
        }
        if (!res.ok) { finish(reject, fail(res.name || 'NotAllowedError', res.message || 'The operation either timed out or was not allowed.')); return; }
        finish(resolve, credentialFor(kind, res.credential));
      }, function () { finish(reject, fail('NotAllowedError', 'The operation either timed out or was not allowed.')); });
    });
  }

  function wrap(kind, native) {
    return new Proxy(native, {
      apply: function (target, thisArg, args) {
        if (thisArg !== credentials) return Reflect.apply(target, thisArg, args);
        var options = args[0];
        if (!options || typeof options !== 'object' || !options.publicKey) return Reflect.apply(target, thisArg, args);
        try { return run(kind, options, target, thisArg, args); } catch (err) { return $Promise.reject(err); }
      },
    });
  }
  function replace(proto, name, value) {
    var d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d) return;
    d.value = value;
    Object.defineProperty(proto, name, d);
  }
  replace(CC.prototype, 'get', wrap('get', nativeGet));
  replace(CC.prototype, 'create', wrap('create', nativeCreate));

  function stat(name, fn) {
    try { Object.defineProperty(PKC, name, { value: fn, writable: true, configurable: true, enumerable: false }); } catch (e) { /* locked down */ }
  }
  var yes = !refuse;
  var bool = function (v) { return function () { return $Promise.resolve(v); }; };
  stat('isUserVerifyingPlatformAuthenticatorAvailable', bool(yes));
  stat('isConditionalMediationAvailable', bool(yes));
  stat('getClientCapabilities', function () {
    return $Promise.resolve({
      conditionalCreate: false, conditionalGet: yes, hybridTransport: false, passkeyPlatformAuthenticator: yes,
      userVerifyingPlatformAuthenticator: yes, relatedOrigins: false,
      signalAllAcceptedCredentials: false, signalCurrentUserDetails: false, signalUnknownCredential: false,
    });
  });
}

// --- The preload proper (isolated world) -------------------------------------
(function () {
  if (typeof document === 'undefined' || typeof location === 'undefined') return;
  let proto = '';
  try { proto = location.protocol; } catch { return; }
  if (proto !== 'https:' && proto !== 'http:') return;
  if (proto === 'http:' && !/^(?:localhost|[^.]+\.localhost)$/i.test(location.hostname)) return;
  // A page with an opaque origin (a sandboxing CSP header) or that is not a
  // secure context is the browser's to answer, as before.
  try { if (window.origin === 'null' || window.isSecureContext === false) return; } catch { return; }
  let electron;
  try { electron = require('electron'); } catch { return; }
  const { ipcRenderer, contextBridge } = electron;
  if (!ipcRenderer || !contextBridge || typeof contextBridge.executeInMainWorld !== 'function') return;

  let config = {};
  try { config = ipcRenderer.sendSync('compatibility:get') || {}; } catch { config = {}; }
  // 'off': the site is on the "don't offer passkeys" list (site-tweaks.js
  // handles it). 'refused': a private, Tor or locked-down tab, where the page
  // is told no passkeys are available at all.
  const mode = config.passkeys === 'off' || config.suppressPasskeys === true ? 'off' : (config.passkeys === 'refused' ? 'refused' : 'vex');
  if (mode === 'off') return;

  // A request waiting on a field marked autocomplete="webauthn".
  const conditional = new Set();
  let shown = null;
  const wantsField = (el) => {
    try { return el && el.tagName === 'INPUT' && /(^|\s)webauthn(\s|$)/i.test(el.getAttribute('autocomplete') || ''); }
    catch { return false; }
  };
  const hideChooser = () => {
    if (!shown) return;
    shown = null;
    try { ipcRenderer.sendToHost('vex-passkey-field-hide'); } catch { /* not in a Vex tab */ }
  };
  async function showChooser(el) {
    if (!conditional.size || !wantsField(el)) return;
    const id = [...conditional][conditional.size - 1];
    let info;
    try { info = await ipcRenderer.invoke('passkeys:conditional-list', id); }
    catch (err) { console.error('[Vex passkeys] could not list passkeys:', err && err.message); return; }
    if (!info || !Array.isArray(info.accounts) || !info.accounts.length) return;
    if (document.activeElement !== el) return;
    const r = el.getBoundingClientRect();
    shown = el;
    try {
      ipcRenderer.sendToHost('vex-passkey-field', {
        requestId: id, accounts: info.accounts, uv: info.uv, hasPin: info.hasPin,
        rect: { x: r.left, y: r.top, width: r.width, height: r.height }, host: location.hostname,
      });
    } catch (err) { console.error('[Vex passkeys] could not show the list:', err && err.message); }
  }
  document.addEventListener('focusin', (e) => { showChooser(e.target); }, true);
  document.addEventListener('focusout', (e) => { if (e.target === shown) hideChooser(); }, true);
  window.addEventListener('scroll', hideChooser, true);
  window.addEventListener('resize', hideChooser);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideChooser(); }, true);

  const bridge = {
    request: (req) => {
      const cond = req && req.op === 'get' && req.mediation === 'conditional' && typeof req.id === 'string';
      if (cond) {
        conditional.add(req.id);
        // The field may already have the focus.
        setTimeout(() => showChooser(document.activeElement), 0);
      }
      return ipcRenderer.invoke('passkeys:request', req).finally(() => {
        if (cond) { conditional.delete(req.id); hideChooser(); }
      });
    },
    cancel: (id) => { ipcRenderer.send('passkeys:cancel', String(id)); conditional.delete(String(id)); hideChooser(); },
  };
  try { contextBridge.executeInMainWorld({ func: vexPasskeyShim, args: [bridge, mode] }); }
  catch (err) { console.error('[Vex passkeys] could not install:', err && err.message); }
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { vexPasskeyShim };
