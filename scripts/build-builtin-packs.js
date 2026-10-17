// Builds the packs that ship inside Vex (src/main/builtin-packs/*.vexpack) and
// the table of their hashes (src/main/builtin-packs/pins.js).
//
//   node scripts/build-builtin-packs.js          write the files
//   node scripts/build-builtin-packs.js --check  fail if the files differ from the data below
//
// The content lives here, as data, and goes through the SAME validator as any pack
// (main/packs.js buildPack), so a built-in can never hold something a pack may not.
// The files are not signed: the trust of a built-in comes from where it is read from
// (main/packs-builtin.js), and from the hash pinned in pins.js, which a reviewer sees
// change in the same diff as the content. See docs/packs.md, "Built-in packs".
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const packs = require('../src/main/packs');

const OUT = path.join(__dirname, '..', 'src', 'main', 'builtin-packs');
const AUTHOR = 'Vex';
const VERIFIED = '2026-10-16';

const skill = (id, name, icon, prompt, output = 'text', sites = []) => ({ type: 'skills', id, name, icon, prompt, output, sites });

const PROMPTS = {
  id: 'vex-builtin.prompts',
  name: 'Prompt library',
  author: AUTHOR,
  description: 'Ready-made AI skills: prompts that read the page you are on. They are only text; nothing is sent until you run one. Copy the ones you want into your AI Skills, where you can edit them (Vex keeps their history and shows the changes).',
  items: [
    skill('study-notes', 'Study notes from this page', 'book-open', 'Turn this page into study notes: a title, the 5 ideas that matter most, one sentence on why each matters, and 3 questions I should be able to answer afterwards. Use only what the page says.', 'note'),
    skill('quiz-me', 'Quiz me on this page', 'brain', 'Write 5 questions that test whether I understood this page. Put each answer on the line below its question, after the word "Answer:". Do not ask about details the page does not contain.'),
    skill('claims-check', 'List the claims and what would settle them', 'search', 'List every factual claim on this page. For each one, say what kind of source would settle it (a statistic, a primary document, a study). Do not say whether a claim is true unless the page itself gives evidence.', 'table'),
    skill('plain-selection', 'Say my selection in plain words', 'type', 'Rewrite this in plain, short sentences without losing any meaning:\n\n{{selection}}'),
    skill('translate-selection', 'Translate my selection', 'message', 'Translate this into {{ask:Which language?}}. Keep names, numbers and formatting. If a phrase has no direct equivalent, give the closest and add a short note in brackets.\n\n{{selection}}'),
    skill('reply-short', 'Reply to this, saying what I want', 'edit', 'Draft a short, polite reply to the message or thread on this page. What I want to say: {{ask:What do you want to say?}}. Match the language and tone of the thread. Give me only the reply text.'),
    skill('action-items', 'Action items with owners and dates', 'check', 'Extract every action item from this page as a checklist. For each, name who is responsible and any date, if the page gives them. If the page names neither, leave that part out; do not guess.', 'checklist'),
    skill('bug-report', 'Write a bug report from this page', 'code', 'Write a bug report from what is on this page ({{url}}). Sections: Summary, Steps to reproduce, Expected result, Actual result, and What I do not know yet. Do not invent steps that the page does not show.', 'note'),
    skill('earliest-deadline', 'Remind me of the earliest deadline here', 'flag', 'Find the earliest upcoming deadline or closing date on this page. The reminder message should say what it is for, in one line.', 'reminder'),
    skill('pr-summary', 'Summarise this pull request', 'list', 'Summarise this pull request in 5 bullets: what changes, why, what is risky, what is untested, and what a reviewer should look at first. Use only what the page shows.', 'text', ['github.com']),
  ],
};

const step = (id, title, text, run = '') => ({ id, title, text, run });

