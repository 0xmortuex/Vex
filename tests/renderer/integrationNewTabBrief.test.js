// @vitest-environment jsdom
//
// New Tab payload (js/vex-integration.js), the Brief adapters for the 2026-10
// modules (js/brief-integration.js) and the start page's consumer (start.html).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const JS = path.join(ROOT, 'src/renderer/js');
const fresh = (rel) => { const p = path.join(JS, rel); delete require.cache[require.resolve(p)]; return require(p); };

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  for (const k of ['VexProgress', 'VexPet', 'VexLiving', 'VexDelights', 'VexWidgets', 'VexTimeOfDay', 'VexBrief', 'VexTimeTravel',
    'VexTuning', 'RenewalRadar', 'MeetingCopilot', 'VexBriefFlashMind', 'VexWeeklyWorld', 'VexOfflinePages', 'VexYearInVex',
    'VexFortune', 'VexSpeedRun', 'VexAutopilot', 'BriefIntegration']) delete globalThis[k];
});

describe('the New Tab payload', () => {
  it('holds nothing but its version when no feature is on', () => {
    const { VexNewTab } = fresh('vex-integration.js');
    expect(VexNewTab.snapshot()).toEqual({ v: 1, quiet: false });
  });

  it('carries the pet only when it is on, and nothing living while quiet', () => {
    globalThis.VexProgress = fresh('fun/fun-core.js').VexProgress;
    globalThis.VexPet = fresh('fun/vex-pet.js').VexPet;
    const { VexNewTab } = fresh('vex-integration.js');
    expect(VexNewTab.snapshot().pet).toBeUndefined();
    globalThis.VexProgress.setEnabled('pet', true);
    const snap = VexNewTab.snapshot();
    expect(snap.pet.svg.startsWith('<svg')).toBe(true);
    expect(JSON.stringify(snap).length).toBeLessThanOrEqual(VexNewTab.MAX_JSON);
    localStorage.setItem('vex.fun.quiet', '1');
    const q = VexNewTab.snapshot();
    expect(q.quiet).toBe(true);
    expect(q.pet).toBeUndefined();
  });

  it('gives the time-of-day profile as an ordering hint only when that is switched on', () => {
    const { VexNewTab } = fresh('vex-integration.js');
    globalThis.VexTimeOfDay = { snapshot: () => ({ enabled: false, profile: 'brief', label: 'x' }) };
    expect(VexNewTab.snapshot().profile).toBeUndefined();
    globalThis.VexTimeOfDay = { snapshot: () => ({ enabled: true, profile: 'reading', label: 'Reading' }) };
    expect(VexNewTab.snapshot().profile).toEqual({ profile: 'reading', label: 'Reading' });
  });

  it('drops the heavy parts rather than exceed its bound', () => {
    const { VexNewTab } = fresh('vex-integration.js');
    globalThis.VexDelights = { isOn: () => true };
    globalThis.VexWidgets = {
      list: () => [{ id: 'a', type: 'quote', cfg: {} }],
      mount: (el) => { el.textContent = 'x'.repeat(5000); return { dispose() {} }; },
    };
    const snap = VexNewTab.snapshot();
    expect(JSON.stringify(snap).length).toBeLessThanOrEqual(VexNewTab.MAX_JSON);
    expect(snap.widgets[0].text.length).toBe(200);
  });

  it('time travel journals the brief through VexIntegration.briefLines', () => {
    globalThis.VexBrief = { _last: { sections: [{ title: 'Mail', items: [{ text: '3 unread' }] }, { title: 'Empty', items: [] }] } };
    const { VexIntegration } = fresh('vex-integration.js');
    expect(VexIntegration.briefLines()).toEqual(['Mail: 3 unread']);
    globalThis.VexTimeTravel = { briefProvider: null };
    VexIntegration._wired = false;
    VexIntegration.init();
    expect(globalThis.VexTimeTravel.briefProvider()).toEqual(['Mail: 3 unread']);
  });
});

