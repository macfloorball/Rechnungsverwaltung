"""Opt-in Fedora test: real signed RPM install/upgrade/remove through DNF."""
from __future__ import annotations
import argparse
import functools
import hashlib
import http.server
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.rpm_repository import create_repository, fingerprint, run, sign_rpm, verify_metadata, verify_rpm


def must_fail(function):
    try:
        function()
    except ValueError:
        return
    raise AssertionError('Untrusted input was accepted')


def main(first, second, output):
    first, second, output = Path(first).resolve(), Path(second).resolve(), Path(output).resolve()
    first_version = run(['rpm', '-qp', '--queryformat', '%{VERSION}-%{RELEASE}', first])
    second_version = run(['rpm', '-qp', '--queryformat', '%{VERSION}-%{RELEASE}', second])
    assert first_version != second_version
    with tempfile.TemporaryDirectory(prefix='ttc-dnf-native-') as temporary:
        root = Path(temporary)
        home = root/'gnupg'; home.mkdir(mode=0o700)
        run(['gpg', '--homedir', home, '--batch', '--pinentry-mode', 'loopback', '--passphrase', '',
             '--quick-generate-key', 'TTC disposable repository acceptance', 'rsa3072', 'sign', '1d'])
        public = root/'public.asc'
        public.write_text(run(['gpg', '--homedir', home, '--armor', '--export']))
        key = fingerprint(public)
        packages = root/'http/packages'; packages.mkdir(parents=True)
        a, b = packages/first.name, packages/second.name
        shutil.copyfile(first, a); shutil.copyfile(second, b)
        must_fail(lambda: verify_rpm(a, public))
        unsigned = root/a.name; shutil.copyfile(a, unsigned)
        sign_rpm(a, public, home); sign_rpm(b, public, home)
        corrupted = root/'corrupt.rpm'; shutil.copyfile(a, corrupted)
        with corrupted.open('r+b') as file:
            file.seek(-1, 2); value=file.read(1); file.seek(-1, 2); file.write(bytes([value[0] ^ 1]))
        must_fail(lambda: verify_rpm(corrupted, public))
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root/'http'))
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        origin = f'http://127.0.0.1:{server.server_port}/'
        repo = root/'http/rpm'
        create_repository(a, public, home, repo, origin+'rpm/', origin+'packages/')
        configuration = Path('/etc/yum.repos.d/ttc-acceptance.repo')
        configuration.write_text((repo/'ttc-rechnungsverwaltung.repo').read_text())
        run(['gpgconf', '--homedir', home, '--kill', 'gpg-agent'])
        def dnf(*args):
            return run(['dnf', '-y', '--setopt=install_weak_deps=False', *args])
        try:
            # DNF must reject unsigned packages even when dependencies can resolve.
            run(['rpm', '--import', public])
            unsigned_result = subprocess.run(['dnf', '-y', '--setopt=localpkg_gpgcheck=True', 'install', str(unsigned)], capture_output=True, text=True)
            unsigned_text = (unsigned_result.stdout + unsigned_result.stderr).lower()
            assert unsigned_result.returncode != 0 and any(message in unsigned_text for message in ['not signed', 'unsigned', 'no signature']), unsigned_text
            original = (repo/'repodata/repomd.xml').read_bytes()
            (repo/'repodata/repomd.xml').write_bytes(original.replace(b'<revision>', b'<revision>0', 1))
            must_fail(lambda: verify_metadata(repo, public))
            bad = subprocess.run(['dnf', '-y', '--repo=ttc-rechnungsverwaltung', '--refresh', 'makecache'], capture_output=True, text=True)
            assert bad.returncode != 0 and any(s in (bad.stdout+bad.stderr).lower() for s in ['gpg', 'signature']), bad.stdout+bad.stderr
            (repo/'repodata/repomd.xml').write_bytes(original)
            verify_metadata(repo, public)
            dnf('--refresh', 'install', 'ttc-rechnungsverwaltung')
            assert run(['rpm', '-q', '--queryformat', '%{VERSION}-%{RELEASE}', 'ttc-rechnungsverwaltung']) == first_version
            data = Path('/root/.config/ttc-rechnungsverwaltung'); data.mkdir(parents=True, exist_ok=True)
            database = data/'acceptance.sqlite3'
            with sqlite3.connect(database) as connection:
                connection.execute('create table invoice(id integer primary key, number text)')
                connection.execute('insert into invoice values(1, "DNF-2020-0001")')
            before = hashlib.sha256(database.read_bytes()).hexdigest()
            next_repo = root/'next-repo'
            create_repository(b, public, home, next_repo, origin+'rpm/', origin+'packages/', previous=repo)
            shutil.rmtree(repo); next_repo.rename(repo)
            run(['gpgconf', '--homedir', home, '--kill', 'gpg-agent'])
            executable = '/usr/libexec/ttc-rechnungsverwaltung/ttc-rechnungsverwaltung'
            child = subprocess.Popen([executable, '-e', 'process.stdout.write("ready\\n");setInterval(()=>{},1000)'],
                                     env={**os.environ, 'ELECTRON_RUN_AS_NODE': '1'}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                assert child.stdout.readline().strip() == 'ready', child.stderr.read()
                blocked = subprocess.run(['dnf', '-y', '--refresh', 'upgrade', 'ttc-rechnungsverwaltung'], capture_output=True, text=True)
                assert blocked.returncode != 0 and 'läuft noch' in blocked.stdout+blocked.stderr, blocked.stdout+blocked.stderr
                assert run(['rpm', '-q', '--queryformat', '%{VERSION}-%{RELEASE}', 'ttc-rechnungsverwaltung']) == first_version
            finally:
                child.terminate(); child.wait(timeout=10)
            dnf('upgrade', 'ttc-rechnungsverwaltung')
            assert run(['rpm', '-q', '--queryformat', '%{VERSION}-%{RELEASE}', 'ttc-rechnungsverwaltung']) == second_version
            assert hashlib.sha256(database.read_bytes()).hexdigest() == before
            dnf('remove', 'ttc-rechnungsverwaltung')
            assert not Path(executable).exists()
            assert hashlib.sha256(database.read_bytes()).hexdigest() == before
            result = dict(passed=True, packageSignaturesVerified=True, tamperedRpmRejected=True,
                          unsignedRpmRejected=True, tamperedMetadataRejectedByDnf=True,
                          installed=first_version, upgraded=second_version,
                          runningApplicationBlockedUpgrade=True, dataSurvivedUpgradeAndRemoval=True,
                          signingKey=key, disposableTestKey=True)
            output.parent.mkdir(parents=True, exist_ok=True); output.write_text(json.dumps(result, indent=2)+'\n')
            print(json.dumps(result))
        finally:
            configuration.unlink(missing_ok=True)
            server.shutdown(); server.server_close()
            run(['gpgconf', '--homedir', home, '--kill', 'gpg-agent'])

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('first');parser.add_argument('second');parser.add_argument('output')
    args=parser.parse_args();main(args.first,args.second,args.output)
