# Executed by RPM before replacing or removing program files, never user data.
import os
import sys

EXECUTABLE = '/usr/libexec/ttc-rechnungsverwaltung/ttc-rechnungsverwaltung'

def refuse_running_application():
    for entry in os.scandir('/proc'):
        if not entry.name.isdecimal():
            continue
        try:
            executable = os.readlink(entry.path + '/exe')
        except FileNotFoundError:
            continue
        except PermissionError:
            sys.stderr.write('Prozessstatus nicht sicher prüfbar. Installation abgebrochen.\n')
            raise SystemExit(1)
        if executable.removesuffix(' (deleted)') == EXECUTABLE:
            sys.stderr.write('TT Rechnungsverwaltung läuft noch. Bitte die App vollständig schließen und DNF erneut ausführen. Es werden keine Prozesse beendet.\n')
            raise SystemExit(1)

# preun receives 0 only on removal, >0 when replacing the old package.
if __name__ == '__main__':
    refuse_running_application()
