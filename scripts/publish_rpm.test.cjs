'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { publishRpm, newerOrEqual } = require('./publish_rpm.cjs');
function fixture({ existing = [], badUpload = false, extra = false, invalidKey = false, revoke = false } = {}) {
  const release = { version: '0.1.1', release: 2, tag: 'rpm-v0.1.1-2', channel: 'stable', commit: 'a'.repeat(40) };
  const assets = []; const events = []; let checks = 0;
  return { events, assets, options: {
    release, policy: { repository: 'macfloorball/Rechnungsverwaltung', baseUrl: 'https://example.org/rpm/', keyFingerprint: 'A'.repeat(40) },
    gate: async () => { if (revoke && ++checks > 1) throw Error('Revoked'); },
    prepare: async () => {
      if (invalidKey) throw Error('Wrong private key');
      return ['ttc-rechnungsverwaltung-0.1.1-2.x86_64.rpm', 'repository-metadata.tar.gz',
        'ttc-rechnungsverwaltung-0.1.1-2.x86_64.rpm.build.json', 'SHA256SUMS'].map(fileName => ({ fileName, bytes: Buffer.from(fileName) }));
    },
    api: {
      pages: async route => route.endsWith('/assets') ? (extra ? [...assets, { id: 999 }] : assets) : existing,
      verifyAsset: async () => { events.push('VERIFY'); if (badUpload) throw Error('Corrupted upload'); },
      request: async (method, route, options) => {
        events.push(method);
        if (method === 'PATCH') return { draft: false, prerelease: false, tag_name: release.tag };
        if (route.includes('/assets?')) {
          const asset = { id: assets.length + 1, name: decodeURIComponent(route.split('?name=')[1]), size: options.body.length, state: 'uploaded' };
          assets.push(asset); return asset;
        }
        return { id: 100, draft: true, tag_name: release.tag };
      },
    },
  } };
}
test('RPM publication verifies all four assets and publishes last without changing desktop latest', async () => {
  const f = fixture(); await publishRpm(f.options);
  assert.equal(f.assets.length, 4); assert.equal(f.events.filter(x => x === 'VERIFY').length, 4);
  assert.equal(f.events.at(-1), 'PATCH');
});
test('bad signing key and duplicate or newer RPM release cause no remote mutations', async () => {
  for (const settings of [{ invalidKey: true }, { existing: [{ tag_name: 'rpm-v0.1.1-2' }] },
    { existing: [{ tag_name: 'rpm-v0.2.0-1', draft: false, prerelease: false }] }]) {
    const f = fixture(settings); await assert.rejects(publishRpm(f.options)); assert.deepEqual(f.events, []);
  }
  assert.equal(newerOrEqual('desktop-v0.2.0', fixture().options.release), false);
  assert.equal(newerOrEqual('rpm-v0.1.1-3', fixture().options.release), true);
  assert.equal(newerOrEqual('rpm-v0.1.0-99', fixture().options.release), false);
});
test('bad downloads, extra assets and withdrawn authorization leave RPM draft unpublished', async () => {
  for (const settings of [{ badUpload: true }, { extra: true }, { revoke: true }]) {
    const f = fixture(settings); await assert.rejects(publishRpm(f.options)); assert.equal(f.events.includes('PATCH'), false);
  }
});
