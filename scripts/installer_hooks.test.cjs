'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('NSIS compiles installation and data-protection hooks', (t) => {
  if (!process.env.TTC_MAKENSIS) return t.skip('Set TTC_MAKENSIS to the NSIS compiler for hook compilation');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-nsis-hooks-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'check.nsi');
  const executable = path.join(directory, 'check.exe');
  fs.writeFileSync(filename, `
!include LogicLib.nsh
!include FileFunc.nsh
!define UNINSTALL_REGISTRY_KEY "Software\\TTC-hook-check"
!define VERSION "0.1.0"
!include "${path.join(__dirname, '..', 'build', 'windows', 'installer.nsh')}"
Name "TTC hook compilation"
Unicode true
OutFile "${executable}"
Var isForceCurrentInstall
Function .onInit
  !insertmacro customInstallMode
  !insertmacro customInit
FunctionEnd
Function un.onInit
  !insertmacro customUnInit
FunctionEnd
Section
  WriteUninstaller "$TEMP\\TTC-hook-uninstaller.exe"
SectionEnd
Section Uninstall
SectionEnd
`);
  const result = spawnSync(process.env.TTC_MAKENSIS, ['-V2', filename], {
    encoding: 'utf8', env: { ...process.env,
      NSISDIR: process.env.NSISDIR || path.dirname(path.dirname(process.env.TTC_MAKENSIS)) },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.readFileSync(executable).subarray(0, 2).toString(), 'MZ');
});
