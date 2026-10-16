// === Vex: Site permission prompts ===
// Listens for 'permission:request' from main and pops a banner asking the user
// to allow/deny, with an optional Remember checkbox.

const PermissionPrompts = (() => {
  // Inline SVG icons matching the top-bar chrome style: 24-viewbox,
  // stroke=currentColor (picks up --vex-accent from .perm-icon), round caps.
  function _svg(paths) {
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block">${paths}</svg>`;
  }
  const ICONS = {
    pin:     _svg('<path d="M12 21s-7-5.4-7-11a7 7 0 0 1 14 0c0 5.6-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
    video:   _svg('<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>'),
    camera:  _svg('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
    mic:     _svg('<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'),
    bell:    _svg('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'),
    music:   _svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
    film:    _svg('<rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>'),
    screen:  _svg('<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>'),
    clipboard: _svg('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>'),
    shield:  _svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
    external: _svg('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>'),
    download: _svg('<path d="M12 4v11"/><polyline points="7 10 12 15 17 10"/><line x1="5" y1="20" x2="19" y2="20"/>')
  };
  // `ask` finishes the sentence "<site> wants to …"; `label` names the thing
  // in the "Allowed: site → …" toast. One phrase used to do both jobs, which
  // read "wants to access send notifications" and "wants to access capture
  // your screen".
  const LABELS = {
    'geolocation':    { icon: ICONS.pin,    ask: 'know your location', label: 'location' },
    'media':          { icon: ICONS.video,  ask: 'use your camera and microphone', label: 'camera and microphone' },
    'camera':         { icon: ICONS.camera, ask: 'use your camera', label: 'camera' },
    'microphone':     { icon: ICONS.mic,    ask: 'use your microphone', label: 'microphone' },
    'notifications':  { icon: ICONS.bell,   ask: 'send you notifications', label: 'notifications' },
    'midi':           { icon: ICONS.music,  ask: 'use your MIDI devices', label: 'MIDI devices' },
    'midiSysex':      { icon: ICONS.music,  ask: 'use your MIDI devices (SysEx)', label: 'MIDI devices (SysEx)' },
    'mediaKeySystem': { icon: ICONS.film,   ask: 'play protected content (DRM)', label: 'protected content' },
    'display-capture':{ icon: ICONS.screen, ask: 'share your screen', label: 'screen sharing', note: 'You choose which screen or window next.' },
    'clipboard-read': { icon: ICONS.clipboard, ask: 'read what you last copied', label: 'clipboard' },
    // A page's second download with no click (src/main/downloads.js).
    'automatic-downloads': { icon: ICONS.download, ask: 'download several files', label: 'automatic downloads', note: 'It started another download by itself. A file you click always downloads.' },
    // A program or script from a site with no standing (src/main/web-safety.js).
    'risky-download': { icon: ICONS.shield, ask: 'send you a file that can run code', label: 'a risky download', note: 'The file waits unopened until you decide.' }
  };

  function _esc(s) { return window.escapeHtml(s); }

  // One prompt on screen at a time; the rest wait their turn. A second request
  // used to remove the first without answering it, and main then denied that
  // one on its two-minute timeout: the site was refused and nobody had been
  // asked (found 2026-09-29). A request for the same site and permission as
  // one already open or waiting joins it, and one answer settles both.
  const _queue = [];   // [{ data, ids: [id, ...] }]; _queue[0] is the one on screen
  const _key = (d) => (d.origin || '') + '::' + (d.permission || '');

  function showPrompt(data) {
    const d = data || {};
    const same = _queue.find(q => _key(q.data) === _key(d));
    if (same) { same.ids.push(d.id); return; }
    _queue.push({ data: d, ids: [d.id] });
    if (_queue.length === 1) _show(_queue[0]);
  }

  function _next() {
    _queue.shift();
    if (_queue.length) _show(_queue[0]);
  }

  // A link that opens another program (main.js, handleExternalProtocol):
  // "external:<scheme>", with the program's name and a line about it from main.
  function _external(data) {
    const app = data.app || String(data.permission || '').slice('external:'.length);
    return { icon: ICONS.external, ask: 'open ' + app, label: 'opening ' + app, note: data.detail || '' };
  }

  function _show(entry) {
    const { origin, permission } = entry.data;
    const info = LABELS[permission]
      || (/^external:/.test(permission || '') ? _external(entry.data) : null)
      || { icon: ICONS.shield, ask: 'use: ' + (permission || 'unknown'), label: permission || 'unknown' };
    // once: main keeps no "allow" for this one (an Office link that fetches a
    // file from the internet), so the only choices are this time or Block.
    // choice 'allow-block': just the two, kept for the site — or, remember
    // false (a private window, a Tor tab), kept by nothing but the tab.
    const riskyFile = entry.data.choice === 'risky';
    const keep = entry.data.remember === false ? 'false' : 'true';
    // choice 'risky': a file waiting in the holding folder. Nothing is kept
    // unless "Always allow" is pressed, and that is only offered where the
    // answer can be kept (not a private window or a Tor tab).
    const actions = riskyFile
      ? `<button class="btn-danger-sm" data-decision="deny" data-remember="false">Don't download</button>
        <button class="btn-secondary-sm" data-decision="allow" data-remember="false">Download anyway</button>
        ${entry.data.remember === false ? '' : '<button class="btn-primary-sm" data-decision="allow" data-remember="true">Always allow from this site</button>'}`
      : entry.data.choice === 'allow-block'
      ? `<button class="btn-danger-sm" data-decision="deny" data-remember="${keep}">Block</button>
        <button class="btn-primary-sm" data-decision="allow" data-remember="${keep}">Allow</button>`
      : entry.data.once
      ? `<button class="btn-danger-sm" data-decision="deny" data-remember="true">Block</button>
        <button class="btn-primary-sm" data-decision="allow" data-remember="false">Open this once</button>`
      : `<button class="btn-danger-sm" data-decision="deny" data-remember="true">Block</button>
        <button class="btn-secondary-sm" data-decision="allow" data-remember="session">Allow this visit</button>
        <button class="btn-secondary-sm" data-decision="allow" data-remember="day">Allow for a day</button>
        <button class="btn-primary-sm" data-decision="allow" data-remember="true">Always allow</button>`;

    // What the site is asking for in plain words, and whether it asks for more
    // than it should (main: src/main/web-safety.js). Nothing is drawn when main
    // sent none, which is what the "off" setting does.
    const risk = entry.data.risk || null;
    const riskHtml = !risk ? '' : (() => {
      const level = risk.level || 'normal';
      const line = riskyFile ? (risk.line || '') : (risk.riskLine || '');
      const why = Array.isArray(risk.reasons) ? risk.reasons : (Array.isArray(risk.why) ? risk.why : []);
      const head = !riskyFile && risk.summary ? `<div class="perm-risk-head">${_esc(risk.summary)}</div>` : '';
      const reasons = why.length
        ? `<details class="perm-risk-why"><summary>Why was this flagged?</summary><ul>${why.map(w => `<li>${_esc(w)}</li>`).join('')}</ul></details>` : '';
      const quiet = (why.length || riskyFile) && !riskyFile ? `<button type="button" class="perm-risk-quiet" data-quiet>Don't warn me about this site</button>` : '';
      // Why a site would ask at all, in plain words (web-safety.js reasonFor).
      const reason = !riskyFile && risk.reason ? `<div class="perm-risk-reason">${_esc(risk.reason)}</div>` : '';
      return `<div class="perm-risk perm-risk-${_esc(level)}">${head}${line ? `<div class="perm-risk-line">${_esc(line)}</div>` : ''}${reason}${reasons}${quiet}</div>`;
    })();
    const messageHtml = riskyFile
      ? `is sending <strong>${_esc(entry.data.fileName || 'a file')}</strong>${info.note ? ` <span class="perm-note">${_esc(info.note)}</span>` : ''}`
      : `wants to <strong>${_esc(info.ask)}</strong>${info.note ? ` <span class="perm-note">${_esc(info.note)}</span>` : ''}`;

    const prompt = document.createElement('div');
    prompt.className = 'permission-prompt';
    prompt.innerHTML = `
      <div class="perm-icon">${info.icon}</div>
      <div class="perm-content">
        <div class="perm-origin">${_esc(origin)}</div>
        <div class="perm-message">${messageHtml}</div>
        ${riskHtml}
      </div>
      <div class="perm-actions">
        ${actions}
      </div>
    `;
    // The Downloads drop opens by itself with a page's first download and
    // sits over the top right, where this question's Allow is — with its
    // click-catching layer over the rest. The question needs an answer.
    if (window.DownloadsButton && window.DownloadsButton._open) window.DownloadsButton.close();
    document.body.appendChild(prompt);
    requestAnimationFrame(() => prompt.classList.add('show'));

    let answered = false;
    // Main blocked it after two minutes without an answer: take it away, say
    // so, and bring up the next.
    entry._expire = () => {
      if (answered) return;
      answered = true;
      document.removeEventListener('keydown', onKey, true);
      prompt.classList.remove('show');
      setTimeout(() => prompt.remove(), 250);
      _next();
      window.showToast?.(`${origin} → ${info.label}: blocked after two minutes without an answer — the site can ask again`, 'info', 4000);
    };
    const respond = async (decision, remember) => {
      if (answered) return;
      answered = true;
      document.removeEventListener('keydown', onKey, true);
      prompt.classList.remove('show');
      setTimeout(() => prompt.remove(), 250);
      // The next one waiting comes up now, not after main has replied.
      _next();
      let failed = null;
      for (const id of entry.ids) {
        try {
          const res = await window.vex.permissionRespond({ id, decision, remember, origin, permission });
          if (res && res.ok === false) failed = res.error || 'Vex did not take the answer';
        } catch (err) { console.error('[Permissions] respond failed:', err); failed = err.message; }
      }
      if (typeof window.showToast === 'function') {
        // One that waited past main's two-minute limit was already refused
        // there, so "Allowed" would be untrue.
        if (failed) { window.showToast(`Could not answer ${origin} → ${info.label}: ${failed}`, 'error', 4000); return; }
        const how = remember === 'session' ? ' for this visit' : remember === 'day' ? ' for a day' : remember === false ? (entry.data.choice === 'allow-block' ? ' for this tab' : ' this time') : '';
        window.showToast(`${decision === 'allow' ? 'Allowed' : 'Blocked'}${how}: ${origin} \u2192 ${info.label}`, 'info', 3000);
      }
    };
    // "Don't warn me about this site": the site goes on the allow list; this
    // question is still the person's to answer.
    const quiet = prompt.querySelector('[data-quiet]');
    if (quiet) {
      quiet.addEventListener('click', async () => {
        try {
          if (!window.vex || !window.vex.webSafety) throw new Error('Web safety is not available here');
          await window.vex.webSafety.allowHost(origin);
          quiet.textContent = 'Vex will not flag this site again';
          quiet.disabled = true;
        } catch (err) { window.showToast?.(err.message || 'Could not save that', 'error'); }
      });
    }
    prompt.querySelectorAll('[data-decision]').forEach(btn => {
      btn.addEventListener('click', () => {
        // 'session' lasts until Vex closes and is never written down.
        const r = btn.dataset.remember;
        const remember = r === 'session' ? 'session' : r === 'day' ? 'day' : r === 'false' ? false : true;
        respond(btn.dataset.decision, remember);
      });
    });
    // Escape answers "not now": blocked this once, nothing remembered (main's
    // remember:false), so the site may ask again. Every button either allows
    // or blocks for good, and Escape did nothing (found 2026-09-29). This is a
    // banner, not a modal, so only an Escape with nothing else focused (or
    // focus in the prompt) is taken: one typed in the command bar or a form is
    // left to it, as is one meant for a Vex dialog.
    const onKey = (e) => {
      if (!prompt.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
      if (e.key !== 'Escape' || document.querySelector('.vex-dialog-overlay')) return;
      const a = document.activeElement;
      if (a && a !== document.body && !prompt.contains(a)) return;
      e.preventDefault(); e.stopPropagation();
      respond('deny', false);
    };
    document.addEventListener('keydown', onKey, true);
  }

  // A request main gave up on. The prompt goes once none of its requests is
  // still waiting.
  function expired(data) {
    const id = data && data.id;
    const at = _queue.findIndex(q => q.ids.includes(id));
    if (at < 0) return;
    const entry = _queue[at];
    entry.ids = entry.ids.filter(x => x !== id);
    if (entry.ids.length) return;
    if (at === 0 && typeof entry._expire === 'function') entry._expire();
    else _queue.splice(at, 1);
  }

  function init() {
    if (!window.vex?.onPermissionRequest) return;
    window.vex.onPermissionRequest(showPrompt);
    window.vex.onPermissionExpired?.(expired);
    // Signal main we're ready so any permission requests that fired during
    // cold-start (before this listener was attached) get flushed to us now.
    try { window.vex.permissionsRendererReady?.(); } catch {}
  }

  return { init, showPrompt, expired, _queue };
})();

window.PermissionPrompts = PermissionPrompts;
