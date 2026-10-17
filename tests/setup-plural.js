// The plural helper (js/vex-plural.js) is a global in the app, loaded by index.html before the modules that use it.
// A test that loads one of those modules alone gets it from here.
globalThis.VexPlural = require('../src/renderer/js/vex-plural.js').VexPlural;
