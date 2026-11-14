'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verify, createPublicKey } = require('node:crypto');
const { publish } = require('./publish_desktop.cjs');
const { sha256 } = require('./release_bundle.cjs');
const { releaseFixture } = require('../tests/release_fixture.cjs');

function fixture({ existing = [], corrupt = false, extraAsset = false, gateFailure = false } = {}) {
  const { policy, privateKey } = releaseFixture();
  const release = { formatVersion: 1, version: '1.2.3', channel: 'stable', tag: 'desktop-v1.2.3', commit: 'c'.repeat(40) };
  const receipt = { status: 'Valid', timestamped: true, version: release.version, certificateSha256: policy.windows.certificateSha256, publisherSubject: policy.windows.publisherSubject };
  const packages = ['win32', 'linux'].map((platform) => {
    const bytes = Buffer.alloc(1000001, platform === 'win32' ? 1 : 2);
    return { platform, arch: 'x64', packageFormat: platform === 'win32' ? 'nsis' : 'appimage',
      fileName: `ttc-rechnungsverwaltung-1.2.3-${platform === 'win32' ? 'windows-x64-setup.exe' : 'linux-x64.AppImage'}`,
      bytes, size: bytes.length, sha256: sha256(bytes), ...(platform === 'win32' ? { windowsSignature: receipt } : {}) };
  });
  const events = [];
  const assets = [];
  let gates = 0;
  const api = {
    async pages(route) {
      if (route.endsWith('/assets')) return extraAsset ? [...assets, { id: 9999, name: 'private-source.zip' }] : assets;
      return existing;
    },
    async request(method, route, options) {
      events.push({ method, route, body: options?.body });
      if (method === 'PATCH') return { draft: false, prerelease: false, tag_name: release.tag, html_url: 'https://github.com/fixture/release' };
      if (route.includes('/assets?')) {
        const name = decodeURIComponent(route.split('?name=')[1]);
        const asset = { id: assets.length + 101, name, size: options.body.length, state: 'uploaded', bytes: options.body };
        assets.push(asset);
        return asset;
      }
      return { id: 100, draft: true, tag_name: release.tag };
    },
    async verifyAsset(_repository, asset, expected) {
      events.push({ method: 'VERIFY', name: asset.name });
      assert.equal(sha256(asset.bytes), expected.sha256);
      if (corrupt) throw Error('Tampered upload');
    },
  };
  const options = { api, policy, release, packages, notes: 'Reviewed release notes', key: privateKey, now: new Date('2026-11-14T12:00:00Z'),
    gate: async () => { gates++; if (gateFailure) throw Error('Not approved'); } };
  return { options, events, assets, gates: () => gates };
}

test('only a complete release with verified uploads and real Ed25519 manifest signature becomes stable, as the last mutation', async () => {
  const f = fixture();
  await publish(f.options);
  assert.equal(f.assets.length, 6);
  assert.equal(f.gates(), 2);
  assert.equal(f.events.at(-1).method, 'PATCH');
  assert.deepEqual(f.events.at(-1).body, { draft: false, prerelease: false, make_latest: 'false' });
  assert.equal(f.events.filter((event) => event.method === 'VERIFY').length, 6);
  const manifest = f.assets.find((file) => file.name === 'desktop-update.json').bytes;
  const signature = f.assets.find((file) => file.name === 'desktop-update.json.sig').bytes;
  assert.equal(verify(null, manifest, createPublicKey(f.options.policy.publicKeyPem), signature), true);
  assert.deepEqual(JSON.parse(manifest).artifacts.map((file) => file.assetId), [101, 102]);
});

test('missing authorization, existing release or newer stable release causes no remote mutation', async () => {
  for (const settings of [{ gateFailure: true }, { existing: [{ tag_name: 'desktop-v1.2.3', id: 1 }] },
    { existing: [{ tag_name: 'desktop-v2.0.0', id: 2, draft: false, prerelease: false }] }]) {
    const f = fixture(settings);
    await assert.rejects(publish(f.options));
    assert.equal(f.events.length, 0);
  }
});

test('failed upload verification or an extra unapproved asset leaves the release a draft', async () => {
  for (const settings of [{ corrupt: true }, { extraAsset: true }]) {
    const f = fixture(settings);
    await assert.rejects(publish(f.options));
    assert.equal(f.events[0].body.draft, true);
    assert.equal(f.events.some((event) => event.method === 'PATCH'), false);
  }
});

test('missing platform or wrong signing key fails before network mutation', async () => {
  for (const change of [{ packages: [] }, { key: releaseFixture().privateKey }]) {
    const f = fixture();
    await assert.rejects(publish({ ...f.options, ...change }));
    assert.equal(f.events.length, 0);
  }
});

test('authorization withdrawn after upload prevents stable publication', async () => {
  const f = fixture();
  let checks = 0;
  await assert.rejects(publish({ ...f.options, gate: async () => { if (++checks > 1) throw Error('Approval revoked'); } }));
  assert.equal(f.events.some((event) => event.method === 'PATCH'), false);
});
