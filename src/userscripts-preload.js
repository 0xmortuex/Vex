// === Userscripts: the page side =============================================
//
// A guest preload of its own (sandboxed webview preloads can only require
// 'electron', so it cannot be required from preload-webview.js; see
// site-tweaks.js). It asks main which userscripts may run on this page. Main
// answers from the tab's real session and the frame's real address, never the
// page's say-so: no scripts at all in Tor, private, burner, routed or app-panel
// tabs, on Vex's own pages, or on a sensitive site.
//
// A script that asks for no @grant runs in the page's own world, as a plain
// script (Tampermonkey's "@grant none"). A script with grants runs in an
// ISOLATED world of its own: the page cannot see it, its variables or the GM_
// functions, and one script cannot reach another's. The GM_ functions are plain
// functions carried into that world by contextBridge.exposeInIsolatedWorld;
// they hold the script's id, and main re-checks every request against the
// script's @grant and @connect lines. unsafeWindow in that world is the
// isolated window: page globals are not reachable (the price of the page not
// being able to reach the bridge).
'use strict';

(function () {
  if (typeof window === 'undefined' || typeof location === 'undefined') return;
  let ipcRenderer, webFrame, contextBridge;
  try { ({ ipcRenderer, webFrame, contextBridge } = require('electron')); } catch { return; }
  if (!ipcRenderer || !webFrame) return;
  if (window.top !== window) return;
  if (!/^https?:$/.test(location.protocol)) return;

  let reply = null;
  try { reply = ipcRenderer.sendSync('userscripts:page'); }
  catch (err) { console.error('[Userscripts] could not ask Vex which scripts to run:', err && err.message); return; }
  if (!reply || !Array.isArray(reply.scripts) || !reply.scripts.length) return;
  const limits = reply.limits || {};
  const WORLD_BASE = 1000;
  const ran = [];

  function report() {
    try { ipcRenderer.sendToHost('vex-userscripts', { count: ran.length, names: ran.slice(0, 20) }); }
    catch (err) { console.error('[Userscripts] could not tell the tab:', err && err.message); }
  }

  function invoke(id, op, args) { return ipcRenderer.invoke('userscripts:gm', { id, op, args }); }
  const activeNow = () => { try { return !!(navigator.userActivation && navigator.userActivation.isActive); } catch { return false; } };

  function makeBridge(s) {
    const values = s.values && typeof s.values === 'object' ? s.values : {};
    const css = new Map();
    let cssSeq = 0;
    let reqSeq = 0;
    const bridge = {
      getValue(key, fallback) { return Object.prototype.hasOwnProperty.call(values, key) ? JSON.parse(JSON.stringify(values[key])) : fallback; },
      setValue(key, value) {
        if (typeof key !== 'string' || !key || key.length > (limits.maxKeyLength || 128)) throw new Error('A value name must be 1-' + (limits.maxKeyLength || 128) + ' characters');
        let encoded;
        try { encoded = JSON.stringify(value === undefined ? null : value); } catch { throw new Error('That value cannot be saved (it is not plain data)'); }
        if (encoded === undefined) throw new Error('That value cannot be saved');
        if (key.length + encoded.length > (limits.maxValueBytes || 32768)) throw new Error('A saved value is too large');
        const had = Object.prototype.hasOwnProperty.call(values, key);
        const before = had ? values[key] : undefined;
        if (!had && Object.keys(values).length >= (limits.maxValueKeys || 200)) throw new Error('This script has too many saved values');
        values[key] = JSON.parse(encoded);
        invoke(s.id, 'setValue', [key, JSON.parse(encoded)]).catch((err) => {
          if (had) values[key] = before; else delete values[key];
          console.error('[Userscripts] ' + s.name + ': a value was not saved:', err && err.message);
        });
        return undefined;
      },
      deleteValue(key) {
        const had = Object.prototype.hasOwnProperty.call(values, key);
        const before = values[key];
        delete values[key];
        invoke(s.id, 'deleteValue', [String(key)]).catch((err) => {
          if (had) values[key] = before;
          console.error('[Userscripts] ' + s.name + ': a value was not deleted:', err && err.message);
        });
        return undefined;
      },
      listValues() { return Object.keys(values); },
      addStyle(text) {
        const css1 = String(text == null ? '' : text);
        if (css1.length > 1024 * 1024) throw new Error('That stylesheet is too large');
        const handle = ++cssSeq;
        css.set(handle, webFrame.insertCSS(css1));
        return handle;
      },
      removeStyle(handle) {
        const key = css.get(handle);
        if (key !== undefined) { css.delete(handle); webFrame.removeInsertedCSS(key); }
      },
      nextId() { return ++reqSeq; },
      xhr(reqId, details) { return invoke(s.id, 'xhr', [reqId, details]); },
      abortXhr(reqId) { invoke(s.id, 'xhr-abort', [reqId]).catch((err) => console.error('[Userscripts] abort failed:', err && err.message)); },
      clipboard(text) {
        if (!activeNow()) return Promise.reject(new Error('GM_setClipboard only works right after a click or key press on the page'));
        return invoke(s.id, 'clipboard', [String(text == null ? '' : text)]);
      },
      notification(opts) { return invoke(s.id, 'notification', [opts]); },
      openTab(url) {
        if (!activeNow()) return Promise.reject(new Error('GM_openInTab only works right after a click or key press on the page'));
        return invoke(s.id, 'openTab', [String(url)]);
      },
      info() { return JSON.parse(JSON.stringify(s.info || {})); },
    };
    return bridge;
  }

  // The functions a granted script sees, written once as source for its world.
  const PRELUDE = '(function(){var B=window.__vexGM;try{delete window.__vexGM;}catch(e){}'
    + 'var noop=function(){};var G={};'
    + 'var has=function(n){return GRANTS.indexOf(n)>=0;};'
    + 'var GM_info=B.info();'
    + 'var unsafeWindow=window;'
    + 'var GM_log=function(){console.log.apply(console,["[userscript]"].concat([].slice.call(arguments)));};'
    + 'var GM_getValue=function(k,d){return B.getValue(String(k),d);};'
    + 'var GM_setValue=function(k,v){B.setValue(String(k),v);};'
    + 'var GM_deleteValue=function(k){B.deleteValue(String(k));};'
    + 'var GM_listValues=function(){return B.listValues();};'
    + 'var GM_addStyle=function(c){var h=B.addStyle(c);return {remove:function(){B.removeStyle(h);}};};'
    + 'var GM_setClipboard=function(t){B.clipboard(t).catch(function(e){console.error("[userscript] GM_setClipboard:",e&&e.message);});};'
    + 'var GM_notification=function(a,b,c,d){var o=(a&&typeof a==="object")?a:{text:a,title:b,image:c,onclick:d};'
    + 'B.notification({title:o.title==null?"":String(o.title),text:o.text==null?"":String(o.text)}).catch(function(e){console.error("[userscript] GM_notification:",e&&e.message);});};'
    + 'var GM_openInTab=function(u){B.openTab(u).catch(function(e){console.error("[userscript] GM_openInTab:",e&&e.message);});return {close:noop,closed:false};};'
    + 'var GM_xmlhttpRequest=function(d){d=d||{};var id=B.nextId();var dead=false;'
    + 'var data=d.data;if(data!=null&&typeof data!=="string"){if(data instanceof ArrayBuffer){data=new Uint8Array(data);}else if(ArrayBuffer.isView(data)){data=new Uint8Array(data.buffer,data.byteOffset,data.byteLength);}else{data=String(data);}}'
    + 'var rt=d.responseType||"text";'
    + 'var plain={url:String(d.url),method:d.method?String(d.method):"GET",headers:d.headers&&typeof d.headers==="object"?JSON.parse(JSON.stringify(d.headers)):{},data:data==null?null:data,timeout:d.timeout|0,responseType:rt};'
    + 'B.xhr(id,plain).then(function(r){if(dead)return;'
    + 'if(!r||!r.ok){var k=r&&r.kind;var ev={error:(r&&r.message)||"request failed",status:0,readyState:4,finalUrl:plain.url};'
    + 'if(k==="timeout"&&d.ontimeout)d.ontimeout(ev);else if(k==="aborted"&&d.onabort)d.onabort(ev);else if(d.onerror)d.onerror(ev);'
    + 'if(d.onloadend)d.onloadend(ev);return;}'
    + 'var o=r.result;var res={status:o.status,statusText:o.statusText,finalUrl:o.finalUrl,readyState:4,responseHeaders:o.responseHeaders,responseXML:null};'
    + 'if(o.responseText!==undefined){res.responseText=o.responseText;res.response=o.responseText;if(rt==="json"){try{res.response=JSON.parse(o.responseText);}catch(e){res.response=null;}}}'
    + 'else{res.response=o.response&&o.response.buffer?o.response.buffer:o.response;res.responseText="";}'
    + 'if(d.onload)d.onload(res);if(d.onloadend)d.onloadend(res);'
    + '},function(e){if(dead)return;var ev={error:e&&e.message,status:0,readyState:4};if(d.onerror)d.onerror(ev);if(d.onloadend)d.onloadend(ev);});'
    + 'return {abort:function(){if(dead)return;dead=true;B.abortXhr(id);if(d.onabort)d.onabort({});}};};'
    + 'var GM={info:GM_info,log:GM_log,'
    + 'getValue:function(k,d){return Promise.resolve(GM_getValue(k,d));},'
    + 'setValue:function(k,v){return Promise.resolve(GM_setValue(k,v));},'
    + 'deleteValue:function(k){return Promise.resolve(GM_deleteValue(k));},'
    + 'listValues:function(){return Promise.resolve(GM_listValues());},'
    + 'addStyle:function(c){return Promise.resolve(GM_addStyle(c));},'
    + 'setClipboard:function(t){return Promise.resolve(GM_setClipboard(t));},'
    + 'notification:function(){return Promise.resolve(GM_notification.apply(null,arguments));},'
    + 'openInTab:function(u){return Promise.resolve(GM_openInTab(u));},'
    + 'xmlHttpRequest:GM_xmlhttpRequest};'
    + 'var GM_xmlHttpRequest=GM_xmlhttpRequest;';

  function wrapGranted(s) {
    const granted = s.grants || [];
    const off = ['GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_listValues', 'GM_addStyle', 'GM_setClipboard', 'GM_notification', 'GM_openInTab', 'GM_xmlhttpRequest', 'GM_xmlHttpRequest']
      .filter(n => !granted.includes(n === 'GM_xmlHttpRequest' ? 'GM_xmlhttpRequest' : n)).map(n => n + '=undefined;').join('');
    return PRELUDE.replace('GRANTS', () => JSON.stringify(granted)) + off
      + '\ntry{(function(){\n' + s.source + '\n}).call(window);}catch(e){console.error("[Vex userscript] ' + JSON.stringify(s.name).slice(1, -1) + ':",e);}'
      + '\n})();\n//# sourceURL=vex-userscript/' + encodeURIComponent(s.name) + '.user.js';
  }
  function wrapPage(s) {
    return '(function(){try{\n' + s.source + '\n}catch(e){console.error("[Vex userscript] ' + JSON.stringify(s.name).slice(1, -1) + ':",e);}})();\n//# sourceURL=vex-userscript/' + encodeURIComponent(s.name) + '.user.js';
  }

  function run(s) {
    try {
      if (s.mode === 'gm') {
        if (!contextBridge || typeof contextBridge.exposeInIsolatedWorld !== 'function') throw new Error('this build of Vex cannot give a script its own world');
        const world = WORLD_BASE + (Number(s.slot) || 0);
        contextBridge.exposeInIsolatedWorld(world, '__vexGM', makeBridge(s));
        webFrame.executeJavaScriptInIsolatedWorld(world, [{ code: wrapGranted(s) }])
          .catch((err) => console.error('[Userscripts] ' + s.name + ' failed:', err && err.message));
      } else {
        webFrame.executeJavaScript(wrapPage(s))
          .catch((err) => console.error('[Userscripts] ' + s.name + ' failed:', err && err.message));
      }
      ran.push(s.name);
      report();
    } catch (err) {
      console.error('[Userscripts] ' + s.name + ' could not start:', err && err.message);
    }
  }

  function later(runAt, fn) {
    if (runAt === 'start') {
      // The preload runs before the parser has made <html>; a script that
      // touches document.documentElement must find it, so wait for it (a
      // mutation observer fires before the page's first script runs).
      if (document.documentElement) { fn(); return; }
      const obs = new MutationObserver(() => {
        if (!document.documentElement) return;
        obs.disconnect();
        fn();
      });
      obs.observe(document, { childList: true });
      return;
    }
    const ready = () => { if (runAt === 'idle') setTimeout(fn, 0); else fn(); };
    if (document.readyState !== 'loading') ready();
    else document.addEventListener('DOMContentLoaded', ready, { once: true });
  }

  for (const s of reply.scripts) later(s.runAt, () => run(s));
})();
