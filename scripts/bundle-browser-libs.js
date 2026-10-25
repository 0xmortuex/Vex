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
  // The PDF viewer's engine (src/renderer/pdf-viewer, served by main/pdf-viewer.js as vex-pdf://view/lib/...): pdf.js, its
  // page components, the worker, the character maps, the standard fonts and the image decoders it loads on demand.
  // The minified builds are the published ones. Rebuilt from scratch each time, so a file a newer pdf.js dropped goes too.
  const pdfjsFrom = path.join(root, 'node_modules/pdfjs-dist'), pdfjsTo = path.join(dest, 'pdfjs');
  await fs.rm(pdfjsTo, { recursive: true, force: true });
  await fs.mkdir(pdfjsTo, { recursive: true });
  for (const [source, name] of [
    ['build/pdf.min.mjs', 'pdf.mjs'],
    ['build/pdf.worker.min.mjs', 'pdf.worker.mjs'],
    ['web/pdf_viewer.mjs', 'pdf_viewer.mjs'],
    ['web/pdf_viewer.css', 'pdf_viewer.css'],
  ]) await fs.copyFile(path.join(pdfjsFrom, source), path.join(pdfjsTo, name));
  for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) await fs.cp(path.join(pdfjsFrom, folder), path.join(pdfjsTo, folder), { recursive: true });
  await fs.cp(path.join(pdfjsFrom, 'web/images'), path.join(pdfjsTo, 'images'), { recursive: true });
  await fs.copyFile(path.join(pdfjsFrom, 'LICENSE'), path.join(dest, 'pdfjs-LICENSE'));
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
