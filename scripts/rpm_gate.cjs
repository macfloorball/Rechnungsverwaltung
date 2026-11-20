'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { rpmRelease } = require('./rpm_package.cjs');
const { githubAPI } = require('./github_api.cjs');
function loadRpmPolicy(root) {
  const policy = JSON.parse(fs.readFileSync(path.join(root, 'rpm-repository-policy.json')));
  if (policy.formatVersion !== 1 || policy.enabled !== true) throw Error('Produktive RPM-Veröffentlichung ist noch gesperrt.');
  if (policy.repository !== 'macfloorball/Rechnungsverwaltung' || policy.repositoryId !== 1447003404
      || policy.environment !== 'rpm-repository' || policy.baseUrl !== 'https://macfloorball.github.io/Rechnungsverwaltung/rpm/'
      || !/^[A-F0-9]{40}$/.test(policy.keyFingerprint || '') || !/^[a-f0-9]{64}$/.test(policy.publicKeySha256 || '')
      || policy.publicKeyFile !== 'build/linux/rpm/RPM-GPG-KEY-ttc.asc') throw Error('Ungültige RPM-Vertrauenskonfiguration.');
  const file = path.join(root, policy.publicKeyFile);
  if (!fs.lstatSync(file).isFile() || createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== policy.publicKeySha256) throw Error('RPM-Vertrauensanker geändert.');
  return policy;
}
async function checkRpmGate(api, policy, release) {
  if (release.channel !== 'stable' || release.tag !== `rpm-v${release.version}-${release.release}` || !/^[a-f0-9]{40}$/.test(release.commit)) throw Error('Exakter RPM-Tag erforderlich.');
  const base = `/repos/${policy.repository}`;
  const repository = await api.request('GET', base);
  if (repository.id !== policy.repositoryId || repository.full_name !== policy.repository || repository.private || repository.archived) throw Error('RPM-Repository-Identität geändert.');
  const branch = await api.request('GET', `${base}/branches/Entwicklung-App`);
  if (!branch.protected) throw Error('Entwicklungsbranch ist nicht geschützt.');
  const ancestry = await api.request('GET', `${base}/compare/${release.commit}...Entwicklung-App`);
  if (!['ahead', 'identical'].includes(ancestry.status)) throw Error('RPM-Commit gehört nicht zum Entwicklungsbranch.');
  let ref = await api.request('GET', `${base}/git/ref/tags/${release.tag}`);
  for (let i = 0; ref.object.type === 'tag' && i < 5; i++) ref = await api.request('GET', `${base}/git/tags/${ref.object.sha}`);
  if (ref.object.type !== 'commit' || ref.object.sha !== release.commit) throw Error('RPM-Tagziel geändert.');
  const pages = await api.request('GET', `${base}/pages`);
  if (pages.build_type !== 'workflow' || pages.html_url !== policy.baseUrl.slice(0, -4) || pages.https_enforced !== true) throw Error('GitHub Pages mit HTTPS ist nicht eingerichtet.');
  for (const name of ['rpm-repository', 'github-pages']) {
    const environment = await api.request('GET', `${base}/environments/${name}`);
    if (environment.can_admins_bypass !== false || !environment.deployment_branch_policy?.custom_branch_policies
        || !environment.protection_rules?.some(r => r.type === 'required_reviewers' && r.reviewers?.length > 0)) throw Error('Geschützte RPM-/Pages-Freigabe fehlt.');
    const deployments = await api.pages(`${base}/environments/${name}/deployment-branch-policies`, 'branch_policies');
    if (deployments.length !== 1 || deployments[0].type !== 'tag' || deployments[0].name !== 'rpm-v*') throw Error('RPM-/Pages-Environment muss ausschließlich RPM-Tags zulassen.');
  }
  const rulesets = await api.pages(`${base}/rulesets`); let tagsProtected = false;
  for (const entry of rulesets.filter(r => r.target === 'tag' && r.enforcement === 'active')) {
    const rule = await api.request('GET', `${base}/rulesets/${entry.id}`);
    if (rule.conditions?.ref_name?.include?.includes('refs/tags/rpm-v*') && rule.conditions.ref_name.exclude?.length === 0
        && ['creation', 'update', 'deletion'].every(type => rule.rules?.some(r => r.type === type))) tagsProtected = true;
  }
  if (!tagsProtected) throw Error('RPM-Tagschutz fehlt.');
  const runs = await api.pages(`${base}/actions/workflows/desktop-ci.yml/runs?head_sha=${release.commit}&branch=Entwicklung-App&event=push&status=success`, 'workflow_runs');
  const required = ['Tests (ubuntu-24.04)', 'Tests (windows-2025)', 'Windows NSIS x64 build', 'Linux AppImage x64 build', 'Fedora RPM repository acceptance'];
  let complete = false;
  for (const run of runs) {
    if (run.head_sha !== release.commit || run.head_branch !== 'Entwicklung-App' || run.event !== 'push' || run.status !== 'completed' || run.conclusion !== 'success' || run.head_repository?.id !== policy.repositoryId) continue;
    const jobs = await api.pages(`${base}/actions/runs/${run.id}/jobs`, 'jobs');
    if (required.every(name => jobs.some(j => j.name === name && j.conclusion === 'success'))) complete = true;
  }
  if (!complete) throw Error('Vollständige CI einschließlich nativer DNF-Abnahme für genau diesen Commit fehlt.');
  return release;
}
module.exports = { loadRpmPolicy, checkRpmGate };
if (require.main === module) (async () => {
  const root = path.join(__dirname, '..'); const policy = loadRpmPolicy(root);
  if (process.env.GITHUB_EVENT_NAME !== 'push' || process.env.GITHUB_REF_TYPE !== 'tag' || process.env.GITHUB_REPOSITORY !== policy.repository
      || process.env.GITHUB_REF_NAME !== process.env.TTC_RPM_RELEASE_TAG) throw Error('RPM-Tag-Push im festgelegten Repository erforderlich.');
  const release = rpmRelease(root, { release: Number(process.env.TTC_RPM_RELEASE_NUMBER) });
  await checkRpmGate(githubAPI(process.env.DESKTOP_POLICY_READ_TOKEN || process.env.GITHUB_TOKEN), policy, release);
  console.log(`RPM-Freigabebedingungen geprüft: ${release.tag} (${release.commit})`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
