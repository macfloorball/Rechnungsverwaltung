import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
USER_UNIT_DIRECTORY = Path.home() / ".config" / "systemd" / "user"
SERVICE_NAME = "ttc-rechnungsverwaltung-backup.service"
TIMER_NAME = "ttc-rechnungsverwaltung-backup.timer"


def _systemd_argument(value: str) -> str:
    escaped = (
        value.replace("%", "%%")
        .replace("$", "$$")
        .replace("\\", "\\\\")
        .replace('"', '\\"')
    )
    return f'"{escaped}"'


def _systemd_path(value: str) -> str:
    return (
        value.replace("\\", "\\x5c")
        .replace(" ", "\\x20")
        .replace("\t", "\\x09")
        .replace("%", "%%")
    )


def install_backup_timer(
    project_root: Path = PROJECT_ROOT,
    unit_directory: Path = USER_UNIT_DIRECTORY,
) -> None:
    python_executable = Path(sys.executable).absolute()
    backup_script = (project_root / "scripts" / "backup_database.py").resolve()
    unit_directory.mkdir(mode=0o700, parents=True, exist_ok=True)

    service = "\n".join(
        [
            "[Unit]",
            "Description=Create a private backup of the TTC SQLite database",
            "",
            "[Service]",
            "Type=oneshot",
            "UMask=0077",
            f"WorkingDirectory={_systemd_path(str(project_root.resolve()))}",
            "ExecStart="
            f"{_systemd_argument(str(python_executable))} "
            f"{_systemd_argument(str(backup_script))}",
            "",
        ]
    )
    timer = "\n".join(
        [
            "[Unit]",
            "Description=Weekly TTC database backup",
            "",
            "[Timer]",
            "OnCalendar=Sun *-*-* 03:00:00",
            "Persistent=true",
            f"Unit={SERVICE_NAME}",
            "",
            "[Install]",
            "WantedBy=timers.target",
            "",
        ]
    )

    for filename, content in (
        (SERVICE_NAME, service),
        (TIMER_NAME, timer),
    ):
        unit_path = unit_directory / filename
        unit_path.write_text(content, encoding="utf-8")
        unit_path.chmod(0o600)

    subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
    subprocess.run(
        ["systemctl", "--user", "enable", "--now", TIMER_NAME],
        check=True,
    )
    print("Wöchentlicher Datenbank-Backup-Timer ist aktiviert (Sonntag, 03:00).")


if __name__ == "__main__":
    install_backup_timer()
