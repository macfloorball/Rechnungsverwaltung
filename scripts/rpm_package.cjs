'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync, execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { prepareWindowsSource: prepareSource } = require('./package_windows.cjs');
const { createInstallationManifest, validateInstallation } = require('../electron/installation.cjs');
const { validateRpmMetadata } = require('../electron/rpm_package.cjs');
const { readPackage } = require('./desktop_release.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const NAME = 'ttc-rechnungsverwaltung';
const HOME = `/usr/libexec/${NAME}`;
function command(name, args, options = {}) {
  const result = spawnSync(name, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw Error(`${name} failed: ${result.error?.message || result.stderr || result.stdout}`);
  return result.stdout.trim();
}
function rpmRelease(root, { tag = process.env.TTC_RPM_RELEASE_TAG || null, release = 1 } = {}) {
  const metadata = readPackage(root);
  if (!Number.isSafeInteger(release) || release < 1 || release > 65535) throw Error('Invalid RPM release number');
  const result = { formatVersion: 1, version: metadata.version, release, channel: 'development', tag: null, commit: null };
  if (tag !== null) {
    const match = /^rpm-v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))-([1-9]\d*)$/.exec(tag);
    if (!match || match[1] !== metadata.version || Number(match[2]) !== release) throw Error('RPM tag/version mismatch');
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    const commit = git('rev-parse', `refs/tags/${tag}^{commit}`);
    if (git('rev-parse', 'HEAD') !== commit || git('status', '--porcelain') || git('rev-parse', '--is-shallow-repository') !== 'false') throw Error('RPM requires exact clean full tag checkout');
    Object.assign(result, { channel: 'stable', tag, commit });
  }
  return result;
}
function spec(version, rpmRevision, guard, commit = null) {
  if (commit !== null && !/^[a-f0-9]{40}$/.test(commit)) throw Error('Invalid RPM source commit');
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^(?:[1-9]\d*|0\.[1-9]\d*\.dev)$/.test(rpmRevision)) throw Error('Invalid RPM NVR');
  return `%global debug_package %{nil}
%global __os_install_post %{nil}
%global _build_id_links none
%global _rpmformat 4
%global _binary_payload w7.zstdio
Name: ${NAME}
Version: ${version}
Release: ${rpmRevision}
Summary: Lokale TT Rechnungsverwaltung
License: MIT AND LicenseRef-TTC-ThirdParty
URL: https://github.com/macfloorball/Rechnungsverwaltung
${commit ? `VCS: git+https://github.com/macfloorball/Rechnungsverwaltung#${commit}\n` : ''}BuildArch: x86_64
AutoReqProv: no
Requires: alsa-lib, at-spi2-atk, cairo, cups-libs, dbus-libs, expat, glib2, glibc >= 2.28
Requires: gtk3, libX11, libXcomposite, libXdamage, libXext, libXfixes, libXrandr, libdrm
Requires: libxcb, libxkbcommon, mesa-libgbm, nspr, nss, pango, libgcc, libstdc++
Requires(pre): /usr/bin/python3
Requires(preun): /usr/bin/python3

%description
Lokale Rechnungsverwaltung mit eingebetteter Python-Laufzeit.
Aktualisierungen werden ausschließlich über DNF verwaltet.
LicenseRef-TTC-ThirdParty bezeichnet die vollständigen beigefügten Drittanbieterhinweise.

%install
mkdir -p %{buildroot}
cp -a %{_sourcedir}/payload/. %{buildroot}/

%pre -p /usr/bin/python3
${guard}

%preun -p /usr/bin/python3
${guard.replace("if __name__ == '__main__':", "if __name__ == '__main__' and int(sys.argv[1]) == 0:")}

