// @vitest-environment jsdom
//
// The Job Profiles catalogue: hundreds of professions, each with a real theme
// and a short list of tools that exist in the Toolbox (hand-built tools plus
// every pack). Saved `vex.job` ids must keep working, so the original ids —
// and their name, category and theme — are pinned here.

import { describe, it, expect } from 'vitest';

// The icon set must be present: rendersDrawnIcon cannot tell a VexIcons name
// from a typographic mark without it, and deliberately declines to filter.
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons;
const { ToolboxPacks } = require('../../src/renderer/js/toolbox-packs.js');
globalThis.ToolboxPacks = ToolboxPacks;
// Under jsdom a pack registers itself on window.ToolboxPacks when first
// required, so load them all, then reset and register each exactly once.
const PACKS = ['text', 'dev-data-web', 'money-date-health', 'units-math-science']
  .map(p => require(`../../src/renderer/js/toolbox-pack-${p}.js`));
ToolboxPacks.specs = [];
for (const pack of PACKS) ToolboxPacks.add(pack);
const { Toolbox } = require('../../src/renderer/js/toolbox.js');
const { JobProfiles } = require('../../src/renderer/js/job-profiles.js');

const THEMES = ['oxford', 'default', 'midnight', 'forest', 'ocean', 'dracula', 'nord', 'catppuccin', 'sunset', 'rose',
  'matrix', 'mocha', 'solarized', 'vaporwave', 'aurora', 'crimson', 'gold', 'sakura', 'cyberpunk', 'monochrome',
  'slate', 'emerald', 'amethyst', 'volcano', 'sapphire', 'honey', 'mint', 'obsidian', 'ruby', 'lime', 'bronze',
  'plum', 'arctic', 'wine'];

