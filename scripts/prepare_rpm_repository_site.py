"""Verify a small signed repository archive before deploying it to GitHub Pages."""
import argparse
from pathlib import Path
import tarfile
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.rpm_repository import verify_metadata, fingerprint, site_texts


def unpack(archive, public_key, output, expected_fingerprint, base_url):
    if output.exists() or fingerprint(public_key) != expected_fingerprint:
        raise ValueError('New output and pinned public key required')
    with tarfile.open(archive) as source:
        members=source.getmembers()
        if len(members)>10000 or sum(m.size for m in members)>64*1024*1024:
            raise ValueError('Oversized repository archive')
        for item in members:
            p=Path(item.name)
            if p.is_absolute() or '..' in p.parts or not (item.isdir() or item.isfile()):
                raise ValueError('Unsafe repository archive')
        output.mkdir(parents=True)
        source.extractall(output,filter='data')
    verify_metadata(output/'rpm',public_key)
    root = output/'rpm'
    expected = site_texts(base_url, expected_fingerprint)
    if {p.name for p in output.iterdir()} != {'rpm'} or {p.name for p in root.iterdir()} != set(expected) | {'keys', 'repodata'}:
        raise ValueError('Unexpected Pages contents')
    for name, value in expected.items():
        if (root/name).read_text() != value:
            raise ValueError('Modified repository bootstrap content')
    keys = list((root/'keys').iterdir())
    if len(keys) != 1 or keys[0].name != expected_fingerprint+'.asc' or keys[0].read_bytes() != public_key.read_bytes():
        raise ValueError('Modified repository trust anchor')
    for file in (root/'repodata').iterdir():
        if file.name in ['repomd.xml', 'repomd.xml.asc']: continue
        import hashlib, re
        if not file.is_file() or not re.fullmatch(r'[a-f0-9]{64}-[A-Za-z0-9_.-]+', file.name) or hashlib.sha256(file.read_bytes()).hexdigest() != file.name[:64]:
            raise ValueError('Unexpected retained metadata file')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('archive',type=Path);p.add_argument('public_key',type=Path);p.add_argument('output',type=Path);p.add_argument('fingerprint');p.add_argument('base_url')
    a=p.parse_args();unpack(a.archive,a.public_key,a.output,a.fingerprint,a.base_url)
