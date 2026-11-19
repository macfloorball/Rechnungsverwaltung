$ErrorActionPreference = 'Stop'
$cache = Join-Path $env:LOCALAPPDATA 'electron-builder/Cache'
$compiler = @(Get-ChildItem $cache -Recurse -Filter makensis.exe | Where-Object { $_.Directory.Name -eq 'Bin' -and $_.FullName -match 'nsis-3\.0\.4\.1(?:[\\/]|-)' })
$plugins = @(Get-ChildItem $cache -Recurse -Filter StdUtils.dll | Where-Object FullName -Match 'nsis-resources-3\.4\.1(?:[\\/]|-).*x86-unicode')
if ($compiler.Count -ne 1 -or $plugins.Count -ne 1) { throw "Eindeutige festgelegte NSIS-Toolchain nicht gefunden: Compiler=$($compiler.Count), Plugin=$($plugins.Count)." }
$env:TTC_MAKENSIS = $compiler[0].FullName
$env:TTC_NSIS_PLUGINS = $plugins[0].DirectoryName
$env:NSISDIR = $compiler[0].Directory.Parent.FullName
node --test scripts/installer_hooks.test.cjs
if ($LASTEXITCODE) { throw 'Native Installer-Hook-Prüfung fehlgeschlagen.' }

$installer = @(Get-ChildItem 'dist/installer' -Filter '*setup.exe')
if ($installer.Count -ne 1) { throw 'Eindeutiger Installer nicht gefunden.' }
$list = & 7z l $installer[0].FullName
if ($LASTEXITCODE) { throw 'Installerarchiv kann nicht geprüft werden.' }
if ($list -match '(?i)(WinShell|nsProcess)\.dll') { throw 'Ausgeschlossene Plugins noch im Installer enthalten.' }