// The catalogue as it shipped before the expansion: id -> [name, cat, theme].
const ORIGINAL = {
  'software-dev': ['Software Developer', 'Tech', 'matrix'],
  'web-dev': ['Web Developer', 'Tech', 'cyberpunk'],
  'data-analyst': ['Data Analyst', 'Tech', 'solarized'],
  'devops': ['DevOps Engineer', 'Tech', 'obsidian'],
  'qa': ['QA / Test Engineer', 'Tech', 'slate'],
  'security': ['Cybersecurity Analyst', 'Tech', 'matrix'],
  'gamedev': ['Game Developer', 'Tech', 'amethyst'],
  'mobile-dev': ['Mobile Developer', 'Tech', 'mint'],
  'dba': ['Database Admin', 'Tech', 'sapphire'],
  'ux-designer': ['UX / UI Designer', 'Design', 'rose'],
  'graphic-designer': ['Graphic Designer', 'Design', 'vaporwave'],
  'product-designer': ['Product Designer', 'Design', 'arctic'],
  'writer': ['Writer / Author', 'Writing', 'oxford'],
  'journalist': ['Journalist', 'Writing', 'mocha'],
  'copywriter': ['Copywriter', 'Writing', 'honey'],
  'content': ['Content Creator', 'Writing', 'sunset'],
  'translator': ['Translator', 'Writing', 'nord'],
  'editor': ['Editor', 'Writing', 'bronze'],
  'accountant': ['Accountant', 'Business', 'emerald'],
  'financial-analyst': ['Financial Analyst', 'Business', 'gold'],
  'entrepreneur': ['Entrepreneur / Founder', 'Business', 'crimson'],
  'pm': ['Project Manager', 'Business', 'ocean'],
  'marketer': ['Marketer', 'Business', 'sunset'],
  'sales': ['Sales', 'Business', 'ruby'],
  'data-scientist': ['Data Scientist', 'Science', 'midnight'],
  'mech-eng': ['Mechanical Engineer', 'Science', 'slate'],
  'elec-eng': ['Electrical Engineer', 'Science', 'volcano'],
  'researcher': ['Researcher', 'Science', 'forest'],
  'scientist': ['Scientist', 'Science', 'aurora'],
  'doctor': ['Doctor / Physician', 'Health', 'arctic'],
  'nurse': ['Nurse', 'Health', 'mint'],
  'pharmacist': ['Pharmacist', 'Health', 'emerald'],
  'psychologist': ['Psychologist', 'Health', 'lime'],
  'teacher': ['Teacher', 'Education', 'forest'],
  'professor': ['Professor / Academic', 'Education', 'oxford'],
  'student': ['Student', 'Education', 'catppuccin'],
  'lawyer': ['Lawyer', 'Legal', 'wine'],
  'paralegal': ['Paralegal', 'Legal', 'mocha'],
  'photographer': ['Photographer', 'Creative', 'obsidian'],
  'video-editor': ['Video Editor', 'Creative', 'dracula'],
  'musician': ['Musician / Producer', 'Creative', 'amethyst'],
  'architect': ['Architect', 'Creative', 'slate'],
  'sre': ['Site Reliability Engineer', 'Tech', 'obsidian'],
  'ml-engineer': ['ML Engineer', 'Tech', 'amethyst'],
  'cloud-architect': ['Cloud Architect', 'Tech', 'sapphire'],
  'blockchain-dev': ['Blockchain Developer', 'Tech', 'gold'],
  'api-dev': ['API / Backend Developer', 'Tech', 'emerald'],
  'it-support': ['IT Support', 'Tech', 'slate'],
  'sysadmin': ['Systems Administrator', 'Tech', 'matrix'],
  'motion-designer': ['Motion Designer', 'Design', 'vaporwave'],
  '3d-artist': ['3D Artist', 'Design', 'plum'],
  'technical-writer': ['Technical Writer', 'Writing', 'nord'],
  'blogger': ['Blogger', 'Writing', 'honey'],
  'social-media': ['Social Media Manager', 'Writing', 'sunset'],
  'consultant': ['Consultant', 'Business', 'ocean'],
  'hr': ['HR / People Ops', 'Business', 'rose'],
  'recruiter': ['Recruiter', 'Business', 'mint'],
  'operations': ['Operations Manager', 'Business', 'slate'],
  'statistician': ['Statistician', 'Science', 'solarized'],
  'civil-eng': ['Civil Engineer', 'Science', 'bronze'],
  'dentist': ['Dentist', 'Health', 'arctic'],
  'veterinarian': ['Veterinarian', 'Health', 'forest'],
  'podcaster': ['Podcaster', 'Creative', 'crimson'],
  'streamer': ['Streamer', 'Creative', 'cyberpunk'],
  'general': ['General / Everyday', 'General', 'oxford'],
};

const JOBS = JobProfiles.list();
const TOOL_IDS = new Set(Toolbox.all().map(t => t.id));