const PLAYBOOKS = {
  id: 'vex-builtin.incident-extra',
  name: 'More "something went wrong" checklists',
  author: AUTHOR,
  description: 'Four more checklists for the Something Went Wrong screen: a taken-over Roblox account, a stolen Discord login, a lost phone, and money or a code sent to a scammer. Each says when it was last checked. Anything about Windows or another company is a step you do yourself.',
  items: [
    {
      type: 'playbook', id: 'roblox-taken-over', title: 'My Roblox account was taken over',
      sub: 'Items gone, a changed email, or strangers in your friends list. Go in order; tick each step when you have done it.', verified: VERIFIED,
      steps: [
        step('site', 'Clear Roblox in Vex and open its sign-out page', 'Pick roblox.com. Vex removes its cookies and stored data in every container, then opens the page where the site lets you sign out of other sessions.', 'kill'),
        step('email', 'Take back the email first', 'If the email on the account was changed, use the old address to follow the "this was not me" link Roblox sent, or contact Roblox Support from its official site. Change the password of that mailbox before anything else.'),
        step('password', 'Change the Roblox password', 'Choose a long password that you have never used anywhere else. The saved logins list shows where you reused one.', 'logins'),
        step('2step', 'Turn on two-step verification', 'In Roblox Settings, Security, turn on two-step verification with an authenticator app, not only email.'),
        step('sessions', 'Sign out of every other session', 'In Roblox Settings, Security, sign out of all other sessions. Remove any connected app you do not remember.'),
        step('purchases', 'Look at what was bought or traded', 'Check the transaction and trade history. Report anything you did not do to Roblox Support from its official site, with the dates.'),
        step('files', 'Think about where it started', 'Takeovers often start from a "free Robux" page, a cheat or an executor, or a file from a stranger. Look at your downloads folder for names you do not recognise.', 'downloads'),
        step('extensions', 'Check your browser extensions', 'Remove any extension you do not remember installing.', 'extensions'),
        step('scan', 'Run a Windows Security scan', 'Open Windows Security, Virus and threat protection, and run a Full scan. Vex does not scan files.'),
      ],
    },
    {
      type: 'playbook', id: 'discord-login-stolen', title: 'Someone is using my Discord login',
      sub: 'Messages with links you did not send, new servers, or a login from somewhere you are not.', verified: VERIFIED,
      steps: [
        step('site', 'Clear Discord in Vex and open its sign-out page', 'Pick discord.com. Vex removes its cookies and stored data in every container.', 'kill'),
        step('password', 'Change the Discord password', 'Changing it makes Discord end the old sessions. Use a long password you have not used anywhere else.', 'logins'),
        step('2fa', 'Turn on two-step verification', 'In User Settings, My Account, turn on an authenticator app. Save the backup codes somewhere that is not Discord.'),
        step('apps', 'Remove apps and devices you do not know', 'In User Settings, look at Authorized Apps and Devices, and remove what is not yours.'),
        step('servers', 'Check the servers you manage', 'Look for new bots, webhooks, roles or invites you did not make, and remove them. Tell the other admins.'),
        step('friends', 'Warn the people who got messages', 'A short note that the links were not yours, and that nobody should open them.'),
        step('files', 'Look at your downloads folder', 'Login theft often comes from a game mod or a file sent in a chat. Look at names you do not recognise.', 'downloads'),
        step('extensions', 'Check your browser extensions', 'A bad extension can read pages. Remove any you do not remember installing.', 'extensions'),
        step('scan', 'Run a Windows Security scan', 'Open Windows Security, Virus and threat protection, and run a Full scan. Vex does not scan files.'),
      ],
    },
    {
      type: 'playbook', id: 'lost-phone', title: 'I lost my phone',
      sub: 'Lost or stolen. The phone is probably your second factor for many accounts, so work from the most important ones down.', verified: VERIFIED,
      steps: [
        step('locate', 'Lock or locate it from another device', 'Use Find My Device (Android) or Find My (iPhone) from a computer. Lock it and show a message with a number to call. Erase it only when you are sure it is gone.'),
        step('carrier', 'Call your mobile carrier', 'Ask them to block the SIM so no one can receive your codes, and to block the device itself if it was stolen. Ask for a new SIM with the same number.'),
        step('email', 'Secure your email first', 'Change the password of your main email and sign out of other sessions. Email resets everything else.', 'logins'),
        step('signedin', 'See where you are signed in on this computer', 'The list shows the accounts that matter. Use the recovery or backup codes you saved to get into those that asked for the phone.', 'signedin'),
        step('authenticator', 'Move your authenticator codes', 'If your codes lived only on the phone, use each account\'s backup codes to sign in and set up a new authenticator. Vex can show which accounts have a saved login.'),
        step('bank', 'Tell your bank if a banking app was on it', 'Ask them to block the app and your cards if you are not sure. Check recent transactions.'),
        step('sessions', 'Remove the phone from your accounts', 'In your Google, Apple and Microsoft account security pages, remove the phone from the list of devices.'),
        step('police', 'Report it if it was stolen', 'A report helps with the carrier and with insurance. Keep the device serial number or IMEI from its box or your account.'),
      ],
    },
    {
      type: 'playbook', id: 'sent-money-or-code', title: 'I sent money or a code to a scammer',
      sub: 'A payment, card details, or a code from a text or an authenticator. Speed matters more than anything else here.', verified: VERIFIED,
      steps: [
        step('stop', 'Stop talking to them', 'Do not send more, and do not click the "recovery" offers that follow: they are usually the same people.'),
        step('bank', 'Call your bank or card issuer now', 'Use the number on the back of your card, not one the scammer gave you. Ask to block the card and to dispute or recall the payment.'),
        step('evidence', 'Keep the evidence', 'Save screenshots, usernames, addresses, phone numbers and receipts. Do not delete the conversation.'),
        step('code', 'If you gave a login code, treat that account as taken', 'Change its password at once and use the checklist for a taken-over account. A code you read out is a key you handed over.', 'logins'),
        step('signedin', 'See where you are signed in', 'Sign out of the sessions on the accounts that matter.', 'signedin'),
        step('report', 'Report it', 'Report it to the platform where it happened and to your local cyber-crime police. Reports are what let others get money back.'),
        step('watch', 'Watch your accounts for a few weeks', 'Check statements and your credit report. People who were scammed once are often contacted again.'),
      ],
    },
  ],
};

