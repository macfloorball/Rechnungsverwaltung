'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { loadRpmPolicy, checkRpmGate } = require('./rpm_gate.cjs');
const policy = { formatVersion: 1, enabled: true, repository: 'macfloorball/Rechnungsverwaltung', repositoryId: 1447003404,
  environment: 'rpm-repository', baseUrl: 'https://macfloorball.github.io/Rechnungsverwaltung/rpm/',
  keyFingerprint: 'A'.repeat(40), publicKeyFile: 'build/linux/rpm/RPM-GPG-KEY-ttc.asc' };
const release = { formatVersion: 1, version: '0.1.1', release: 1, channel: 'stable', tag: 'rpm-v0.1.1-1', commit: 'a'.repeat(40) };
function api({ missingJob = false, bypass = false, wrongTag = false, unsafePages = false } = {}) {
  return {
    async request(method, route) {
      if (route.endsWith('/Rechnungsverwaltung')) return { id: policy.repositoryId, full_name: policy.repository, private: false };
      if (route.endsWith('/branches/Entwicklung-App')) return { protected: true };
      if (route.includes('/compare/')) return { status: 'ahead' };
      if (route.includes('/git/ref/')) return { object: { type: 'commit', sha: wrongTag ? 'b'.repeat(40) : release.commit } };
      if (route.endsWith('/pages')) return { build_type: 'workflow', html_url: policy.baseUrl.slice(0, -4), https_enforced: !unsafePages };
      if (route.includes('/environments/')) return { can_admins_bypass: bypass, deployment_branch_policy: { custom_branch_policies: true }, protection_rules: [{ type: 'required_reviewers', reviewers: ['owner'] }] };
      if (route.includes('/rulesets/')) return { conditions: { ref_name: { include: ['refs/tags/rpm-v*'], exclude: [] } }, rules: ['creation', 'update', 'deletion'].map(type => ({ type })) };
      throw Error('Unexpected gate request: ' + route);
    },
    async pages(route) {
      if (route.endsWith('/deployment-branch-policies')) return [{ type: 'tag', name: 'rpm-v*' }];
      if (route.endsWith('/rulesets')) return [{ id: 1, target: 'tag', enforcement: 'active' }];
      if (route.includes('/actions/workflows/')) return [{ id: 2, head_sha: release.commit, head_branch: 'Entwicklung-App', event: 'push', status: 'completed', conclusion: 'success', head_repository: { id: policy.repositoryId } }];
      if (route.endsWith('/jobs')) return ['Tests (ubuntu-24.04)', 'Tests (windows-2025)', 'Windows NSIS x64 build', 'Linux AppImage x64 build', ...(missingJob ? [] : ['Fedora RPM repository acceptance'])].map(name => ({ name, conclusion: 'success' }));
      throw Error('Unexpected gate list: ' + route);
    },
  };
}
test('RPM gate requires exact tag, native DNF CI, protected approvals and HTTPS Pages', async () => {
  assert.equal(await checkRpmGate(api(), policy, release), release);
  for (const options of [{ missingJob: true }, { bypass: true }, { wrongTag: true }, { unsafePages: true }]) await assert.rejects(checkRpmGate(api(options), policy, release));
  await assert.rejects(checkRpmGate(api(), policy, { ...release, channel: 'development' }));
});
test('RPM publication remains disabled until the committed public trust anchor is pinned', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-rpm-policy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, policy.publicKeyFile); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'public-key-fixture');
  const pinned = { ...policy, publicKeySha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
  const config = path.join(root, 'rpm-repository-policy.json'); fs.writeFileSync(config, JSON.stringify({ ...pinned, enabled: false }));
  assert.throws(() => loadRpmPolicy(root), /gesperrt/);
  fs.writeFileSync(config, JSON.stringify(pinned)); assert.equal(loadRpmPolicy(root).keyFingerprint, policy.keyFingerprint);
  fs.appendFileSync(file, 'modified'); assert.throws(() => loadRpmPolicy(root), /Vertrauensanker/);
});
