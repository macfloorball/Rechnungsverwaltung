'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

// ReportLab 5.1.0 ships these Adobe/Monotype metrics and font programs together.
const excludedReportLabFonts = [
  '_a______.afm', '_a______.pfb',
  '_ab_____.afm', '_ab_____.pfb',
  '_abi____.afm', '_abi____.pfb',
  '_ai_____.afm', '_ai_____.pfb',
  '_eb_____.afm', '_eb_____.pfb',
  '_ebi____.afm', '_ebi____.pfb',
  '_ei_____.afm', '_ei_____.pfb',
  '_er_____.afm', '_er_____.pfb',
  'cob_____.afm', 'cob_____.pfb',
  'cobo____.afm', 'cobo____.pfb',
  'com_____.afm', 'com_____.pfb',
  'coo_____.afm', 'coo_____.pfb',
  'sy______.afm', 'sy______.pfb',
  'zd______.afm', 'zd______.pfb',
  'zx______.afm', 'zx______.pfb',
  'zy______.afm', 'zy______.pfb',
];

async function copyDesktopRuntime(runtime, destination, platform) {
  const pythonLibrary = platform === 'win32' ? 'Lib' : path.join('lib', 'python3.13');
  const excluded = new Set(excludedReportLabFonts.map((name) =>
    path.join(pythonLibrary, 'site-packages', 'reportlab', 'fonts', name)));
  await fs.cp(runtime, destination, {
    recursive: true,
    filter: (source) => !excluded.has(path.relative(runtime, source)),
  });
}

module.exports = { copyDesktopRuntime };