describe('Morning Brief adapters', () => {
  it('registers the 2026-10 modules that are loaded, each as its own section', () => {
    const mod = (id) => ({ id, title: id, icon: 'sparkles', isEnabled: () => true, build: () => ({ lines: [{ text: id }] }) });
    globalThis.VexBriefFlashMind = mod('flashmind-due');
    globalThis.VexWeeklyWorld = mod('weekly-world');
    globalThis.VexOfflinePages = mod('offline-pages');
    globalThis.VexYearInVex = mod('year-in-vex');
    globalThis.VexFortune = { brief: mod('fortune') };
    globalThis.VexSpeedRun = { brief: mod('speed-run-best') };
    globalThis.VexTimeTravel = { briefSection: async () => ({ lines: ['3 tabs were open yesterday.'] }) };
    globalThis.VexTuning = { briefSection: async () => ({ lines: ['Slower today', 'Tab X: +80 MB'] }) };
    globalThis.RenewalRadar = { snapshot: () => ({ upcoming: [{ name: 'Mail', next: '2026-11-01', cost: 5, currency: 'USD' }], toConfirm: 2 }) };
    globalThis.MeetingCopilot = { snapshot: () => ({ title: 'Standup', ended: false, decisions: 1, actions: 2 }) };
    const regs = new Map();
    const brief = { register: (d) => regs.set(d.id, d), get: (id) => regs.get(id) };
    const { BriefIntegration } = fresh('brief-integration.js');
    globalThis.BriefIntegration = BriefIntegration;
    BriefIntegration.sync(brief);
    for (const id of ['flashmind-due', 'weekly-world', 'offline-pages', 'year-in-vex', 'fortune', 'speed-run-best',
      'time-travel', 'tuning', 'renewals', 'meeting-copilot']) {
      expect(regs.has(id), id).toBe(true);
    }
  });

  it('turns an adapter answer into display items', async () => {
    globalThis.VexTimeTravel = { briefSection: async () => ({ lines: ['3 tabs were open yesterday.'] }) };
    globalThis.RenewalRadar = { snapshot: () => ({ upcoming: [{ name: 'Mail', next: '2026-11-01', cost: 5, currency: 'USD' }], toConfirm: 0 }) };
    const regs = new Map();
    const { BriefIntegration } = fresh('brief-integration.js');
    BriefIntegration.sync({ register: (d) => regs.set(d.id, d), get: (id) => regs.get(id) });
    const tt = await regs.get('time-travel').build();
    expect(tt.items[0].text).toBe('3 tabs were open yesterday.');
    const rn = await regs.get('renewals').build();
    expect(rn.items[0].text).toBe('Mail renews 2026-11-01');
  });

  it('the Autopilot button only opens the panel when the last build offered it', async () => {
    const { VexBrief } = fresh('brief.js');
    globalThis.VexAutopilot = {};
    const opened = vi.fn();
    document.addEventListener('vex:autopilot-open', opened);
    window.showToast = vi.fn();
    await VexBrief.onStartCommand({ type: 'autopilot-open' });
    expect(opened).not.toHaveBeenCalled();
    VexBrief._last = { sections: [{ items: [], action: { label: 'Open Autopilot', cmd: { type: 'autopilot-open' } } }] };
    await VexBrief.onStartCommand({ type: 'autopilot-open' });
    expect(opened).toHaveBeenCalledTimes(1);
  });
});

describe('the start page consumer', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer/start.html'), 'utf8');
  const open = html.indexOf('<aside id="vex-newtab-extras"');
  const block = html.slice(html.lastIndexOf('<div id="vex-newtab-layer"', open), html.lastIndexOf('</body>'));
  const inline = [...block.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];

  function run(newtab) {
    document.body.innerHTML = '<section id="brief-section"></section><div id="today-section"></div>' + block.replace(/<script[\s\S]*?<\/script>/g, '');
    window.__vexToday = { newtab };
    new Function(inline)();   // eslint-disable-line no-new-func
  }

  it('shows nothing when the payload has nothing', () => {
    run({ v: 1, quiet: false });
    expect(document.getElementById('vex-newtab-extras').hidden).toBe(true);
  });

  it('draws the pet and the shelf as plain text and shapes, and drops anything else', () => {
    run({
      v: 1, quiet: false,
      pet: { label: 'Your pet', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" onload="x()"><script>alert(1)</script><path d="M0 0" class="vp-fill"/><image href="https://x/y.png"/></svg>' },
      widgets: [{ type: 'quote', text: '<img src=x onerror=alert(1)> be kind' }],
    });
    const pet = document.getElementById('vex-newtab-pet');
    expect(pet.querySelector('script')).toBeNull();
    expect(pet.querySelector('image')).toBeNull();
    expect(pet.querySelector('svg').hasAttribute('onload')).toBe(false);
    expect(pet.querySelector('path')).not.toBeNull();
    const w = document.querySelector('.vex-nt-widget');
    expect(w.textContent).toContain('<img');
    expect(w.querySelector('img')).toBeNull();
  });

  it('puts the Today block before the brief for a project or reading day', () => {
    run({ v: 1, quiet: false, profile: { profile: 'reading', label: 'Reading' } });
    const kids = [...document.body.children].map(e => e.id);
    expect(kids.indexOf('today-section')).toBeLessThan(kids.indexOf('brief-section'));
  });
});