const phrase = (label, text) => ({ label, text });

const MUN = {
  id: 'vex-builtin.mun-phrases',
  name: 'Model UN procedure phrases',
  author: AUTHOR,
  description: 'Generic phrases to copy while you draft speeches and points. Conferences differ in their rules of procedure (names, order of motions, time limits and voting thresholds), so check the one you attend. Nothing here is a rule.',
  items: [
    {
      type: 'snippets', id: 'procedure', name: 'Motions and points',
      entries: [
        phrase('Point of order', 'Point of order: the delegate would like to raise a concern about how the rules of procedure are being applied.'),
        phrase('Point of personal privilege', 'Point of personal privilege: the delegate asks the Chair to address a matter that affects their ability to take part in the debate, such as audibility or comfort.'),
        phrase('Point of parliamentary inquiry', 'Point of parliamentary inquiry: could the Chair clarify what the next step in the procedure is?'),
        phrase('Open the speakers list', 'Motion to open the speakers list.'),
        phrase('Moderated caucus', 'Motion for a moderated caucus on [topic], for a total of [minutes] minutes, with [seconds] seconds per speaker.'),
        phrase('Unmoderated caucus', 'Motion for an unmoderated caucus for a total of [minutes] minutes, so that delegations can work together on draft text.'),
        phrase('Extend the caucus', 'Motion to extend the caucus by [minutes] minutes.'),
        phrase('Set the speaking time', 'Motion to set the speaking time to [seconds] seconds.'),
        phrase('Close the speakers list', 'Motion to close the speakers list.'),
        phrase('Close debate', 'Motion to close debate on the topic and move into voting procedure.'),
        phrase('Introduce the draft', 'Motion to introduce the draft resolution [code], submitted by [sponsors].'),
        phrase('Friendly amendment', 'The sponsors accept this as a friendly amendment.'),
        phrase('Right of reply', 'Point of right of reply: the delegate believes that remarks about their country were inaccurate and asks the Chair to allow a short response.'),
        phrase('Yield to the Chair', 'The delegate yields the remainder of their time to the Chair.'),
        phrase('Yield to questions', 'The delegate yields the remainder of their time to questions.'),
        phrase('Yield to a delegate', 'The delegate yields the remainder of their time to the delegate of [country].'),
        phrase('Ask a question', 'Would the delegate of [country] clarify how their proposal would be paid for and monitored?'),
      ],
    },
    {
      type: 'snippets', id: 'speech', name: 'Speeches and clauses',
      entries: [
        phrase('Open a speech', 'Honourable Chair, fellow delegates, [country] thanks the Chair for the floor. On the topic of [topic], my delegation wishes to make three points.'),
        phrase('State a position', 'The position of [country] is that [position], because [reason].'),
        phrase('Cite your own policy', 'This is consistent with [country]\'s national policy on [issue], as set out in [document].'),
        phrase('Ask for cooperation', 'My delegation invites all delegations that share this concern to work with us in the next caucus.'),
        phrase('Disagree politely', 'While [country] respects the position of the delegate of [country], we cannot support it, because [reason].'),
        phrase('Close a speech', 'In conclusion, [country] urges the committee to [action]. Thank you, Chair.'),
        phrase('Preambulatory: recalling', 'Recalling [resolution or treaty],'),
        phrase('Preambulatory: noting with concern', 'Noting with concern [fact],'),
        phrase('Preambulatory: emphasizing', 'Emphasizing the need for [aim],'),
        phrase('Operative: calls upon', '1. Calls upon [who] to [action];'),
        phrase('Operative: encourages', '2. Encourages [who] to [action];'),
        phrase('Operative: requests', '3. Requests the Secretary-General to [action] and to report to [body] by [date];'),
        phrase('Operative: decides', '4. Decides to remain seized of the matter.'),
      ],
    },
  ],
};

