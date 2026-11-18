'use strict';
const path = require('node:path');
const { windowsMode, validWindowsReceipt } = require('../electron/windows_trust.cjs');
const { execFileSync } = require('node:child_process');
const { parseVersion } = require('../electron/version.cjs');

function authenticode(file, policy, sign = false, expectedVersion) {
  if (process.platform !== 'win32') throw Error('Produktive Windows-Signierung und -Verifikation benötigen Windows.');
  parseVersion(expectedVersion);
  const win = policy.windows;
  if (windowsMode(win) === 'ed25519-only') {
    const result = execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-File',
      path.join(__dirname, 'windows_unsigned.ps1'), '-Path', path.resolve(file), '-ExpectedVersion', expectedVersion],
      { encoding: 'utf8', timeout: 30000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const receipt = JSON.parse(result.trim());
    if (!validWindowsReceipt(receipt, win, expectedVersion)) throw Error('Unsignierter Windows-Nachweis ist ungültig.');
    return receipt;
  }
  const result = execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-File',
    path.join(__dirname, 'windows_authenticode.ps1'), '-Mode', sign ? 'Sign' : 'Verify',
    '-Path', path.resolve(file), '-CertificateSha1', win.certificateSha1,
    '-CertificateSha256', win.certificateSha256, '-PublisherSubject', win.publisherSubject,
    '-TimestampUrl', win.timestampUrl, '-ExpectedVersion', expectedVersion], { encoding: 'utf8', timeout: 180000, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'] });
  const receipt = JSON.parse(result.trim());
  if (receipt.status !== 'Valid' || receipt.certificateSha256 !== win.certificateSha256
      || receipt.publisherSubject !== win.publisherSubject || receipt.timestamped !== true || receipt.version !== expectedVersion) {
    throw Error('Windows-Signatur wurde nicht vertrauenswürdig verifiziert.');
  }
  return receipt;
}
module.exports = { authenticode };
