'use strict';
// Run only in a private, size-limited tmpfs mount namespace. Real ENOSPC,
// no injected filesystem result and no production packages or network requests.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { updateFixture } = require('./update_fixture.cjs');
const { createUpdateService } = require('../electron/updates.cjs');
const { createUpdateDownloader } = require('../electron/update_download.cjs');
(async () => {
  const root = process.env.TTC_TEST_SPACE_DIRECTORY;
  const space = await fs.statfs(root, { bigint: true });
  assert.equal(Number(space.type), 0x01021994);
  assert.ok(space.blocks * space.bsize <= 64n * 1024n * 1024n, 'must be a dedicated small tmpfs');
  const profile = await fs.mkdtemp(path.join(root, 'profile-'));
  const personal = path.join(profile, 'personal.db'); await fs.writeFile(personal, 'unchanged');
  const f = updateFixture();
  const service = createUpdateService({ config: f.config, now: () => f.now, getToken: async () => f.token, transportFactory: () => f.transport });
  assert.equal((await service.check()).state, 'available');
  const filler = path.join(root, 'fill-after-preflight');
  const downloader = createUpdateDownloader({ config: f.config, profile, now: () => f.now,
    getCandidate: service.getCandidate, getToken: async () => f.token, transportFactory: () => ({
      release: async () => f.feedRelease,
      async streamAsset(_id, size, consume) {
        const remaining = await fs.statfs(root, { bigint: true });
        let left = Number(remaining.bavail * remaining.bsize) - 32768;
        const handle = await fs.open(filler, 'wx', 0o600), block = Buffer.alloc(1024 * 1024);
        try { while (left > 0) { const chunk = block.subarray(0, Math.min(left, block.length)); await handle.writeFile(chunk); left -= chunk.length; } }
        finally { await handle.close(); }
        await consume(Buffer.alloc(size));
      },
    }) });
  try {
    downloader.start('0.2.0');
    const deadline = Date.now() + 10000;
    while (downloader.isBusy()) { assert.ok(Date.now() < deadline); await new Promise(r => setTimeout(r, 5)); }
    assert.equal(downloader.getStatus().error.code, 'DOWNLOAD_SPACE');
    assert.deepEqual(await fs.readdir(path.join(profile, 'updates/downloads')), []);
    assert.equal(await fs.readFile(personal, 'utf8'), 'unchanged');
    console.log('NATIVE_ENOSPC_CHECK passed: real disk exhaustion, partial cleanup, local data preserved');
  } finally { await downloader.stop(); service.stop(); await fs.rm(profile, { recursive: true, force: true }); await fs.unlink(filler).catch(() => {}); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
