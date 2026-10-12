// pdf.js's worker, with what it assumes filled in first. Imports run in order,
// so the polyfills are in place before a line of the worker is evaluated.
import './vex-polyfills.mjs';
import './pdf.worker.min.mjs';
