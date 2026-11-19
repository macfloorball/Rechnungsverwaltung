"""Linux build input validation; real packaged checks reuse test_windows_runtime."""
import hashlib
import io
import sys
import tarfile

import pytest

from scripts import prepare_linux_runtime as runtime

pytestmark = pytest.mark.skipif(sys.platform != "linux", reason="Linux runtime archive semantics")


def archive_fixture(tmp_path, monkeypatch, entries):
    archive = tmp_path / "python.tar.gz"
    with tarfile.open(archive, "w:gz") as target:
        for name, content, link in entries:
            member = tarfile.TarInfo(name)
            if link:
                member.type = tarfile.SYMTYPE
                member.linkname = content
                target.addfile(member)
            else:
                data = content.encode()
                member.size = len(data)
                member.mode = 0o755
                target.addfile(member, io.BytesIO(data))
    monkeypatch.setattr(runtime, "ARCHIVE_SHA256", hashlib.sha256(archive.read_bytes()).hexdigest())
    return archive


def test_corrupt_linux_archive_never_creates_runtime(tmp_path):
    archive = tmp_path / "bad.tar.gz"
    archive.write_bytes(b"not the approved archive")
    with pytest.raises(ValueError, match="SHA-256"):
        runtime.extract_runtime(archive, tmp_path / "runtime")
    assert not (tmp_path / "runtime").exists()


def test_internal_python_alias_is_materialized_without_symlinks(tmp_path, monkeypatch):
    archive = archive_fixture(tmp_path, monkeypatch, [
        ("python/bin/python3.13", "binary-fixture", False), ("python/bin/python3", "python3.13", True)])
    target = tmp_path / "runtime"
    runtime.extract_runtime(archive, target)
    assert (target / "bin/python3").read_text() == "binary-fixture"
    assert not (target / "bin/python3").is_symlink()
    with pytest.raises(ValueError, match="existiert"):
        runtime.extract_runtime(archive, target)


@pytest.mark.parametrize("entry", [
    ("python/../../outside", "untrusted", False),
    ("/tmp/ttc-untrusted", "untrusted", False),
    ("python/bin/python3", "/etc/passwd", True),
])
def test_unsafe_linux_archive_never_publishes_runtime(tmp_path, monkeypatch, entry):
    archive = archive_fixture(tmp_path, monkeypatch, [entry])
    target = tmp_path / "runtime"
    with pytest.raises((ValueError, tarfile.FilterError)):
        runtime.extract_runtime(archive, target)
    assert not target.exists()


def test_linux_runtime_never_replaces_existing_directory(tmp_path):
    target = tmp_path / "runtime"
    target.mkdir()
    (target / "marker").write_text("preserve")
    with pytest.raises(ValueError, match="existiert"):
        runtime.prepare(target)
    assert (target / "marker").read_text() == "preserve"


def test_packaged_linux_license_collections_match_provenance():
    import json
    import os
    from pathlib import Path

    executable = os.environ.get('TTC_LINUX_PYTHON')
    if not executable:
        pytest.skip('Set TTC_LINUX_PYTHON for real packaged evidence')
    python = Path(executable).resolve().parents[1]
    for group in ['python-linux', 'pydantic-core', 'desktop-linux']:
        directory = python / 'licenses' / group
        provenance = json.loads((directory / 'provenance.json').read_text())
        for item in provenance['files']:
            assert hashlib.sha256((directory / item['file']).read_bytes()).hexdigest() == item['sha256']
    evidence = json.loads((python / 'licenses/desktop-linux/provenance.json').read_text())
    for component in evidence['components']:
        for item in component['nativeFiles']:
            assert hashlib.sha256((python / item['file']).read_bytes()).hexdigest() == item['sha256']
    font = python / 'lib/python3.13/site-packages/reportlab/fonts'
    assert len(list(font.glob('*.afm'))) + len(list(font.glob('*.pfb'))) + len(list(font.glob('*.ttf'))) == 9
    assert (font / 'Vera.ttf').is_file()
    assert (font / 'DarkGarden.sfd').is_file()
    assert not (font / '_a______.pfb').exists()
