"""Repeat existing lifecycle regressions, retaining separate temporary evidence.

This runs test-owned processes only. It never changes application timeouts,
release policy, user profiles or signing configuration. Run natively on Windows
for Windows evidence; a Linux run does not qualify a Windows shutdown fix.
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--iterations", type=int, default=20)
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    if not 1 <= args.iterations <= 100:
        parser.error("--iterations must be between 1 and 100")
    output = args.output_dir
    if output is None:
        output = Path(tempfile.mkdtemp(prefix="ttc-shutdown-evidence-"))
    else:
        output = output.resolve()
        output.mkdir(mode=0o700, parents=True, exist_ok=False)
    results = {"platform": sys.platform, "python": sys.version, "runs": []}
    print(f"Shutdown evidence: {output}", flush=True)
    for iteration in range(1, args.iterations + 1):
        log = output / f"run-{iteration}.log"
        with log.open("x", encoding="utf-8") as stream:
            result = subprocess.run([sys.executable, "-m", "pytest", "-vv",
                "tests/test_managed_server.py", "tests/test_storage_lifecycle.py",
                "--basetemp", str(output / f"profiles-{iteration}")], cwd=ROOT,
                stdout=stream, stderr=subprocess.STDOUT, check=False)
        results["runs"].append({"iteration": iteration, "returncode": result.returncode, "log": log.name})
        (output / "result.json").write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
        print(f"Iteration {iteration}/{args.iterations}: {'passed' if result.returncode == 0 else 'FAILED'}", flush=True)
        if result.returncode:
            print("Stop at first failure; preserve logs and per-process stacks.", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
