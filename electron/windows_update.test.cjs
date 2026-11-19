'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { createWindowsInstaller, startWindowsHelper, checkWindowsUpdateLock } = require('./windows_update.cjs');
const { createUpdateService } = require('./updates.cjs');
const { updateFixture } = require('../tests/update_fixture.cjs');

async function fixture(t, extra = {}) {
  const f = updateFixture('win32'), profile = await fs.mkdtemp(path.join(os.tmpdir(), 'ttc-win-update-'));
  const slot = path.join(profile, 'updates', 'downloads', 'download-AbC123');
  await fs.mkdir(slot, { recursive: true });
  const file = path.join(slot, f.packages[0].fileName);
  await fs.writeFile(file, Buffer.alloc(f.packages[0].size));
  const service = createUpdateService({ config: f.config, getToken: async () => f.token, transportFactory: () => f.transport, now: () => f.now });
  await service.check();
  const calls = [], holder = { safe: true, response: 1, fail: null, context: null };
  const downloader = { getVerified: () => ({ slot, file, version: '0.2.0', candidate: service.getCandidate() }),
    releaseForInstall: (value) => { assert.equal(value, file); calls.push('release'); } };
  const backend = { pauseForUpdate: async () => { calls.push('drain'); if (holder.fail === 'drain') throw Error('secret'); },
    stopForUpdate: async () => { calls.push('stop'); if (holder.fail === 'stop') throw Error('secret'); },
    resumeAfterUpdate: async () => calls.push('resume') };
  const installer = createWindowsInstaller({ config: f.config, platform: 'win32', now: () => f.now, downloader, getCandidate: service.getCandidate,
    app: { isPackaged: true, getPath: (key) => key === 'userData' ? profile : path.join(profile, 'Program', 'TT Rechnungsverwaltung.exe') },
    getMainWindow: () => ({ isDestroyed: () => false, webContents: { executeJavaScript: async (code) => {
      calls.push(code.startsWith('!') ? 'safe' : code.includes('= true') ? 'freeze' : 'unfreeze'); return holder.safe;
    } } }),
    dialog: { showMessageBox: async (_window, options) => { calls.push('confirm'); assert.equal(options.defaultId, 0); return { response: holder.response }; } },
    getBackend: () => backend, restartBackend: async () => calls.push('restart'), exitForUpdate: () => calls.push('quit'),
    helperFactory: (context) => { calls.push('helper'); holder.context = context; return {
      ready: holder.fail === 'signature' ? Promise.reject(Error('secret path')) : Promise.resolve(),
      commit: async () => { calls.push('commit'); if (holder.fail === 'commit') throw Error('secret'); },
      launch: () => calls.push('launch'), cancel: () => calls.push('cancel-helper') }; }, ...extra });
  t.after(async () => { service.stop(); await fs.rm(profile, { recursive: true, force: true }); });
  return { installer, holder, calls, profile, file, service };
}

test('Windows handoff is confirmed, drained, stopped and committed before package release and quit', async (t) => {
  const f = await fixture(t);
  assert.equal(f.installer.canInstall('0.2.0'), true);
  await f.installer.install('0.2.0');
  assert.deepEqual(f.calls, ['safe', 'confirm', 'safe', 'freeze', 'helper', 'drain', 'stop', 'commit', 'release', 'launch', 'quit']);
  assert.equal(f.installer.getStatus().state, 'install_handoff');
  assert.equal(JSON.stringify(f.installer.getStatus()).includes(f.profile), false);
  assert.equal(f.holder.context.file, f.file);
  assert.ok(f.holder.context.requiredFiles.includes('electron/bootstrap.cjs'));
  assert.equal(f.holder.context.windowsMode, 'authenticode-required');
  assert.equal(f.holder.context.trust.repositoryId, 1447003404);
  assert.match(f.holder.context.publicKeyPem, /^-----BEGIN PUBLIC KEY-----/);
  assert.equal(f.holder.context.commit, 'c'.repeat(40));
  assert.match(f.holder.context.installKey, /HKCU:.*da941357/);
});

