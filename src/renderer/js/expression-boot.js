// === Expression and fun: start-up wiring ======================================
//
// Loaded last of the expression scripts (index.html). Registers each module
// with the hub (js/vex-expression.js) so the command bar gets its commands
// and Settings gets one "Fun and expression" group, then wires the jingle.
// Nothing here runs a feature: every one is off or asleep until chosen.
(function () {
  if (typeof VexExpression === 'undefined') { console.error('[expression-boot] the hub is not loaded'); return; }
  const X = VexExpression;
  const mods = [
    { id: 'jingle', title: 'Jingle', icon: 'music', mod: typeof VexJingle !== 'undefined' ? VexJingle : null },
    { id: 'fortune', title: 'Fortune of the day', icon: 'sparkles', mod: typeof VexFortune !== 'undefined' ? VexFortune : null },
    { id: 'roulette', title: 'Read Later roulette', icon: 'shuffle', mod: typeof VexRoulette !== 'undefined' ? VexRoulette : null },
    { id: 'speedrun', title: 'Speed-run', icon: 'timer', mod: typeof VexSpeedRun !== 'undefined' ? VexSpeedRun : null },
    { id: 'keytrainer', title: 'Keyboard practice', icon: 'keyboard', mod: typeof VexKeyTrainer !== 'undefined' ? VexKeyTrainer : null },
  ];
  for (const m of mods) {
    if (!m.mod) { console.error('[expression-boot] missing module', m.id); continue; }
    X.register({
      id: m.id, title: m.title, icon: m.icon,
      commands: m.mod.commands,
      brief: m.mod.brief,
      renderSettings: typeof m.mod.renderSettings === 'function' ? (c) => m.mod.renderSettings(c) : null,
    });
  }
  // The roulette has no settings of its own; the others draw theirs.
  try { X.mountSettings(); } catch (err) { console.error('[expression-boot] settings', err); }
  if (typeof VexJingle !== 'undefined') {
    VexJingle.wire();
    VexJingle.startup();
  }
})();
