"""Sign RPM packages and rpm-md metadata; never use the system RPM key database."""
from __future__ import annotations
import argparse
import hashlib
import html
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET

NAME = 'ttc-rechnungsverwaltung'

def run(args, *, env=None, data=None):
    result = subprocess.run([str(x) for x in args], input=data, capture_output=True, env=env, check=False)
    if result.returncode:
        raise ValueError(f'{args[0]} failed: {result.stderr.decode(errors="replace")[-3000:]}')
    return result.stdout.decode()

def fingerprint(public_key):
    with tempfile.TemporaryDirectory(prefix='ttc-rpm-key-inspect-') as temporary:
        result = run(['gpg', '--homedir', temporary, '--batch', '--with-colons', '--show-keys', public_key])
    lines = [line.split(':') for line in result.splitlines()]
    pubs = [line for line in lines if line[0] == 'pub']
    if len(pubs) != 1 or pubs[0][1] in ('r', 'e') or pubs[0][3] != '1' or int(pubs[0][2]) < 3072:
        raise ValueError('One valid RSA signing key with at least 3072 bits is required')
    value = next(line[9] for line in lines if line[0] == 'fpr')
    if not re.fullmatch(r'[A-F0-9]{40}|[A-F0-9]{64}', value):
        raise ValueError('Invalid signing fingerprint')
    return value

def verify_rpm(package, public_key):
    with tempfile.TemporaryDirectory(prefix='ttc-rpm-keyring-') as temporary:
        run(['rpm', '--dbpath', temporary, '--initdb'])
        run(['rpmkeys', '--dbpath', temporary, '--import', public_key])
        text = run(['rpmkeys', '--dbpath', temporary, '--checksig', '--verbose', package])
        if not any('signature' in line.lower() and line.rstrip().endswith(': OK') for line in text.splitlines()):
            raise ValueError('RPM must contain a verified package signature')

def sign_rpm(package, public_key, gnupg_home):
    key = fingerprint(public_key)
    run(['rpmsign', '--define', f'_openpgp_sign_id {key}', '--define', f'_gpg_name {key}',
         '--define', f'_gpg_path {gnupg_home}', '--define', '_openpgp_sign gpg',
         '--define', '_gpg_digest_algo sha256', '--addsign', package],
        env={**os.environ, 'GNUPGHOME': str(gnupg_home)})
    verify_rpm(package, public_key)
    return key

def verify_metadata(directory, public_key):
    directory = Path(directory)
    with tempfile.TemporaryDirectory(prefix='ttc-rpm-metadata-keyring-') as temporary:
        run(['gpg', '--homedir', temporary, '--batch', '--import', public_key])
        run(['gpg', '--homedir', temporary, '--batch', '--verify', directory/'repodata/repomd.xml.asc', directory/'repodata/repomd.xml'])
    entries = ET.parse(directory/'repodata/repomd.xml').getroot().findall('{*}data')
    types = [entry.get('type') for entry in entries]
    if len(set(types)) != len(types) or not {'primary', 'filelists', 'other'}.issubset(types):
        raise ValueError('Incomplete repository metadata')
    for data in entries:
        location = data.find('{*}location')
        checksum = data.find('{*}checksum')
        if location is None or checksum is None or checksum.get('type') != 'sha256':
            raise ValueError('Missing SHA-256 repository binding')
        relative = Path(location.get('href', ''))
        if relative.is_absolute() or '..' in relative.parts or relative.parts[0] != 'repodata':
            raise ValueError('Unsafe metadata path')
        file = directory/relative
        if file.is_symlink() or hashlib.sha256(file.read_bytes()).hexdigest() != checksum.text:
            raise ValueError('Repository metadata checksum mismatch')

def repository_config(base_url, key):
    if not base_url.endswith('/') or '\n' in base_url or not re.fullmatch(r'[A-F0-9]{40}|[A-F0-9]{64}', key):
        raise ValueError('Invalid repository configuration')
    if not base_url.startswith('https://') and not re.match(r'^http://127\.0\.0\.1:[0-9]+/', base_url):
        raise ValueError('HTTPS repository required')
    return (f'[{NAME}]\nname=TT Rechnungsverwaltung\nbaseurl={base_url}\nenabled=1\n'
            f'gpgcheck=1\nrepo_gpgcheck=1\ngpgkey={base_url}keys/{key}.asc\n'
            'sslverify=1\nskip_if_unavailable=0\nmetadata_expire=1h\nincludepkgs=ttc-rechnungsverwaltung\n')

