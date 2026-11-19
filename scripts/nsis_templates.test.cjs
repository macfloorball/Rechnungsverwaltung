'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { prepareNsisTemplates, withNsisTemplates } = require('./nsis_templates.cjs');

test('private NSIS templates replace all uncertain plugins and preserve stock signing', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ttc-nsis-templates-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const util = require('app-builder-lib/out/targets/nsis/nsisUtil');
  const original = util.nsisTemplatesDir;
  const before = await fs.readFile(path.join(original, 'include/installer.nsh'));
  await assert.rejects(withNsisTemplates(path.join(root, 'copy'), async () => {
    assert.notEqual(util.nsisTemplatesDir, original);
    for (const name of ['include/installer.nsh', 'uninstaller.nsh']) {
      const patched = await fs.readFile(path.join(util.nsisTemplatesDir, name), 'utf8');
      assert.doesNotMatch(patched, /WinShell::/);
      assert.match(patched, /!insertmacro TTC_/);
    }
    assert.deepEqual(await fs.readFile(path.join(original, 'include/installer.nsh')), before);
    assert.deepEqual(await fs.readFile(path.join(util.nsisTemplatesDir, 'installer.nsi')),
      await fs.readFile(path.join(original, 'installer.nsi')));
    throw Error('deliberate compiler failure');
  }), /deliberate compiler failure/);
  assert.equal(util.nsisTemplatesDir, original);
  const hooks = await fs.readFile(path.join(__dirname, '../build/windows/installer.nsh'), 'utf8');
  assert.doesNotMatch(hooks, /nsProcess::/);
  const changed = path.join(root, 'changed');
  await fs.cp(original, changed, { recursive: true });
  await fs.appendFile(path.join(changed, 'include/installer.nsh'), '\n; upstream change');
  await assert.rejects(prepareNsisTemplates(path.join(root, 'refused'), changed), /template changed/);
  assert.equal(createHash('sha256').update(before).digest('hex'), '0e319437dd01dcbf911f3f48f664fde0cefbaef704f1cdb1739f63d563f5d4a0');
});
