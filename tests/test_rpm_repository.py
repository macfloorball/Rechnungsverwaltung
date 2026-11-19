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
