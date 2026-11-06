// A stand-in for whisper-cli.exe, started by tests/main/voiceEngine.test.js through node. It opens the file named after -f
// (a named pipe in Vex's real use), reads the WAV from it, and prints what it received so the test can see the audio arrive:
//   "heard <samples> samples sum <checksum> lang <language>"
// FAKE_VOICE_MODE: 'ok' (default), 'hang' (never answers), 'fail' (exit code 3), 'flood' (prints far too much).
const fs = require('fs');
const args = process.argv.slice(2);
const at = (flag) => args[args.indexOf(flag) + 1];
const mode = process.env.FAKE_VOICE_MODE || 'ok';
if (mode === 'hang') { setInterval(() => {}, 1000); return; }
// 'twice': like whisper.cpp, which opens the name once to try one decoder and again for another. The pipe must still be there.
if (mode === 'twice') { fs.readFileSync(at('-f')); }
const wav = fs.readFileSync(at('-f'));
if (wav.toString('latin1', 0, 4) !== 'RIFF') { console.error('not a wav'); process.exit(2); }
if (mode === 'fail') { console.error('model is damaged'); process.exit(3); }
if (mode === 'flood') { setInterval(() => process.stdout.write('x'.repeat(10000)), 5); return; }
const samples = (wav.length - 44) / 2;
let sum = 0;
for (let i = 44; i < wav.length; i++) sum = (sum + wav[i]) % 1000003;
process.stdout.write(` heard ${samples} samples sum ${sum} lang ${at('-l')}\n`);
