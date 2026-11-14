'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');

test('NSIS compiles installation and data-protection hooks', (t) => {
  if (!process.env.TTC_MAKENSIS || !process.env.TTC_NSIS_PLUGINS) return t.skip('Set TTC_MAKENSIS and TTC_NSIS_PLUGINS for hook compilation');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-nsis-hooks-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'check.nsi');
  const executable = path.join(directory, 'check.exe');
  const registryKey = `Software\\TTC-hook-check-${randomUUID()}`;
  fs.writeFileSync(filename, `
!include LogicLib.nsh
!include FileFunc.nsh
!addplugindir /x86-unicode "${process.env.TTC_NSIS_PLUGINS}"
!include "${path.join(__dirname, '..', 'node_modules', 'app-builder-lib', 'templates', 'nsis', 'include', 'StdUtils.nsh')}"
!define UNINSTALL_REGISTRY_KEY "${registryKey}"
!define VERSION "0.1.0"
!define APP_EXECUTABLE_FILENAME "TTC-not-running-test.exe"
!include "${path.join(__dirname, '..', 'build', 'windows', 'installer.nsh')}"
Name "TTC hook compilation"
Unicode true
OutFile "${executable}"
Var isForceCurrentInstall
Function .onInit
  !insertmacro customInstallMode
  !insertmacro customInit
  !insertmacro customCheckAppRunning
FunctionEnd
Function un.onInit
  !insertmacro customUnInit
  !insertmacro customCheckAppRunning
FunctionEnd
Section
  WriteUninstaller "$EXEDIR\\uninstall-check.exe"
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
  if (process.env.TTC_WINE && process.env.TTC_WINE_PREFIX) {
    const env = { ...process.env, WINEPREFIX: process.env.TTC_WINE_PREFIX, WINEDEBUG: '-all' };
    const run = (args) => spawnSync(process.env.TTC_WINE, args, { env, encoding: 'utf8', timeout: 60000 });
    const blocked = run([executable, '/S', '/D=C:\\TTC-hook-data']);
    assert.equal(blocked.status, 4, blocked.stdout + blocked.stderr);
    const installed = run([executable, '/S']);
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
    const removed = run([path.join(directory, 'uninstall-check.exe'), '/S', '--delete-app-data', `_?=Z:${directory.replaceAll('/', '\\')}`]);
    assert.equal(removed.status, 2, removed.stdout + removed.stderr);
    const key = `HKCU\\${registryKey}`;
    try {
      assert.equal(run(['reg', 'add', key, '/v', 'DisplayVersion', '/d', '0.2.0', '/f']).status, 0);
      const downgraded = run([executable, '/S']);
      assert.equal(downgraded.status, 3, downgraded.stdout + downgraded.stderr);
    } finally {
      assert.equal(run(['reg', 'delete', key, '/f']).status, 0);
    }
  }
});
