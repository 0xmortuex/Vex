// === Vex Job Profiles ===
// "A browser that reshapes itself around your work." Pick your profession in the
// setup wizard (or Ctrl+K → Personalize for Your Job) and Vex applies a fitting
// theme, enables the built-in Toolbox tools that job uses daily, and drops quick
// tool buttons next to the Tor button. Every tool here is built into Vex
// (toolbox.js) — no embedded external sites. The user can toggle tools on/off.
const JobProfiles = {
  CATEGORIES: ['Tech', 'Design', 'Writing', 'Business', 'Science', 'Health', 'Education', 'Legal', 'Creative', 'General'],

  // theme = a real ThemeManager theme id. tools = toolbox.js tool ids.
  JOBS: [
    // Tech
    { id: 'software-dev',   name: 'Software Developer',   cat: 'Tech', theme: 'matrix',     tools: ['regex', 'json', 'base64', 'hash', 'timestamp', 'uuid', 'cron', 'csv'] },
    { id: 'web-dev',        name: 'Web Developer',        cat: 'Tech', theme: 'cyberpunk',  tools: ['regex', 'json', 'color', 'base64', 'uuid', 'jwt', 'urlencode'] },
    { id: 'data-analyst',   name: 'Data Analyst',         cat: 'Tech', theme: 'solarized',  tools: ['csv', 'json', 'regex', 'timestamp'] },
    { id: 'devops',         name: 'DevOps Engineer',      cat: 'Tech', theme: 'obsidian',   tools: ['cron', 'json', 'hash', 'timestamp', 'base64'] },
    { id: 'qa',             name: 'QA / Test Engineer',   cat: 'Tech', theme: 'slate',      tools: ['regex', 'json', 'timestamp', 'uuid'] },
    { id: 'security',       name: 'Cybersecurity Analyst',cat: 'Tech', theme: 'matrix',     tools: ['hash', 'base64', 'regex', 'uuid', 'jwt', 'passgen'] },
    { id: 'gamedev',        name: 'Game Developer',       cat: 'Tech', theme: 'amethyst',   tools: ['json', 'color', 'uuid', 'hash'] },
    { id: 'mobile-dev',     name: 'Mobile Developer',     cat: 'Tech', theme: 'mint',       tools: ['json', 'regex', 'uuid', 'color'] },
    { id: 'dba',            name: 'Database Admin',       cat: 'Tech', theme: 'sapphire',   tools: ['csv', 'json', 'timestamp', 'uuid'] },
    // Design
    { id: 'ux-designer',    name: 'UX / UI Designer',     cat: 'Design', theme: 'rose',     tools: ['color', 'wordcount'] },
    { id: 'graphic-designer',name: 'Graphic Designer',    cat: 'Design', theme: 'vaporwave',tools: ['color'] },
    { id: 'product-designer',name: 'Product Designer',    cat: 'Design', theme: 'arctic',   tools: ['color', 'wordcount'] },
    // Writing
    { id: 'writer',         name: 'Writer / Author',      cat: 'Writing', theme: 'oxford',   tools: ['wordcount'] },
    { id: 'journalist',     name: 'Journalist',           cat: 'Writing', theme: 'mocha',    tools: ['wordcount', 'timestamp'] },
    { id: 'copywriter',     name: 'Copywriter',           cat: 'Writing', theme: 'honey',    tools: ['wordcount', 'color'] },
    { id: 'content',        name: 'Content Creator',      cat: 'Writing', theme: 'sunset',   tools: ['wordcount', 'color'] },
    { id: 'translator',     name: 'Translator',           cat: 'Writing', theme: 'nord',     tools: ['wordcount'] },
    { id: 'editor',         name: 'Editor',               cat: 'Writing', theme: 'bronze',   tools: ['wordcount'] },
    // Business
    { id: 'accountant',     name: 'Accountant',           cat: 'Business', theme: 'emerald',  tools: ['csv', 'timestamp'] },
    { id: 'financial-analyst',name: 'Financial Analyst',  cat: 'Business', theme: 'gold',     tools: ['csv', 'json'] },
    { id: 'entrepreneur',   name: 'Entrepreneur / Founder',cat: 'Business', theme: 'crimson', tools: ['wordcount', 'csv', 'color'] },
    { id: 'pm',             name: 'Project Manager',      cat: 'Business', theme: 'ocean',    tools: ['csv', 'timestamp', 'wordcount'] },
    { id: 'marketer',       name: 'Marketer',             cat: 'Business', theme: 'sunset',   tools: ['wordcount', 'color', 'csv'] },
    { id: 'sales',          name: 'Sales',                cat: 'Business', theme: 'ruby',     tools: ['csv', 'wordcount'] },
    // Science
    { id: 'data-scientist', name: 'Data Scientist',       cat: 'Science', theme: 'midnight',  tools: ['csv', 'json', 'regex', 'timestamp'] },
    { id: 'mech-eng',       name: 'Mechanical Engineer',  cat: 'Science', theme: 'slate',     tools: ['color', 'csv'] },
    { id: 'elec-eng',       name: 'Electrical Engineer',  cat: 'Science', theme: 'volcano',   tools: ['color', 'csv'] },
    { id: 'researcher',     name: 'Researcher',           cat: 'Science', theme: 'forest',    tools: ['wordcount', 'csv'] },
    { id: 'scientist',      name: 'Scientist',            cat: 'Science', theme: 'aurora',     tools: ['csv', 'wordcount'] },
    // Health
    { id: 'doctor',         name: 'Doctor / Physician',   cat: 'Health', theme: 'arctic',     tools: ['timestamp', 'wordcount'] },
    { id: 'nurse',          name: 'Nurse',                cat: 'Health', theme: 'mint',        tools: ['timestamp', 'wordcount'] },
    { id: 'pharmacist',     name: 'Pharmacist',           cat: 'Health', theme: 'emerald',     tools: ['wordcount'] },
    { id: 'psychologist',   name: 'Psychologist',         cat: 'Health', theme: 'lime',        tools: ['wordcount', 'timestamp'] },
    // Education
    { id: 'teacher',        name: 'Teacher',              cat: 'Education', theme: 'forest',    tools: ['wordcount', 'timestamp'] },
    { id: 'professor',      name: 'Professor / Academic', cat: 'Education', theme: 'oxford',    tools: ['wordcount', 'csv'] },
    { id: 'student',        name: 'Student',              cat: 'Education', theme: 'catppuccin',tools: ['wordcount', 'timestamp'] },
    // Legal
    { id: 'lawyer',         name: 'Lawyer',               cat: 'Legal', theme: 'wine',         tools: ['wordcount', 'timestamp'] },
    { id: 'paralegal',      name: 'Paralegal',            cat: 'Legal', theme: 'mocha',        tools: ['wordcount'] },
    // Creative
    { id: 'photographer',   name: 'Photographer',         cat: 'Creative', theme: 'obsidian',   tools: ['color', 'timestamp'] },
    { id: 'video-editor',   name: 'Video Editor',         cat: 'Creative', theme: 'dracula',    tools: ['timestamp', 'color'] },
    { id: 'musician',       name: 'Musician / Producer',  cat: 'Creative', theme: 'amethyst',   tools: ['wordcount', 'timestamp'] },
    { id: 'architect',      name: 'Architect',            cat: 'Creative', theme: 'slate',      tools: ['color', 'wordcount'] },
    { id: 'sre',            name: 'Site Reliability Engineer', cat: 'Tech', theme: 'obsidian',  tools: ['cron', 'json', 'hash', 'timestamp', 'regex'] },
    { id: 'ml-engineer',    name: 'ML Engineer',           cat: 'Tech', theme: 'amethyst',   tools: ['json', 'csv', 'regex', 'uuid'] },
    { id: 'cloud-architect',name: 'Cloud Architect',       cat: 'Tech', theme: 'sapphire',   tools: ['json', 'jwt', 'base64', 'timestamp'] },
    { id: 'blockchain-dev', name: 'Blockchain Developer',  cat: 'Tech', theme: 'gold',       tools: ['hash', 'base64', 'jwt', 'uuid'] },
    { id: 'api-dev',        name: 'API / Backend Developer',cat: 'Tech', theme: 'emerald',    tools: ['json', 'jwt', 'urlencode', 'timestamp', 'uuid'] },
    { id: 'it-support',     name: 'IT Support',            cat: 'Tech', theme: 'slate',      tools: ['passgen', 'urlencode', 'timestamp'] },
    { id: 'sysadmin',       name: 'Systems Administrator', cat: 'Tech', theme: 'matrix',     tools: ['cron', 'hash', 'passgen', 'regex'] },
    { id: 'motion-designer',name: 'Motion Designer',       cat: 'Design', theme: 'vaporwave', tools: ['color'] },
    { id: '3d-artist',      name: '3D Artist',             cat: 'Design', theme: 'plum',      tools: ['color'] },
    { id: 'technical-writer',name: 'Technical Writer',     cat: 'Writing', theme: 'nord',     tools: ['markdown', 'wordcount', 'caseconvert'] },
    { id: 'blogger',        name: 'Blogger',               cat: 'Writing', theme: 'honey',    tools: ['markdown', 'wordcount'] },
    { id: 'social-media',   name: 'Social Media Manager',  cat: 'Writing', theme: 'sunset',   tools: ['wordcount', 'caseconvert', 'color'] },
    { id: 'consultant',     name: 'Consultant',            cat: 'Business', theme: 'ocean',    tools: ['wordcount', 'csv'] },
    { id: 'hr',             name: 'HR / People Ops',       cat: 'Business', theme: 'rose',     tools: ['wordcount', 'csv'] },
    { id: 'recruiter',      name: 'Recruiter',             cat: 'Business', theme: 'mint',     tools: ['wordcount', 'csv'] },
    { id: 'operations',     name: 'Operations Manager',    cat: 'Business', theme: 'slate',    tools: ['csv', 'timestamp', 'cron'] },
    { id: 'statistician',   name: 'Statistician',          cat: 'Science', theme: 'solarized', tools: ['csv', 'json'] },
    { id: 'civil-eng',      name: 'Civil Engineer',        cat: 'Science', theme: 'bronze',    tools: ['color', 'csv'] },
    { id: 'dentist',        name: 'Dentist',               cat: 'Health', theme: 'arctic',     tools: ['timestamp', 'wordcount'] },
    { id: 'veterinarian',   name: 'Veterinarian',          cat: 'Health', theme: 'forest',     tools: ['timestamp', 'wordcount'] },
    { id: 'podcaster',      name: 'Podcaster',             cat: 'Creative', theme: 'crimson',   tools: ['wordcount', 'timestamp'] },
    { id: 'streamer',       name: 'Streamer',              cat: 'Creative', theme: 'cyberpunk', tools: ['color', 'timestamp'] },
    // General
    { id: 'general',        name: 'General / Everyday',   cat: 'General', theme: 'oxford',      tools: ['wordcount', 'color', 'uuid', 'timestamp', 'passgen', 'caseconvert', 'markdown'] },
  ],

  list() { return this.JOBS; },
  get(id) { return this.JOBS.find(j => j.id === id) || null; },
  current() { try { return localStorage.getItem('vex.job') || null; } catch { return null; } },

  // Apply a job: persist it + the chosen tools, switch theme, redraw buttons.
  apply(jobId, enabledToolIds) {
    const job = this.get(jobId);
    if (!job) return;
    const tools = Array.isArray(enabledToolIds) ? enabledToolIds : job.tools.slice();
    try { localStorage.setItem('vex.job', jobId); } catch {}
    try { localStorage.setItem('vex.jobTools', JSON.stringify(tools)); } catch {}
    try {
      if (typeof ThemeManager !== 'undefined' && ThemeManager.availableThemes.includes(job.theme)) {
        ThemeManager.applyTheme(job.theme);
      }
    } catch {}
    this.renderButtons();
    try { if (window.WorkPanel) WorkPanel.refresh(); } catch {}
  },

  // Clear the profile (back to plain Vex — theme left as-is).
  clear() {
    try { localStorage.removeItem('vex.job'); localStorage.removeItem('vex.jobTools'); } catch {}
    this.renderButtons();
    try { if (window.WorkPanel) WorkPanel.refresh(); } catch {}
  },

  // Draw the 🧰 Toolbox button + up to 3 quick tool buttons next to the Tor
  // button. Idempotent — removes previously-drawn job buttons first.
  renderButtons() {
    const bar = document.getElementById('top-bar-right');
    if (!bar) return;
    bar.querySelectorAll('.vex-job-btn').forEach(b => b.remove());
    const enabled = (() => { try { const a = JSON.parse(localStorage.getItem('vex.jobTools') || 'null'); return Array.isArray(a) ? a : null; } catch { return null; } })();
    if (!this.current()) return; // no profile → no job buttons
    const anchor = document.getElementById('btn-command') || null;
    const mk = (title, icon, onClick) => {
      const b = document.createElement('button');
      b.className = 'nav-btn vex-job-btn';
      b.title = title;
      b.textContent = icon;
      b.style.cssText = 'font-size:14px';
      b.addEventListener('click', onClick);
      bar.insertBefore(b, anchor);
      return b;
    };
    mk('Toolbox — your job tools', '🧰', () => { try { window.Toolbox && Toolbox.open(); } catch {} });
    const quick = (enabled || []).slice(0, 3);
    for (const id of quick) {
      const t = window.Toolbox && Toolbox.get(id);
      if (!t) continue;
      mk(t.name, t.icon, () => { try { Toolbox.openTool(id); } catch {} });
    }
  },

  // Called at boot to restore the job's toolbar buttons (theme is restored by
  // ThemeManager itself).
  boot() { try { if (this.current()) this.renderButtons(); } catch {} },
};

if (typeof window !== 'undefined') window.JobProfiles = JobProfiles;
if (typeof module !== 'undefined' && module.exports) module.exports = { JobProfiles };
