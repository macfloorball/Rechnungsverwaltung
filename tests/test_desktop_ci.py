"""Security and coverage contract of ordinary desktop CI (not release CI)."""
from pathlib import Path
import re

import yaml

ROOT = Path(__file__).resolve().parent.parent


def workflow():
    # BaseLoader keeps GitHub's `on` a string instead of YAML 1.1 boolean True.
    return yaml.load((ROOT / ".github/workflows/desktop-ci.yml").read_text(), Loader=yaml.BaseLoader)


def test_ordinary_ci_has_no_release_trigger_or_write_permissions():
    config = workflow()
    assert set(config["on"]) == {"pull_request", "push", "workflow_dispatch"}
    assert config["on"]["pull_request"]["branches"] == ["Entwicklung-App"]
    assert "main" not in config["on"]["push"]["branches"]
    assert "tags" not in config["on"]["push"]
    assert config["permissions"] == {"contents": "read"}
    for job in config["jobs"].values():
        assert "environment" not in job
        assert "permissions" not in job
        for step in job["steps"]:
            assert "secrets." not in str(step)
            if "uses" in step:
                assert re.fullmatch(r"actions/[a-z-]+@[0-9a-f]{40}", step["uses"])
            if step.get("uses", "").startswith("actions/checkout@"):
                assert step["with"]["persist-credentials"] == "false"


def test_ci_runs_tests_on_both_platforms_and_builds_only_supported_formats():
    jobs = workflow()["jobs"]
    assert set(jobs["tests"]["strategy"]["matrix"]["os"]) == {"ubuntu-24.04", "windows-2025"}
    runs = "\n".join(step.get("run", "") for step in jobs["tests"]["steps"])
    assert "npm run desktop:check" in runs
    assert "python -m pytest -q" in runs
    for name, command in [("windows-build", "npm run desktop:installer:win"), ("linux-build", "npm run desktop:build:linux")]:
        assert jobs[name]["needs"] == "tests"
        assert command in "\n".join(step.get("run", "") for step in jobs[name]["steps"])
    linux = str(jobs["linux-build"])
    assert "check_appimage.cjs" in linux
    assert "TTC_LINUX_PYTHON" in linux
    assert "TTC_WINDOWS_PYTHON" in str(jobs["windows-build"])


def test_ci_and_runtime_requirements_have_no_floating_package_versions():
    for name in ("requirements-ci.txt", "requirements-linux.txt", "requirements-windows.txt"):
        for line in (ROOT / name).read_text().splitlines():
            if not line or line.startswith(("#", "-r ")):
                continue
            assert re.fullmatch(r"[a-zA-Z0-9_-]+==[0-9]+(?:\.[0-9]+)+(?:; .+)?", line), (name, line)


def test_failed_native_tests_preserve_only_scoped_diagnostic_logs():
    steps = workflow()["jobs"]["tests"]["steps"]
    pytest_step = next(step for step in steps if step.get("name") == "Python tests")
    assert '--basetemp "${{ runner.temp }}/ttc-pytest"' in pytest_step["run"]
    diagnostics = next(step for step in steps if step.get("name") == "Preserve lifecycle diagnostics on failure")
    assert diagnostics["if"] == "failure()"
    assert diagnostics["with"]["path"] == "${{ runner.temp }}/ttc-pytest/**/*.log"
    assert diagnostics["with"]["retention-days"] == "7"
    assert diagnostics["with"]["if-no-files-found"] == "ignore"
