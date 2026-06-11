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
      this.renderMessage(list,
        'Queue not configured. Add <code>queueUrl</code> and <code>queueSecret</code> ' +
        'to your local <code>sidebar-config.json</code> — see queue-bot/SETUP.md.');
      return;
    }

    try {
      const res = await fetch(
        buildQueueUrl(this.config.queueUrl, '/queue', this.config.queueSecret));
      if (res.status === 403) {
        this.renderMessage(list, 'Access denied (403) — check <code>queueSecret</code>.');
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
      const res = await fetch(
        buildQueueUrl(this.config.queueUrl, `/queue/${encodeURIComponent(id)}/done`,
          this.config.queueSecret),
        { method: 'POST' });
      if (res.ok) await this.refresh();
    } catch (err) {
      console.warn('[queue] markDone failed:', err && err.message);
    }
  },

  async deleteItem(id) {
    if (!this.isConfigured()) return;
    try {
      const res = await fetch(
        buildQueueUrl(this.config.queueUrl, `/queue/${encodeURIComponent(id)}`,
          this.config.queueSecret),
        { method: 'DELETE' });
      if (res.ok) await this.refresh();
    } catch (err) {
      console.warn('[queue] deleteItem failed:', err && err.message);
    }
  },

  startAutoRefresh() {
    if (this.refreshTimer) return;
    this.refreshTimer = setInterval(() => {
      // Only poll while the Queue panel is the one on screen.
      if (typeof SidebarManager !== 'undefined' && SidebarManager.activePanel === 'queue') {
        this.refresh();
      }
    }, this.REFRESH_MS);
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
