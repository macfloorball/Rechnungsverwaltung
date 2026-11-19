"""Rebuild the pinned Electron FFmpeg source bundle; never publish or sign.

Requires the ordinary 'patch' command. Output must be a new file. License texts,
original patches, build inputs and provenance are included. This is source
preparation, not a legal clearance or a claim of bit-reproducible binaries.
"""
import argparse
import base64
import gzip
import hashlib
import json
import io
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent


def verified_bytes(data, expected):
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError('Source SHA-256 mismatch')
    return data


def source_content_hash(data):
    # Gitiles can change archive wrapping; pin every file/link/mode instead.
    entries = {}
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        for item in archive:
            if Path(item.name).is_absolute() or '..' in Path(item.name).parts:
                raise ValueError('Unsafe source archive path')
            if item.isdir():
                continue
            if item.name in entries:
                raise ValueError('Duplicate source archive path')
            if item.issym():
                content, mode = item.linkname.encode(), '120000'
            elif item.isfile():
                content = archive.extractfile(item).read()
                mode = '100755' if item.mode & 0o111 else '100644'
            else:
                raise ValueError('Unsupported source archive entry')
            entries[item.name] = (mode, hashlib.sha256(content).hexdigest())
    canonical = ''.join(f'{name}\0{mode}\0{digest}\n' for name, (mode, digest) in sorted(entries.items()))
    return hashlib.sha256(canonical.encode()).hexdigest()


def download(entry):
    def read(url):
        with urllib.request.urlopen(url, timeout=60) as response:
            return response.read()
    data = read(entry['url'])
    if 'contentSha256' in entry:
        if source_content_hash(data) != entry['contentSha256']:
            raise ValueError('Source content SHA-256 mismatch')
        return data
    if hashlib.sha256(data).hexdigest() != entry['sha256'] and 'googlesource.com/' in entry['url'] and '+archive/' not in entry['url']:
        data = base64.b64decode(read(entry['url'] + '?format=TEXT'))
    return verified_bytes(data, entry['sha256'])


def extract(archive, target):
    with tarfile.open(archive) as source:
        for item in source.getmembers():
            if Path(item.name).is_absolute() or '..' in Path(item.name).parts:
                raise ValueError('Unsafe source archive path')
        source.extractall(target, filter='data')


def prepare(output):
    if output.exists():
        raise ValueError('Output already exists; choose a new path')
    provenance = json.loads((ROOT / 'third_party/licenses/desktop-windows/provenance.json').read_text())
    component = next(c for c in provenance['components'] if c['name'] == 'Electron Chromium FFmpeg')
    with tempfile.TemporaryDirectory(prefix='ttc-ffmpeg-source-') as temporary:
        root = Path(temporary)
        bundle = root / 'electron-ffmpeg-source'
        source = bundle / 'ffmpeg'
        source.mkdir(parents=True)
        upstream = bundle / 'upstream.tar.gz'
        source_archive = json.loads((ROOT / 'third_party/sources/electron-ffmpeg.json').read_text())
        assert source_archive['revision'] == component['revision']
        upstream.write_bytes(download(source_archive))
        source_archive['downloadedArchiveSha256'] = hashlib.sha256(upstream.read_bytes()).hexdigest()
        extract(upstream, source)
        inputs = bundle / 'build-inputs'
        inputs.mkdir()
        for i, entry in enumerate(component['buildSources']):
            (inputs / f'{i:02d}-{entry["url"].rsplit("/", 1)[-1]}').write_bytes(download(entry))
        patches = bundle / 'patches'
        patches.mkdir()
        for entry in component['patchesInApplicationOrder']:
            patch = patches / entry['url'].rsplit('/', 1)[-1]
            patch.write_bytes(download(entry))
            subprocess.run(['patch', '--batch', '--forward', '--fuzz=0', '-p1', '-i', str(patch)], cwd=source, check=True)
        configs = {}
        for platform in ['win', 'linux']:
            relative = f'chromium/config/Chrome/{platform}/x64/config.h'
            data = (source / relative).read_bytes()
            for flag in ['CONFIG_GPL', 'CONFIG_NONFREE', 'CONFIG_VERSION3']:
                assert f'#define {flag} 0' in data.decode(), (relative, flag)
            configs[platform] = {'path': relative, 'sha256': hashlib.sha256(data).hexdigest()}
        assert configs['win']['sha256'] == component['buildConfiguration']['sha256AfterPatches']
        (bundle / 'provenance.json').write_text(json.dumps({'upstream': component, 'verifiedSourceArchive': source_archive, 'verifiedPatchedConfigs': configs}, indent=2) + '\n')
        (bundle / 'README.txt').write_text(
            'Pinned FFmpeg sources for Electron 45.3.1 / Chromium 156.0.8078.96.\n'
            'ffmpeg/ contains the source with all Electron patches applied in order.\n'
            'upstream.tar.gz preserves the original archive; patches/ preserves originals.\n'
            'build-inputs/ contains DEPS, Electron GN arguments and patch order.\n'
            'Windows and Linux Chrome/x64 configurations are included.\n'
            'Refer to the exact Electron release sources for the complete Chromium/Electron build toolchain.\n'
            'This bundle does not assert a bit-reproducible build or patent clearance.\n'
            'Before binary publication, provide this bundle at a durable publicly accessible URL\n'
            'and record that URL and hash in the distribution documentation.\n'
        )
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open('xb') as file, gzip.GzipFile(filename='', mode='wb', fileobj=file, mtime=0) as compressed, tarfile.open(fileobj=compressed, mode='w') as tar:
            def normalized(info):
                info.uid = info.gid = info.mtime = 0
                info.uname = info.gname = ''
                return info
            tar.add(bundle, arcname=bundle.name, filter=normalized)
    print(json.dumps({'file': str(output), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'published': False}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    prepare(parser.parse_args().output.resolve())
