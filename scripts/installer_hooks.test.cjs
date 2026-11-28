'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');

test('NSIS compiles installation and data-protection hooks', async (t) => {
  if (!process.env.TTC_MAKENSIS || !process.env.TTC_NSIS_PLUGINS) return t.skip('Set TTC_MAKENSIS and TTC_NSIS_PLUGINS for hook compilation');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-nsis-hooks-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'check.nsi');
  const executable = path.join(directory, 'check.exe');
  const registryKey = `Software\\TTC-hook-check-${randomUUID()}`;
  fs.writeFileSync(filename, `
Unicode true
!include LogicLib.nsh
!include FileFunc.nsh
!addplugindir /x86-unicode "${process.env.TTC_NSIS_PLUGINS}"
!include "${path.join(__dirname, '..', 'node_modules', 'app-builder-lib', 'templates', 'nsis', 'include', 'StdUtils.nsh')}"
!define UNINSTALL_REGISTRY_KEY "${registryKey}"
!define VERSION "0.1.0"
!define APP_EXECUTABLE_FILENAME "TTC-not-running-test.exe"
!include "${path.join(__dirname, '..', 'build', 'windows', 'installer.nsh')}"
Name "TTC hook compilation"
RequestExecutionLevel user
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
  CreateShortCut "$EXEDIR\\hook-check.lnk" "$SYSDIR\\notepad.exe"
  !insertmacro TTC_SetLnkAUMI "$EXEDIR\\hook-check.lnk" "TTC.NativeHookCheck"
  !insertmacro TTC_UninstShortcut "$EXEDIR\\hook-check.lnk"
  !insertmacro TTC_UninstAppUserModelId "TTC.NativeHookCheck"
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
  if (process.platform === 'win32') {
    const run = (exe, args = []) => spawnSync(exe, args, { encoding: 'utf8', timeout: 60000 });
    assert.equal(run(executable, ['/S', '/D=C:\\TTC-hook-data']).status, 4);
    assert.equal(run(executable, ['/S']).status, 0);
    const property = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$s=New-Object -ComObject Shell.Application; $f=$s.NameSpace('${directory.replaceAll("'", "''")}'); $f.ParseName('hook-check.lnk').ExtendedProperty('System.AppUserModel.ID')`]);
    assert.equal(property.status, 0, property.stderr);
    assert.equal(property.stdout.trim(), 'TTC.NativeHookCheck');
    const processCopy = path.join(directory, 'TTC-not-running-test.exe');
    fs.copyFileSync(process.execPath, processCopy);
    const child = spawn(processCopy, ['-e', 'process.stdout.write("ready\\n");setInterval(()=>{},1000)'], { stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => child.kill());
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Process probe did not start')), 10000);
      child.once('error', reject);
      child.stdout.once('data', () => { clearTimeout(timer); resolve(); });
    });
    assert.equal(run(executable, ['/S']).status, 5, 'live app must block file changes');
    const stopped = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await stopped;
    assert.equal(run(executable, ['/S']).status, 0, 'installation resumes after process exit');
    const uninstaller = path.join(directory, 'uninstall-check.exe');
    assert.equal(run(uninstaller, ['/S', '--delete-app-data', `_?=${directory}`]).status, 2);
    const key = `HKCU\\${registryKey.replaceAll('\\\\', '\\')}`;
    try {
      assert.equal(run('reg.exe', ['add', key, '/v', 'DisplayVersion', '/d', '0.2.0', '/f']).status, 0);
      assert.equal(run(executable, ['/S']).status, 3);
    } finally {
      assert.equal(run('reg.exe', ['delete', key, '/f']).status, 0);
    }
  }
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

test('native agreement hooks persist explicit consent and reject missing or changed silent consent', (t) => {
  if (!process.env.TTC_MAKENSIS || !process.env.TTC_NSIS_PLUGINS) return t.skip('NSIS toolchain required');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-native-agreement-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const registryKey = `Software\\TTC-agreement-test-${randomUUID()}`;
  const text = require('./license_agreement.cjs').agreementHash('Testvereinbarung');
  const include = path.join(__dirname, '../build/windows/installer.nsh');
  for (const accept of [false, true]) {
    const script = path.join(root, `${accept ? 'accept' : 'check'}.nsi`);
    fs.writeFileSync(script, `
Unicode true
!include LogicLib.nsh
!include FileFunc.nsh
!addplugindir /x86-unicode "${process.env.TTC_NSIS_PLUGINS}"
!include "${path.join(__dirname, '../node_modules/app-builder-lib/templates/nsis/include/StdUtils.nsh')}"
!define TTC_LICENSE_HASH "${text}"
!define TTC_AGREEMENT_KEY "${registryKey}"
!define UNINSTALL_REGISTRY_KEY "${registryKey}-installation"
!define VERSION "1.0.0"
!include "${include}"
Name "Agreement regression"
OutFile "${path.join(root, accept ? 'accept.exe' : 'check.exe')}"
RequestExecutionLevel user
Function .onInit
  ${accept ? 'Call TTC_LicenseAccepted' : '!insertmacro customInit'}
FunctionEnd
Section
  !insertmacro customInstall
SectionEnd
`);
    const result = spawnSync(process.env.TTC_MAKENSIS, ['-V2', script], {encoding:'utf8',env:{...process.env,NSISDIR:process.env.NSISDIR || path.dirname(path.dirname(process.env.TTC_MAKENSIS))}});
    assert.equal(result.status,0,result.stdout+result.stderr);
  }
  if (process.platform !== 'win32') return; // compilation is not native Windows execution
  const run = (exe, args) => spawnSync(exe,args,{encoding:'utf8',timeout:20000});
  const key = `HKCU\\${registryKey}`;
  t.after(() => run('reg.exe',['delete',key,'/f']));
  const check = () => run(path.join(root,'check.exe'),['/S']);
  assert.equal(check().status,6,'legacy/missing consent requires the interactive page');
  assert.equal(run(path.join(root,'accept.exe'),['/S']).status,0,'test adapter invokes the real license-page leave hook');
  assert.equal(check().status,0,'a fresh process reuses the saved content hash');
  assert.equal(run('reg.exe',['add',key,'/v','AcceptedSHA256','/d','old-content-hash','/f']).status,0);
  assert.equal(check().status,6,'changed agreement cannot be silently accepted');
});
