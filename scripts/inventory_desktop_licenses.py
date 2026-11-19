"""Inventory shipped license evidence; this is not a legal distribution clearance.

Accept the extracted AppImage root or unpacked Windows application directory.
Only package files are read. No signing keys, profiles or network are accessed.
"""
import argparse
import csv
from email.parser import Parser
import hashlib
import json
from pathlib import Path


def inventory(root):
    root = root.resolve()
    app = root / "resources" / "app"
    package = json.loads((app / "package.json").read_text(encoding="utf-8"))
    runtime = app / "runtime" / "python"
    platform = "linux" if (runtime / "bin" / "python3.13").is_file() else "win32"
    python_license = "lib/python3.13/LICENSE.txt" if platform == "linux" else "LICENSE.txt"
    expected = {
        "project": [app / "LICENSE"],
        "project_notices": [app / "THIRD_PARTY_NOTICES.md"],
        "electron": [root / "LICENSE", root / "LICENSE.electron.txt"],
        "chromium": [root / "LICENSES.chromium.html"],
        "python": [runtime / python_license],
    }
    def relative(file):
        return file.relative_to(root).as_posix()
    def evidence(file):
        return {"path": relative(file), "sha256": hashlib.sha256(file.read_bytes()).hexdigest()}
    known = {name: [evidence(file) for file in candidates if file.is_file() and not file.is_symlink()]
             for name, candidates in expected.items()}
    packages = []
    owners = {}
    for metadata in sorted(runtime.rglob("*.dist-info/METADATA")):
        record = Parser().parsestr(metadata.read_text(encoding="utf-8"))
        licenses = [file for file in metadata.parent.rglob("*") if file.is_file() and not file.is_symlink()
                    and ("licenses" in file.relative_to(metadata.parent).parts or file.name.upper().startswith(("LICENSE", "COPYING", "NOTICE")))]
        ownership_record = metadata.parent / "RECORD"
        if ownership_record.is_file() and not ownership_record.is_symlink():
            with ownership_record.open(encoding="utf-8", newline="") as stream:
                for row in csv.reader(stream):
                    if not row:
                        continue
                    file = (metadata.parent.parent / row[0]).resolve()
                    if file.is_relative_to(runtime) and file.is_file():
                        owners.setdefault(relative(file), []).append({
                            "name": record.get("Name"), "version": record.get("Version"),
                            "record": relative(ownership_record),
                        })
        packages.append({"name": record.get("Name"), "version": record.get("Version"),
            "declaredLicense": record.get("License-Expression") or record.get("License"),
            "declaredLicenseFiles": record.get_all("License-File", []),
            "metadata": evidence(metadata), "licenseEvidence": [evidence(file) for file in sorted(licenses)]})
    native = []
    fonts = []
    additional = []
    for file in sorted(runtime.rglob("*")):
        if not file.is_file() or file.is_symlink():
            continue
        name = file.name.lower()
        if ".so" in name or file.suffix.lower() in {".dll", ".pyd", ".dylib"}:
            native.append({**evidence(file), "distributionOwners": owners.get(relative(file), [])})
        if file.suffix.lower() in {".ttf", ".otf", ".pfb", ".afm"}:
            fonts.append({**evidence(file), "distributionOwners": owners.get(relative(file), [])})
        if (name.startswith(("license", "copying", "notice")) or "-license" in name or "-copying" in name) and not any(part.endswith(".dist-info") for part in file.parts):
            additional.append(evidence(file))
    return {"formatVersion": 1, "platform": platform, "appVersion": package["version"],
        "reviewRequired": True, "knownLicenseEvidence": known,
        "missingKnownLicenseEvidence": [name for name, files in known.items() if not files],
        "pythonDistributions": packages, "additionalRuntimeLicenseEvidence": additional,
        "nativeRuntimeFilesForReview": native, "fontFilesForReview": fonts,
        "ownershipBasis": "Distribution RECORD claims only; not a component license or source-offer clearance. Bundled subcomponents require separate attribution.",
        "limits": "Inventory only: native dependency attribution, source offers and license obligations require separate review of the exact binaries."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package_root", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = inventory(args.package_root)
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, indent=2)
        stream.write("\n")
    print(json.dumps({"platform": report["platform"], "distributions": len(report["pythonDistributions"]),
        "missingKnownLicenseEvidence": report["missingKnownLicenseEvidence"],
        "nativeFilesForReview": len(report["nativeRuntimeFilesForReview"]), "fontsForReview": len(report["fontFilesForReview"]),
        "report": str(args.output)}, indent=2))
    return 1 if report["missingKnownLicenseEvidence"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
