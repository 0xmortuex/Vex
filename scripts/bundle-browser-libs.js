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
  ]) await fs.copyFile(path.join(root, 'node_modules', source), path.join(dest, name));
  const core = path.join(root, 'node_modules/tesseract.js-core');
  for (const file of await fs.readdir(core)) if (/\.(?:wasm|js)$/.test(file) || file === 'LICENSE') await fs.copyFile(path.join(core,file), path.join(dest,file));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
