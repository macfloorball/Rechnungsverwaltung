'use strict';
// Missing mode preserves the historical Authenticode requirement, never relaxes it.
function windowsMode(windows) {
  const mode = windows?.mode === undefined ? 'authenticode-required' : windows.mode;
  if (!['authenticode-required', 'ed25519-only'].includes(mode)) throw Error('Ungültiger Windows-Vertrauensmodus.');
  if (mode === 'ed25519-only' && ['certificateSha1', 'certificateSha256', 'publisherSubject', 'timestampUrl']
    .some((field) => windows[field] != null)) throw Error('Ed25519-only darf keine Authenticode-Identität enthalten.');
  return mode;
}
function validWindowsReceipt(receipt, windows, version) {
  const mode = windowsMode(windows);
  return receipt?.version === version && (mode === 'ed25519-only'
    ? receipt.status === 'NotSigned' && receipt.timestamped === false && receipt.certificateSha256 === null && receipt.publisherSubject === null
    : receipt.status === 'Valid' && receipt.timestamped === true && receipt.certificateSha256 === windows.certificateSha256
      && receipt.publisherSubject === windows.publisherSubject);
}
module.exports = { windowsMode, validWindowsReceipt };
