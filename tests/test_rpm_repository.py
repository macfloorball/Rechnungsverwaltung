import pytest
from scripts.rpm_repository import repository_config


def test_repository_requires_both_signatures_and_limits_package_scope():
    text = repository_config('https://example.org/rpm/', 'A' * 40)
    assert '\ngpgcheck=1\n' in text
    assert '\nrepo_gpgcheck=1\n' in text
    assert '\nsslverify=1\n' in text
    assert '\nincludepkgs=ttc-rechnungsverwaltung\n' in text
    assert 'keys/' + 'A' * 40 + '.asc' in text


@pytest.mark.parametrize('url,key', [
    ('http://example.org/rpm/', 'A' * 40),
    ('https://example.org/\ngpgcheck=0\n', 'A' * 40),
    ('https://example.org/rpm/', 'not-a-fingerprint'),
])
def test_repository_rejects_insecure_or_injected_configuration(url, key):
    with pytest.raises(ValueError):
        repository_config(url, key)


def test_pages_archive_rejects_modified_bootstrap_and_unsafe_paths(tmp_path, monkeypatch):
    import hashlib
    import tarfile
    from scripts import prepare_rpm_repository_site as site
    from scripts.rpm_repository import site_texts
    key = 'A' * 40
    public = tmp_path / 'public.asc'
    public.write_text('test public key')
    monkeypatch.setattr(site, 'fingerprint', lambda _: key)
    # This test isolates the bootstrap/archive boundary. Real PGP and RPM
    # verification is exercised by check_native_rpm_repository.py.
    monkeypatch.setattr(site, 'verify_metadata', lambda *_: None)
    source = tmp_path / 'source' / 'rpm'
    (source / 'keys').mkdir(parents=True)
    (source / 'repodata').mkdir()
    (source / 'keys' / (key + '.asc')).write_bytes(public.read_bytes())
    (source / 'repodata/repomd.xml').write_text('signed-metadata-fixture')
    (source / 'repodata/repomd.xml.asc').write_text('signature-fixture')
    data = b'repository metadata'
    (source / 'repodata' / (hashlib.sha256(data).hexdigest() + '-primary.xml.gz')).write_bytes(data)
    for name, value in site_texts('https://example.org/rpm/', key).items():
        (source / name).write_text(value)
    archive = tmp_path / 'valid.tar.gz'
    with tarfile.open(archive, 'w:gz') as target:
        target.add(source, arcname='rpm')
    site.unpack(archive, public, tmp_path / 'valid', key, 'https://example.org/rpm/')
    (source / 'index.html').write_text('modified download instructions')
    bad = tmp_path / 'bad.tar.gz'
    with tarfile.open(bad, 'w:gz') as target:
        target.add(source, arcname='rpm')
    with pytest.raises(ValueError, match='bootstrap'):
        site.unpack(bad, public, tmp_path / 'modified', key, 'https://example.org/rpm/')
    traversal = tmp_path / 'traversal.tar.gz'
    with tarfile.open(traversal, 'w:gz') as target:
        target.addfile(tarfile.TarInfo('../outside'))
    with pytest.raises(ValueError, match='Unsafe'):
        site.unpack(traversal, public, tmp_path / 'unsafe', key, 'https://example.org/rpm/')
    assert not (tmp_path / 'outside').exists()
