'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkGate } = require('./release_gate.cjs');
const { releaseFixture } = require('../tests/release_fixture.cjs');

function fixture(patch = {}) {
  const { policy } = releaseFixture();
  const release = { formatVersion: 1, version: '1.2.3', channel: 'stable', tag: 'desktop-v1.2.3', commit: 'c'.repeat(40) };
  const data = {
    repository: { id: policy.repositoryId, full_name: policy.repository, private: true, archived: false },
    branch: { protected: true }, comparison: { status: 'ahead' }, ref: { object: { type: 'commit', sha: release.commit } },
    environment: { can_admins_bypass: false, protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { id: 1 } }] }], deployment_branch_policy: { custom_branch_policies: true } },
    deploymentRules: [{ name: 'desktop-v*', type: 'tag' }],
    rulesets: [{ id: 1, target: 'tag', enforcement: 'active' }],
    ruleset: { conditions: { ref_name: { include: ['refs/tags/desktop-v*'], exclude: [] } }, rules: ['creation', 'update', 'deletion'].map((type) => ({ type })) },
    runs: [{ id: 10, head_sha: release.commit, head_branch: 'Entwicklung-App', event: 'push', status: 'completed', conclusion: 'success', head_repository: { id: policy.repositoryId } }],
    jobs: ['Tests (ubuntu-24.04)', 'Tests (windows-2025)', 'Windows NSIS x64 build', 'Linux AppImage x64 build'].map((name) => ({ name, conclusion: 'success' })),
    ...patch,
  };
  const api = {
    async request(method, route) {
      assert.equal(method, 'GET');
      if (route.endsWith('/branches/Entwicklung-App')) return data.branch;
      if (route.includes('/compare/')) return data.comparison;
      if (route.includes('/git/ref/')) return data.ref;
      if (route.includes('/environments/')) return data.environment;
      if (route.endsWith('/rulesets/1')) return data.ruleset;
      return data.repository;
    },
    async pages(route) {
      if (route.endsWith('/deployment-branch-policies')) return data.deploymentRules;
      if (route.endsWith('/rulesets')) return data.rulesets;
      if (route.endsWith('/jobs')) return data.jobs;
      return data.runs;
    },
  };
  return { api, policy, release, data };
}

test('release authorization requires exact private repository, protected tags, environment and successful native CI', async () => {
  const f = fixture();
  assert.equal(await checkGate(f.api, f.policy, f.release), f.release);
});

test('unapproved commits, changed tags, visibility changes, missing protection and skipped builds block releases', async () => {
  const base = fixture().data;
  for (const patch of [
    { repository: { ...base.repository, private: false } }, { repository: { ...base.repository, id: 1 } },
    { branch: { protected: false } }, { comparison: { status: 'diverged' } },
    { ref: { object: { type: 'commit', sha: 'd'.repeat(40) } } },
    { environment: { protection_rules: [] } }, { deploymentRules: [{ name: '*', type: 'branch' }] },
    { rulesets: [] }, { ruleset: { ...base.ruleset, rules: [{ type: 'creation' }] } },
    { runs: [] }, { runs: [{ ...base.runs[0], head_sha: 'd'.repeat(40) }] },
    { jobs: base.jobs.slice(0, 3) }, { jobs: base.jobs.map((job) => ({ ...job, conclusion: 'skipped' })) },
  ]) {
    const f = fixture(patch);
    await assert.rejects(checkGate(f.api, f.policy, f.release));
  }
});

test('unreadable GitHub protection settings fail closed', async () => {
  const f = fixture();
  f.api.request = async () => { throw Error('HTTP 403'); };
  await assert.rejects(checkGate(f.api, f.policy, f.release), /403/);
});


test('release environment rejects enabled, missing and malformed administrator bypass evidence', async () => {
  const environment = fixture().data.environment;
  for (const value of [true, undefined, null, 'false', 0]) {
    const f = fixture({ environment: { ...environment, can_admins_bypass: value } });
    await assert.rejects(checkGate(f.api, f.policy, f.release), /Administrator-Bypass/);
  }
  const f = fixture({ environment: { ...environment, can_admins_bypass: false } });
  assert.equal(await checkGate(f.api, f.policy, f.release), f.release);
});