def site_texts(base_url, key):
    index = (
        '<!doctype html><html lang="de"><meta charset="utf-8"><title>TT Rechnungsverwaltung – DNF</title>'
        '<h1>TT Rechnungsverwaltung für Fedora x86_64</h1><p>Signiertes RPM-Paketrepository.</p>'
        '<p>Einmalig Repository hinzufügen, anschließend mit DNF installieren:</p><pre>'
        f'sudo dnf config-manager addrepo --from-repofile={html.escape(base_url)}{NAME}.repo\n'
        f'sudo dnf install {NAME}</pre><p>Beim Schlüsselimport diesen Fingerprint vergleichen:</p><pre>{key}</pre>'
        f'<p>Aktualisieren: <code>sudo dnf upgrade {NAME}</code>. App vorher vollständig schließen.</p>'
        '<p>Die Anwendung verwendet FFmpeg unter LGPL-2.1-or-later. '
        '<a href="https://github.com/macfloorball/Rechnungsverwaltung/releases/tag/desktop-sources-2026-11-19">'
        'Drittanbieter-Quellen und Lizenzhinweise</a>.</p></html>'
    )
    return {f'{NAME}.repo': repository_config(base_url, key), 'index.html': index, '.nojekyll': ''}


def create_repository(package, public_key, gnupg_home, destination, base_url, asset_base, previous=None):
    package, public_key, destination = Path(package), Path(public_key), Path(destination)
    if destination.exists() or not re.fullmatch(r'ttc-rechnungsverwaltung-[0-9.]+-[0-9.]+(?:dev)?\.x86_64\.rpm', package.name):
        raise ValueError('New output path and canonical RPM filename required')
    if not asset_base.startswith('https://github.com/macfloorball/Rechnungsverwaltung/releases/download/rpm-v') and not re.match(r'^http://127\.0\.0\.1:[0-9]+/', asset_base):
        raise ValueError('Unapproved RPM asset location')
    key = fingerprint(public_key)
    verify_rpm(package, public_key)
    destination.mkdir(parents=True)
    with tempfile.TemporaryDirectory(prefix='ttc-rpm-metadata-', dir=package.parent) as temporary:
        package_dir = Path(temporary)
        os.link(package, package_dir/package.name)
        run(['createrepo_c', '--no-database', '--checksum', 'sha256', '--general-compress-type', 'gz',
             '--unique-md-filenames', '--workers', '2', '--location-prefix', asset_base.rstrip('/'),
             '--outputdir', destination, package_dir])
    if previous:
        verify_metadata(previous, public_key)
        # Cached old repomd.xml may still reference old hashed metadata files.
        for file in (Path(previous)/'repodata').iterdir():
            if re.fullmatch(r'[a-f0-9]{64}-[A-Za-z0-9_.-]+', file.name) and file.is_file() and not file.is_symlink():
                target = destination/'repodata'/file.name
                if not target.exists(): shutil.copyfile(file, target)
    run(['gpg', '--homedir', gnupg_home, '--batch', '--yes', '--local-user', key, '--digest-algo', 'SHA256',
         '--armor', '--detach-sign', '--output', destination/'repodata/repomd.xml.asc', destination/'repodata/repomd.xml'])
    key_dir = destination/'keys'; key_dir.mkdir()
    shutil.copyfile(public_key, key_dir/f'{key}.asc')
    for name, content in site_texts(base_url, key).items():
        (destination/name).write_text(content)
    verify_metadata(destination, public_key)
    return key

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['sign', 'verify', 'repository'])
    parser.add_argument('--package', type=Path, required=True)
    parser.add_argument('--public-key', type=Path, required=True)
    parser.add_argument('--gnupg-home', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--base-url')
    parser.add_argument('--asset-base')
    parser.add_argument('--previous', type=Path)
    args = parser.parse_args()
    if args.operation == 'sign': print(sign_rpm(args.package, args.public_key, args.gnupg_home))
    elif args.operation == 'verify': verify_rpm(args.package, args.public_key)
    else: print(create_repository(args.package, args.public_key, args.gnupg_home, args.output, args.base_url, args.asset_base, args.previous))
