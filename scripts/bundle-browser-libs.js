const fs = require('fs/promises');
const path = require('path');
async function run() {
  const root = path.resolve(__dirname, '..'), dest = path.join(root, 'src/renderer/vendor/runtime');
  await fs.mkdir(dest, { recursive: true });
  for (const [source, name] of [
    ['@mlc-ai/web-llm/lib/index.js','webllm.mjs'],
    ['tesseract.js/dist/tesseract.esm.min.js','tesseract.mjs'],
    ['tesseract.js/dist/worker.min.js','worker.min.js'],
    ['tesseract.js/LICENSE.md','tesseract-LICENSE'],
    ['@mlc-ai/web-llm/LICENSE','webllm-LICENSE'],
    // Dictation: Whisper through Transformers.js, on WebGPU or WASM. The
    // runtime loads its .wasm from next to itself (wasmPaths = this folder).
    ['@huggingface/transformers/dist/transformers.min.js','transformers.mjs'],
    ['@huggingface/transformers/LICENSE','transformers-LICENSE'],
    ['onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs','ort-wasm-simd-threaded.asyncify.mjs'],
    // onnxruntime-web is MIT (its package.json); the package ships no LICENSE file.
    ['onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm','ort-wasm-simd-threaded.asyncify.wasm'],
  ]) await fs.copyFile(path.join(root, 'node_modules', source), path.join(dest, name));
  // The office-document viewer's unzip (src/renderer/office-viewer, served by main/office-viewer.js as vex-doc://view/lib/...): fflate, MIT.
  // The browser build is one plain script the viewer's worker loads with importScripts. Its own folder, so the viewer's page can reach only this.
  const officeTo = path.join(dest, 'office');
  await fs.rm(officeTo, { recursive: true, force: true });
  await fs.mkdir(officeTo, { recursive: true });
  await fs.copyFile(path.join(root, 'node_modules/fflate/umd/index.js'), path.join(officeTo, 'fflate.js'));
  await fs.copyFile(path.join(root, 'node_modules/fflate/LICENSE'), path.join(dest, 'fflate-LICENSE'));
  const core = path.join(root, 'node_modules/tesseract.js-core');
  // In the browser, worker.min.js loads only the base64-inlined
  // tesseract-core*.wasm.js builds. The plain .wasm files, the Node builds
  // (tesseract-core*.js) and index.js are never requested, so they are not
  // copied, and copies left by an older run of this script are removed.
  for (const file of await fs.readdir(core)) {
    if (file.endsWith('.wasm.js') || file === 'LICENSE') await fs.copyFile(path.join(core, file), path.join(dest, file));
    else if (/\.(?:wasm|js)$/.test(file)) await fs.rm(path.join(dest, file), { force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
