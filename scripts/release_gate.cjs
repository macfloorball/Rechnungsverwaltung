'use strict';
const path = require('node:path');
const { appendFileSync } = require('node:fs');
const { windowsMode } = require('../electron/windows_trust.cjs');
const { loadPolicy, validatePolicy } = require('./release_policy.cjs');
const { getDesktopRelease } = require('./desktop_release.cjs');
const { validateReleaseMetadata } = require('../electron/version.cjs');
const { githubAPI } = require('./github_api.cjs');

async function checkGate(api, policy, release) {
  validatePolicy(policy);
  validateReleaseMetadata(release, release.version);
  if (release.channel !== 'stable') throw Error('Nur stabile Desktop-Tags sind freigabefähig.');
  const base = `/repos/${policy.repository}`;
  const repository = await api.request('GET', base);
  if (repository.id !== policy.repositoryId || repository.full_name !== policy.repository
      || repository.private !== (policy.visibility === 'private') || repository.archived) {
    throw Error('Repository-Identität oder freigegebene Sichtbarkeit hat sich geändert.');
  }
  const branch = await api.request('GET', `${base}/branches/Entwicklung-App`);
  if (!branch.protected) throw Error('Entwicklung-App ist nicht geschützt.');
  const ancestry = await api.request('GET', `${base}/compare/${release.commit}...Entwicklung-App`);
  if (!['identical', 'ahead'].includes(ancestry.status)) throw Error('Release-Commit gehört nicht zum freigegebenen Entwicklungsbranch.');
  let ref = await api.request('GET', `${base}/git/ref/tags/${release.tag}`);
  for (let depth = 0; ref.object.type === 'tag' && depth < 5; depth++) {
    ref = await api.request('GET', `${base}/git/tags/${ref.object.sha}`);
  }
  if (ref.object.type !== 'commit' || ref.object.sha !== release.commit) throw Error('Release-Tag wurde verändert.');
  const environment = await api.request('GET', `${base}/environments/${policy.environment}`);
  if (environment.can_admins_bypass !== false) throw Error('Administrator-Bypass des Release-Environments ist aktiv oder nicht nachgewiesen.');
  if (!environment.protection_rules?.some((rule) => rule.type === 'required_reviewers' && rule.reviewers?.length > 0)
      || environment.deployment_branch_policy?.custom_branch_policies !== true) throw Error('Geschützte manuelle Release-Freigabe fehlt.');
  const deployments = await api.pages(`${base}/environments/${policy.environment}/deployment-branch-policies`, 'branch_policies');
  if (deployments.length !== 1 || deployments[0].type !== 'tag' || deployments[0].name !== 'desktop-v*') {
    throw Error('Release-Environment darf ausschließlich desktop-v*-Tags zulassen.');
  }
  const rulesets = await api.pages(`${base}/rulesets`);
  let protectedTags = false;
  for (const ruleset of rulesets.filter((rule) => rule.target === 'tag' && rule.enforcement === 'active')) {
    const rule = await api.request('GET', `${base}/rulesets/${ruleset.id}`);
    if (rule.conditions?.ref_name?.include?.includes('refs/tags/desktop-v*') && rule.conditions.ref_name.exclude?.length === 0
        && ['creation', 'update', 'deletion'].every((type) => rule.rules?.some((item) => item.type === type))) protectedTags = true;
  }
  if (!protectedTags) throw Error('Geschützte Desktop-Tags mit Erstellungs-, Änderungs- und Löschsperre fehlen.');
  const runs = await api.pages(`${base}/actions/workflows/desktop-ci.yml/runs?head_sha=${release.commit}&branch=Entwicklung-App&event=push&status=success`, 'workflow_runs');
  const required = ['Tests (ubuntu-24.04)', 'Tests (windows-2025)', 'Windows NSIS x64 build', 'Linux AppImage x64 build'];
  let successful = false;
  for (const run of runs) {
    if (run.head_sha !== release.commit || run.head_branch !== 'Entwicklung-App' || run.event !== 'push'
        || run.status !== 'completed' || run.conclusion !== 'success' || run.head_repository?.id !== policy.repositoryId) continue;
    const jobs = await api.pages(`${base}/actions/runs/${run.id}/jobs`, 'jobs');
    if (required.every((name) => jobs.some((job) => job.name === name && job.conclusion === 'success'))) successful = true;
  }
  if (!successful) throw Error('Erfolgreiche vollständige Desktop-CI für genau diesen Entwicklungscommit fehlt.');
  return release;
}

if (require.main === module) {
  (async () => {
    const root = path.join(__dirname, '..');
    const policy = loadPolicy(root);
    if (process.env.GITHUB_EVENT_NAME !== 'push' || process.env.GITHUB_REF_TYPE !== 'tag'
        || process.env.GITHUB_REPOSITORY !== policy.repository || process.env.GITHUB_REF_NAME !== process.env.TTC_DESKTOP_RELEASE_TAG) {
      throw Error('Produktiver Release benötigt ein Tag-Push-Ereignis im konfigurierten Repository.');
    }
    const release = getDesktopRelease(root);
    await checkGate(githubAPI(process.env.DESKTOP_POLICY_READ_TOKEN || process.env.GITHUB_TOKEN), policy, release);
    if (process.env.GITHUB_OUTPUT) {
      const runner = windowsMode(policy.windows) === 'ed25519-only'
        ? ['windows-2025'] : ['self-hosted', 'Windows', 'X64', 'desktop-release-signing'];
      appendFileSync(process.env.GITHUB_OUTPUT, `windowsRunner=${JSON.stringify(runner)}\n`);
    }
    console.log(`Release-Voraussetzungen geprüft: ${release.tag} (${release.commit})`);
  })().catch((error) => { console.error(`Release gesperrt: ${error.message}`); process.exitCode = 1; });
}
module.exports = { checkGate };
