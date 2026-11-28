'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { agreementHash, needsAgreement } = require('./license_agreement.cjs');
const { prepareNsisTemplates } = require('./nsis_templates.cjs');
test('agreement identity survives versions, BOM and CRLF, but detects changed terms and missing legacy consent', () => {
  const text = 'Vereinbarung\nBedingungen\n';
  const hash = agreementHash(text);
  assert.equal(needsAgreement(hash, '\uFEFF' + text.replaceAll('\n', '\r\n')), false);
  for (const previous of [undefined, '', 'old-version', agreementHash('Andere Bedingungen')]) assert.equal(needsAgreement(previous, text), true);
  assert.equal(needsAgreement(hash, text + 'Neue Bedingung'), true);
});
test('actual NSIS page uses content decision even for --updated and records only installed consent', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ttc-agreements-'));
  t.after(() => fs.rm(root, {recursive:true, force:true}));
  await prepareNsisTemplates(path.join(root, 'templates'));
  const page = await fs.readFile(path.join(root, 'templates/assistedInstaller.nsh'), 'utf8');
  assert.match(page, /MUI_PAGE_CUSTOMFUNCTION_PRE TTC_LicensePre/);
  assert.match(page, /MUI_PAGE_CUSTOMFUNCTION_LEAVE TTC_LicenseAccepted/);
  assert.doesNotMatch(page, /skipPageIfUpdated\s+!insertmacro licensePage/);
  const hook = await fs.readFile(path.join(__dirname, '../build/windows/installer.nsh'), 'utf8');
  assert.match(hook, /ReadRegStr.*AcceptedSHA256/);
  assert.match(hook, /\$R0 == "\$\{TTC_LICENSE_HASH\}"/);
  assert.match(hook, /ElseIf.*Silent[\s\S]*SetErrorLevel 6/);
  assert.match(hook, /!macro customInstall[\s\S]*WriteRegStr.*AcceptedSHA256/);
});