%files
%defattr(-,root,root,-)
/usr/bin/${NAME}
${HOME}
/usr/share/applications/${NAME}.desktop
/usr/share/icons/hicolor/512x512/apps/${NAME}.png
%license /usr/share/licenses/${NAME}
`;
}
async function stageRpm(root, extracted, destination, release) {
  const metadata = readPackage(root);
  if (metadata.name !== NAME) throw Error('RPM package name changed');
  const baseApp = path.join(extracted, 'resources/app');
  validateInstallation(baseApp, true, 'linux');
  const baseMetadata = JSON.parse(await fs.readFile(path.join(baseApp, 'package.json')));
  const runtimeInfo = JSON.parse(await fs.readFile(path.join(baseApp, 'packaged-runtime.json')));
  if (baseMetadata.desktopRelease.channel !== 'development' || baseMetadata.version !== metadata.version
      || runtimeInfo.electron !== metadata.devDependencies.electron
      || runtimeInfo.requirementsSha256 !== hash(await fs.readFile(path.join(root, 'requirements-linux.txt')))) throw Error('RPM requires a current verified Linux staging build');
  const runtime = path.join(baseApp, 'runtime/python');
  const manifest = JSON.parse(await fs.readFile(path.join(runtime, 'runtime-manifest.json')));
  if (manifest.requirementsSha256 !== runtimeInfo.requirementsSha256) throw Error('RPM runtime requirements mismatch');
  const app = path.join(destination, HOME.slice(1));
  await fs.mkdir(app, { recursive: true });
  for (const entry of await fs.readdir(extracted, { withFileTypes: true })) {
    if (['resources', 'usr', 'AppRun', '.DirIcon', `${NAME}.png`].includes(entry.name) || entry.name.endsWith('.desktop')) continue;
    if (entry.isSymbolicLink()) throw Error('Unexpected runtime symlink');
    await fs.cp(path.join(extracted, entry.name), path.join(app, entry.name), { recursive: true });
  }
  const source = path.join(app, 'resources/app');
  const desktopRelease = { formatVersion: 1, version: metadata.version, channel: 'development', tag: null, commit: null };
  await prepareSource(root, source, desktopRelease);
  await fs.cp(runtime, path.join(source, 'runtime/python'), { recursive: true });
  const own = JSON.parse(await fs.readFile(path.join(source, 'package.json')));
  Object.assign(own, { ttcDistribution: 'rpm', main: 'electron/bootstrap.cjs', rpmRelease: release });
  validateRpmMetadata(own);
  await fs.writeFile(path.join(source, 'package.json'), JSON.stringify(own, null, 2) + '\n');
  await fs.writeFile(path.join(source, 'packaged-runtime.json'), JSON.stringify(runtimeInfo));
  await fs.writeFile(path.join(source, 'installation-manifest.json'), JSON.stringify(createInstallationManifest(source, 'linux'), null, 2));
  validateInstallation(source, true, 'linux');
  const files = {
    [`usr/bin/${NAME}`]: `#!/bin/sh\nexec ${HOME}/${NAME} "$@"\n`,
    [`usr/share/applications/${NAME}.desktop`]: `[Desktop Entry]\nType=Application\nName=TT Rechnungsverwaltung\nComment=Lokale Rechnungsverwaltung\nExec=${NAME}\nIcon=${NAME}\nTerminal=false\nCategories=Office;Finance;\nStartupWMClass=${NAME}\n`,
  };
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(destination, name); await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, { mode: name.startsWith('usr/bin/') ? 0o755 : 0o644 });
  }
  const icon = path.join(destination, `usr/share/icons/hicolor/512x512/apps/${NAME}.png`);
  await fs.mkdir(path.dirname(icon), { recursive: true });
  await fs.copyFile(path.join(root, 'electron/assets/app-icon.png'), icon);
  const licenses = path.join(destination, `usr/share/licenses/${NAME}`); await fs.mkdir(licenses, { recursive: true });
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await fs.copyFile(path.join(root, name), path.join(licenses, name));
  return { source, metadata, runtimeInfo };
}
async function buildRpm(root, extracted, output, release) {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw Error('RPM build requires Linux x86_64');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ttc-rpm-build-'));
  try {
    const payload = path.join(temporary, 'SOURCES/payload');
    if (!extracted) {
      const desktop = { formatVersion: 1, version: release.version, channel: 'development', tag: null, commit: null };
      const staging = path.join(temporary, 'linux-stage'); await fs.mkdir(staging);
      extracted = (await require('./build_appimage.cjs').prepareLinuxApp(root, staging, desktop)).prepackaged;
    }
    const staged = await stageRpm(root, extracted, payload, release);
    const guard = await fs.readFile(path.join(root, 'build/linux/rpm/process_guard.py'), 'utf8');
    const revision = release.channel === 'stable' ? String(release.release) : `0.${release.release}.dev`;
    const filename = path.join(temporary, 'package.spec'); await fs.writeFile(filename, spec(staged.metadata.version, revision, guard, release.commit));
    command('rpmbuild', ['-bb', '--define', `_topdir ${temporary}`, filename]);
    const directory = path.join(temporary, 'RPMS/x86_64'); const packages = (await fs.readdir(directory)).filter(n => n.endsWith('.rpm'));
    if (packages.length !== 1) throw Error('Exactly one RPM required');
    const bytes = await fs.readFile(path.join(directory, packages[0]));
    await fs.mkdir(output, { recursive: true }); const target = path.join(output, packages[0]);
    await fs.writeFile(target, bytes, { flag: 'wx' });
    await fs.writeFile(target + '.build.json', JSON.stringify({ ...release, runtimeSource: staged.runtimeInfo, fileName: packages[0], sha256: hash(bytes), size: bytes.length }, null, 2) + '\n');
    return target;
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
module.exports = { command, rpmRelease, spec, stageRpm, buildRpm, NAME };
if (require.main === module) {
  const root = path.join(__dirname, '..');
  const releaseNumber = Number(process.env.TTC_RPM_RELEASE_NUMBER || 1);
  buildRpm(root, null, path.resolve(process.argv[2] || path.join(root, 'dist/rpm')), rpmRelease(root, { release: releaseNumber }))
    .then(file => console.log(file)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