test('cancellation and busy work never start a helper or shut down the backend', async (t) => {
  const f = await fixture(t); f.holder.response = 0;
  await f.installer.install('0.2.0');
  assert.equal(f.calls.includes('helper'), false); assert.equal(f.calls.includes('stop'), false);
  f.calls.length = 0; f.holder.safe = false;
  await f.installer.install('0.2.0');
  assert.equal(f.installer.getStatus().error.code, 'INSTALL_BUSY');
  assert.equal(f.calls.includes('confirm'), false); assert.equal(f.calls.includes('helper'), false);
});

for (const failure of ['signature', 'drain', 'stop', 'commit']) test(`${failure} failure cannot hand off or quit, and restores the old application`, async (t) => {
  const f = await fixture(t); f.holder.fail = failure;
  await f.installer.install('0.2.0');
  assert.equal(f.installer.getStatus().state, 'error');
  assert.equal(f.calls.includes('quit'), false); assert.equal(f.calls.includes('release'), false);
  assert.equal(f.calls.includes('cancel-helper'), true);
  assert.equal(f.calls.at(-1), 'unfreeze');
  assert.equal(JSON.stringify(f.installer.getStatus()).includes('secret'), false);
  assert.equal(f.calls.includes(['stop', 'commit'].includes(failure) ? 'restart' : 'resume'), true);
});

test('wrong platform, expired trust, stale versions and incomplete files cannot prepare installation', async (t) => {
  const disabled = await fixture(t, { platform: 'linux' });
  assert.equal(disabled.installer.canInstall('0.2.0'), false);
  await assert.rejects(disabled.installer.install('0.2.0'), /INSTALL_UNAVAILABLE/);
  const f = await fixture(t);
  assert.equal(f.installer.canInstall('0.1.0'), false);
  await fs.truncate(f.file, 20);
  await f.installer.install('0.2.0');
  assert.equal(f.calls.includes('helper'), false);
});

test('journal detects failed or interrupted installation and accepts only matching completed version', async (t) => {
  const f = await fixture(t), journal = path.join(f.profile, 'updates', 'windows-install-state.json');
  await fs.writeFile(journal, JSON.stringify({ formatVersion: 1, phase: 'handoff', version: '0.2.0' }));
  await f.installer.recovery(); assert.equal(f.installer.getStatus().error.code, 'INSTALL_INCOMPLETE');
  f.installer.reset();
  await fs.writeFile(journal, JSON.stringify({ formatVersion: 1, phase: 'installed', version: '0.1.0' }));
  await f.installer.recovery(); assert.equal(f.installer.getStatus(), null);
  await assert.rejects(fs.stat(journal), { code: 'ENOENT' });
  await checkWindowsUpdateLock(f.profile);
});

