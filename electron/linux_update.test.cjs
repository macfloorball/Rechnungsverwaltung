'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { probeAppImage, createLinuxInstaller } = require('./linux_update.cjs');
const { createUpdateService } = require('./updates.cjs');
const { updateFixture } = require('../tests/update_fixture.cjs');

async function location(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ttc-appimage-'));
  const target = path.join(root, 'Original AppImage.AppImage'), mount = path.join(root, 'mounted image');
  const header = Buffer.alloc(24); Buffer.from('7f454c460201','hex').copy(header); Buffer.from('414902','hex').copy(header, 8); header.writeUInt16LE(62,18);
  await fs.writeFile(target, header, { mode: 0o700 });
  const app = { isPackaged: true, getAppPath: () => path.join(mount, 'resources/app'), getPath: (key) => key === 'exe' ? path.join(mount, 'ttc-rechnungsverwaltung') : root };
  const env = { APPIMAGE: target, APPDIR: mount };
  const mountInfo = async () => `1 0 0:1 / ${mount.replaceAll(' ', '\\040')} ro,nosuid,nodev - fuse.squashfuse squashfuse ro\n`;
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, target, mount, app, env, mountInfo };
}
const linux = { skip: process.platform !== 'linux' };
test('only owned writable x64 AppImages in a recognized read-only runtime mount qualify', linux, async (t) => {
  const f = await location(t);
  const result = await probeAppImage(f);
  assert.equal(result.target, f.target);
  assert.equal(result.identity.ino, String((await fs.stat(f.target)).ino));
  await assert.rejects(probeAppImage({ ...f, mountInfo: async () => '' }), /INSTALL_UNAVAILABLE/);
  await fs.chmod(f.target, 0o500);
  await assert.rejects(probeAppImage(f), /INSTALL_UNAVAILABLE/);
  await fs.chmod(f.target, 0o700);
  const link = path.join(f.root, 'linked.AppImage'); await fs.symlink(f.target, link);
  await assert.rejects(probeAppImage({ ...f, env: { ...f.env, APPIMAGE: link } }), /INSTALL_UNAVAILABLE/);
  await fs.chmod(f.root, 0o777);
  await assert.rejects(probeAppImage(f), /INSTALL_UNAVAILABLE/);
});

