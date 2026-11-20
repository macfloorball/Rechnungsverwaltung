"""Bind an unsigned RPM to its source receipt, then create a signed release bundle."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import tarfile
import tempfile
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.rpm_repository import run, fingerprint, sign_rpm, create_repository
from scripts.prepare_rpm_repository_site import unpack


def prepare(package, public_key, output, release, policy, private_key, previous=None):
    if output.exists() or package.is_symlink() or not package.is_file():
        raise ValueError('New output directory and regular RPM required')
    receipt = json.loads(Path(str(package) + '.build.json').read_text())
    expected_name = f"ttc-rechnungsverwaltung-{release['version']}-{release['release']}.x86_64.rpm"
    if package.name != expected_name or any(receipt.get(k) != v for k, v in release.items()):
        raise ValueError('RPM source receipt does not match release')
    original = package.read_bytes()
    if receipt.get('size') != len(original) or receipt.get('sha256') != hashlib.sha256(original).hexdigest():
        raise ValueError('RPM build checksum mismatch')
    header = run(['rpm', '-qp', '--queryformat', '%{NAME}|%{VERSION}|%{RELEASE}|%{ARCH}|%{VCS}', package])
    expected_header = f"ttc-rechnungsverwaltung|{release['version']}|{release['release']}|x86_64|git+https://github.com/macfloorball/Rechnungsverwaltung#{release['commit']}"
    if header != expected_header or fingerprint(public_key) != policy['keyFingerprint']:
        raise ValueError('RPM source header or public fingerprint mismatch')
    output.mkdir(parents=True)
    with tempfile.TemporaryDirectory(prefix='ttc-rpm-signing-') as temporary:
        home = Path(temporary)
        os.chmod(home, 0o700)
        try:
            run(['gpg', '--homedir', home, '--batch', '--import'], data=private_key)
            keys = run(['gpg', '--homedir', home, '--batch', '--with-colons', '--list-secret-keys'])
            primary = [line.split(':') for line in keys.splitlines() if line.startswith('sec:')]
            fprs = [line.split(':')[9] for line in keys.splitlines() if line.startswith('fpr:')]
            if len(primary) != 1 or not fprs or fprs[0] != policy['keyFingerprint']:
                raise ValueError('Private signing key does not match committed trust anchor')
            target = output / package.name
            target.write_bytes(original)
            sign_rpm(target, public_key, home)
            old = None
            if previous:
                old = home / 'previous'
                unpack(previous, public_key, old, policy['keyFingerprint'], policy['baseUrl'], history=True)
                old = old / 'rpm'
            site = home / 'site' / 'rpm'
            create_repository(target, public_key, home, site, policy['baseUrl'],
                              f"https://github.com/{policy['repository']}/releases/download/{release['tag']}/", old)
            archive = output / 'repository-metadata.tar.gz'
            with tarfile.open(archive, 'w:gz') as tar:
                tar.add(site, arcname='rpm')
            signed = {**receipt, 'unsignedSha256': receipt['sha256'], 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                      'size': target.stat().st_size, 'keyFingerprint': policy['keyFingerprint']}
            (output / (package.name + '.build.json')).write_text(json.dumps(signed, indent=2) + '\n')
            files = sorted(output.iterdir())
            (output / 'SHA256SUMS').write_text(''.join(f'{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.name}\n' for file in files))
        finally:
            # Stop the agent before deleting the ephemeral private keyring.
            run(['gpgconf', '--homedir', home, '--kill', 'gpg-agent'])


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['package', 'public_key', 'output', 'release_json', 'policy_json']:
        p.add_argument(name, type=Path)
    p.add_argument('--previous', type=Path)
    a = p.parse_args()
    prepare(a.package, a.public_key, a.output, json.loads(a.release_json.read_text()),
            json.loads(a.policy_json.read_text()), sys.stdin.buffer.read(), a.previous)