test('native helper uses the bundled relay and fixed system executable with context only on stdin', async () => {
  const child = new EventEmitter(), stdout = new EventEmitter(), stdin = new EventEmitter();
  const writes = [];
  stdout.setEncoding = () => {}; stdout.destroy = () => {};
  stdin.write = (value) => writes.push(value); stdin.end = (value) => { if (value) writes.push(value); }; child.stdin = stdin; child.stdout = stdout;
  child.kill = () => {}; child.unref = () => {};
  const secretPath = 'C:\\profile\\literal `$code.exe';
  const pythonPath = 'C:\\Program Files\\TTC\\runtime\\python\\python.exe';
  const helper = startWindowsHelper({ file: secretPath }, { pythonPath, systemRoot: 'C:\\Windows', spawnImpl: (file, args, options) => {
    assert.equal(file, pythonPath);
    assert.equal(args[4], 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.equal(options.detached, true);
    assert.equal(options.shell, false);
    assert.equal(Buffer.from(args.at(-1), 'base64').toString('utf16le').includes(secretPath), false);
    return child;
  } });
  assert.equal(JSON.parse(writes[0]).file, secretPath);
  stdout.emit('data', 'TTC_UPDATE_READY\n'); await helper.ready;
  const commit = helper.commit(); stdout.emit('data', 'TTC_UPDATE_COMMITTED\n'); await commit;
  const launch = helper.launch(); stdout.emit('data', 'TTC_UPDATE_LAUNCHED\n'); child.emit('exit', 0); await launch;
  assert.equal(writes[1], 'commit\n');
  assert.equal(writes[2], 'launch\n');
});

test('Windows PowerShell parses the static helper and unsigned verifier without executing them', (t) => {
  if (process.platform !== 'win32') return t.skip('Native Windows PowerShell parser requires Windows');
  const { execFileSync } = require('node:child_process');
  for (const text of [require('./windows_update_helper.cjs'), require('node:fs').readFileSync(path.join(__dirname, '../scripts/windows_unsigned.ps1'), 'utf8')]) {
  const source = Buffer.from(text, 'utf16le').toString('base64');
  const program = `$errors = $null; $tokens = $null; [void][System.Management.Automation.Language.Parser]::ParseInput([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${source}')), [ref]$tokens, [ref]$errors); if ($errors.Count) { throw 'Helper syntax invalid' }`;
  execFileSync(path.win32.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'], { input: program, timeout: 20000, windowsHide: true });
  }
});

test('Windows PowerShell reads stdin through the detached Python launcher', { skip: process.platform !== 'win32', timeout: 20000 }, async () => {
  const { execFileSync, spawn } = require('node:child_process');
  const pythonPath = execFileSync('python', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
  let output = '';
  const helper = startWindowsHelper({}, { pythonPath, spawnImpl(file, args, options) {
    const child = spawn(file, args, options);
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    return child;
  } });
  try {
    await assert.rejects(helper.ready, { code: 'INSTALL_UNAVAILABLE' });
    assert.match(output, /TTC_UPDATE_REJECTED/);
  } finally {
    helper.cancel();
  }
});

test('Windows launcher keeps the handoff pipe open until PowerShell accepts launch', { skip: process.platform !== 'win32', timeout: 20000 }, async () => {
  const { execFileSync, spawn } = require('node:child_process');
  const pythonPath = execFileSync('python', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
  const protocol = Buffer.from(`
if ([Console]::In.ReadLine() -cne '{}') { exit 1 }
[Console]::Out.WriteLine('TTC_UPDATE_READY'); [Console]::Out.Flush()
if ([Console]::In.ReadLine() -cne 'commit') { exit 1 }
[Console]::Out.WriteLine('TTC_UPDATE_COMMITTED'); [Console]::Out.Flush()
if ([Console]::In.ReadLine() -cne 'launch') { exit 1 }
[Console]::Out.WriteLine('TTC_UPDATE_LAUNCHED'); [Console]::Out.Flush()
Start-Sleep -Milliseconds 500
`, 'utf16le').toString('base64');
  const helper = startWindowsHelper({}, { pythonPath, spawnImpl(file, args, options) {
    return spawn(file, [...args.slice(0, -1), protocol], options);
  } });
  try {
    await helper.ready;
    await helper.commit();
    await helper.launch();
  } finally {
    helper.cancel();
  }
});

test('Windows update registry identity remains the existing NSIS app GUID', () => {
  const { UUID } = require('builder-util-runtime');
  const { installerConfig } = require('../scripts/installer_config.cjs');
  const { GUID } = require('./windows_update.cjs');
  const config = installerConfig(path.join(__dirname, '..'), require('../package.json'));
  assert.equal(config.nsis.guid || UUID.v5(config.appId, UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3')), GUID);
});

test('a verified download loses install capability when the active signed offer is invalidated', async (t) => {
  const f = await fixture(t);
  await f.service.invalidate();
  assert.equal(f.installer.canInstall('0.2.0'), false);
  await assert.rejects(f.installer.install('0.2.0'), /INSTALL_UNAVAILABLE/);
  assert.equal(f.calls.includes('helper'), false);
});
