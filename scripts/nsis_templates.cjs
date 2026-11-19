'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

// Keep electron-builder's standard script and uninstaller signing path. Only a
// private copy of these pinned templates is changed; node_modules is untouched.
const templates = Object.freeze({
  'include/installer.nsh': { sha256: '0e319437dd01dcbf911f3f48f664fde0cefbaef704f1cdb1739f63d563f5d4a0', calls: 7 },
  'uninstaller.nsh': { sha256: '9ee2dac4593478083e8aa6f8487287ce9401006ccd50ecc538871d133ea4a42c', calls: 3 },
});
async function prepareNsisTemplates(destination, source = require('app-builder-lib/out/targets/nsis/nsisUtil').nsisTemplatesDir) {
  if (require('app-builder-lib/package.json').version !== '26.18.0') throw Error('NSIS template version requires review.');
  await fs.cp(source, destination, { recursive: true, errorOnExist: true, force: false });
  for (const [name, expected] of Object.entries(templates)) {
    const file = path.join(destination, name);
    const original = await fs.readFile(file);
    if (createHash('sha256').update(original).digest('hex') !== expected.sha256) throw Error(`NSIS template changed: ${name}`);
    let calls = 0;
    const patched = original.toString('utf8').replace(/WinShell::(SetLnkAUMI|UninstShortcut|UninstAppUserModelId)/g, (_, method) => {
      calls++;
      return `!insertmacro TTC_${method}`;
    });
    if (calls !== expected.calls || patched.includes('WinShell::')) throw Error(`NSIS template calls changed: ${name}`);
    await fs.writeFile(file, patched);
  }
  return destination;
}

async function withNsisTemplates(destination, build) {
  const nsisUtil = require('app-builder-lib/out/targets/nsis/nsisUtil');
  const original = nsisUtil.nsisTemplatesDir;
  const prepared = await prepareNsisTemplates(destination, original);
  nsisUtil.nsisTemplatesDir = prepared;
  try { return await build(); }
  finally { nsisUtil.nsisTemplatesDir = original; }
}
module.exports = { prepareNsisTemplates, withNsisTemplates };
