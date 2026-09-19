// A feature that reads another module behind a guard —
//   if (typeof WebMonitor !== 'undefined') { ... }
// — does nothing, silently, when that module does not exist. The Today card
// and the weekly review both read "watched pages that changed" from a
// WebMonitor that was never written (the real one is PageWatch), so that part
// of both was always empty, and their tests mocked the phantom and passed.
//
// This fails when a guard names a module that nothing declares.

import { describe, expect, it } from 'vitest';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..', 'src');
const dir = path.join(root, 'renderer', 'js');

// Real browser globals that are feature-tested the same way.
const BROWSER = new Set(['CSS', 'MediaRecorder', 'ResizeObserver', 'Storage', 'IntersectionObserver', 'EyeDropper', 'ClipboardItem', 'Notification', 'BroadcastChannel', 'OffscreenCanvas', 'Intl', 'WebSocket', 'Worker']);

describe('guarded reads of other modules', () => {
  it('only name modules that exist', () => {
    const sources = fs.readdirSync(dir).filter(f => f.endsWith('.js')).map(f => [f, fs.readFileSync(path.join(dir, f), 'utf8')]);
    for (const f of ['preload.js', 'renderer/index.html', 'renderer/start.html']) {
      const p = path.join(root, f);
      if (fs.existsSync(p)) sources.push([f, fs.readFileSync(p, 'utf8')]);
    }
    const declared = new Set();
    for (const [, s] of sources) {
      for (const m of s.matchAll(/^(?:const|let|var|class|function)\s+([A-Z]\w*)/gm)) declared.add(m[1]);
      for (const m of s.matchAll(/(?:window|globalThis)\.([A-Z]\w*)\s*=/g)) declared.add(m[1]);
    }
    const phantoms = [];
    for (const [f, s] of sources) {
      const names = [
        ...[...s.matchAll(/typeof\s+(?:window\.)?([A-Z]\w*)\s*[!=]==?\s*'undefined'/g)].map(m => m[1]),
        ...[...s.matchAll(/window\.([A-Z]\w*)\s*(?:&&|\?\.)/g)].map(m => m[1]),
      ];
      for (const n of names) if (!declared.has(n) && !BROWSER.has(n)) phantoms.push(`${f}: ${n} — nothing declares it, so the code behind this guard never runs`);
    }
    expect([...new Set(phantoms)], [...new Set(phantoms)].join('\n')).toEqual([]);
  });
});
