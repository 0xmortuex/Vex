// === Fortune of the day =====================================================
//
// One short, hand-written line a day: a thought, a tip or a pun. Bundled in
// this file (no network, nothing generated), the same line all day, and a
// different one tomorrow; the list goes round without repeating until every
// line has been shown once.
//
//   VexFortune.LINES                   the list (200+)
//   VexFortune.indexFor(date, n)       pure: which line a given day gets
//   VexFortune.today(date?)            { text, kind, day }
//   VexFortune.isEnabled()             OFF until switched on (vex.fortune)
//   VexFortune.setEnabled(on)
//   VexFortune.brief                   { id, title, icon, build(), isEnabled() }
//
// Brief shape (js/brief-integration.js "extras"):
//   build() -> null when off, else
//     { id, title, icon, lines: [{ text, detail }] }
// Silent in Game mode: build() answers null while a game runs, so nothing is
// drawn and nothing is announced.
//
// kind: 't' a thought, 'k' a tip about Vex, 'p' a pun.
const VexFortune = {
  KEY: 'vex.fortune',

  LINES: [
    // Thoughts
    ['t', 'A tidy start makes the rest of the day easier to begin.'],
    ['t', 'Finish the small thing first; it clears room for the big one.'],
    ['t', 'You do not have to read everything. You only have to read what matters to you.'],
    ['t', 'Rest is part of the work, not a break from it.'],
    ['t', 'One tab at a time is still a way to get through a hundred.'],
    ['t', 'Curiosity is a fine reason to open a page.'],
    ['t', 'Closing a tab is allowed. The page will still be on the internet.'],
    ['t', 'A short walk is a very good plugin.'],
    ['t', 'Done and imperfect is a better draft than perfect and unfinished.'],
    ['t', 'Today only needs to be a good day, not a record-setting one.'],
    ['t', 'Make the next step so small that it is hard to say no to.'],
    ['t', 'It is fine to be a beginner at something again.'],
    ['t', 'Slow is a speed too.'],
    ['t', 'The best time to take a break is a little before you need it.'],
    ['t', 'Write it down, and your head has more room for the rest.'],
    ['t', 'A clear question is half of its answer.'],
    ['t', 'Ask for help earlier than feels comfortable.'],
    ['t', 'Not every message needs an answer today.'],
    ['t', 'Notice one thing that went well before you open the list of what is left.'],
    ['t', 'The queue will still be there; so will you.'],
    ['t', 'Quiet is also a setting.'],
    ['t', 'Start where you are, with what you have.'],
    ['t', 'Boring work done calmly beats exciting work done in a hurry.'],
    ['t', 'You can change your mind and the plan will survive.'],
    ['t', 'A good habit is just a decision you only have to make once.'],
    ['t', 'Fewer things, done properly, add up to more.'],
    ['t', 'Say no to one thing today and see how the day feels.'],
    ['t', 'Drink some water. Everything else can wait a minute.'],
    ['t', 'Your attention is yours; spend it where you would choose to.'],
    ['t', 'Messy notes now are worth more than perfect notes never.'],
    ['t', 'If it takes two minutes, it is often quicker to do than to remember.'],
    ['t', 'The first ten minutes are the hardest. After that it is just work.'],
    ['t', 'Look up from the screen and find the farthest thing you can see.'],
    ['t', 'A finished list is nice, but a calm evening is nicer.'],
    ['t', 'You are allowed to leave a page unread.'],
    ['t', 'Some days the win is simply turning up.'],
    ['t', 'Good tools should get out of your way.'],
    ['t', 'Today is a fine day to delete something you no longer need.'],
    ['t', 'Patience is a way of paying attention.'],
    ['t', 'Make it work, then make it kind to the next person, who may be you.'],
    ['t', 'There is no inbox so full that one message at a time does not help.'],
    ['t', 'A bookmark is a promise; keep the ones you mean.'],
    ['t', 'You learn a lot from the things that did not go as planned.'],
    ['t', 'Stretch your shoulders. They have been holding the whole internet up.'],
    ['t', 'A plan in pencil is still a plan.'],
    ['t', 'Choose one thing to finish before lunch.'],
    ['t', 'It is quieter when you do not check.'],
    ['t', 'Be as kind to your future self as you would be to a friend.'],
    ['t', 'Sometimes the most productive thing is to close the laptop.'],
    ['t', 'Take the long way once in a while.'],
    ['t', 'Praise in public, fix in private, and write both down.'],
    ['t', 'Trust the process less than you trust a good night of sleep.'],
    ['t', 'Perfect is a moving target. Good enough holds still.'],
    ['t', 'What you pay attention to grows. Choose gently.'],
    ['t', 'A clean desk is nice. A clear mind is nicer.'],
    ['t', 'There is always one more interesting link. You may skip it.'],
    ['t', 'Begin before you feel ready; ready tends to arrive after.'],
    ['t', 'Do the hardest thing while you still have the most energy.'],
    ['t', 'Be curious about people, even in the comments. Especially there. Maybe not there.'],
    ['t', 'You do not owe the internet your whole afternoon.'],
    ['t', 'A well-timed pause is worth ten rushed minutes.'],
    ['t', 'The day does not need a headline.'],
    ['t', 'Small and steady wins more often than loud and quick.'],
    ['t', 'Check the thing you have been putting off. It is usually smaller up close.'],
    ['t', 'Let one task be good enough today.'],
    ['t', 'Come back to it with fresh eyes. It will have changed, or you will.'],
    ['t', 'Give yourself the same patience you give a slow download.'],
    ['t', 'A thank-you takes ten seconds and lasts all day.'],
    ['t', 'It is okay to want a simpler day.'],
    ['t', 'If everything is urgent, nothing is; pick one.'],
    ['t', 'Read one good thing slowly instead of ten things quickly.'],
    ['t', 'Not knowing yet is how knowing starts.'],
    ['t', 'Keep a short list. It is the long ones that get abandoned.'],
    ['t', 'Make room for a surprise today.'],
    ['t', 'You are probably doing better than your to-do list suggests.'],
    ['t', 'Plant a small thing today and see what grows by Friday.'],
    ['t', 'The best shortcut is knowing where you are going.'],
    ['t', 'Wherever you are in the work, a cup of tea makes it a little warmer.'],
    ['t', 'Every expert closed a lot of tabs on the way.'],
    ['t', 'Rain on the window is a perfect reason to read something long.'],
    ['t', 'Tidy up a corner of your day and call it progress.'],
    ['t', 'The work is easier to see after you step back from it.'],
    ['t', 'Stop when it is going well; tomorrow starts easy.'],
    ['t', 'Remember the reason you started this, then take a sip of water.'],
    ['t', 'An unanswered email is not a debt. It is an email.'],
    ['t', 'Treat a good idea like a guest: write down its name before it leaves.'],
    ['t', 'Today is as good a day as any to be a little kinder.'],
    ['t', 'You can make a decision and still keep the door ajar.'],
    ['t', 'A well-chosen word saves a paragraph.'],
    ['t', 'Leave the last page of the day unwritten.'],
    ['t', 'Sometimes the answer is to ask a better question.'],
    ['t', 'A gentle reminder: you have already done a lot.'],
    ['t', 'Pick something small to be proud of today.'],
    ['t', 'No one has ever regretted a short stretch outside.'],
    ['t', 'You can only read so many tabs at once. Pick the one that sparks something.'],
    ['t', 'Make friends with the word later.'],
    ['t', 'Good morning, or good whatever time it is where you are.'],
    ['t', 'A habit does not need a streak to count.'],

    // Tips about Vex (each verified against the shortcut list)
    ['k', 'Press Ctrl+K and type what you want; the command bar does the rest.'],
    ['k', 'Ctrl+Shift+K shows every key Vex answers to, the relevant ones first.'],
    ['k', 'Ctrl+Alt+K saves the page you are on for later.'],
    ['k', 'Alt+Q takes you back to the last tab you used.'],
    ['k', 'Ctrl+Shift+T brings back the tab you just closed.'],
    ['k', 'Ctrl+Alt+F starts focus mode.'],
    ['k', 'Ctrl+J asks Vex AI a quick question without opening a panel.'],
    ['k', 'Ctrl+Alt+B opens your Library: everything you saved.'],
    ['k', 'Ctrl+Alt+X opens the Toolbox, a drawer of small useful tools.'],
    ['k', 'Ctrl+Alt+E lists everything Vex can do.'],
    ['k', 'Ctrl+Shift+Z puts a tab to sleep to free its memory.'],
    ['k', 'Ctrl+Shift+S splits the screen so two pages sit side by side.'],
    ['k', 'Ctrl+Alt+M frees memory right now.'],
    ['k', 'Ctrl+Alt+R switches to reading mode: just the words.'],
    ['k', 'Ctrl+Alt+S takes a screenshot.'],
    ['k', 'Ctrl+Alt+A repeats the last command-bar command.'],
    ['k', 'Ctrl+Alt+W watches the page you are on for changes.'],
    ['k', 'Ctrl+Alt+C clips what you selected into Notes.'],
    ['k', 'Ctrl+Alt+G translates the page you are on.'],
    ['k', 'Ctrl+Alt+J opens your downloads.'],
    ['k', 'Ctrl+Shift+G asks Vex to organise your tabs into groups.'],
    ['k', 'Ctrl+Shift+Y opens the theme picker.'],
    ['k', 'Ctrl+Shift+O opens the sessions menu.'],
    ['k', 'Ctrl+Alt+L locks Vex when you step away.'],
    ['k', 'Ctrl+Alt+N opens a private window.'],
    ['k', 'Ctrl+Shift+PageUp and Ctrl+Shift+PageDown move the current tab along the strip.'],
    ['k', 'Ctrl+B shows or hides the tabs sidebar.'],
    ['k', 'Ctrl+M mutes the tab in front.'],
    ['k', 'F11 toggles full screen.'],
    ['k', 'Every key in Vex can be changed in Settings if you would like a different one.'],
    ['k', 'Ctrl+Alt+P opens your logins and 2FA codes.'],
    ['k', 'Ctrl+Alt+T shows the tasks that are running.'],
    ['k', 'The Ctrl+K command bar also opens addresses, so you may never need the address bar again.'],
    ['k', 'Ctrl+Shift+A opens the AI panel.'],
    ['k', 'Ctrl+Shift+M shows which tabs are using the most memory.'],
    ['k', 'Ctrl+H opens your history.'],
    ['k', 'Ctrl+Shift+P pops the video out into a small floating window.'],
    ['k', 'Ctrl+Shift+L shows your scheduled tasks and reminders.'],
    ['k', 'The Fun and expression settings hold the jingle, this line, and the key trainer.'],
    ['k', 'Ctrl+Alt+D lets you dictate: you speak, Vex types.'],

    // Puns and light lines
    ['p', 'I would tell you a joke about tabs, but I have too many of them open.'],
    ['p', 'Why did the browser go to therapy? Too many unresolved cookies.'],
    ['p', 'A bookmark walks into a bar. The bartender says, we saved you a seat.'],
    ['p', 'I asked the address bar for directions. It said: go straight, then slash.'],
    ['p', 'The cache and I have a lot in common: we both hold on to things we should let go.'],
    ['p', 'The tab said it would only take a minute. That was three hours ago.'],
    ['p', 'My to-do list and I are on speaking terms again.'],
    ['p', 'Refresh the page. Not the whole page, just you.'],
    ['p', 'What do you call a very organised browser? Well-tabbed.'],
    ['p', 'Why was the keyboard so calm? It had everything under control.'],
    ['p', 'A tab never forgets, but it does hibernate.'],
    ['p', 'The URL went on a diet. It lost its query string.'],
    ['p', 'I would make a pun about HTTP, but I am not sure it would get a response.'],
    ['p', 'What do you call a browser that never crashes? A good listener.'],
    ['p', 'Why do programmers prefer dark mode? Because light attracts bugs.'],
    ['p', 'A pop-up walked into a bar and the bouncer closed it.'],
    ['p', 'Some say the cloud is just someone else\'s computer. I say: lovely weather today.'],
    ['p', 'My sleep schedule is like a sleeping tab: it wakes up when something clicks.'],
    ['p', 'Once you have a dozen windows open, it is a pane in the neck.'],
    ['p', 'The mouse said it would be right back. It is now a cursor of habit.'],
    ['p', 'Why did the function stay home? It had too many arguments.'],
    ['p', 'A password walked in and the bouncer said: you are not strong enough.'],
    ['p', 'The download bar sighed: I am only ninety-nine percent of the way there.'],
    ['p', 'I am reading about anti-gravity. It is impossible to put down.'],
    ['p', 'When in doubt, scroll it out.'],
    ['p', 'Be the tab you wish to see in the strip.'],
    ['p', 'There are ten kinds of people: those who read the fortune and those who skip it.'],
    ['p', 'The only thing worse than a slow page is a slow page with a cookie banner.'],
    ['p', 'The early bird gets the worm, but the second mouse gets the cheese. Plan accordingly.'],
    ['p', 'Alt-Tab: because one window was never enough.'],
    ['p', 'The clock on the wall said: I have a lot of time for you.'],
    ['p', 'Debugging is like being the detective in a crime movie where you are also the murderer.'],
    ['p', 'What did the tab say to the window? You complete me, in a slightly cluttered way.'],
    ['p', 'The new tab page is a blank canvas. Mostly of weather.'],
    ['p', 'I would never ask a tab to do something it cannot undo.'],
    ['p', 'My battery is at one percent, but my optimism is fully charged.'],
    ['p', 'The spellchecker and I are on different pages, but we are working it out.'],
    ['p', 'The coffee machine and the browser have this in common: both run best warmed up.'],
    ['p', 'I keep a lot of tabs open. It is called commitment issues with closing.'],
    ['p', 'Do not worry, the internet is just a series of tubes with delusions of grandeur.'],
    ['p', 'A new tab a day keeps the boredom away.'],
    ['p', 'Why was the little tab sad? It always felt a bit left of the others.'],
    ['p', 'Keep calm and press Ctrl+K.'],
    ['p', 'Hover is just click practising.'],
    ['p', 'I would tell you a UDP joke, but you might not get it.'],
    ['p', 'The command bar took a poll; ninety percent said: just type it.'],
    ['p', 'This page is intentionally left helpful.'],
    ['p', 'I tried to organise my tabs, and now I have organised tabs and a lot of free time.'],
    ['p', 'A well-named folder is a small act of kindness.'],
    ['p', 'The scroll bar went on holiday, and it came back a little shorter.'],
    ['p', 'The mouse pad said to the mouse: you are always on the move, but I am here.'],
    ['p', 'The bookmark folder called Misc is now taking applications for a second Misc.'],
    ['p', 'The ad blocker gets a quiet nod of respect from the page.'],
    ['p', 'My favourite exercise is a cross between a lunge and a crunch: I call it lunch.'],
    ['p', 'The screenshot is worth a thousand tabs.'],
    ['p', 'The history panel remembers everything. The back button forgives everything.'],
    ['p', 'Nothing to see here, just a very organised pile of things to see later.'],
    ['p', 'Have you tried turning your tabs off and on again?'],
    ['p', 'Why did the user bring a ladder? To reach the top of the page.'],
    ['p', 'I am not procrastinating; I am doing background research on later.'],
    ['p', 'This line has been proofread by a team of one very small, very tired editor.'],
    ['p', 'The reading list asked: have you met my cousin, the someday pile?'],
    ['p', 'A little-known fact: the Escape key is also a small vacation.'],
    ['p', 'If you are reading this, you have already done the most important thing today: opened Vex.'],
    ['p', 'Tab complete.'],
    ['p', 'Sorry, I am busy mastering the art of staying on one page.'],
    ['p', 'Behind every great page is a very patient server.'],

    // More thoughts to round the list out
    ['t', 'Take one thing off the list that has been there too long, either by doing it or by deciding not to.'],
    ['t', 'Today, pick the kind option.'],
    ['t', 'Your best work often arrives while you are doing something else. Go for a walk.'],
    ['t', 'It is worth knowing when you are done.'],
    ['t', 'A quiet five minutes can reorder an entire afternoon.'],
    ['t', 'Everything gets simpler when you know what you are not doing.'],
    ['t', 'The next right thing is usually small.'],
    ['t', 'Listen to the song you like. Work will wait the length of one song.'],
    ['t', 'A page you can leave is a page you can enjoy.'],
    ['t', 'Make one thing a little better than you found it.'],
    ['t', 'Be where your feet are, even when your tabs are elsewhere.'],
    ['t', 'You have survived every difficult day so far, which is a strong record.'],
    ['t', 'Get the sunlight if there is any going.'],
    ['t', 'Some questions are best left in a notebook until they are ready.'],
    ['t', 'Not everything has to be optimised. Some things can just be pleasant.'],
    ['t', 'You are not behind. You are on your own schedule.'],
    ['t', 'Tomorrow is a fresh page, and you are already getting the pen ready.'],
    ['t', 'Take the stairs, metaphorically.'],
    ['t', 'It is a small day when you do not have to carry the whole week.'],
    ['t', 'One clear sentence is better than a tangled page.'],
  ].map(([kind, text]) => ({ kind, text })),

  DAY_MS: 24 * 3600 * 1000,

  // Days since a fixed local date, so the number changes at local midnight.
  dayNumber(date) {
    const d = date instanceof Date ? date : new Date(date);
    return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / this.DAY_MS);
  },

  dayKey(date) {
    const d = date instanceof Date ? date : new Date(date);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  },

  _gcd(a, b) { return b ? this._gcd(b, a % b) : a; },

  // Pure. A step that is coprime to n visits every index once before any
  // repeats, so a line is not shown twice until all of them have been.
  indexFor(date, n) {
    if (!Number.isInteger(n) || n < 1) throw new Error('There are no lines to choose from');
    let step = 37;
    while (this._gcd(step, n) !== 1) step += 2;
    return (((this.dayNumber(date) % n) * (step % n)) % n + n) % n;
  },

  // Lines from installed Vex Packs (js/packs-consumers.js): in memory only.
  _pack: [],
  setPackLines(list) {
    this._pack = (Array.isArray(list) ? list : [])
      .filter(e => e && typeof e.text === 'string' && e.text.trim())
      .slice(0, 100)
      .map(e => ({ kind: 't', text: e.text.slice(0, 280) + (e.by ? ' - ' + String(e.by).slice(0, 60) : '') }));
    return this._pack.length;
  },

  today(date) {
    const when = date || new Date();
    const lines = this.LINES.concat(this._pack);
    const line = lines[this.indexFor(when, lines.length)];
    return { text: line.text, kind: line.kind, day: this.dayKey(when) };
  },

  isEnabled() {
    const v = VexExpression.read(this.KEY, null);
    return !!(v && v.on === true);
  },

  setEnabled(on) {
    if (typeof on !== 'boolean') throw new Error('On or off');
    VexExpression.write(this.KEY, { on });
    try { document.dispatchEvent(new CustomEvent('vex:fortune-changed', { detail: { on } })); } catch { /* no document */ }
  },

  KIND_NAMES: { t: 'A thought', k: 'A tip', p: 'A pun' },

  // Brief module. Never throws into the brief: an unreadable setting just
  // leaves the card out.
  brief: {
    id: 'fortune',
    title: 'Fortune of the day',
    icon: 'sparkles',
    isEnabled() {
      try { return VexFortune.isEnabled() && !VexExpression.gaming() && (typeof VexPlayfulness === 'undefined' || VexPlayfulness.allowed('delight')); }
      catch { return false; }
    },
    build(now) {
      if (!this.isEnabled()) return null;
      const f = VexFortune.today(now instanceof Date ? now : new Date());
      return { id: 'fortune', title: 'Fortune of the day', icon: 'sparkles', lines: [{ text: f.text, detail: VexFortune.KIND_NAMES[f.kind] || '' }] };
    },
  },

  renderSettings(container) {
    const p = document.createElement('p');
    p.className = 'setting-info muted';
    p.style.margin = '0 0 6px';
    p.textContent = 'One short line a day, written by hand and kept inside Vex. It is shown on the Morning Brief. Off until you turn it on.';
    container.appendChild(p);
    container.appendChild(VexExpression.toggleRow('Show a fortune on the Morning Brief', '', this.isEnabled(), (on) => this.setEnabled(on)));
  },
};

if (typeof window !== 'undefined') window.VexFortune = VexFortune;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexFortune };
