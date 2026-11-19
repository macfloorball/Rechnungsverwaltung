"""Source-bundle verification rejects changed bytes and unsafe archive paths."""
import hashlib
import io
import tarfile

import pytest

from scripts.prepare_ffmpeg_sources import extract, verified_bytes


def test_sources_reject_wrong_hash():
    data = b'unchanged source'
    assert verified_bytes(data, hashlib.sha256(data).hexdigest()) == data
    with pytest.raises(ValueError, match='SHA-256'):
        verified_bytes(data + b'changed', hashlib.sha256(data).hexdigest())


def test_source_archive_cannot_escape_destination(tmp_path):
    archive = tmp_path / 'source.tar'
    with tarfile.open(archive, 'w') as tar:
        item = tarfile.TarInfo('../outside')
        item.size = 1
        tar.addfile(item, io.BytesIO(b'x'))
    with pytest.raises(ValueError, match='Unsafe'):
        extract(archive, tmp_path / 'sources')
    assert not (tmp_path / 'outside').exists()


def test_source_content_pin_ignores_only_archive_metadata():
    from scripts.prepare_ffmpeg_sources import source_content_hash

    def archive(content, mtime):
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode='w:gz') as tar:
            item = tarfile.TarInfo('source.c')
            item.size = len(content)
            item.mtime = mtime
            item.mode = 0o644
            tar.addfile(item, io.BytesIO(content))
        return buffer.getvalue()

    assert source_content_hash(archive(b'same', 1)) == source_content_hash(archive(b'same', 999))
    assert source_content_hash(archive(b'same', 1)) != source_content_hash(archive(b'changed', 1))
