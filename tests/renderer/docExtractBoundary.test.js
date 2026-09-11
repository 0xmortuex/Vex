// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { DocExtract } from '../../src/renderer/js/doc-extract.js';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete window.VexTabPolicy; });
function source(start = 'https://docs.google.com/document/d/example/edit') {
  let url = start;
  const wv = { capturePage: vi.fn(), getURL: () => url, getAttribute: () => 'persist:work', _navigationGeneration: 1 };
  vi.stubGlobal('WebviewManager', { getActiveWebview: () => wv });
  vi.stubGlobal('TabManager', { getActiveTab: () => ({ url }) });
  return { wv, navigate: () => { url = 'https://other.test'; wv._navigationGeneration++; } };
}
it('extracts Google documents using the source account partition', async () => {
  source();
  const load = vi.spyOn(DocExtract, '_viaHiddenWebview').mockResolvedValue('Document text');
  const show = vi.spyOn(DocExtract, '_showResult').mockImplementation(() => {});
  await DocExtract.run();
  expect(load).toHaveBeenCalledWith('https://docs.google.com/document/d/example/mobilebasic', 'persist:work');
  expect(show).toHaveBeenCalledWith('Document text', 'Google Doc (real text)');
});
it('reads a Google Sheet grid, not its shell, on the source account partition', async () => {
  // A shared sheet is often only viewable while signed in, so the grid must be
  // fetched on the tab's own account - and through the grid reader, since the
  // /htmlview shell alone yields only the title, tab name and scroll arrows.
  source('https://docs.google.com/spreadsheets/d/example/edit');
  const load = vi.spyOn(DocExtract, '_viaHiddenWebview').mockResolvedValue('Name\tId');
  const show = vi.spyOn(DocExtract, '_showResult').mockImplementation(() => {});
  await DocExtract.run();
  expect(load).toHaveBeenCalledTimes(1);
  const [viewUrl, partition, opts] = load.mock.calls[0];
  expect(viewUrl).toBe('https://docs.google.com/spreadsheets/d/example/htmlview');
  expect(partition).toBe('persist:work');
  expect(opts.reader).toContain('table.waffle');
  expect(opts.reader).toContain('trustedTypes');
  expect(show).toHaveBeenCalledWith('Name\tId', 'Google Sheet (real text)');
});
it('discards a document result after the source navigates', async () => {
  const { navigate } = source();
  vi.spyOn(DocExtract, '_viaHiddenWebview').mockImplementation(async () => { navigate(); return 'Previous document'; });
  const show = vi.spyOn(DocExtract, '_showResult').mockImplementation(() => {});
  const ocr = vi.spyOn(DocExtract, '_ocr').mockResolvedValue();
  await DocExtract.run();
  expect(show).not.toHaveBeenCalled();
  expect(ocr).not.toHaveBeenCalled();
});
