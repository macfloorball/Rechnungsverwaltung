"""Verify concrete package ownership evidence without asserting license clearance."""
import csv
import json
from pathlib import Path

from scripts.inventory_desktop_licenses import inventory


def package(tmp_path):
    app = tmp_path / 'resources/app'
    runtime = app / 'runtime/python'
    (runtime / 'bin').mkdir(parents=True)
    (runtime / 'bin/python3.13').write_bytes(b'fixture')
    (app / 'package.json').write_text(json.dumps({'version': '0.1.0'}))
    site = runtime / 'lib/python3.13/site-packages'
    metadata = site / 'example-1.0.dist-info'
    metadata.mkdir(parents=True)
    (metadata / 'METADATA').write_text('Name: example\nVersion: 1.0\nLicense-Expression: MIT\n')
    return runtime, site, metadata


def test_record_ownership_preserves_csv_paths_and_unassigned_runtime_files(tmp_path):
    runtime, site, metadata = package(tmp_path)
    library = site / 'example.libs/lib,example.so'
    library.parent.mkdir()
    library.write_bytes(b'owned native fixture')
    (runtime / 'lib/libpython.so').write_bytes(b'unassigned runtime fixture')
    with (metadata / 'RECORD').open('w', newline='') as stream:
        csv.writer(stream).writerow(['example.libs/lib,example.so', '', ''])
    result = inventory(tmp_path)
    files = {Path(item['path']).name: item for item in result['nativeRuntimeFilesForReview']}
    assert files['lib,example.so']['distributionOwners'] == [{
        'name': 'example', 'version': '1.0',
        'record': 'resources/app/runtime/python/lib/python3.13/site-packages/example-1.0.dist-info/RECORD',
    }]
    assert files['libpython.so']['distributionOwners'] == []
    assert result['reviewRequired'] is True


def test_font_component_license_texts_are_inventoried_with_hashes(tmp_path):
    _, site, metadata = package(tmp_path)
    fonts = site / 'example/fonts'
    fonts.mkdir(parents=True)
    names = ['Vera.ttf', 'bitstream-vera-license.txt', 'DarkGarden-copying-gpl.txt']
    for name in names:
        (fonts / name).write_bytes(name.encode())
    (metadata / 'RECORD').write_text(''.join(f'example/fonts/{name},,\n' for name in names))
    result = inventory(tmp_path)
    assert result['fontFilesForReview'][0]['distributionOwners'][0]['name'] == 'example'
    evidence = result['additionalRuntimeLicenseEvidence']
    assert {Path(item['path']).name for item in evidence} == set(names[1:])
    assert all(len(item['sha256']) == 64 for item in evidence)


def test_record_cannot_attribute_files_outside_runtime(tmp_path):
    _, _, metadata = package(tmp_path)
    outside = tmp_path / 'outside.so'
    outside.write_bytes(b'outside fixture')
    (metadata / 'RECORD').write_text(f'{outside},,\n')
    result = inventory(tmp_path)
    assert result['nativeRuntimeFilesForReview'] == []
    assert result['missingKnownLicenseEvidence']
