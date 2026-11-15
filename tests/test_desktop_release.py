"""Release workflow permissions and dependency barriers are security contracts."""
from pathlib import Path
import re

import yaml


def test_only_tag_pushes_can_start_production_release_workflow():
    root = Path(__file__).resolve().parent.parent
    workflow = yaml.load((root / '.github/workflows/desktop-release.yml').read_text(), Loader=yaml.BaseLoader)
    assert workflow['on'] == {'push': {'tags': ['desktop-v*']}}
    assert workflow['permissions'] == {'contents': 'read'}
    assert workflow['concurrency']['cancel-in-progress'] == 'false'
    jobs = workflow['jobs']
    assert jobs['publish']['needs'] == ['gate', 'linux', 'windows']
    assert jobs['linux']['needs'] == jobs['windows']['needs'] == 'gate'
    assert jobs['windows']['environment'] == jobs['publish']['environment'] == 'desktop-release'
    assert jobs['windows']['runs-on'] == jobs['publish']['runs-on'] == ['self-hosted', 'Windows', 'X64', 'desktop-release-signing']
    for name, job in jobs.items():
        assert (job.get('permissions', {}).get('contents') == 'write') == (name == 'publish')
        for step in job['steps']:
            if 'uses' in step:
                assert re.fullmatch(r'actions/[a-z-]+@[a-f0-9]{40}', step['uses'])
            if step.get('uses', '').startswith('actions/checkout@'):
                assert step['with']['fetch-depth'] == '0'
                assert step['with']['persist-credentials'] == 'false'
                assert step['with']['ref'] == '${{ github.sha }}'
            if 'DESKTOP_UPDATE_PRIVATE_KEY' in str(step):
                assert name == 'publish'
                assert step['run'] == 'node scripts/publish_desktop.cjs'


def test_uploaded_intermediate_artifacts_are_only_selected_binaries_and_metadata():
    root = Path(__file__).resolve().parent.parent
    workflow = yaml.load((root / '.github/workflows/desktop-release.yml').read_text(), Loader=yaml.BaseLoader)
    uploads = [step['with'] for job in workflow['jobs'].values() for step in job['steps'] if step.get('uses', '').startswith('actions/upload-artifact@')]
    assert len(uploads) == 2
    for upload in uploads:
        assert upload['if-no-files-found'] == 'error'
        assert upload['retention-days'] == '1'
        assert len(upload['path'].splitlines()) == 3
        assert all(line.startswith(('dist/installer/*.', 'dist/appimage/*.')) for line in upload['path'].splitlines())