async function fixture(t, extra = {}) {
  const f = updateFixture(), root = await fs.mkdtemp(path.join(os.tmpdir(), 'ttc-linux-install-'));
  const calls = [], holder = { response: 1, safe: true, fail: null };
  const service = createUpdateService({ config: f.config, getToken: async () => f.token, now: () => f.now, transportFactory: () => f.transport });
  await service.check();
  const slot = path.join(root, 'updates/downloads/download-AbC123'), file = path.join(slot, f.packages[1].fileName);
  const downloader = { getVerified: () => ({ file, slot, version: '0.2.0', candidate: service.getCandidate() }), releaseForInstall: () => calls.push('release') };
  const installer = createLinuxInstaller({ config: f.config, app: { isPackaged: true, getPath: () => root, getAppPath: () => root },
    platform: 'linux', now: () => f.now, downloader, getCandidate: service.getCandidate,
    probe: async () => { if (holder.fail === 'location') throw Error('unsupported'); return { target: path.join(root, 'app.AppImage'), identity: {} }; },
    prepare: async () => { calls.push('copy-runtime'); const directory = path.join(root, 'updates/linux-helper-AbC123'); await fs.mkdir(directory, { recursive: true, mode: 0o700 }); return { directory }; },
    helperFactory: (context) => { calls.push('helper'); assert.equal(context.sha256, f.packages[1].sha256); return {
      ready: holder.fail === 'hash' ? Promise.reject(Error('raw path')) : Promise.resolve(),
      commit: async () => calls.push('commit'), launch: () => calls.push('launch'), cancel: () => calls.push('cancel') }; },
    dialog: { showMessageBox: async (_window, options) => { calls.push('confirm'); assert.equal(options.defaultId, 0); return { response: holder.response }; } },
    getMainWindow: () => ({ isDestroyed: () => false, webContents: { executeJavaScript: async (source) => { calls.push(source.startsWith('!') ? 'safe' : source.includes('= true') ? 'freeze' : 'unfreeze'); return holder.safe; } } }),
    getBackend: () => ({ pauseForUpdate: async () => { calls.push('drain'); if (holder.fail === 'drain') throw Error('active writes'); },
      stopForUpdate: async () => { calls.push('stop'); if (holder.fail === 'stop') throw Error('busy'); }, resumeAfterUpdate: async () => calls.push('resume') }),
    restartBackend: async () => calls.push('restart'), exitForUpdate: () => calls.push('quit'), ...extra });
  t.after(async () => { service.stop(); await fs.rm(root, { recursive: true, force: true }); });
  await installer.recovery();
  calls.length = 0;
  return { installer, calls, holder, root, service };
}
test('Linux consent stages a private helper, drains and stops before committing replacement', linux, async (t) => {
  const f = await fixture(t); assert.equal(f.installer.canInstall('0.2.0'), true);
  await f.installer.install('0.2.0');
  assert.deepEqual(f.calls, ['safe', 'confirm', 'safe', 'freeze', 'copy-runtime', 'helper', 'drain', 'stop', 'commit', 'release', 'launch', 'quit']);
  assert.equal(f.installer.getStatus().state, 'install_handoff');
  assert.equal(JSON.stringify(f.installer.getStatus()).includes(f.root), false);
});
test('manual fallback never asks for root or starts a helper', linux, async (t) => {
  const f = await fixture(t); f.holder.fail = 'location'; await f.installer.recovery();
  assert.equal(f.installer.canInstall('0.2.0'), false);
  assert.match(f.installer.getPolicy().message, /manuell/);
  await assert.rejects(f.installer.install('0.2.0'), /INSTALL_UNAVAILABLE/);
  assert.deepEqual(f.calls, []);
});
test('cancel and active forms preserve the running application', linux, async (t) => {
  const f = await fixture(t); f.holder.response = 0; await f.installer.install('0.2.0');
  assert.equal(f.calls.includes('copy-runtime'), false);
  f.holder.safe = false; await f.installer.install('0.2.0');
  assert.equal(f.installer.getStatus().error.code, 'INSTALL_BUSY');
  assert.equal(f.calls.includes('drain'), false);
});
for (const failure of ['hash', 'drain', 'stop']) test(`${failure} failure cannot replace or quit and resumes the old app`, linux, async (t) => {
  const f = await fixture(t); f.holder.fail = failure; await f.installer.install('0.2.0');
  assert.equal(f.installer.getStatus().state, 'error');
  assert.equal(f.calls.includes('launch'), false); assert.equal(f.calls.includes('quit'), false);
  assert.equal(f.calls.includes(failure === 'stop' ? 'restart' : 'resume'), true);
});


test('successful version confirmation removes only its private helper and download slot', linux, async (t) => {
  const f = await fixture(t);
  const updates = path.join(f.root, 'updates');
  await fs.mkdir(path.join(updates, 'linux-helper-AbC123'), { recursive: true, mode: 0o700 });
  await fs.chmod(updates, 0o700);
  await fs.mkdir(path.join(updates, 'downloads/download-AbC123'), { recursive: true });
  await fs.writeFile(path.join(f.root, 'personal.db'), 'unchanged');
  await fs.writeFile(path.join(updates, 'linux-install-state.json'), JSON.stringify({ formatVersion: 1, phase: 'replaced', version: '0.1.0', helper: 'linux-helper-AbC123', download: 'download-AbC123' }));
  await f.installer.recovery();
  assert.equal(f.installer.getStatus(), null);
  await assert.rejects(fs.stat(path.join(updates, 'linux-helper-AbC123')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(updates, 'downloads/download-AbC123')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(f.root, 'personal.db'), 'utf8'), 'unchanged');
});

test('startup removes only private staging directories with matching app and target markers', linux, async (t) => {
  const { cleanupLinuxStages } = require('./linux_update.cjs');
  const f = await location(t);
  const own = path.join(f.root, '.ttc-rechnungsverwaltung-update-' + 'a'.repeat(24));
  const foreign = path.join(f.root, '.ttc-rechnungsverwaltung-update-' + 'b'.repeat(24));
  for (const directory of [own, foreign]) {
    await fs.mkdir(directory, { mode: 0o700 });
    await fs.writeFile(path.join(directory, 'image.part'), 'partial', { mode: 0o600 });
    await fs.writeFile(path.join(directory, '.owner.json'), JSON.stringify({ formatVersion: 1, appId: 'de.mac-floorball.ttc-rechnungsverwaltung', originalName: directory === own ? path.basename(f.target) : 'another.AppImage' }), { mode: 0o600 });
  }
  await cleanupLinuxStages(f.target);
  await assert.rejects(fs.stat(own), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(foreign, 'image.part'), 'utf8'), 'partial');
});