describe('Job Profiles catalogue', () => {
  it('loads every Toolbox pack (sanity check for the tool-id assertions)', () => {
    expect(Toolbox.TOOLS.length).toBeGreaterThanOrEqual(15);
    expect(ToolboxPacks.specs.length).toBeGreaterThan(250);
    expect(TOOL_IDS.size).toBe(Toolbox.TOOLS.length + ToolboxPacks.specs.length);
  });

  it('has at least 250 jobs', () => {
    expect(JOBS.length).toBeGreaterThanOrEqual(250);
  });

  it('has unique kebab-case ids and unique names', () => {
    const ids = JOBS.map(j => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    const names = JOBS.map(j => j.name);
    expect(new Set(names).size).toBe(names.length);
  });

  // A saved `vex.job` must keep working: the id, name and theme stay. The
  // category may move to one of the new groups (Mechanical Engineer now sits
  // under Engineering, not Science) — that only changes where it's listed.
  it('keeps every original job id with its name and theme', () => {
    expect(Object.keys(ORIGINAL).length).toBe(65);
    for (const [id, [name, , theme]] of Object.entries(ORIGINAL)) {
      const job = JobProfiles.get(id);
      expect(job, `missing original job "${id}"`).not.toBeNull();
      expect({ id, name: job.name, theme: job.theme }).toEqual({ id, name, theme });
    }
  });

  it('puts every job in a known category and uses every category', () => {
    const cats = JobProfiles.CATEGORIES;
    expect(new Set(cats).size).toBe(cats.length);
    expect(cats[0]).toBe('Tech');
    expect(cats[cats.length - 1]).toBe('General');
    for (const j of JOBS) expect(cats, `${j.id} has unknown category "${j.cat}"`).toContain(j.cat);
    for (const c of cats) expect(JOBS.some(j => j.cat === c), `category "${c}" has no jobs`).toBe(true);
  });

  it('uses only real theme ids, never custom', () => {
    for (const j of JOBS) {
      expect(THEMES, `${j.id} has theme "${j.theme}"`).toContain(j.theme);
      expect(j.theme).not.toBe('custom');
    }
  });

  it('gives every job 5–12 distinct tools that exist in the Toolbox', () => {
    for (const j of JOBS) {
      expect(Array.isArray(j.tools), j.id).toBe(true);
      expect(j.tools.length, `${j.id} tool count`).toBeGreaterThanOrEqual(5);
      expect(j.tools.length, `${j.id} tool count`).toBeLessThanOrEqual(12);
      expect(new Set(j.tools).size, `${j.id} has duplicate tools`).toBe(j.tools.length);
      for (const t of j.tools) expect(TOOL_IDS.has(t), `${j.id} lists unknown tool "${t}"`).toBe(true);
    }
  });
});

// A job's recommended tools only include ones that draw a real icon. 137 of the
// 318 tools are marked with a typographic sign instead (".*", "{ }", "Aa"), and
// a grid mixing the two kinds is what made the Work panel look inconsistent.
// The JOBS table itself is deliberately left intact — this is a read-time
// filter, so nothing is lost and it can be changed in one place.
describe('recommended tools are drawn-icon only', () => {
  it('drops every typographic-icon tool from every job', () => {
    const byId = new Map(Toolbox.all().map(t => [t.id, t]));
    const offenders = [];
    for (const job of JobProfiles.list()) {
      for (const id of JobProfiles.recommendedTools(job)) {
        const t = byId.get(id);
        if (t && !Toolbox.rendersDrawnIcon(t)) offenders.push(`${job.id}: ${id} (${t.icon})`);
      }
    }
    expect(offenders, offenders.slice(0, 10).join('\n')).toEqual([]);
  }, 30000);

  it('declines to filter at all when the icon set is missing, rather than emptying lists', () => {
    const saved = globalThis.VexIcons;
    try {
      delete globalThis.VexIcons;
      const job = JobProfiles.list()[0];
      expect(JobProfiles.recommendedTools(job)).toEqual(job.tools);
    } finally { globalThis.VexIcons = saved; }
  });

  it('leaves no job without any tools at all', () => {
    const empty = JobProfiles.list().filter(j => JobProfiles.recommendedTools(j).length === 0).map(j => j.id);
    expect(empty, empty.join(', ')).toEqual([]);
  }, 30000);

  it('keeps the recommendation a subset of what the job actually listed', () => {
    for (const job of JobProfiles.list().slice(0, 60)) {
      const rec = JobProfiles.recommendedTools(job);
      expect(rec.every(id => job.tools.includes(id)), job.id).toBe(true);
    }
  });

  it('still recognises a drawn icon, so the filter is not just emptying lists', () => {
    expect(Toolbox.rendersDrawnIcon({ icon: 'star' })).toBe(true);
    expect(Toolbox.rendersDrawnIcon({ icon: '.*' })).toBe(false);
    expect(Toolbox.rendersDrawnIcon({ icon: '{ }' })).toBe(false);
    // No icon at all falls through to the family drawing, which is a real icon.
    expect(Toolbox.rendersDrawnIcon({ icon: '', family: 'dev' })).toBe(true);
  });
});