// Fixed dates repeat every year; the religious holidays are listed day by day and
// are ALL marked "verify", because the official dates come from Diyanet's calendar
// and can differ by a day from an astronomical table.
function holidays() {
  const fixed = [
    ['01-01', 'Yılbaşı (New Year\'s Day)'],
    ['04-23', 'Ulusal Egemenlik ve Çocuk Bayramı'],
    ['05-01', 'Emek ve Dayanışma Günü'],
    ['05-19', 'Atatürk\'ü Anma, Gençlik ve Spor Bayramı'],
    ['07-15', 'Demokrasi ve Millî Birlik Günü'],
    ['08-30', 'Zafer Bayramı'],
    ['10-28', 'Cumhuriyet Bayramı arifesi (afternoon off)', 'half-day'],
    ['10-29', 'Cumhuriyet Bayramı'],
  ];
  const religious = {
    2026: [['03-19', 'Ramazan Bayramı arifesi (afternoon off)'], ['03-20', 'Ramazan Bayramı, day 1'], ['03-21', 'Ramazan Bayramı, day 2'], ['03-22', 'Ramazan Bayramı, day 3'],
      ['05-26', 'Kurban Bayramı arifesi (afternoon off)'], ['05-27', 'Kurban Bayramı, day 1'], ['05-28', 'Kurban Bayramı, day 2'], ['05-29', 'Kurban Bayramı, day 3'], ['05-30', 'Kurban Bayramı, day 4']],
    2027: [['03-08', 'Ramazan Bayramı arifesi (afternoon off)'], ['03-09', 'Ramazan Bayramı, day 1'], ['03-10', 'Ramazan Bayramı, day 2'], ['03-11', 'Ramazan Bayramı, day 3'],
      ['05-16', 'Kurban Bayramı arifesi (afternoon off)'], ['05-17', 'Kurban Bayramı, day 1'], ['05-18', 'Kurban Bayramı, day 2'], ['05-19', 'Kurban Bayramı, day 3'], ['05-20', 'Kurban Bayramı, day 4']],
    2028: [['02-25', 'Ramazan Bayramı arifesi (afternoon off)'], ['02-26', 'Ramazan Bayramı, day 1'], ['02-27', 'Ramazan Bayramı, day 2'], ['02-28', 'Ramazan Bayramı, day 3'],
      ['05-04', 'Kurban Bayramı arifesi (afternoon off)'], ['05-05', 'Kurban Bayramı, day 1'], ['05-06', 'Kurban Bayramı, day 2'], ['05-07', 'Kurban Bayramı, day 3'], ['05-08', 'Kurban Bayramı, day 4']],
  };
  const out = [];
  for (const y of [2026, 2027, 2028]) {
    for (const [md, name, kind] of fixed) out.push({ date: y + '-' + md, name, kind: kind || 'fixed', verify: false });
    for (const [md, name] of religious[y]) out.push({ date: y + '-' + md, name, kind: /arifesi/.test(name) ? 'half-day' : 'religious', verify: true });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const TR_HOLIDAYS = {
  id: 'vex-builtin.tr-holidays',
  name: 'Turkish public holidays 2026-2028',
  author: AUTHOR,
  description: 'The fixed national holidays and the bayram days for 2026, 2027 and 2028. The bayram dates are marked "verify with Diyanet": they follow the religious calendar, and the official announcement is what counts. Government "bridge" extensions are decided each year and are not listed.',
  items: [{ type: 'dates', id: 'tr-public', name: 'Public holidays', region: 'TR', entries: holidays() }],
};

// Student discounts and portal recipes (Wave 5). Data only: fixed, public https addresses to the companies' and
// the government's own pages, and short steps. Nothing here is fetched, scraped or signed in to by Vex. Offers and
// menu names change, so every part says it was last checked on STUDENT_CHECKED and tells the reader to verify there.
const STUDENT_CHECKED = '2026-10-17';
const link = (label, url) => ({ kind: 'link', label, url });
const STUDENT = {
  id: 'vex-builtin.student-portals',
  name: 'Student discounts and portal recipes',
  author: AUTHOR,
  description: 'Where student offers usually live, with a link to each company\'s own page, and four short recipes for common student portals. Last checked ' + STUDENT_CHECKED + '. Offers, prices and menus change: open the page and verify before you rely on anything here.',
  items: [
    {
      type: 'brief-section', id: 'student-discounts', title: 'Student discounts (verify each one)',
      blocks: [
        { kind: 'text', text: 'Last checked ' + STUDENT_CHECKED + '. Each link goes to the company\'s own page. Who qualifies, the price and how you prove you are a student change often, so read the page before you apply.' },
        link('GitHub Student Developer Pack', 'https://education.github.com/pack'),
        link('JetBrains tools for students', 'https://www.jetbrains.com/community/education/#students'),
        link('Microsoft education offers', 'https://www.microsoft.com/en-us/education'),
        link('Canva for Education', 'https://www.canva.com/education/'),
        link('Figma for Education', 'https://www.figma.com/education/'),
        link('Adobe Creative Cloud for students', 'https://www.adobe.com/creativecloud/buy/students.html'),
        link('Autodesk education software', 'https://www.autodesk.com/education/edu-software/overview'),
        link('Apple education', 'https://www.apple.com/education/'),
        link('Spotify Premium Student', 'https://www.spotify.com/student/'),
        link('UNiDAYS student offers', 'https://www.myunidays.com/'),
        link('Student Beans offers', 'https://www.studentbeans.com/'),
      ],
    },
    {
      type: 'snippets', id: 'portal-recipes', name: 'Student portal recipes (verify on the portal)',
      entries: [
        { label: 'e-Devlet: student certificate', text: 'Open https://www.turkiye.gov.tr/ and sign in. Search for "Öğrenci Belgesi", choose your university, and download the PDF (it has a verification barcode). Menu and service names change: verify on the portal. Last checked ' + STUDENT_CHECKED + '.' },
        { label: 'ÖSYM: sign in to your candidate account', text: 'Open https://ais.osym.gov.tr/ from your own bookmark, never from a link in a message. Sign in with the details you set there; applications, the exam entry document and results sit under your account. Menu names change each season: verify on the portal. Last checked ' + STUDENT_CHECKED + '.' },
        { label: 'Apply for a student discount', text: 'Open the company\'s own student page. Sign in with your school email if it asks. Proof usually goes through UNiDAYS, SheerID or your school address; keep your student certificate PDF ready. Most offers must be renewed each year. Terms change: verify on the company\'s page. Last checked ' + STUDENT_CHECKED + '.' },
        { label: 'University portal: password reset', text: 'Use the portal\'s own "forgot password" link; the reset goes to the email on your account. Open the portal from your own bookmark, never from a message, and do not type your university password on a page you reached from one. Steps differ per university: verify on yours. Last checked ' + STUDENT_CHECKED + '.' },
      ],
    },
  ],
};

const ALL = [PROMPTS, PLAYBOOKS, MUN, TR_HOLIDAYS, STUDENT];

function build() {
  const files = {};
  const pins = {};
  for (const def of ALL) {
    const pack = packs.buildPack({ id: def.id, name: def.name, author: def.author, description: def.description, items: def.items }, { builtin: true });
    files[def.id + '.vexpack'] = packs.serializePack(pack);
    pins[def.id] = pack.hash;
  }
  const pinsSource = '// Generated by scripts/build-builtin-packs.js. Do not edit by hand: a change here must come with the\n'
    + '// matching change in the .vexpack files, and both are reviewed together.\n'
    + "'use strict';\n\nmodule.exports = Object.freeze({\n"
    + Object.entries(pins).map(([id, h]) => "  '" + id + "': '" + h + "',").join('\n') + '\n});\n';
  files['pins.js'] = pinsSource;
  return files;
}

if (require.main === module) {
  const files = build();
  const check = process.argv.includes('--check');
  let bad = 0;
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    const target = path.join(OUT, name);
    if (check) {
      const have = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : null;
      if (have !== text) { console.error('Out of date: ' + name); bad++; }
    } else {
      fs.writeFileSync(target, text, 'utf8');
      console.log('wrote ' + name);
    }
  }
  if (bad) { console.error('Run: node scripts/build-builtin-packs.js'); process.exit(1); }
}

module.exports = { build, ALL, VERIFIED };
