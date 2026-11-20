"""Exercise production bundle preparation with disposable keys and a tiny RPM fixture."""
from pathlib import Path
import hashlib
import json
import sys
import tempfile
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.rpm_repository import run, fingerprint
from scripts.prepare_rpm_release import prepare
from scripts.prepare_rpm_repository_site import unpack


def main():
    with tempfile.TemporaryDirectory(prefix='ttc-rpm-publication-probe-') as temporary:
        root = Path(temporary)
        home = root / 'gnupg'; home.mkdir(mode=0o700)
        try:
            run(['gpg', '--homedir', home, '--batch', '--pinentry-mode', 'loopback', '--passphrase', '',
                 '--quick-generate-key', 'TTC disposable publication acceptance', 'rsa3072', 'sign', '1d'])
            private = run(['gpg', '--homedir', home, '--batch', '--armor', '--export-secret-keys']).encode()
            public = root / 'public.asc'; public.write_text(run(['gpg', '--homedir', home, '--armor', '--export']))
            policy = {'repository': 'macfloorball/Rechnungsverwaltung', 'baseUrl': 'https://example.org/rpm/', 'keyFingerprint': fingerprint(public)}
            release = {'formatVersion': 1, 'version': '0.1.1', 'release': 1, 'channel': 'stable', 'tag': 'rpm-v0.1.1-1', 'commit': 'a' * 40}
            spec = root / 'fixture.spec'
            spec.write_text('''Name: ttc-rechnungsverwaltung
Version: 0.1.1
Release: 1
Summary: Disposable publication fixture
License: MIT
BuildArch: x86_64
VCS: git+https://github.com/macfloorball/Rechnungsverwaltung#''' + release['commit'] + '''
%description
Fixture only, never published or installed.
%install
mkdir -p %{buildroot}/usr/share/ttc-publication-fixture
printf fixture > %{buildroot}/usr/share/ttc-publication-fixture/data
%files
/usr/share/ttc-publication-fixture
''')
            run(['rpmbuild', '-bb', '--define', f'_topdir {root}', spec])
            package = next((root / 'RPMS/x86_64').glob('*.rpm'))
            receipt = {**release, 'fileName': package.name, 'size': package.stat().st_size,
                       'sha256': hashlib.sha256(package.read_bytes()).hexdigest()}
            receipt_file = Path(str(package) + '.build.json'); receipt_file.write_text(json.dumps(receipt))
            output = root / 'signed'
            prepare(package, public, output, release, policy, private)
            unpack(output / 'repository-metadata.tar.gz', public, root / 'site', policy['keyFingerprint'], policy['baseUrl'])
            # Existing signed metadata survives a subsequent Pages preparation.
            prepare(package, public, root / 'signed-again', release, policy, private, output / 'repository-metadata.tar.gz')
            receipt_file.write_text(json.dumps({**receipt, 'sha256': '0' * 64}))
            try:
                prepare(package, public, root / 'invalid', release, policy, private)
            except ValueError as error:
                assert 'checksum mismatch' in str(error)
            else:
                raise AssertionError('Corrupted source receipt accepted')
            print('Native RPM publication: signed bundle, Pages verification, metadata history and receipt rejection passed')
        finally:
            run(['gpgconf', '--homedir', home, '--kill', 'gpg-agent'])


if __name__ == '__main__':
    main()
