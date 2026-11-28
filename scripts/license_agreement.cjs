'use strict';
const { createHash } = require('node:crypto');
// Versioned canonicalization: packaging may add a UTF-8 BOM or use CRLF.
function agreementHash(text) {
  return createHash('sha256').update('ttc-agreement-v1\n')
    .update(text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')).digest('hex');
}
function needsAgreement(accepted, text) { return accepted !== agreementHash(text); }
module.exports = { agreementHash, needsAgreement };
