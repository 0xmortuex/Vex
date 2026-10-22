// === Vex Queue Panel ===
//
// Sidebar panel for the personal Telegram queue (see the queue-bot Worker:
// github.com/0xmortuex/queue-bot). Reads queueUrl + queueSecret from the
// LOCAL, gitignored sidebar-config.json over IPC — the secret never enters
// this public repo. Shows queued items with Done / Delete actions and
// auto-refreshes every 60s (and on every panel open).

// --- pure helpers (also exported for tests) --------------------------------

// Sort: pending before done; newest (latest timestamp) first within a group.
// The Worker already sorts, but the panel re-sorts defensively.
function sortQueueItems(items) {
  const rank = (s) => (s === 'pending' ? 0 : 1);
  return [...items].sort((a, b) => {
    const r = rank(a.status) - rank(b.status);
    if (r !== 0) return r;
    return String(b.timestamp || '').localeCompare(String(a.timestamp || ''));
  });
}

// Build a queue endpoint URL: trims a trailing slash off the base, appends the
// path, and adds the secret as a query param.
function buildQueueUrl(base, path, secret) {
  const b = String(base || '').replace(/\/+$/, '');
  return `${b}${path}?secret=${encodeURIComponent(secret || '')}`;
}

// Compact relative time: "just now", "5m ago", "2h ago", "3d ago".
function formatTimestamp(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

// --- panel -----------------------------------------------------------------

const QueuePanel = {
  REFRESH_MS: 60_000,
  config: { queueUrl: '', queueSecret: '' },
  refreshTimer: null,

  async init() {
    this.render();
    await this.loadConfig();
    await this.refresh();
    this.startAutoRefresh();
  },

  render() {
    const panel = document.getElementById('panel-queue');
    if (!panel || panel.dataset.rendered) return;
    panel.dataset.rendered = 'true';

    panel.innerHTML = `
      <style>
        #panel-queue .queue-item {
          display: flex; flex-direction: column; gap: 8px;
          padding: 12px; margin-bottom: 8px;
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 10px;
        }
        #panel-queue .queue-item.is-done { opacity: 0.55; }
        #panel-queue .queue-item-text {
          color: var(--text); font-size: 14px; line-height: 1.4;
          white-space: pre-wrap; word-break: break-word;
        }
        #panel-queue .queue-item.is-done .queue-item-text { text-decoration: line-through; }
        #panel-queue .queue-item-meta {
          display: flex; gap: 8px; align-items: center;
          font-size: 11px; color: var(--text-muted);
        }
        #panel-queue .queue-item-actions { display: flex; gap: 8px; }
        #panel-queue .queue-act-btn {
          flex: 1; padding: 6px 10px; font-size: 12px;
          border-radius: 7px; cursor: pointer;
          font-family: 'Outfit', sans-serif;
          background: var(--bg); color: var(--text);
          border: 1px solid var(--border);
        }
        #panel-queue .queue-act-btn.danger { color: #e5484d; }
        #panel-queue .queue-act-btn:disabled { opacity: 0.5; cursor: default; }
      </style>
      <div class="panel-content">
        <div class="panel-section">
          <div class="panel-section-title">
            Queue
            <button class="panel-btn" id="queue-refresh-btn"
                    style="float:right;padding:2px 10px;font-size:11px">Refresh</button>
          </div>
          <div class="panel-list" id="queue-panel-list">
            <div class="panel-placeholder"><p>Loading queue…</p></div>
          </div>
        </div>
      </div>
    `;

    panel.querySelector('#queue-refresh-btn')
      .addEventListener('click', () => this.refresh());
  },

  async loadConfig() {
    try {
      if (typeof window !== 'undefined' && window.vex &&
          typeof window.vex.getSidebarConfig === 'function') {
        const cfg = await window.vex.getSidebarConfig();
        if (cfg && typeof cfg === 'object') {
          this.config = {
            queueUrl: typeof cfg.queueUrl === 'string' ? cfg.queueUrl.trim() : '',
            queueSecret: typeof cfg.queueSecret === 'string' ? cfg.queueSecret.trim() : '',
          };
        }
      }
    } catch (err) {
      console.warn('[queue] sidebar-config fetch failed:', err && err.message);
    }
  },

  isConfigured() {
    return !!(this.config.queueUrl && this.config.queueSecret);
  },

  async refresh() {
    const list = document.getElementById('queue-panel-list');
    if (!list) return;

    if (!this.isConfigured()) {
      // Plain words: this read "Add queueUrl and queueSecret to your local
      // sidebar-config.json — see queue-bot/SETUP.md" (walkthrough M5,
      // 2026-10-07). It is hidden from the rail by default anyway.
      this.renderSetup(list);
      return;
    }

    try {
      const res = await (window.VexNet?.fetch || fetch)(
        buildQueueUrl(this.config.queueUrl, '/queue', this.config.queueSecret));
      if (res.status === 403) {
        this.renderSetup(list, 'The bot refused the read secret (403). Paste the secret again below.');
        return;
      }
      if (res.status === 429) {
        this.renderMessage(list, 'Rate limited (429) — too many reads this hour. Try later.');
        return;
      }
      if (!res.ok) {
        this.renderMessage(list, `Queue request failed (${res.status}).`);
        return;
      }
      const items = await res.json();
      this.renderItems(list, Array.isArray(items) ? items : []);
    } catch (err) {
      this.renderMessage(list,
        `Could not reach the queue. ${this.escape(err && err.message || 'Network error')}`);
    }
  },

  renderMessage(list, html) {
    list.innerHTML = `<div class="panel-placeholder"><p>${html}</p></div>`;
  },

  GUIDE_URL: 'https://github.com/0xmortuex/queue-bot/blob/main/SETUP.md',
  // The steps, in plain words. The deploying itself is one page of copy-and-paste in the queue-bot guide; this panel takes the last step.
  SETUP_STEPS: [
    'On your phone, open Telegram, message @BotFather, send /newbot and follow it. Keep the token it gives you.',
    'Message @userinfobot to get your own Telegram number. The bot only listens to you.',
    'Put the free queue-bot Worker on your Cloudflare account. The guide below has every command to copy; it takes about ten minutes, once.',
    'Message your bot anything, such as “buy milk”. It answers that it queued it.',
    'Paste your Worker’s address and its read secret below, and press Connect.',
  ],

  // The first-time guide, and the form that finishes it. `note` is shown first when the panel is here for a reason (a refused secret).
  renderSetup(list, note) {
    list.textContent = '';
    const wrap = document.createElement('div');
    wrap.className = 'queue-setup';
    const add = (tag, text, css) => { const el = document.createElement(tag); el.textContent = text; if (css) el.style.cssText = css; wrap.appendChild(el); return el; };
    if (note) add('p', note, 'color:#e5484d;font-size:12.5px;margin:0 0 10px');
    add('p', 'Your own Queue', 'font-weight:650;font-size:14px;margin:0 0 4px;color:var(--text)');
    add('p', 'The Queue is not set up on this computer yet. Send yourself links and notes from your phone through Telegram, and they wait here with Done and Delete buttons. It is free, private to you, and only needs setting up once.', 'font-size:12.5px;line-height:1.5;margin:0 0 10px;color:var(--text-muted)');
    const ol = document.createElement('ol');
    ol.style.cssText = 'margin:0 0 10px;padding-left:20px;font-size:12.5px;line-height:1.55;color:var(--text)';
    for (const step of this.SETUP_STEPS) { const li = document.createElement('li'); li.textContent = step; li.style.marginBottom = '4px'; ol.appendChild(li); }
    wrap.appendChild(ol);
    const guide = document.createElement('button');
    guide.className = 'queue-act-btn';
    guide.textContent = 'Open the step-by-step guide';
    guide.addEventListener('click', () => {
      if (typeof TabManager === 'undefined') { window.showToast?.('Could not open the guide: ' + this.GUIDE_URL, 'error'); return; }
      TabManager.createTab(this.GUIDE_URL, true);
    });
    wrap.appendChild(guide);
    const form = document.createElement('form');
    form.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:12px';
    const field = (label, type, placeholder) => {
      const l = document.createElement('label');
      l.style.cssText = 'display:flex;flex-direction:column;gap:3px;font-size:11.5px;color:var(--text-muted)';
      l.append(label);
      const i = document.createElement('input');
      i.type = type; i.placeholder = placeholder; i.spellcheck = false; i.autocomplete = 'off';
      i.style.cssText = 'padding:7px 9px;border:1px solid var(--border);border-radius:7px;background:var(--bg);color:var(--text);font:inherit;font-size:12.5px';
      l.appendChild(i); form.appendChild(l); return i;
    };
    const url = field('Your Worker’s address', 'url', 'https://queue-bot.your-name.workers.dev');
    const secret = field('Read secret', 'password', 'The QUEUE_READ_SECRET you set');
    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    status.style.cssText = 'font-size:12px;min-height:16px;color:#e5484d';
    const go = document.createElement('button');
    go.type = 'submit'; go.className = 'queue-act-btn'; go.textContent = 'Connect';
    form.append(go, status);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      status.textContent = '';
      go.disabled = true;
      try {
        if (!window.vex || typeof window.vex.saveQueueConfig !== 'function') throw new Error('Saving is not available in this build');
        const saved = await window.vex.saveQueueConfig({ queueUrl: url.value, queueSecret: secret.value });
        this.config = { queueUrl: saved.queueUrl || '', queueSecret: saved.queueSecret || '' };
        await this.refresh();
      } catch (err) {
        status.textContent = String((err && err.message) || err).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
        go.disabled = false;
      }
    });
    wrap.appendChild(form);
    add('p', 'Not for you? Right-click the Queue button and choose Hide button.', 'font-size:11.5px;color:var(--text-muted);margin:12px 0 0');
    list.appendChild(wrap);
  },

  renderItems(list, items) {
    if (!items.length) {
      this.renderMessage(list, 'No queued items — text @yourbot_username to add');
      return;
    }
    const sorted = sortQueueItems(items);
    list.innerHTML = '';
    for (const item of sorted) {
      const done = item.status === 'done';
      const row = document.createElement('div');
      row.className = 'queue-item' + (done ? ' is-done' : '');
      row.dataset.id = item.id;
      row.innerHTML = `
        <div class="queue-item-text">${this.escape(item.text)}</div>
        <div class="queue-item-meta">
          <span>${this.escape(formatTimestamp(item.timestamp))}</span>
          <span>·</span>
          <span>${done ? 'done' : 'pending'}</span>
        </div>
        <div class="queue-item-actions">
          <button class="queue-act-btn queue-done-act" ${done ? 'disabled' : ''}>Done</button>
          <button class="queue-act-btn danger queue-del-act">Delete</button>
        </div>
      `;
      const doneBtn = row.querySelector('.queue-done-act');
      const delBtn = row.querySelector('.queue-del-act');
      if (!done) doneBtn.addEventListener('click', () => this.markDone(item.id));
      delBtn.addEventListener('click', () => this.deleteItem(item.id));
      list.appendChild(row);
    }
  },

  async markDone(id) {
    if (!this.isConfigured()) return;
    try {
      const res = await (window.VexNet?.fetch || fetch)(
        buildQueueUrl(this.config.queueUrl, `/queue/${encodeURIComponent(id)}/done`,
          this.config.queueSecret),
        { method: 'POST' });
      // A refused or failed request used to vanish into console.warn, so the
      // button just did nothing (found 2026-09-29).
      if (!res.ok) throw new Error('the queue server answered ' + res.status);
      await this.refresh();
    } catch (err) {
      console.error('[queue] markDone failed:', err);
      window.showToast?.('Could not mark it done: ' + ((err && err.message) || err), 'error');
    }
  },

  async deleteItem(id) {
    if (!this.isConfigured()) return;
    try {
      const res = await (window.VexNet?.fetch || fetch)(
        buildQueueUrl(this.config.queueUrl, `/queue/${encodeURIComponent(id)}`,
          this.config.queueSecret),
        { method: 'DELETE' });
      if (!res.ok) throw new Error('the queue server answered ' + res.status);
      await this.refresh();
    } catch (err) {
      console.error('[queue] deleteItem failed:', err);
      window.showToast?.('Could not delete it: ' + ((err && err.message) || err), 'error');
    }
  },

  startAutoRefresh() {
    if (this.refreshTimer) return;
    this.refreshTimer = VexJobs.every('Queue panel refresh', this.REFRESH_MS, () => {
      // Only poll while the Queue panel is the one on screen.
      if (typeof SidebarManager !== 'undefined' && SidebarManager.activePanel === 'queue') {
        this.refresh();
      }
    });
  },

  escape(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  },
};

if (typeof window !== 'undefined') window.QueuePanel = QueuePanel;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { QueuePanel, sortQueueItems, buildQueueUrl, formatTimestamp };
}
