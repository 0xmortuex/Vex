// The plural helper (js/vex-plural.js) is a global in the app, loaded by index.html before the modules that use it.
// A test that loads one of those modules alone gets it from here.
globalThis.VexPlural = require('../src/renderer/js/vex-plural.js').VexPlural;
// The Turkish-correct search fold (js/vex-tr.js) is a global too: search boxes fold with VexTr.fold so "istanbul" finds "İstanbul".
globalThis.VexTr = require('../src/renderer/js/vex-tr.js').VexTr;
