'use strict';
// Real signature/discovery/transport/stream/file/controller/coordinator chain.
// The native OS installer, UI confirmation and process shutdown are adapters;
// these tests never execute Windows installers or overwrite an AppImage.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { createUpdateService } = require('./updates.cjs');
const { createUpdateTransport } = require('./update_transport.cjs');
const { createUpdateDownloader } = require('./update_download.cjs');
const { createUpdateController } = require('./update_controller.cjs');
const { createWindowsInstaller } = require('./windows_update.cjs');
const { createLinuxInstaller } = require('./linux_update.cjs');
const { signedManifest } = require('../scripts/release_bundle.cjs');
const { updateFixture } = require('../tests/update_fixture.cjs');

for (const platform of ['win32', 'linux']) for (const scenario of ['success', 'network-retry', 'signature', 'payload', 'downgrade', 'later', 'install-failure']) {
  test(`${platform}: complete update chain / ${scenario}`, { skip: platform === 'linux' && process.platform !== 'linux' }, async (t) => {
    const f = updateFixture(platform), payload = Buffer.alloc(1000001, 42), calls = [], stages = [];
    if (platform === 'win32') payload.write('MZ');
    else { Buffer.from('7f454c460201','hex').copy(payload); Buffer.from('414902','hex').copy(payload, 8); payload.writeUInt16LE(62,18); }
    const hash = createHash('sha256').update(payload).digest('hex');
    f.packages.find(a => a.platform === platform).sha256 = hash;
    const packet = signedManifest(f.policy, f.release, f.packages, 'Signed integration fixture', f.privateKey, new Date(f.now));
    f.feedRelease.assets.find(a => a.id === 30).size = packet.bytes.length;
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'ttc-pipeline-'));
    const data = path.join(profile, 'ttc.db'), pdf = path.join(profile, 'existing-invoice.pdf');
    await fs.writeFile(data, 'personal data sentinel'); await fs.writeFile(pdf, '%PDF-existing sentinel');
    let online = scenario !== 'network-retry';
    const config = { ...f.config, currentVersion: scenario === 'downgrade' ? '0.3.0' : '0.1.0' };
    const fetchImpl = async (url, options) => {
      calls.push(url);
      if (!online) throw Object.assign(Error('private diagnostic'), { code: 'ENOTFOUND' });
      if (url.startsWith('https://release-assets.githubusercontent.com/')) {
        assert.equal(options.headers.Authorization, undefined);
        const bytes = Buffer.from(payload); if (scenario === 'payload') bytes[100] ^= 1;
        return new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
      }
      assert.equal(options.headers.Authorization, `Bearer ${f.token}`);
      if (url.endsWith('/assets/30')) return new Response(packet.bytes);
      if (url.endsWith('/assets/40')) return new Response(scenario === 'signature' ? Buffer.alloc(64) : packet.signature);
      if (url.includes('/assets/')) return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/pinned-fixture' } });
      if (url.includes('/releases?')) return Response.json([f.feedRelease]);
      if (url.endsWith('/releases/100')) return Response.json(f.feedRelease);
      return Response.json({ id: config.repositoryId, full_name: config.repository, private: true, archived: false });
    };
    const transportFactory = args => createUpdateTransport({ ...args, fetchImpl });
    const service = createUpdateService({ config, now: () => f.now, getToken: async () => f.token, transportFactory, minimumIntervalMs: 0 });
    const downloader = createUpdateDownloader({ config, profile, now: () => f.now, getToken: async () => f.token, getCandidate: service.getCandidate, transportFactory });
    const app = { isPackaged: true, getPath: key => key === 'userData' ? profile : path.join(profile, 'Program/app.exe'), getAppPath: () => profile };
    const options = { config, app, downloader, getCandidate: service.getCandidate, now: () => f.now, platform,
      dialog: { showMessageBox: async () => ({ response: scenario === 'later' ? 0 : 1 }) },
      getMainWindow: () => ({ isDestroyed: () => false, webContents: { executeJavaScript: async () => true } }),
      getBackend: () => ({ pauseForUpdate: async () => stages.push('drain'), stopForUpdate: async () => stages.push('stop'), resumeAfterUpdate: async () => stages.push('resume') }),
      restartBackend: async () => stages.push('restart'), exitForUpdate: () => stages.push('quit'),
      helperFactory: context => ({ ready: (async () => {
        assert.equal(createHash('sha256').update(await fs.readFile(context.file)).digest('hex'), hash);
        assert.equal(context.hash || context.sha256, hash); stages.push('native-ready');
      })(), commit: async () => { stages.push('commit'); if (scenario === 'install-failure') throw Error('native adapter refused'); },
        launch: () => stages.push('launch'), cancel: () => stages.push('cancel') }),
    };
    if (platform === 'linux') Object.assign(options, { probe: async () => ({ target: path.join(profile, 'owned.AppImage'), identity: {} }),
      prepare: async () => { const directory = path.join(profile, 'updates/linux-helper-AbC123'); await fs.mkdir(directory, { recursive: true, mode: 0o700 }); return { directory }; } });
    const installer = (platform === 'linux' ? createLinuxInstaller : createWindowsInstaller)(options);
    const controller = createUpdateController({ service, downloader, installer, credentials: {} });
    t.after(async () => { controller.dispose(); await downloader.stop(); service.stop(); await fs.rm(profile, { recursive: true, force: true }); });
    await installer.recovery();
    if (!online) { assert.equal((await controller.check()).error.code, 'NETWORK'); online = true; }
    const checked = await controller.check();
    if (['signature', 'downgrade'].includes(scenario)) {
      assert.equal(checked.state, scenario === 'signature' ? 'error' : 'up_to_date');
      assert.equal(checked.canDownload, false);
      assert.throws(() => controller.request('0.2.0'), /UPDATE_CHANGED/);
      assert.equal(calls.some(url => /assets\/(10|20)$/.test(url)), false);
    } else {
      assert.equal(checked.state, 'available');
      controller.defer('0.2.0'); assert.equal(controller.getStatus().promptVersion, null);
      assert.equal(calls.some(url => /assets\/(10|20)$/.test(url)), false);
      controller.request('0.2.0');
      const deadline = Date.now() + 5000;
      while (downloader.isBusy()) { assert.ok(Date.now() < deadline); await new Promise(r => setTimeout(r, 5)); }
      if (scenario === 'payload') {
        assert.equal(controller.getStatus().error.code, 'DOWNLOAD_HASH');
        await assert.rejects(controller.install('0.2.0'));
        assert.equal(stages.length, 0);
      } else {
        assert.equal(controller.getStatus().canInstall, true);
        await controller.install('0.2.0');
        if (scenario === 'later') { assert.equal(stages.length, 0); assert.equal(controller.getStatus().canInstall, true); }
        else if (scenario === 'install-failure') { assert.equal(controller.getStatus().state, 'error'); assert.ok(stages.includes('restart')); assert.equal(stages.includes('launch'), false); }
        else { assert.deepEqual(stages, ['native-ready', 'drain', 'stop', 'commit', 'launch', 'quit']); assert.equal(controller.getStatus().state, 'install_handoff'); }
      }
    }
    assert.equal(await fs.readFile(data, 'utf8'), 'personal data sentinel');
    assert.equal(await fs.readFile(pdf, 'utf8'), '%PDF-existing sentinel');
    for (const value of [profile, f.token, 'private diagnostic']) assert.equal(JSON.stringify(controller.getStatus()).includes(value), false);
  });
}
